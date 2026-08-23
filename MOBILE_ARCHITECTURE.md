# Breeze Mobile Architecture Contract

Breeze mobile is **not** the desktop browser collapsed to a narrow viewport.
It is a separate interaction shell with the same product model, privacy rules
and visual language.

## What desktop and mobile share

- Breeze identity, palette, typography roles and comfort philosophy.
- Workspace model and the rule that identity belongs to a workspace.
- History/bookmark semantics and the privacy contract.
- Search provider model and tracking-parameter stripping.
- Sync schemas when encrypted cross-device sync is built.
- The principle that useful context follows the user instead of becoming tab
  archaeology.

## What is deliberately different on mobile

Desktop is the complete power surface: sidebar, right-side context panels,
split view, developer tools, Flow workbenches, extension management and dense
multi-tab workflows.

Mobile is thumb-first:

- bottom navigation rather than a permanent desktop sidebar;
- bottom sheets rather than right-side panels or hover popovers;
- card-style tab switching designed for touch;
- safe-area aware controls and 44px minimum hit targets;
- swipe/dismiss gestures where they replace desktop pointer affordances;
- smaller, staged feature surfaces rather than exposing every desktop control
  at once.

The two shells live in different source files on purpose. `build.py` injects the
Electron desktop adapter only into `breeze-desktop.html`; the mobile shell does
not inherit desktop IPC merely because it shares tokens or data.

## Private browsing contract on mobile

The mobile product must implement the same engine-level guarantees as desktop,
but with a mobile presentation:

- private session storage is memory-only;
- private tabs are not restored after the private session ends;
- automatic browsing history is not written;
- permission decisions are not remembered;
- extensions/injected add-ons are off unless a future platform-specific review
  explicitly permits them;
- private state never appears in Continue / resume surfaces;
- files the user explicitly saves remain on the device, because saving a file
  is an intentional action rather than passive browser history;
- an explicit Save/Bookmark action may persist only the item the user chose to
  save.

The current mobile HTML is a purpose-built UI prototype, not an iOS/Android
browser engine. Do not describe prototype state as a shipped mobile browser.

## Feature priority

Mobile should receive capabilities by usefulness on a phone, not by desktop
menu order. Tabs, navigation, private browsing, downloads, saved pages, history,
reader/PDF comfort and share flows come before desktop-heavy tooling such as
extension debugging or a full developer console.

If a desktop feature has no comfortable thumb-first interaction, design the
mobile interaction separately before implementing it. Do not solve the problem
with a smaller button.
