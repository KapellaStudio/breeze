# Breeze Extension Compatibility

Status: release candidate on `feature/extension-certification`.

Breeze uses Electron 43 / Chromium as its desktop engine. The goal is not to claim generic Chrome Web Store parity; the goal is to certify the extension behaviors people actually expect from a modern browser and fail clearly when an API is not yet supported.

## Proven now

The isolated `shell/extensiontest.js` runtime probe verifies the managed Breeze extension path end to end:

- unpacked Manifest V3 extension import
- MV3 background service worker startup
- `chrome.runtime` messaging between a content script and the worker
- `chrome.storage.local` use from the worker
- content-script execution on a real HTTP page
- persistent-session extension loading
- registry visibility
- unload/remove cleanup

MV3 service-worker extensions are therefore admitted as **partial** rather than blocked. Individual Chrome APIs remain separately certified.

## Compatibility targets

### Wallet benchmark — Phantom

The pinned official Phantom certification verifies:

- extension loads and initializes
- provider injection into supported dApps
- popup/action UI
- account connect request
- message/signature request round trip
- storage persistence
- workspace/session isolation

### Browser-assistant benchmark — ChatGPT / Claude class

Breeze will certify the behavior rather than a specific vendor implementation:

- extension can request host access to the active site
- content script can read the permitted page DOM
- page access is visible and revocable by the user
- runtime messaging between page/content/background/popup works
- extension cannot access Breeze's privileged chrome renderer
- per-site permissions can be reset

## Later compatibility work

1. Extension action / popup surfaces.
2. Runtime ports and long-lived messaging.
3. `chrome.tabs` behavior mapped to real Breeze tabs.
4. `chrome.storage.local` persistence and quota behavior.
5. `chrome.scripting` / content-script host permission behavior.
6. `chrome.cookies` and `chrome.webNavigation` where extension compatibility requires them.
7. Permission and site-access controls in Breeze Settings.
8. Extension update/install UX after unpacked compatibility is stable.

## Safety rule

Extension compatibility work stays off `main` until the full Breeze browser regression, private-mode, security, Flow, document, search, tab, and shell integration suites remain green. Phantom is the certified wallet target for this beta; other extensions remain best-effort within the documented partial tier. No Netlify production deployment is required for this work.
