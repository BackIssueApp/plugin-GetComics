// The GetComics download source: an "immediate" source. find() searches the
// site and matches a post to the wanted issue; fetch() resolves the post's
// download link, streams the archive, and returns it as a CBZ buffer for the
// core import tail to tag + file. No external download client — the fetch is
// synchronous and in-app, like the batcave source.
import fs from 'node:fs';
import path from 'node:path';
import config from '../../src/config.js';
import { scoreRelease, suspiciouslySmall, manualTarget } from '../../src/sources/usenet.js';
import { normalizeNumber } from '../../src/matcher.js';
import { cbrBufferToCbz } from '../../src/archive.js';
import { fetchHtml, downloadToBuffer } from './http.js';
import { parseSearchResults, parseDownloadLinks, pixeldrainDirectUrl, pixeldrainListId, sniffBuffer, isPackTitle, SUPPORTED_HOSTS } from './parse.js';
import { extractPackToDir } from './pack.js';

// Human label for the chosen host, shown in the queue.
const HOST_LABEL = { main: 'GetComics', pixeldrain: 'PixelDrain' };

// Resolve the post's download link and stream the archive (trying each mirror),
// reporting byte progress. Shared by fetch() (single issue) and fetchPack().
async function downloadArchive(candidate, session, onProgress) {
  const html = await fetchHtml(candidate.postUrl, { flareUrl: flareUrl(), session });
  const all = parseDownloadLinks(html);
  const links = all.filter((l) => SUPPORTED_HOSTS.has(l.host));
  if (!links.length) {
    const unsupported = [...new Set(all.map((l) => l.host))];
    // A common case: the post only offers MEGA/Mediafire (behind GetComics'
    // /dls/ redirector), neither of which is a direct HTTP download.
    throw new Error(unsupported.length
      ? `this post only offers ${unsupported.join('/')} — not a direct download (need a GetComics or PixelDrain link)`
      : 'no download link found on ' + candidate.postUrl);
  }
  let lastErr = null;
  for (const link of links) {
    try {
      let url = link.host === 'pixeldrain' ? pixeldrainDirectUrl(link.url) : link.url;
      // A PixelDrain LIST (album) link can't be fetched directly — ask the
      // list API for its files and take the comic (or the largest file).
      const listId = link.host === 'pixeldrain' ? pixeldrainListId(link.url) : null;
      if (listId) {
        const res = await fetch(`https://pixeldrain.com/api/list/${listId}`);
        if (!res.ok) throw new Error(`pixeldrain list lookup failed (HTTP ${res.status})`);
        const meta = await res.json();
        const files = Array.isArray(meta?.files) ? meta.files : [];
        const best = files.find((f) => /\.(cbz|cbr|pdf)$/i.test(f.name || ''))
          || [...files].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
        if (!best?.id) throw new Error('pixeldrain list has no downloadable file');
        url = `https://pixeldrain.com/api/file/${best.id}?download`;
      }
      const detail = HOST_LABEL[link.host] || link.host;
      // Connecting/solving can take tens of seconds before the first byte —
      // show an indeterminate phase, not a frozen "Downloading · 0 B".
      onProgress({ phase: 'connecting', detail });
      const { buffer } = await downloadToBuffer(url, {
        referer: candidate.postUrl, session,
        proxyUrl: config.getcomicsDownloadProxy || '',
        // The file host may run its OWN Cloudflare gate on a different domain
        // than the site — downloadToBuffer solves it per-host when challenged.
        flareUrl: flareUrl(),
        // The slow pre-stream stages report themselves so the queue row moves.
        onStage: (name) => onProgress({ phase: name === 'solving' ? 'solving' : 'connecting', detail }),
        onProgress: ({ done, total, bps }) => onProgress({ phase: 'download', unit: 'bytes', done, total, bps, detail }),
      }).catch((e) => {
        // "download HTTP 403" alone helps nobody — say which mirror refused
        // and what to do about it. 403 on the main server is Cloudflare (or an
        // IP block); 403 on PixelDrain is usually its free transfer limit.
        const st = /download HTTP (\d{3})/.exec(e.message)?.[1];
        if (st === '403' && link.host === 'main') {
          const remedy = flareUrl() ? 'the download host is blocking this IP — try a download proxy in Settings → GetComics'
            : 'set a FlareSolverr URL in Settings → GetComics to get past it';
          // Nothing changes between retries (no config, no cookies) — retrying
          // a Cloudflare 403 just burns requests. Same for a transfer cap.
          throw Object.assign(new Error(`GetComics' download server refused the request (HTTP 403 — Cloudflare); ${remedy}`), { noRetry: true });
        }
        if (st && link.host === 'pixeldrain') {
          throw Object.assign(new Error(`PixelDrain refused the download (HTTP ${st}${st === '403' ? ' — usually its free transfer limit; try again later' : ''})`), { noRetry: st === '403' });
        }
        throw new Error(`${detail} download failed (${e.message})`);
      });
      if (suspiciouslySmall(buffer.length)) {
        // Small can be legitimate (a short chapter) — but only when the BYTES
        // are a real archive. A tiny HTML body is the download host serving a
        // Cloudflare challenge / error page instead of the file: name that,
        // so the queue error explains itself.
        const kind = sniffBuffer(buffer);
        if (!kind) {
          const head = buffer.toString('latin1', 0, 512);
          const looksHtml = /<(!doctype|html)/i.test(head);
          // Keep the evidence: the LAST bad body is saved for inspection, and
          // the page title (the host's own words — "Just a moment…",
          // "Rate limited", a 404 …) goes in the log.
          const title = (head.match(/<title[^>]*>([^<]{0,120})/i) || [])[1]?.trim();
          let saved = '';
          try {
            const dir = path.join(config.dataDir, 'debug');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, looksHtml ? 'getcomics-last-response.html' : 'getcomics-last-response.bin');
            fs.writeFileSync(file, buffer);
            saved = file;
          } catch { /* debug dump is best-effort */ }
          console.warn(`getcomics: ${detail} returned ${buffer.length} bytes of ${looksHtml ? 'HTML' : 'unknown data'} from ${url}${title ? ` — page title: "${title}"` : ''}${saved ? ` (saved to ${saved})` : ''}`);
          // Say WHOSE page came back. A "Download Now" /dls/ button can
          // redirect anywhere — some posts point it at TeraBox and the like,
          // which need a browser/account and can't be fetched directly.
          const cloudHost = /terabox|1024tera/i.test(head) ? 'TeraBox'
            : /mediafire/i.test(head) ? 'Mediafire'
              : /mega\.nz/i.test(head) ? 'MEGA' : null;
          throw Object.assign(new Error(!looksHtml
            ? 'downloaded file is suspiciously small and not a comic archive'
            : cloudHost
              ? `this post's ${detail} link redirects to ${cloudHost}, which BackIssue can't download from directly — try another release for this issue`
              : `${detail} sent a web page instead of the file${title ? ` ("${title}")` : ''} — Cloudflare challenge or rate limit on the download host; a browser download works because it can pass the challenge`),
          // A redirect to an unsupported cloud host won't change on retry.
          cloudHost ? { noRetry: true } : {});
        }
      }
      return buffer;
    } catch (e) { lastErr = e; /* try the next mirror */ }
  }
  // Preserve noRetry: if the last mirror's failure can't be fixed by retrying
  // (Cloudflare 403, transfer cap), retrying the whole download can't either.
  throw Object.assign(new Error('getcomics download failed: ' + (lastErr?.message || 'all links failed')),
    lastErr?.noRetry ? { noRetry: true } : {});
}

