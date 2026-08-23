# Breeze

Breeze is Kapella's privacy-focused browser project. This repository is the
canonical Breeze 19 source and release repository.

Start with [`HANDOFF.md`](HANDOFF.md) for product context and decisions,
[`DEPLOY.md`](DEPLOY.md) for release operations, and
[`RELEASE_STATUS.md`](RELEASE_STATUS.md) for the current launch state.

## Source rule

Do not hand-edit the generated root `breeze-desktop.html` or
`breeze-mobile.html`. Edit `src/`, then build:

```bash
python3 build.py
```

The build produces standalone desktop/mobile HTML, writes the Electron UI copy,
and refreshes the Netlify preview copy. There is no frontend bundler.

## Source layout

```text
src/
  breeze-tokens.css       shared design tokens and platform touch overrides
  breeze-core.js          shared safe DOM/data helpers and product data
  breeze-desktop.html     desktop interaction shell
  breeze-mobile.html      separate mobile interaction shell
  breeze-shell-adapter.js narrow bridge between UI and Electron preload API
  breeze-mark.svg         canonical Breeze vector mark
  regress.py / mob.py     desktop and mobile UI regressions
  breach*.py / mbreach.py browser-chrome security regressions

shell/
  main.js                 Electron main process / Chromium browser runtime
  preload.js              narrow renderer bridge
  security.js             navigation and privilege boundary helpers
  downloads.js            download provenance and local history
  permissions.js          per-origin permission broker
  extensions.js           managed unpacked-extension compatibility tier
  media.js                local Breeze Flow media conversion
  documents.js            local PDF operations
  ui/pdf-viewer.*         sandboxed Breeze PDF Workspace
  *test.js                Electron/browser-core/media/document tests

netlify/functions/        release lookup, download routing and waitlist seam
supabase/                 privacy-minimal schema + Breeze Ops Edge Function
site/                     public download/waitlist site
build.py                  deterministic UI/branding build + drift guards
release.py                installer checksum/release metadata helper
.github/workflows/        CI and cross-platform installer/release workflows
```

## Desktop and mobile are intentionally separate

Desktop uses side tabs, hover/popover interactions, split views and right-side
panels. Mobile uses bottom navigation, sheets, thumb-zone controls and touch-safe
private browsing. Shared palette/data belong in the shared core; platform
interaction models do not get compressed into one responsive shell.

See [`MOBILE_ARCHITECTURE.md`](MOBILE_ARCHITECTURE.md).

## Runtime architecture

The desktop product runs in Electron with bundled Chromium. Breeze chrome lives
in the BrowserWindow; real sites live in separate Chromium `WebContentsView`
instances. Privileged behavior is kept behind named preload/main-process APIs.

Breeze 18/19 includes real local history/bookmarks, restart recovery, download
provenance, per-origin permissions, memory-only Private sessions, explicit screen
source selection, trusted local-file PDF opening and a dedicated sandboxed PDF
Workspace with Comfort Reading and local extract/split/merge/rotate actions.

Do not move the desktop runtime to Tauri: platform webviews would break the
cross-platform Chromium-engine contract.

Full Chrome Web Store / modern Manifest V3 parity remains a separate Breeze
Chromium Core milestone. The Electron unpacked-extension tier must not be
marketed as full MetaMask/Phantom/Chrome-extension compatibility. See
[`CHROMIUM_CORE.md`](CHROMIUM_CORE.md).

## Breeze Flow

Breeze Flow is local-first utility software built into the browser. Current
desktop capabilities include image conversion/resizing, text/developer tools,
SHA-256/UUID utilities, and local audio/video conversion across MOV, MP4, MKV,
WebM, AVI, WMV and common audio formats. Media paths remain behind opaque tokens;
Flow does not upload user files to Netlify, Supabase or a conversion API.

## PDF Workspace

Breeze replaces the raw Chromium PDF surface with a dedicated sandboxed document
renderer. It supports faithful page rendering, thumbnails, search, zoom/fit,
Comfort Reading, paragraph focus, and local document manipulation. Filesystem
paths remain in the Electron main process. PDF.js is pinned to 6.2.108 with the
viewer scripting/eval surface disabled.

See [`PDF_WORKSPACE.md`](PDF_WORKSPACE.md).

## Verification

Nothing ships without the repository verification workflow. The principal local
checks are:

```bash
python3 build.py
python3 src/regress.py
python3 src/mob.py
python3 src/sitecheck.py
python3 src/flowcheck.py
python3 src/backendcheck.py
python3 src/privatecheck.py
python3 src/breach.py
python3 src/breach2.py
python3 src/breach3.py
python3 src/mbreach.py
```

CI additionally installs the Electron shell dependencies and runs smoke,
shell-breach, integration, search, media, browser-core and PDF document tests.
The browser-chrome security gate currently covers **41 attack vectors** across
desktop and mobile.

## Branding

`src/breeze-mark.svg` is the canonical Breeze vector mark and is inlined by the
build. Kapella dark/light wordmarks used by the browser/site are stored as
tracked base64 PNG source and checked byte-for-byte in CI. Do not reintroduce a
fallback or redraw a separate Breeze mark in this repository.

## Backend/privacy contract

The live Breeze Supabase project stores release metadata, aggregate download
counts and launch waitlist email only. It stores no per-user browsing history,
page telemetry, device fingerprint or IP analytics.

RLS is enabled on every public table. The publishable key can read only
`is_published = true` release rows. `waitlist` and `download_counts` have no
public policy.

Netlify never receives a Supabase service-role/admin key. Privileged writes pass
through the narrow `breeze-ops` Edge Function using a Breeze-specific secret
whose source representation is SHA-256 digest only.

## Packaging and publication

The Electron package version is **1.3.0**. `.github/workflows/package.yml` builds
Linux, Windows and macOS installers from the canonical `main` branch, retains the
CI artifacts and checksums, and publishes the canonical merge as
`v1.3.0-rc.1` GitHub prerelease.

Windows/macOS are still unsigned/unnotarised until platform signing credentials
are configured, so they must remain clearly labelled prerelease builds. No
Supabase release row should be published until the real artifact URL, byte size
and SHA-256 are known.

## Current release state

The source-transfer phase is complete: the repository tracks the real desktop,
mobile, Electron main-process and adapter source directly. The remaining launch
work is release engineering—merge the green canonical tree, deploy the repo-backed
Netlify site/functions, publish CI-built installer artifacts/checksums, register
real artifact metadata, and finish Windows/macOS signing for an unqualified
stable public desktop launch.
