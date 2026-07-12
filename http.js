// HTTP layer for the GetComics source. getcomics.org sits behind Cloudflare, so
// fetching its HTML sometimes needs a challenge solved. Strategy, in order:
//   1. FlareSolverr, if its URL is configured (the proven approach — an external
//      service that drives a real browser and returns cf_clearance cookies).
//   2. Direct undici with realistic browser headers — works whenever Cloudflare
//      isn't actively challenging; a detected challenge fails with a clear hint.
// Downloads go direct (undici streaming), carrying any cookies obtained —
// unless a download proxy is configured (see downloadDispatcher).
import { request, Agent, ProxyAgent, interceptors } from 'undici';

// Redirect following moved out of request()'s options in undici v7+ (passing
// maxRedirections now throws "use the redirect interceptor"). Compose it onto a
// shared dispatcher instead. The DDL "Download Now" link redirects to the real
// file, and PixelDrain/host links redirect too, so we need this on downloads.
const redirectDispatcher = new Agent().compose(interceptors.redirect({ maxRedirections: 5 }));

// Some GetComics download hosts (the /dls/ redirector) block datacenter IPs
// outright with a 403 — while the search/browse path is unaffected. An optional
// egress proxy (e.g. a VPN container's HTTP proxy, http://gluetun:8888) routes
// ONLY the file download out through a clean IP. One dispatcher per proxy URL,
// cached; redirects still apply (the DDL link redirects to the real file).
const proxyDispatchers = new Map();
function downloadDispatcher(proxyUrl) {
  if (!proxyUrl) return redirectDispatcher;
  let d = proxyDispatchers.get(proxyUrl);
  if (!d) {
    d = new ProxyAgent(proxyUrl).compose(interceptors.redirect({ maxRedirections: 5 }));
    proxyDispatchers.set(proxyUrl, d);
  }
  return d;
}

// A current, realistic desktop Firefox UA. When FlareSolverr solves a challenge
// its cf_clearance cookie is bound to the UA it used, so we adopt whatever UA it
// reports for the follow-up direct requests.
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0';

// SSRF guard: the URLs here originate from a client-supplied search result
// (a downloads.grab holder), so refuse obviously-internal targets — loopback,
// private/link-local ranges, and the cloud metadata endpoint. Domain names are
// allowed (this fetches public comic hosts); a literal internal IP is not.
function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error('invalid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`refusing non-http(s) URL: ${u.protocol}`);
  if (process.env.GETCOMICS_ALLOW_INTERNAL === '1') return u; // test hook only
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const bad = host === 'localhost' || host.endsWith('.localhost')
    || /^127\./.test(host) || host === '0.0.0.0' || host === '::1' || host === '::'
    || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host) || /^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host);
  if (bad) throw new Error(`refusing to fetch an internal address: ${host}`);
  return u;
}

function looksChallenged(html, status) {
  if (status === 403 || status === 503) return true;
  return /just a moment|challenge-platform|cf-browser-verification|_cf_chl/i.test(html || '');
}

// Solve/fetch a CF-gated page via FlareSolverr. Returns { html, cookieHeader, ua }.
async function viaFlareSolverr(flareUrl, url) {
  // FlareSolverr v3 lives at /v1 — tolerate the URL given with or without it (a
  // classic Mylar footgun: without /v1 it 405s and fails silently).
  const endpoint = /\/v1\/?$/.test(flareUrl) ? flareUrl : flareUrl.replace(/\/+$/, '') + '/v1';
  const res = await request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 }),
  });
  const data = await res.body.json();
  if (data.status !== 'ok' || !data.solution) throw new Error('FlareSolverr: ' + (data.message || 'no solution'));
  const sol = data.solution;
  const cookieHeader = (sol.cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
  return { html: sol.response || '', cookieHeader, ua: sol.userAgent || DEFAULT_UA, status: sol.status || 200 };
}

// Direct fetch with browser-like headers. Returns the same shape.
async function viaDirect(url, { cookieHeader = '', ua = DEFAULT_UA } = {}) {
  const res = await request(url, {
    method: 'GET',
    dispatcher: redirectDispatcher,
    headers: {
      'user-agent': ua,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
  const html = await res.body.text();
  return { html, cookieHeader, ua, status: res.statusCode };
}

// Fetch a GetComics HTML page, solving Cloudflare if needed. `session` carries
// cookies/UA between calls so one solve serves the whole find→fetch flow.
export async function fetchHtml(url, { flareUrl = '', session = {} } = {}) {
  assertPublicUrl(url);
  if (flareUrl) {
    const r = await viaFlareSolverr(flareUrl, url);
    session.cookieHeader = r.cookieHeader;
    session.ua = r.ua;
    return r.html;
  }
  const r = await viaDirect(url, session);
  if (looksChallenged(r.html, r.status)) {
    throw new Error('Cloudflare challenge on ' + new URL(url).host +
      ' — set a FlareSolverr URL in Settings → GetComics to get past it.');
  }
  return r.html;
}

// Stream a file to a Buffer (the DDL/PixelDrain hosts aren't CF-gated). Returns
// { buffer, filename } — filename from content-disposition when present.
// onProgress({ done, total, bps }) fires as bytes arrive (throttled), where
// total is the content-length (0 if the server omits it) and bps is a smoothed
// bytes/second.
export async function downloadToBuffer(url, { referer = '', session = {}, maxBytes = 2 * 1024 * 1024 * 1024, onProgress = null, proxyUrl = '' } = {}) {
  assertPublicUrl(url);
  const res = await request(url, {
    method: 'GET',
    dispatcher: downloadDispatcher(proxyUrl),
    headers: {
      'user-agent': session.ua || DEFAULT_UA,
      accept: '*/*',
      ...(referer ? { referer } : {}),
      ...(session.cookieHeader ? { cookie: session.cookieHeader } : {}),
    },
  });
  if (res.statusCode >= 400) throw new Error('download HTTP ' + res.statusCode);
  const cd = res.headers['content-disposition'] || '';
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(Array.isArray(cd) ? cd[0] : cd);
  const filename = m ? decodeURIComponent(m[1].replace(/"/g, '').trim()) : null;
  const total = Number(res.headers['content-length']) || 0;

  const chunks = [];
  let done = 0;
  // Speed: bytes over a short trailing window, emitted at most ~5×/s.
  let winStart = null, winBytes = 0, bps = 0, lastEmit = 0;
  const nowMs = () => Number(process.hrtime.bigint() / 1000000n);
  for await (const chunk of res.body) {
    done += chunk.length;
    if (done > maxBytes) throw new Error('file exceeds size cap (' + Math.round(maxBytes / 1024 / 1024) + 'MB)');
    chunks.push(chunk);
    if (!onProgress) continue;
    const t = nowMs();
    if (winStart === null) winStart = t;
    winBytes += chunk.length;
    const elapsed = t - winStart;
    if (elapsed >= 1000) { bps = Math.round((winBytes / elapsed) * 1000); winStart = t; winBytes = 0; }
    if (t - lastEmit >= 200) { lastEmit = t; onProgress({ done, total, bps }); }
  }
  if (onProgress) onProgress({ done, total: total || done, bps });
  return { buffer: Buffer.concat(chunks), filename };
}

export { DEFAULT_UA };
