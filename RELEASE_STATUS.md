# Breeze 19 — Canonical Source / Release Candidate Status

**Updated:** 23 August 2026

## Canonical repository state

`KapellaStudio/breeze` is now the complete Breeze 19 source repository on the
`release/breeze-19-source` integration branch. The oversized-source transfer
scaffolding has been removed after SHA-verified reconstruction and a full passing
verification run. Desktop/mobile source, Electron main process, bridge code,
backend, packaging, and release workflows are tracked as normal repository files.

The Breeze mark is sourced from the tracked Kapella Breeze vector master. Kapella
wordmarks are verified byte-for-byte by CI. Generated root/preview UI remains a
build product; edit `src/` and run `python3 build.py`.

## Verified product surface

- Desktop Electron/Chromium browser shell
- real navigation, tabs, downloads, history, bookmarks and restart recovery
- real Private browsing with memory-only sessions
- per-origin site permissions and display-capture broker
- Breeze Flow local creator tools and broad local media conversion
- compatible unpacked-extension management
- sandboxed Breeze PDF Workspace + Comfort Reading + local document actions
- separate mobile interaction architecture/prototype
- Netlify download/waitlist/release site and functions
- Supabase release/waitlist backend with RLS and narrow Breeze Ops seam
- cross-platform Windows/macOS/Linux packaging workflow
- browser-chrome security, desktop/mobile regression, Electron shell, media,
  browser-core, search and PDF document test gates

## Live infrastructure

- GitHub repository: `KapellaStudio/breeze` (public)
- Supabase project: Breeze (`iyyuxzfjkrtqqixqzsrr`) — healthy
- Supabase release bucket + schema: provisioned; RLS enabled on all public tables
- Breeze Ops Edge Function: active; privileged surface limited to waitlist insert
  and aggregate download counting
- Netlify project: `kapella-breeze`
- Netlify functions use the Supabase project URL + publishable key for reads
- Netlify holds only a Breeze-specific write token as a function secret; no
  Supabase service-role/admin key is sent to Netlify

## Release publication

The desktop package version is `1.3.0`. The repository packaging workflow builds
Linux, Windows and macOS from `main`, publishes checksums, and on the canonical
main merge publishes `v1.3.0-rc.1` as a GitHub prerelease.

No Supabase `releases` row is published until a real installer URL, byte size and
SHA-256 exist. This prevents the download site from advertising nonexistent files.

## Public launch gate

Windows and macOS code signing/notarization remain external credential/account
work. Those packages must stay clearly identified as unsigned prerelease builds
until signing is configured. Linux can be distributed unsigned without the same
platform trust-warning problem.

This is no longer a source-transfer or preview-only repository. The remaining
launch work is release engineering: merge the verified canonical tree, deploy the
repo-backed site/functions, publish CI-built installers/checksums, register the
real artifact metadata, and complete Windows/macOS signing for an unqualified
stable desktop launch.

## Engine milestone after Breeze 19

Full modern Chrome Web Store / Manifest V3 compatibility, including standard
MetaMask and Phantom experiences, remains a Breeze Chromium Core milestone.
Electron's compatibility tier must not be marketed as full Chrome-extension parity.
