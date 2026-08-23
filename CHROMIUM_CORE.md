# Breeze Chromium Core — extension parity milestone

Breeze's current Electron shell is the fast path to a real cross-platform
Chromium browser, but Electron explicitly supports only a subset of Chrome's
extension platform. Breeze will not label that subset as Chrome Web Store
compatibility.

## Why this milestone exists

Modern wallet extensions such as MetaMask target Manifest V3 and use extension
service workers. Phantom targets Chromium-family browsers as well. The current
Electron compatibility tier cannot honestly promise either wallet will work.

## Product contract

The future Breeze Chromium core must preserve the existing Breeze chrome and
behaviour while adding:

- Manifest V3 service workers.
- `chrome.action` / toolbar popup behaviour.
- Chrome Web Store-class CRX install and signed update flow.
- The extension APIs required by the target compatibility suite.
- Per-workspace enable/disable semantics without silently changing cookie
  identity.
- Extension permission inspection before install.
- A pinned compatibility suite including MetaMask and Phantom, plus creator and
  developer extensions selected from actual Breeze usage research.

## What does not change

Flow, search, downloads, permission UX, workspaces, session recovery and the PDF
workspace remain Breeze product layers. This is an engine swap, not a product
rewrite.

## Gate

Do not call Breeze "Chrome extension compatible" until the automated target
suite installs, launches and exercises the named extensions against the forked
engine on Windows and macOS.
