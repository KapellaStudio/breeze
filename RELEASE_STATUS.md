# Breeze 19 — Canonical Source / Release Candidate Status

**Updated:** 23 August 2026

## Canonical repository state

`KapellaStudio/breeze` is the canonical Breeze source and release repository.
PR #1 merged the verified Breeze 19 source into `main`; temporary source-transfer
scaffolding has been removed. Desktop/mobile source, Electron main process,
bridge code, backend, packaging, production smoke verification, and release
workflows are tracked as normal repository files.

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
- live Netlify download/release/waitlist site and functions
- Supabase release/waitlist backend with RLS and narrow Breeze Ops seam
- cross-platform Windows/macOS/Linux packaging
- browser-chrome security, desktop/mobile regression, Electron shell, media,
  browser-core, search and PDF document gates

## Live infrastructure

- GitHub repository: `KapellaStudio/breeze` (public) — canonical and active
- Supabase project: Breeze (`iyyuxzfjkrtqqixqzsrr`) — healthy
- Breeze Ops Edge Function v7: active; privileged surface is limited to waitlist
  insert and aggregate download counting
- Netlify project: `kapella-breeze` — connected to the canonical GitHub repo,
  production branch `main`
- Netlify build settings: `python3 build.py`, publish directory `site`, Functions
  directory `netlify/functions`
- Netlify production publishes all four serverless functions: `download`,
  `health`, `releases`, and `waitlist`
- Netlify deploy secret scanning reported no committed secret matches
- Public Supabase URL/publishable-key fallbacks are intentionally non-secret and
  keep release reads/download routing available if Netlify env injection fails;
  no Supabase service-role/admin key is committed or exposed to Netlify clients

## Published release candidate

Breeze `1.3.0` RC 1 is published as GitHub prerelease `v1.3.0-rc.1` from the
canonical `main` branch. The release includes platform installers,
`SHA256SUMS.txt`, and `release-manifest.json`.

The successful release matrix produced and published:

- macOS Apple silicon DMG
- macOS Intel DMG
- Windows x64 installer
- Linux x64 AppImage
- alternate macOS ZIP and Linux DEB packages

The four canonical platform downloads are registered in Supabase as published
`beta` rows with the exact final byte size and SHA-256 from the release manifest.
The live Netlify release page explicitly queries the beta channel and labels these
files as release-candidate downloads; the backend default remains `stable` for
the eventual signed production channel.

## Production verification

The public RC hosting gate is **complete**.

Permanent `production-smoke.yml` passed on canonical `main` commit
`90ea655e581091ca97778db5cae6cd5666883012` (run `32669707120`). The live checks
confirmed:

- `https://kapella-breeze.netlify.app/` returns HTTP 200
- `/api/health` returns HTTP 200 from Netlify Functions
- `/api/releases?channel=beta` returns HTTP 200, Breeze `1.3.0` / `McCloskey`,
  and all four canonical platform builds
- `/download?channel=beta&platform=linux-x64` redirects to the exact GitHub
  prerelease asset
- the redirect exposes the published Linux SHA-256
  `830995f9733923e7a09e5c8cdb7cb7ce1e53b17086fe3ef66cba013836735e1a`
- Supabase aggregate download counting was independently verified for
  `linux-x64`, version `1.3.0`

GitHub issue #3 (Netlify production connection/deploy) is closed as completed.
The temporary one-shot production probe workflow used during deployment diagnosis
has been removed; the permanent production smoke remains the release guard.

## Remaining public launch gate

### Stable desktop signing
Windows and macOS code signing/notarization remain external credential/account
work. RC downloads are intentionally labeled unsigned/unnotarized and may trigger
SmartScreen/Gatekeeper warnings. They must not be reclassified as a stable public
release until production signing is configured and verified. Linux does not have
the same platform-signing gate.

Stable promotion requires:

- valid Windows code signing with publisher verification
- macOS Developer ID signing, hardened runtime, notarization and stapling
- signed-build launch/regression verification
- new post-signing SHA-256 manifest
- Supabase `stable` rows created only from the final signed artifact manifest
- production smoke against the `stable` channel

GitHub issue #2 tracks this final stable-launch gate.

## Engine milestone after Breeze 19

Full modern Chrome Web Store / Manifest V3 compatibility, including standard
MetaMask and Phantom experiences, remains a Breeze Chromium Core milestone.
Electron's compatibility tier must not be marketed as full Chrome-extension parity.
