# Breeze 1.0 — Canonical Source / Beta Release Status

**Updated:** 24 August 2026

## Canonical repository state

`KapellaStudio/breeze` is the canonical Breeze source and release repository.
Desktop/mobile source, Electron main process, narrow preload bridges, local data
services, backend, packaging, production smoke verification, and release workflows
are tracked as normal repository files.

The feature-complete daily-driver source is now on `main`. Real two-pane Split
View and the certified Phantom extension path are included in the Breeze 1.0
beta publication lane.

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

## Breeze 1.0 release candidate

Breeze is being repackaged as **Breeze 1.0**. The new public beta artifacts will
be published as GitHub prerelease `v1.0.0-beta.1` only after the cross-platform
package matrix and final verification pass. Historical pre-1.0 release-candidate
metadata is not a current download target. Windows and macOS beta packages remain
intentionally unsigned/unnotarized test builds and are not a stable public release.

## Distribution metadata

The four Supabase `beta` rows will be moved to the exact Breeze 1.0 artifacts,
byte sizes and SHA-256 values only after the new publication manifest is verified.
Existing stable data is left untouched.

The Netlify production site's `/api/releases`
function performs live least-privilege reads from the `releases` table with a
60-second cache, while `/download` performs a live newest-build lookup and returns
the stored artifact URL and SHA with `no-store`. Updating beta rows therefore does
not require a site rebuild.

The public release/download/waitlist infrastructure remains separate from the
new site-design deployment milestone.

## Remaining public launch gate

### Stable desktop signing

Windows and macOS code signing/notarization remain external credential/account
work. Beta downloads may trigger SmartScreen/Gatekeeper warnings and must not be
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
