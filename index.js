// GetComics download source plugin for BackIssue.
//
// A direct-download (DDL) source: searches getcomics.org for a wanted issue,
// resolves the post's download link (its own DDL server, else PixelDrain),
// streams the archive, and returns it as a CBZ for the core import tail to tag
// and file. An "immediate" source — no external download client involved.
//
// getcomics.org is behind Cloudflare; the HTML fetches use FlareSolverr when a
// URL is configured (Settings → GetComics), and fall back to a direct request
// otherwise (which works whenever Cloudflare isn't actively challenging).
import { getcomics } from './source.js';
import { fetchHtml } from './http.js';
import config from '../../src/config.js';
import { parseSearchResults } from './parse.js';

export default function register(api) {
  api.registerSource(getcomics);

  api.registerSettings({
    getcomicsEnabled: { type: 'bool' },
    // Site base URL — the .info domain now redirects to .org; overridable if it
    // moves again.
    getcomicsUrl: { type: 'string', allowEmpty: true },
    // Optional FlareSolverr endpoint (e.g. http://flaresolverr:8191/v1) for
    // getting past Cloudflare. Blank = try direct.
    getcomicsFlaresolverrUrl: { type: 'string', allowEmpty: true },
    // Optional egress proxy for the FILE DOWNLOAD only (e.g. a VPN container's
    // HTTP proxy, http://gluetun:8888). GetComics' download host blocks some
    // datacenter IPs with a 403 while the site itself works — routing the
    // download through a clean IP gets past it. Blank = download direct.
    getcomicsDownloadProxy: { type: 'string', allowEmpty: true },
  });

  // Settings UI (source toggle + fields, and a Test button target).
  api.registerClientAsset({ js: 'client/ui.js' });

  // Connection test: run a trivial search and report how many results parsed —
  // exercises the Cloudflare path so a misconfigured FlareSolverr is obvious.
  // Tests the posted form values (so it works before Save), falling back to
  // saved config.
  api.registerRoute('post', '/api/getcomics/test', async (req, res) => {
    const b = req.body || {};
    const base = String(b.getcomicsUrl || config.getcomicsUrl || 'https://getcomics.org').replace(/\/+$/, '');
    const flareUrl = b.getcomicsFlaresolverrUrl != null ? b.getcomicsFlaresolverrUrl : (config.getcomicsFlaresolverrUrl || '');
    try {
      const html = await fetchHtml(`${base}/?s=batman`, { flareUrl });
      const n = parseSearchResults(html).length;
      return res.json({ ok: n > 0, message: n > 0 ? `Connected — parsed ${n} results.` : 'Reached the site but parsed no results (markup may have changed).' });
    } catch (e) {
      return res.json({ ok: false, message: String(e?.message || e) });
    }
  });
}
