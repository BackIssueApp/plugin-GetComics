# Changelog

Notable, user-facing changes per release. Format follows [Keep a Changelog](https://keepachangelog.com);
versions follow the tags in this repository (`vX.Y.Z` → the release bundle BackIssue's plugin catalog installs).

Contributors: please **don't** edit this file in pull requests — entries are added
by the maintainers when changes merge, so concurrent PRs don't conflict here.

## [Unreleased]

### Fixed
- A very large CBR (a collected edition too big to repack in memory) no longer
  fails the whole download with "too large to convert safely" — it's handed to
  the app as-is and filed as a `.cbr` (readable natively; it just isn't
  ComicInfo-tagged).

## [1.2.1] — 2026-07-17

### Fixed
- PixelDrain **list/album links** (`pixeldrain.com/l/…`) now download correctly —
  the plugin resolves the list via PixelDrain's API and fetches the comic file
  inside it, instead of downloading the album's web page (which surfaced as
  "sent a web page instead of the file"). `…/file/…` links are handled too.
- The "sent a web page" diagnostic now logs **which URL** was fetched, so
  mirror problems can be pinned to the exact link.
- **TeraBox links** are now recognized: a "Download Now" button that redirects
  to TeraBox fails with a clear "redirects to TeraBox, which BackIssue can't
  download from directly" error (instead of a misleading Cloudflare message),
  and explicitly labelled TeraBox buttons are classified as an unsupported
  host up front — the plugin moves on to a supported mirror when one exists.
- **Downloads get past the file host's own Cloudflare gate.** The "Download
  Now" button redirects to a file server on a *different domain* with its own
  Cloudflare challenge — and clearance cookies don't cross domains, so
  downloads could 403 even with FlareSolverr configured (while a browser,
  which solves the second challenge invisibly, worked fine). Downloads now
  follow redirects with per-host cookies and solve the file host through
  FlareSolverr when it challenges, then retry. While that challenge solve runs
  (it can take tens of seconds), the queue row shows a live "Solving
  challenge…" / "Connecting…" phase instead of a frozen "Downloading · 0 B".

### Changed
- **Cloudflare clearance is cached and reused across downloads.** A solve costs
  ~20s of Cloudflare's own challenge timer, and the resulting cookie is good for
  ~15 minutes — so the plugin now remembers each host's clearance and reuses it
  instead of re-solving on every download. In testing, the second and later
  downloads from the same file host dropped from ~21s of setup to ~1.5s. Page
  fetches reuse the site's clearance the same way (direct fetch first, solve
  only when the cookie has expired), so searches stop driving a browser solve
  every time.
- A refused download ("download HTTP 403") now says **which mirror** refused
  and what to do: a 403 from GetComics' server is Cloudflare — set a
  FlareSolverr URL (or a download proxy) in Settings → GetComics; a 403 from
  PixelDrain is usually its free transfer limit — try again later.

## [1.2.0] — 2026-07-16

### Fixed
- Genuinely small comics (short chapters) download instead of being rejected
  as "suspiciously small" — the guard now checks the bytes are a real archive.
  When the download host serves a web page instead of the file (a Cloudflare
  challenge or rate limit), the error says exactly that instead of the vague
  size complaint — including the page title the host sent, with the full
  response saved to `data/debug/getcomics-last-response.html` for inspection.

## [1.1.0] — 2026-07-12

### Added
- **Download proxy** (Settings → GetComics): optionally route the file download
  through an HTTP proxy on a clean IP. The download host (`/dls/`) blocks some
  datacenter IPs with a 403 even though the site itself works fine — pointing
  this at a VPN container's HTTP proxy (e.g. `http://gluetun:8888`) gets the
  download through. Only the download is proxied; search and browsing stay on
  the direct connection.

## [1.0.0] — 2026-07-08

Initial release: an immediate direct-download source for single issues.
Works through FlareSolverr when the site challenges, or connects directly;
downloads from the Main DDL host with PixelDrain as a mirror.
