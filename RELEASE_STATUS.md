# Breeze 19 — Canonical Source / Release Candidate Status

**Updated:** 23 August 2026

## Canonical repository state

`KapellaStudio/breeze` is the canonical Breeze source and release repository.
PR #1 merged the verified Breeze 19 source into `main`; the temporary source
transfer scaffolding has been removed. Desktop/mobile source, Electron main
process, bridge code, backend, packaging, production smoke verification, and
release workflows are tracked as normal repository files.

The Breeze mark is sourced from the tracked Kapella Breeze vector master. Kapella
wordmarks are integrity-checked by CI. Generated root/preview UI remains a build
product; edit `src/` and run `python3 build.py`.

## Verified product surface

- Desktop Electron/Chromium browser shell
- real navigation, tabs, downloads, history, bookmarks and restart recovery
- real Private browsing with memory-only sessions
- per-origin site permissions and display-capture broker
- Breeze Flow local creator tools and broad local media conversion
- compatible unpacked-extension management
- sandboxed Breeze PDF Workspace + Comfort Reading + local document actions
- separate mobile interaction architecture/prototype
- Netlify-ready download/release/waitlist site and functions
- Supabase release/waitlist backend with RLS and narrow Breeze Ops seam
- cross-platform Windows/macOS/Linux packaging
- browser-chrome security, desktop/mobile regression, Electron shell, media,
  browser-core, search and PDF document gates

## Infrastructure state

- GitHub repository: `KapellaStudio/breeze` (public) — canonical and active
- Supabase project: Breeze (`iyyuxzfjkrtqqixqzsrr`) — healthy
- Breeze Ops Edge Function: active; privileged surface is limited to waitlist
  insert and aggregate download counting
- Netlify project: `kapella-breeze` exists and the required Breeze/Supabase
  environment variables have been configured
- Netlify is now configured to build the canonical GitHub repository from
  production branch `main` with `python3 build.py`, publish directory `site`,
  and Functions directory `netlify/functions`
- A fresh `main` commit was intentionally created after repository linkage to
  trigger the first canonical production deploy and the external production
  smoke workflow
- Netlify may only be called live after `production-smoke.yml` passes the real
  production site, Functions API, beta release API, and download redirect.

## Published release candidate

Breeze `1.3.0` RC 1 is published as GitHub prerelease `v1.3.0-rc.1` from the
canonical `main` branch. The release includes the platform installers,
`SHA256SUMS.txt`, and `release-manifest.json`.

The successful release matrix produced and published:

- macOS Apple silicon DMG
- macOS Intel DMG
- Windows x64 installer
- Linux x64 AppImage
- alternate macOS ZIP and Linux DEB packages

The four canonical platform downloads are registered in Supabase as published
`beta` rows with the exact final byte size and SHA-256 from the release manifest.
The Netlify release page source explicitly queries the beta channel and labels
these files as release-candidate downloads; the backend default remains `stable`
for the eventual signed production channel.

## Public launch gates

### Hosting gate
The repository connection is configured. Require the new canonical production
deploy from `main` and `production-smoke.yml` to pass the live site,
`/api/health`, beta release API, and download redirect checks before closing this
gate.

### Stable desktop signing gate
Windows and macOS code signing/notarization remain external credential/account
work. RC downloads are intentionally labeled unsigned/unnotarized and may trigger
SmartScreen/Gatekeeper warnings. They must not be reclassified as a stable public
release until production signing is configured. Linux does not have the same
platform-signing gate.

Breeze is past the source/CI/package phase: canonical source, backend, CI-built
desktop packages, checksums, release metadata and Supabase beta rows are in
place. The remaining launch work is production smoke verification followed by
Windows/macOS signing/notarization and final signed-build regression.

## Engine milestone after Breeze 19

Full modern Chrome Web Store / Manifest V3 compatibility, including standard
MetaMask and Phantom experiences, remains a Breeze Chromium Core milestone.
Electron's compatibility tier must not be marketed as full Chrome-extension parity.
