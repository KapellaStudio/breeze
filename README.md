# Breeze

**Start with [`HANDOFF.md`](HANDOFF.md)** — full project context, decisions and
what remains. [`DEPLOY.md`](DEPLOY.md) is the deployment runbook.

---

# Breeze — source layout

## The rule

**Never edit `breeze-desktop.html` or `breeze-mobile.html` in the output folder.**
They are generated. Edit `src/`, then run the build.

```bash
python3 build.py
```

Output: two standalone HTML files that open by double-click. No server, no
bundler, no `node_modules`.

---

## What lives where

```
src/
  breeze-tokens.css     ← THE palette. Colours, comfort scale, radii, shadows,
                          easing, density. Both shells inline this. Editing a
                          colour here changes both apps.
  breeze-core.js        ← Shared logic and content: esc(), DOM builders, the
                          SITE registry, SR_DATA / QUEUE / WORKSPACES / QUICK,
                          luminance measurement, toast.
  breeze-desktop.html   ← Desktop layout + desktop-only interaction
                          (sidebar, popovers, hover, split view, panels).
  breeze-mobile.html    ← Mobile layout + mobile-only interaction
                          (bottom bar, sheets, swipe, card tab switcher).
  logo.b64              ← Breeze mark, base64.

build.py                ← Inlines tokens + core + logo. Runs the drift guards.
```

### Why two shells and not one responsive file

These are not one layout at two widths. Desktop uses popovers, a sidebar, hover
states and a right panel. Mobile uses bottom sheets, a thumb-zone bar,
swipe-to-dismiss and a card grid. Merging them means one file carrying both
interaction models with half of it dead on any device — and the real product
ships as a desktop binary and a native mobile app anyway.

What they genuinely *share* — the palette and the data — now lives in exactly
one place each.

---

## Drift guards

`build.py` fails the build if either shell:

1. **Redeclares a symbol the core owns** (`esc`, `el`, `toast`, `SR_DATA`, …).
2. **Defines a design token outside `breeze-tokens.css`.**

Both are tested and confirmed to fail correctly. Component-scoped custom
properties set per-instance at runtime (`--site`, `--tintA`, `--tintB`) are
allowlisted in `build.py` — those belong with the component that owns them and
are not part of the palette.

This exists because **twelve tokens drifted apart within a single session**
before the split, and the accidental drift (`--bg2`, `--line`, `--tx3`) was
indistinguishable from the deliberate drift (larger touch radii). Now deliberate
differences are declared in one visible block.

### Where platform differences go

`breeze-tokens.css`, in the `[data-platform="touch"]` block, each with a reason
written next to it. Mobile sets `data-platform="touch"` on `<html>`. Currently:
larger corner radii for touch, safe-area insets, and upward-throwing shadows for
bottom-anchored chrome.

---

## Verification

Run from `src/`. Nothing ships without all of these clean.

```bash
python3 regress.py    # 32-step desktop pass at 1440 / 1180 / 1024px
python3 mob.py        # mobile at 360 / 375 / 393 / 412 / 430px
python3 breach.py     # 9 chrome-XSS vectors, desktop
python3 breach2.py    # 10 URL / pollution / break-out / DoS vectors
python3 mbreach.py    # 10 vectors, mobile
```

**Current status:** zero step failures, zero page errors, zero horizontal
overflow, zero sub-44px tap targets, **0 of 29 attack vectors**.

---

## Runtime architecture

The desktop product already runs in **Electron with bundled Chromium**. The
HTML/CSS shells remain intentionally simple and share `breeze-tokens.css` and
`breeze-core.js`, while privileged browser behavior lives behind narrow Electron
preloads/main-process modules. Do not move the desktop product to Tauri: its
platform webviews would break Breeze's cross-platform Chromium-engine promise.

Full Chrome Web Store / Manifest V3 parity is a separate **Breeze Chromium Core**
engine milestone documented in `CHROMIUM_CORE.md`; do not confuse Electron's
compatible unpacked-extension tier with full Chrome-extension support.


## Breeze Flow

Flow is Breeze's local-first utility workspace. Current desktop tools include image conversion/resizing, text/developer utilities, and broad local audio/video conversion including MOV, MP4, MKV, WebM, AVI, WMV and common audio formats. Desktop drag/drop stays behind the isolated Electron bridge. See HANDOFF.md §16 for the current security boundary and verification contract.

### Breeze 17 browser-core additions

The desktop shell now has real download provenance, local tab restore,
per-origin permission prompts, and a managed unpacked-extension compatibility
tier. Full Manifest V3 / Chrome Web Store-class compatibility is intentionally
reserved for the planned Breeze Chromium core; the Electron build does not
pretend complex MV3 wallets work when they do not.

## Breeze 18 browser-core pass

Private browsing now uses memory-only Electron sessions and is excluded from
restart recovery, automatic history, remembered permissions, extension loading,
recently-closed recovery and persisted download metadata. Normal history,
bookmarks and reopen-closed tabs are real local browser services. Screen sharing
uses an explicit source picker instead of auto-granting a display.

Desktop can also open a local PDF through a trusted file picker (`Cmd/Ctrl+O`)
without exposing its filesystem path to the chrome renderer. Breeze 19 replaces the raw Chromium PDF surface with a dedicated sandboxed
Breeze document renderer. It has faithful page rendering, thumbnail navigation,
search, zoom/fit, and a reflowed Comfort Reading mode with type size, line
spacing, reading width, themes and paragraph focus. Local extract/split/merge/
rotate actions run in the main process; the viewer never receives a filesystem
path. PDF.js is pinned to 6.2.108 with scripting/eval disabled.

Mobile remains a separate interaction shell. See `MOBILE_ARCHITECTURE.md` for
the contract: bottom navigation, sheets, touch-safe private browsing and staged
mobile functionality instead of a compressed desktop UI.


## Breeze 19 — document workspace + release candidate

Local PDFs now open in a dedicated, sandboxed Breeze renderer rather than the
stock Chromium PDF viewer. `shell/pdf-preload.js` exposes only named document
actions and `shell/documents.js` owns filesystem access and PDF manipulation.
The viewer has both faithful page rendering and **Comfort Reading**, a reflowed
reading mode intended for long documents and low-vision comfort.

Document operations are local-only: extract pages, split into ranges, merge
additional PDFs and rotate pages. No document is uploaded to Netlify, Supabase
or a conversion service. See [`PDF_WORKSPACE.md`](PDF_WORKSPACE.md).

The live backend is also provisioned: the Breeze Supabase project exists, RLS
is active, the public installer bucket exists, and the narrow `breeze-ops` Edge
Function is deployed. The `kapella-breeze` Netlify project exists and its
non-secret Supabase configuration is set. Netlify never receives a Supabase
admin/service-role key.
