# Breeze — Third-party notices

Breeze Flow's desktop media conversion layer uses `ffmpeg-static` 5.3.0 to provide platform-specific FFmpeg binaries.

- Package: ffmpeg-static
- Version: 5.3.0 (pinned)
- Package license: GPL-3.0-or-later
- Upstream: FFmpeg and the binary distributors identified by the ffmpeg-static project

This file is an engineering notice, not a substitute for a release-time open-source compliance review. Before public distribution, verify the exact FFmpeg build configuration, include all required license text/source-offer material, and ensure the distribution method satisfies the applicable licenses.


## PDF.js

Breeze's local PDF renderer uses `pdfjs-dist` **6.2.108**.

- Package: pdfjs-dist
- Version: 6.2.108 (pinned)
- License: Apache-2.0
- Upstream: Mozilla PDF.js

PDF.js is used only inside Breeze's sandboxed document renderer. Breeze disables
PDF scripting/eval at the integration boundary.

## pdf-lib

Breeze's local PDF manipulation layer uses `pdf-lib` **1.17.1**.

- Package: pdf-lib
- Version: 1.17.1 (pinned)
- License: MIT
- Upstream: Hopding/pdf-lib

It is used in the Electron main process for page extraction, split, merge and
rotation.
