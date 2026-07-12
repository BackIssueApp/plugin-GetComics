// The GetComics download source: an "immediate" source. find() searches the
// site and matches a post to the wanted issue; fetch() resolves the post's
// download link, streams the archive, and returns it as a CBZ buffer for the
// core import tail to tag + file. No external download client — the fetch is
// synchronous and in-app, like the batcave source.
import config from '../../src/config.js';
import { scoreRelease, suspiciouslySmall, manualTarget } from '../../src/sources/usenet.js';
import { normalizeNumber } from '../../src/matcher.js';
import { cbrBufferToCbz } from '../../src/archive.js';
import { fetchHtml, downloadToBuffer } from './http.js';
import { parseSearchResults, parseDownloadLinks, pixeldrainDirectUrl, sniffBuffer, isPackTitle, SUPPORTED_HOSTS } from './parse.js';
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
      const url = link.host === 'pixeldrain' ? pixeldrainDirectUrl(link.url) : link.url;
      const detail = HOST_LABEL[link.host] || link.host;
      onProgress({ phase: 'download', unit: 'bytes', done: 0, total: candidate.size || 0, bps: 0, detail });
      const { buffer } = await downloadToBuffer(url, {
        referer: candidate.postUrl, session,
        proxyUrl: config.getcomicsDownloadProxy || '',
        onProgress: ({ done, total, bps }) => onProgress({ phase: 'download', unit: 'bytes', done, total, bps, detail }),
      });
      if (suspiciouslySmall(buffer.length)) throw new Error('downloaded file is suspiciously small');
      return buffer;
    } catch (e) { lastErr = e; /* try the next mirror */ }
  }
  throw new Error('getcomics download failed: ' + (lastErr?.message || 'all links failed'));
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
    if (fmt === 'cbr') return { buffer: await cbrBufferToCbz(buffer), format: 'cbz' };
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
