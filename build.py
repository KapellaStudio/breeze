#!/usr/bin/env python3
"""
Breeze build — inlines the shared token stylesheet, shared JS core and release
brand assets into each shell, producing standalone HTML files with no server
and no bundler.

    python3 build.py

Source of truth lives in src/. Never edit generated output files directly.
"""
import base64, os, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).parent
SRC  = ROOT / 'src'
OUT  = pathlib.Path(os.environ.get('BREEZE_OUT', ROOT))
COPY_TO = [ROOT / 'site' / 'preview', ROOT / 'shell' / 'ui']
TOKEN_COPY = ROOT / 'site' / 'tokens.css'

# Build output must be byte-equivalent across Linux, macOS and Windows. Never
# depend on the host's locale/default text codec (Windows commonly uses cp1252).
def _read(path):
    return path.read_text(encoding='utf-8')

def _write(path, text):
    path.write_text(text, encoding='utf-8', newline='\n')

tokens = _read(SRC / 'breeze-tokens.css')
core   = _read(SRC / 'breeze-core.js')
adapter= _read(SRC / 'breeze-shell-adapter.js')

# Breeze 19 keeps its browser mark as the Kapella-owned vector master in src/.
# Kapella wordmarks are tracked as base64 PNG source files under site/ so the
# public site and standalone browser builds share the exact same brand bytes.
# No transparent/bootstrap brand fallback is allowed in a release build.
def _b64_text(*paths):
    for path in paths:
        p = ROOT / path
        if p.exists():
            data = _read(p).strip()
            if data:
                return data
    raise FileNotFoundError('Missing required release asset: ' + ' or '.join(str(p) for p in paths))

breeze_svg = (SRC / 'breeze-mark.svg').read_bytes()
logo_svg_b64 = base64.b64encode(breeze_svg).decode('ascii')
kapella_dark = _b64_text('src/kapella_word_dark.b64', 'site/kapella-word-dark.png.b64')
kapella_light = _b64_text('src/kapella_word_light.b64', 'site/kapella-word-light.png.b64')

# The legacy __KMARK__ slot is retained for source-template compatibility. In
# Breeze 19 it resolves to the current Kapella dark wordmark rather than a
# missing raster mark. This keeps every release build branded and self-contained.
ASSETS = {
    '__KMARK__':     kapella_dark,
    '__KWORD_L__':   kapella_light,
    '__KWORD_D__':   kapella_dark,
}

SHELLS = ['breeze-desktop.html', 'breeze-mobile.html']
fail = False

for name in SHELLS:
    html = _read(SRC / name)
    for marker in ('__TOKENS__', '__CORE__', '__LOGO__'):
        if marker not in html:
            print(f'  !! {name}: missing {marker}'); fail = True
    html = html.replace('__TOKENS__', tokens)
    html = html.replace('__CORE__', core)
    html = html.replace('__ADAPTER__', adapter if name == 'breeze-desktop.html' else '')
    # Existing templates wrap __LOGO__ in an image/png data URI. Replace the
    # complete URI first so the canonical SVG is served with the correct MIME.
    html = html.replace('data:image/png;base64,__LOGO__', 'data:image/svg+xml;base64,' + logo_svg_b64)
    html = html.replace('__LOGO__', logo_svg_b64)
    for marker, data in ASSETS.items():
        html = html.replace(marker, data)
    OUT.mkdir(parents=True, exist_ok=True)
    _write(OUT / name, html)
    for dest in COPY_TO:
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy(OUT / name, dest / name)
    print(f'  built {name}  ({len(html):,} bytes)  -> ' + ', '.join(str(d.name) for d in COPY_TO))

for name in SHELLS:
    built = _read(OUT / name)
    styles  = re.findall(r'<style>(.*?)</style>',   built, re.S)
    scripts = re.findall(r'<script>(.*?)</script>', built, re.S)
    for css in styles:
        if re.search(r'^\s*(function|const|let|var)\s', css, re.M):
            print(f'  !! {name}: JavaScript found inside <style>'); fail = True
    for js in scripts:
        if re.search(r'^[.#][\w-]+\{', js, re.M):
            print(f'  !! {name}: CSS rule found inside <script>'); fail = True

core_names = set(re.findall(r'^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)', core, re.M))
for name in SHELLS:
    js = re.findall(r'<script>(.*?)</script>', _read(SRC / name), re.S)[-1]
    shell_names = set(re.findall(r'^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)', js, re.M))
    clash = sorted(core_names & shell_names)
    if clash:
        print(f'  !! {name} redeclares core symbols: {clash}'); fail = True

LOCAL_OK = {'--site', '--tintA', '--tintB'}
for name in SHELLS:
    css = re.findall(r'<style>(.*?)</style>', _read(SRC / name), re.S)
    body = '\n'.join(css)
    body = body.replace('__TOKENS__', '')
    body = re.sub(r'var\(\s*--[a-zA-Z0-9-]+\s*(?:,[^()]*)?\)', '', body)
    stray = sorted(set(re.findall(r'(--[a-zA-Z0-9-]+)\s*:', body)) - LOCAL_OK)
    if stray:
        print(f'  !! {name} defines tokens outside breeze-tokens.css: {stray}'); fail = True

TOKEN_COPY.parent.mkdir(parents=True, exist_ok=True)
_write(TOKEN_COPY, tokens)

print('\nBUILD FAILED' if fail else '\nBuild OK — tokens, core and release branding are single-source.')
sys.exit(1 if fail else 0)
