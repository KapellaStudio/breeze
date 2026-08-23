# Breeze Shell — the desktop application

This is where Breeze stops being a prototype and becomes a browser.

```bash
npm install
npm start          # run it
npm run smoke      # 12 functional checks, headless, exits non-zero on failure
npm run breach     # 7 security checks against the IPC bridge and isolation
npm run integration # 12 end-to-end checks: does the CHROME drive real tabs?
npm run searchtest  # 30 search checks against a local stub — no key, no quota

npm run pack        # unpacked build — fastest way to test a packaging change
npm run dist:linux  # .AppImage + .deb
npm run dist:win    # .exe (NSIS, per-user)
npm run dist:mac    # .dmg + .zip, arm64 and x64
```

Every `dist:*` and `pack` script runs the root `build.py` first. Calling
`npx electron-builder` directly without doing that packages an app with **no
user interface** — it builds cleanly and launches to a blank window.

Nothing is signed. See `electron-builder.yml` and HANDOFF.md §7B.

`ui/breeze-desktop.html` is produced by the root `build.py`. Do not edit it here.

## How it is put together

The BrowserWindow hosts **only Breeze's own chrome**. Every web page lives in
its own `WebContentsView`, positioned in the gap the chrome leaves. That split
is the entire security story: page content never shares a renderer with the UI
that holds privileged IPC, so a compromised page cannot reach the shell API.

`preload.js` exposes `window.__BREEZE_SHELL__` — the object `breeze-core.js`
has been looking for since the shell bridge was written. Every method is named
explicitly. There is deliberately **no generic `invoke(channel, args)`**,
because that single convenience would hand a chrome XSS the whole main process.

## Sealed workspaces are real here

`session.fromPartition('persist:ws-<id>')` gives a sealed workspace a genuinely
separate cookie jar, cache and storage. This is the one place where the concept
we designed and the platform primitive line up exactly — proven by the breach
suite, which writes a cookie in one partition and confirms it is absent in the
other.

## Session recovery is real here too

- `reload`  — plain reload.
- `rebuild` — clears cachestorage, service workers, indexeddb and websql for the
  origin, then hard-reloads. **Cookies are untouched, so you stay signed in.**
- `reset`   — clears everything for the origin, including cookies.

That middle option is the feature the product is named around, and it is four
lines of `clearStorageData` with the right `storages` array.

## The chrome drives real tabs

`src/breeze-shell-adapter.js` binds the UI to the bridge. Outside Electron it
is a no-op, so the standalone prototype is unchanged. Inside it, the mock tab
list is dropped and `GROUPS` becomes a live projection of real tab state — so
the rendering layer never learns which it is looking at.

Proven end to end by `npm run integration`: real page titles in the sidebar,
real URL in the address bar, real back/forward, real find-in-page, and the
content view positioned in the exact gap the chrome reports (188×48).

## What still has to happen before shipping

1. **Code signing.** Apple Developer ID ($99/yr) and a Windows certificate.
   Unsigned builds are blocked by Gatekeeper and SmartScreen.
3. **Auto-update** over a signed, pinned channel.
4. **A real blocklist.** `security.js` ships a 24-host starter list; production
   should consume EasyList/EasyPrivacy.
5. **Extensions.** Electron supports only a subset of the Chrome API and
   unpacked extensions only. Full parity needs a Chromium fork — see DEPLOY.md.

## Container note

In a sandboxed CI container, run with `--no-sandbox --disable-gpu` and expect
harmless D-Bus errors. Never ship `--no-sandbox` to users.

## Search

`search.js` owns it. Redirect mode is the default: the query goes to a search
engine's own page, no key, no quota, cannot fail. Native mode renders results
inside Breeze and needs a provider key — **the user's key**, not one shipped in
the binary, because a desktop app makes queries from every user's machine.

Signals (read time, trackers, page weight) are `null` until `measure()` has
actually fetched the page. No search API returns them and nothing here guesses.
Measurement is off by default because it contacts pages the user has not
clicked on.

There is no way to read a stored key back across the bridge. `searchConfig()`
reports readiness, not values, and `shellbreach.js` plants a canary to prove it.

**Anything new added to `shell/` must also be added to `files:` in
`electron-builder.yml`,** or it will not be packaged — `search.js` was missed
once and produced a build whose main process crashed on boot.
