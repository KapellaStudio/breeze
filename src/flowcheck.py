#!/usr/bin/env python3
"""Breeze Flow structural gate.

This intentionally avoids a browser dependency so the Flow contract is checked
alongside syntax even when Playwright is unavailable locally. Runtime geometry
is still covered by the existing desktop regression suite in CI.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
src = (ROOT / 'src' / 'breeze-desktop.html').read_text()
main = (ROOT / 'shell' / 'main.js').read_text()
preload = (ROOT / 'shell' / 'preload.js').read_text()
adapter = (ROOT / 'src' / 'breeze-shell-adapter.js').read_text()
media = (ROOT / 'shell' / 'media.js').read_text()

checks = [
    ('Flow is a first-class view', 'data-view="flow"' in src and 'v-flow' in src),
    ('Flow toolbar entry exists', 'id="flowBtn"' in src),
    ('Flow brand is explicit', '<b>Breeze</b><em>Flow</em>' in src),
    ('Flow file picker exists', 'id="flowFile"' in src),
    ('Image conversion is local', 'canvas.toBlob' in src and 'flowImageExport' in src),
    ('Text Lab exists', 'id="flowTextArea"' in src and 'data-flow-text="jsonPretty"' in src),
    ('SHA-256 uses Web Crypto', "crypto.subtle.digest('SHA-256'" in src),
    ('UUID uses Web Crypto', 'crypto.randomUUID()' in src),
    ('Media workbench exists', 'id="flowMediaWork"' in src and 'data-flow-tool="audio"' in src and 'data-flow-tool="video"' in src),
    ('PDF workspace entry is real and advanced actions stay honest', 'data-flow-tool="document"' in src and 'Split, merge and extraction tools are the next document layer.' in src and "document:openPdf" in main),
    ('No upload endpoint in Flow', 'fetch(' not in src[src.find('BREEZE FLOW ═'):src.find('SETTINGS PANES')]),
    ('Shell can hide live page for internal views', "reg('chrome:internalView'" in main),
    ('Preload exposes named internal-view method', 'setInternalView: on =>' in preload),
    ('Adapter syncs view visibility', "S.setInternalView(root.dataset.view !== 'browse')" in adapter),
    ('Media paths stay behind opaque tokens', "reg('flow:pickMedia'" in main and 'media.safeFile' in main and 'pickMedia:' in preload),
    ('Media conversion has an allowlisted bridge', "reg('flow:convertMedia'" in main and 'convertMedia:' in preload),
    ('Media capabilities are single-source', "reg('flow:mediaCapabilities'" in main and 'mediaCapabilities:' in preload and 'function capabilities()' in media),
    ('MOV is first-class input and output', "'mov'" in media and "id:'mov'" in media and 'MOV · H.264' in src),
    ('Broad video conversion matrix is present', all(x in media for x in ["id:'mp4'","id:'mkv'","id:'webm'","id:'avi'","id:'wmv'","id:'gif'"])),
    ('Broad audio conversion matrix is present', all(x in media for x in ["id:'mp3'","id:'wav'","id:'flac'","id:'m4a'","id:'ogg'","id:'opus'","id:'aac'","id:'aiff'","id:'wma'"])),
    ('Source overwrite is blocked', 'choose a different output file' in media),
]

failed = 0
for name, ok in checks:
    print(('PASS' if ok else 'FAIL') + '  ' + name)
    failed += 0 if ok else 1
print(f'\nFlow: {len(checks)-failed}/{len(checks)} checks passed')
sys.exit(1 if failed else 0)
