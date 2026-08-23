#!/usr/bin/env python3
"""
Breeze build — inlines the shared token stylesheet, the shared JS core and the
logo into each shell, producing two standalone HTML files that open by
double-click with no server and no bundler.

    python3 build.py

Source of truth lives in src/. Never edit the files in the output directory —
they are generated and will be overwritten.
"""
import os, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).parent
SRC  = ROOT / 'src'
OUT  = pathlib.Path(os.environ.get('BREEZE_OUT', ROOT))
COPY_TO = [ROOT / 'site' / 'preview', ROOT / 'shell' / 'ui']
TOKEN_COPY = ROOT / 'site' / 'tokens.css'

tokens = (SRC / 'breeze-tokens.css').read_text()
core   = (SRC / 'breeze-core.js').read_text()
adapter= (SRC / 'breeze-shell-adapter.js').read_text()
logo   = (SRC / 'logo.b64').read_text().strip()
ASSETS = {
    '__LOGO__':      logo,
    '__KMARK__':     (SRC / 'kapella_mark.b64').read_text().strip(),
    '__KWORD_L__':   (SRC / 'kapella_word_light.b64').read_text().strip(),
    '__KWORD_D__':   (SRC / 'kapella_word_dark.b64').read_text().strip(),
}

SHELLS = ['breeze-desktop.html', 'breeze-mobile.html']
fail = False

for name in SHELLS:
    html = (SRC / name).read_text()
    for marker in ('__TOKENS__', '__CORE__', '__LOGO__'):
        if marker not in html:
            print(f'  !! {name}: missing {marker}'); fail = True
    html = html.replace('__TOKENS__', tokens)
    html = html.replace('__CORE__', core)
    html = html.replace('__ADAPTER__', adapter if name == 'breeze-desktop.html' else '')
    for marker, data in ASSETS.items():
        html = html.replace(marker, data)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(html)
    for dest in COPY_TO:
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy(OUT / name, dest / name)
    print(f'  built {name}  ({len(html):,} bytes)  -> ' + ', '.join(str(d.name) for d in COPY_TO))

for name in SHELLS:
    built = (OUT / name).read_text()
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
    js = re.findall(r'<script>(.*?)</script>', (SRC / name).read_text(), re.S)[-1]
    shell_names = set(re.findall(r'^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)', js, re.M))
    clash = sorted(core_names & shell_names)
    if clash:
        print(f'  !! {name} redeclares core symbols: {clash}'); fail = True

LOCAL_OK = {'--site', '--tintA', '--tintB'}
for name in SHELLS:
    css = re.findall(r'<style>(.*?)</style>', (SRC / name).read_text(), re.S)
    body = '\n'.join(css)
    body = body.replace('__TOKENS__', '')
    body = re.sub(r'var\(\s*--[a-zA-Z0-9-]+\s*(?:,[^()]*)?\)', '', body)
    stray = sorted(set(re.findall(r'(--[a-zA-Z0-9-]+)\s*:', body)) - LOCAL_OK)
    if stray:
        print(f'  !! {name} defines tokens outside breeze-tokens.css: {stray}'); fail = True

TOKEN_COPY.parent.mkdir(parents=True, exist_ok=True)
TOKEN_COPY.write_text(tokens)

print('\nBUILD FAILED' if fail else '\nBuild OK — tokens and core are single-source.')
sys.exit(1 if fail else 0)
