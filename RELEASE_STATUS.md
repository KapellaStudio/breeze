# Breeze 19 — Release Candidate Status

**Date:** 22 August 2026

## Ready in source

- Desktop Electron/Chromium browser shell
- real navigation, tabs, downloads, history, bookmarks and restart recovery
- real Private browsing with memory-only sessions
- per-origin site permissions and display-capture broker
- Breeze Flow local creator tools and broad media conversion
- compatible unpacked-extension management
- sandboxed Breeze PDF Workspace + Comfort Reading + local document actions
- separate mobile interaction architecture/prototype
- Netlify download/waitlist site and functions
- Supabase release/waitlist backend with RLS and narrow Breeze Ops seam
- CI gates and cross-platform packaging workflows

## Live infrastructure already provisioned

- GitHub repository: `KapellaStudio/breeze` (public)
- Supabase project: Breeze
- Supabase release bucket + schema: provisioned
- Breeze Ops Edge Function: active
- Netlify project: `kapella-breeze`
- Netlify Supabase public configuration: set
- Netlify Breeze Ops token: functions-only secret

## GitHub publication state

The production-safe backend/configuration layer is staged on the Breeze 19 release
branch and reviewed through a draft pull request. The larger desktop/browser source
archive is being transferred separately because the connected GitHub write API has
a strict per-call content ceiling; source is not considered published until its
reconstructed bytes and CI both verify successfully.

Do not merge the release pull request or trigger a public production launch until
the full source tree is present and `verify.yml` is green.

## Blocking unqualified public desktop launch

macOS and Windows code signing/notarization are still external account/certificate
work. Until signed installers exist, keep the public state honest: preview +
waitlist, with Linux as the only unsigned platform that can ship without an OS
trust warning.

## Engine milestone after this release candidate

Full modern Chrome Web Store / MV3 compatibility, including standard MetaMask and
Phantom experiences, remains a Breeze Chromium Core milestone. Electron's
extension tier must not be marketed as full Chrome-extension parity.
