# GetComics Source

An immediate direct-download source for BackIssue: single issues are fetched
in-app from GetComics — no external download client needed. Downloads come
from the Main DDL host with PixelDrain as a mirror fallback.

## Install

One click from **Sidebar → Plugins** in BackIssue, or drop this folder into
the app's `plugins/` directory and restart.

## Setup

Enable it in **Settings → Sources → GetComics**:

- **Site URL** — defaults to the current domain; only change it if the site
  moves again.
- **FlareSolverr URL** (optional) — e.g. `http://flaresolverr:8191/v1`. When
  the site sits behind a Cloudflare challenge, requests are routed through
  [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr); blank means
  connect directly (works when no challenge is up). **Test** tells you which
  path is in use.

Searches match on series title + issue number and prefer proper CBZ/CBR
releases; results import through the normal pipeline (convert, tag, file).
