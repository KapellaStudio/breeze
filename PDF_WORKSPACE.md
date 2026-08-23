# Breeze PDF Workspace

Breeze treats a PDF as a workspace, not as a passive browser attachment.

## Privacy boundary

Local files enter through the native **Open PDF** picker only. The absolute path
stays in Electron's main process. The tab receives an opaque PDF token and a
safe display name. The PDF renderer is sandboxed, has no Node integration and
uses a dedicated preload with only these methods: load, info, extract, rotate,
split and merge.

No local PDF is uploaded to Breeze's Netlify site, Supabase project or any
third-party conversion service.

## Page view

The faithful view uses PDF.js 6.2.108 to render the original page layout. It
provides thumbnails, page navigation, fit/zoom and document-wide text search.
Scripting and eval are disabled.

## Comfort Reading

Comfort Reading extracts page text and reflows it for reading. It provides:

- adjustable type size
- adjustable line spacing
- adjustable reading width
- paper, warm and night reading surfaces
- paragraph focus mode

It is a reading aid; it intentionally does not claim pixel-faithful layout.
Scanned/image-only PDFs will need an OCR layer in a future pass.

## Local tools

The tool drawer uses pdf-lib behind the main-process boundary:

- extract selected pages or ranges
- split one PDF into multiple ranges
- merge additional local PDFs
- rotate selected pages by 90, 180 or 270 degrees

All outputs use a native save dialog.

## Release gates

- `shell/browsercoretest.js` checks the sandbox/preload/security contract and
  exact PDF.js pin.
- `shell/documenttest.js` creates PDFs and verifies inspect/extract/rotate/split/
  merge behavior after dependencies are installed.
- Do not relax the `file:` omnibox restriction to make local PDFs easier.
