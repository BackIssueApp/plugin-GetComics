# Changelog

Notable, user-facing changes per release. Format follows [Keep a Changelog](https://keepachangelog.com);
versions follow the tags in this repository (`vX.Y.Z` → the release bundle BackIssue's plugin catalog installs).

Contributors: please **don't** edit this file in pull requests — entries are added
by the maintainers when changes merge, so concurrent PRs don't conflict here.

## [Unreleased]

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