const siteUrl = () => (config.getcomicsUrl || 'https://getcomics.org').replace(/\/+$/, '');
const flareUrl = () => config.getcomicsFlaresolverrUrl || '';

// Build the search query for a single issue: "<name> <number>". GetComics is a
// WordPress site whose post titles carry the BARE issue number ("Poison Ivy
// #46"), so search with the un-padded number — the usenet-style zero-padded
// token ("046") never matches its full-text search.
export function buildQuery(name, issue) {
  const num = normalizeNumber(issue?.issue_number);
  return [name, /^\d/.test(num) ? num : ''].filter(Boolean).join(' ').trim();
}

// Choose the best post for an issue from parsed search results (pure — the
// network-free core of find()). Keeps only true title+number matches that
// aren't suspiciously small, best score first. Exported for testing.
export function pickBestPost(results, target) {
  const scored = results
    .filter((r) => !suspiciouslySmall(r.size))
    .map((r) => ({ r, score: scoreRelease(r.title, target) }))
    .filter((x) => x.score != null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.r || null;
}

export const getcomics = {
  id: 'getcomics',
  label: 'getcomics',
  kind: 'immediate',
  isEnabled: (cfg) => !!cfg?.getcomicsEnabled,

  async find(ctx) {
    const session = {}; // one CF solve serves the whole find()
    const names = (ctx.seriesNames && ctx.seriesNames.length) ? ctx.seriesNames : [ctx.seriesTitle];
    const target = { series: ctx.seriesTitle, names, number: ctx.issue?.issue_number, year: ctx.seriesYear };

    const runSearch = async (queries) => {
      const byUrl = new Map();
      for (const q of queries) {
        if (!q) continue;
        let html;
        try { html = await fetchHtml(`${siteUrl()}/?s=${encodeURIComponent(q)}`, { flareUrl: flareUrl(), session }); }
        catch (e) { throw new Error('getcomics search failed: ' + (e?.message || e)); }
        for (const r of parseSearchResults(html)) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
      }
      return [...byUrl.values()];
    };

    // Primary: "<name> <number>". Fallback: name-only (some posts title the
    // issue in a form the number search misses); scoreRelease filters either way.
    let results = await runSearch(names.map((n) => buildQuery(n, ctx.issue)));
    if (!results.length) results = await runSearch(names);

    const best = pickBestPost(results, target);
    return best ? { source: 'getcomics', postUrl: best.url, title: best.title, size: best.size, _session: session } : null;
  },

  async fetch(candidate, ctx, onProgress = () => {}) {
    const session = candidate._session || {};
    onProgress({ phase: 'download', unit: 'bytes', done: 0, total: 0 });
    const buffer = await downloadArchive(candidate, session, onProgress);
    // GetComics serves CBZ/ZIP mostly, sometimes CBR — normalize to CBZ so it
    // can be tagged. Sniff by magic bytes, not extension.
    const fmt = sniffBuffer(buffer);
    if (fmt === 'cbr') {
      // Normalize to CBZ so it can be tagged. An oversized CBR (a big collected
      // edition) can't be repacked in memory — hand the raw RAR to the core,
      // which files it as a .cbr (the app reads CBR natively).
      try { return { buffer: await cbrBufferToCbz(buffer), format: 'cbz' }; }
      catch (e) {
        if (!/too large to convert/i.test(String(e?.message))) throw e;
        return { buffer, format: 'cbr' };
      }
    }
    if (fmt === 'cbz') return { buffer, format: 'cbz' };
    if (fmt === 'pdf') return { buffer, format: 'pdf' };
    throw new Error('unrecognized archive from getcomics');
  },

  // Download a PACK post and extract it to a temp dir of comic files, for core's
  // processPack to import each missing issue. Returns { dir } — the caller
  // removes it after import.
  async fetchPack(candidate, ctx, onProgress = () => {}) {
    const session = candidate._session || {};
    onProgress({ phase: 'download', unit: 'bytes', done: 0, total: 0 });
    const buffer = await downloadArchive(candidate, session, onProgress);
    const { dir, count } = await extractPackToDir(buffer, candidate.title);
    return { dir, count };
  },

  // Multi-result manual search: matching GetComics posts. A pick downloads that
  // exact post in-app (the pin → worker → fetch path). Broad (score is a hint,
  // not a filter), so packs and near-matches show too.
  async manualSearch(ctx) {
    const session = {};
    const q = String(ctx.query || '').trim();
    const names = (ctx.seriesNames && ctx.seriesNames.length) ? ctx.seriesNames : [ctx.seriesTitle].filter(Boolean);
    const queries = q ? [q] : names.map((n) => buildQuery(n, ctx.issue));
    const target = manualTarget(ctx);
    const byUrl = new Map();
    for (const query of queries) {
      if (!query) continue;
      let html;
      try { html = await fetchHtml(`${siteUrl()}/?s=${encodeURIComponent(query)}`, { flareUrl: flareUrl(), session }); }
      catch (e) { return { results: [], error: String(e?.message || e) }; }
      for (const r of parseSearchResults(html)) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
    }
    const results = [...byUrl.values()]
      .filter((r) => !suspiciouslySmall(r.size))
      .map((r) => {
        const pack = isPackTitle(r.title);
        return { source: 'getcomics', postUrl: r.url, title: r.title, size: r.size, isPack: pack, meta: pack ? 'getcomics · pack' : 'getcomics', score: scoreRelease(r.title, target) };
      });
    return { results, searched: queries };
  },
};
