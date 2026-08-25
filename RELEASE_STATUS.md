# Breeze 19 — Canonical Source / Release Candidate Status

**Updated:** 24 August 2026

## Canonical repository state

`KapellaStudio/breeze` is the canonical Breeze source and release repository.
Desktop/mobile source, Electron main process, narrow preload bridges, local data
services, backend, packaging, production smoke verification, and release workflows
are tracked as normal repository files.

The feature-complete daily-driver source is now on `main`. Real two-pane Split
View was merged in PR #6, and PR #7 promoted the RC3 publication lane without
redeploying Netlify.

The Breeze mark is sourced from the tracked Kapella Breeze vector master. Kapella
wordmarks are integrity-checked by CI. Generated root/preview UI remains a build
product; edit `src/` and run `python3 build.py`.

## Verified product surface

- Desktop Electron/Chromium browser shell with real tabs/navigation/recovery
- browser-grade omnibox/search plus local tab/library/queue search surfaces
- real downloads, provenance, local history and bookmarks
- real Private browsing with memory-only sessions and persistence exclusions
- per-origin site permissions and display-capture broker
- persistent preferences, first-run import/default-browser flow and Workspaces
- local Reading Queue, Notes and Snapshots
- OS-encrypted Breeze Vault with main-process password handling
- opt-in live New Tab weather using approximate network location
- true inactive-tab renderer sleeping with navigation-history wake restoration
- real two-pane Split View using two independent Chromium `WebContentsView`s
- Breeze Flow local creator tools and broad local media conversion
- sandboxed Breeze PDF Workspace + Comfort Reading + local document actions
- compatible unpacked-extension management with unsupported MV3 service workers
  blocked honestly
- separate mobile interaction architecture/prototype
- cross-platform Windows/macOS/Linux packaging
- browser-chrome security, desktop/mobile regression, shell, media, browser-core,
  search, PDF, Vault, weather, omnibox, tab-sleep and Split View gates

The final Split View candidate passed all 41 browser-chrome security vectors and
42/42 packaged Electron integration checks before merge.

## Published release candidate

Breeze `1.3.0` RC 3 is published as GitHub prerelease `v1.3.0-rc.3` from canonical
`main` source commit `a18cc3dc38be4b6b4a26b43ed2959d8be12ba26b`.

Package/publish run `32712496727` completed successfully for Windows, macOS and
Linux, then generated `SHA256SUMS.txt` and `release-manifest.json` and published
the prerelease.

Canonical platform artifacts from the RC3 manifest:

- macOS Apple silicon DMG — 164,469,053 bytes — SHA-256
  `e359bd0e58c3b8666b52ab1fd399c0877cd88e34bb3c35721c6062945817aab1`
- macOS Intel DMG — 166,456,313 bytes — SHA-256
  `858eee38bc29676dde9264b74de0cde64e86e7796b31c536cf274b56e13f9d58`
- Windows x64 installer — 144,342,985 bytes — SHA-256
  `584d70d9b95be13be47b28375dec20541c5c1fb61179a327d433b8418d7c01ea`
- Linux x64 AppImage — 197,713,535 bytes — SHA-256
  `ae800631d215354b91151f72408f31c1de95761fcf389c30644f87b2d12a4420`

Alternate macOS ZIP and Linux DEB packages are also included in the RC3 release.
Windows and macOS RC3 bytes remain intentionally unsigned/unnotarized test builds.
They are not a stable public release.

## Distribution metadata

The four published Supabase `beta` rows now point to the exact RC3 canonical
artifacts, byte sizes and SHA-256 values above. Existing stable data is left
untouched.

The currently published Netlify production deploy remains the earlier verified
site/functions deploy; RC3 work did not redeploy the site. Its `/api/releases`
function performs live least-privilege reads from the `releases` table with a
60-second cache, while `/download` performs a live newest-build lookup and returns
the stored artifact URL and SHA with `no-store`. Updating beta rows therefore does
not require a site rebuild.

The public release/download/waitlist infrastructure remains separate from the
new site-design deployment milestone.

## Remaining public launch gate

### Stable desktop signing

Windows and macOS code signing/notarization remain external credential/account
work. RC downloads may trigger SmartScreen/Gatekeeper warnings and must not be
reclassified as stable until production trust verification passes.

The production lane is already implemented in `.github/workflows/stable-release.yml`
and `shell/electron-builder.production.yml`.

Stable promotion requires:

- valid Windows code signing with publisher verification
- macOS Developer ID signing, hardened runtime, notarization and stapling
- signed-build launch/regression verification
- new post-signing SHA-256 manifest
- Supabase `stable` rows created only from the final signed artifact manifest
- production smoke against the `stable` channel

GitHub issue #2 tracks this final stable-launch gate.

## Engine milestone after Breeze 19

Full modern Chrome Web Store / arbitrary Manifest V3 compatibility remains a
future Breeze Chromium Core milestone. Phantom is the wallet certified for the
current beta; Electron's compatible unpacked-extension tier must not be marketed
as full Chrome-extension parity.
