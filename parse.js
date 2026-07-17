// GetComics HTML parsing (cheerio). Deliberately structural-tolerant: results
// are keyed off <article> post cards and download links off their host/label
// rather than exact theme classes, so a WordPress/AIO-button markup tweak
// doesn't silently break everything.
import * as cheerio from 'cheerio';

// ---- Search results -------------------------------------------------------
// getcomics.org/?s=<query> renders a grid of <article> post cards. Each card
// has a title link to the post page, a cover image, and a "Year / Size" line.
export function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('article').each((_, el) => {
    const art = $(el);
    // The post title link: prefer a heading anchor, else the first content link
    // that points at a getcomics post (not a category/tag/author archive).
    let a = art.find('h1 a, h2 a, h3 a, .post-title a').first();
    if (!a.length) a = art.find('a[href*="getcomics"]').filter((__, l) => !/\/(cat|tag|author|page)\//i.test($(l).attr('href') || '')).first();
    const url = (a.attr('href') || '').trim();
    const title = collapse(a.text()) || collapse(art.find('h1, h2, .post-title').first().text());
    if (!url || !title) return;
    const img = art.find('img').first();
    const cover = img.attr('data-src') || img.attr('src') || null;
    const text = art.text();
    out.push({ title, url, cover, year: extractYear(text), size: extractSizeBytes(text) });
  });
  return out;
}

// ---- Post page → download links -------------------------------------------
// Collect every download link and classify by HOST. GetComics wraps EVERY host
// (its own server, MEGA, Mediafire, PixelDrain) behind a getcomics.org/dls/…
// redirector, so the URL path alone can't tell them apart — the button LABEL
// does ("Download Now" vs "Mega Link" vs "Mediafire Link"). Classify by label
// first, then fall back to the URL for un-wrapped links.
const SUPPORTED = new Set(['main', 'pixeldrain']); // direct-HTTP hosts we can fetch

function classifyHost(url, label) {
  const t = label || '';
  // Label wins (the /dls/ URL is opaque). Order matters: third-party hosts
  // before "main", so a /dls/ link labelled "Mega Link" is MEGA, not main.
  if (/pixel\s*drain/i.test(t) || /pixeldrain\.(com|net)/i.test(url)) return 'pixeldrain';
  if (/\bmega\b/i.test(t) || /mega\.(nz|co\.nz)/i.test(url)) return 'mega';
  if (/mediafire/i.test(t) || /mediafire\.com/i.test(url)) return 'mediafire';
  if (/^\s*(download\s*now|main\s*(server|download)|mirror\s*download|download\s*(here|link))\b/i.test(t)) return 'main';
  // Un-labelled getcomics DDL link → assume the direct server.
  if (/getcomics\.(org|info)\/(dls|dlds|links)\//i.test(url)) return 'main';
  return null; // not a download link
}

// All classified download links on the post, supported hosts first. The caller
// filters to SUPPORTED and can report the unsupported ones in an error.
export function parseDownloadLinks(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];
  // Scope to the post body if present, so nav/footer links don't leak in.
  const scope = $('.post-contents, .entry-content, article').first();
  (scope.length ? scope : $('body')).find('a[href]').each((_, el) => {
    const url = ($(el).attr('href') || '').trim();
    const label = collapse($(el).text());
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    const host = classifyHost(url, label);
    if (host) { links.push({ host, url, label }); seen.add(url); }
  });
  const order = ['main', 'pixeldrain', 'mega', 'mediafire'];
  return links.sort((a, b) => order.indexOf(a.host) - order.indexOf(b.host));
}

export { SUPPORTED as SUPPORTED_HOSTS };

// PixelDrain share links (pixeldrain.com/u/<id>) need the API file URL to get
// the raw bytes; direct-file links pass through unchanged.
export function pixeldrainDirectUrl(url) {
  const m = /pixeldrain\.(?:com|net)\/(?:u|d|file)\/([A-Za-z0-9]+)/i.exec(url);
  return m ? `https://pixeldrain.com/api/file/${m[1]}?download` : url;
}

// PixelDrain LIST links (pixeldrain.com/l/<id>) hold one or more files behind
// an album page — the id must be resolved via the list API to a file id, or
// the download fetches the album's HTML viewer instead of any bytes.
export function pixeldrainListId(url) {
  return (/pixeldrain\.(?:com|net)\/l\/([A-Za-z0-9]+)/i.exec(url) || [])[1] || null;
}

// Heuristic: does this post title list an explicit multi-issue RANGE (e.g.
// "#1-6", "1 – 2100")? Only true multi-issue listings are packs — they extract
// into separate issue files we can match and import individually. A plain
// collected edition (TPB/HC/OGN/"Collection" with no range) is ONE bound file
// that can't be split into issues, so it is NOT treated as a pack.
// Parenthetical YEAR ranges like "(1977-2018)" are ignored so they don't read
// as an issue range.
export function isPackTitle(title) {
  const t = String(title || '').replace(/\(\s*(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\s*\)/g, ' ');
  return /(?:#\s*)?\b\d{1,5}\s*[-–—]\s*\d{1,5}\b/.test(t);
}

// Magic-byte format sniff on a Buffer (core's sniffFormat is path-based; we have
// the archive in memory). Same three signatures. Returns 'cbz'|'cbr'|'pdf'|null.
export function sniffBuffer(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'cbz';              // "PK"  → ZIP
  const head = buf.toString('latin1', 0, 4);
  if (head === 'Rar!') return 'cbr';                                 // "Rar!" → RAR
  if (head === '%PDF') return 'pdf';                                 // "%PDF"
  return null;
}

// ---- helpers --------------------------------------------------------------
const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function extractYear(text) {
  const m = /Year\s*[:\-]?\s*(\d{4})/i.exec(text) || /\((\d{4})\)/.exec(text);
  return m ? m[1] : null;
}

// "Size : 242 MB" / "1.2 GB" → bytes. Returns 0 when absent/unparseable.
export function extractSizeBytes(text) {
  const m = /Size\s*[:\-]?\s*([\d.]+)\s*(GB|MB|KB)/i.exec(text);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3;
  return Math.round(n * mult);
}
