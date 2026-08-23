#!/usr/bin/env python3
"""Breeze private/mobile contract — static checks that should fail loudly if a
future refactor turns Private into cosmetics or collapses mobile into desktop."""
from pathlib import Path
import re, sys
ROOT=Path(__file__).resolve().parents[1]
main=(ROOT/'shell/main.js').read_text()
perms=(ROOT/'shell/permissions.js').read_text()
dls=(ROOT/'shell/downloads.js').read_text()
lib=(ROOT/'shell/library.js').read_text()
pre=(ROOT/'shell/preload.js').read_text()
desk=(ROOT/'src/breeze-desktop.html').read_text()
mob=(ROOT/'src/breeze-mobile.html').read_text()
build=(ROOT/'build.py').read_text()
checks=[]
def check(name,cond): checks.append((name,bool(cond)))
check('Private uses an in-memory Electron partition', 'breeze-private-' in main and 'fromPartition(partition,{cache:false})' in main)
check('Private session storage is cleared at teardown', 'clearData()' in main and 'clearAuthCache()' in main and 'closeAllConnections()' in main)
check('Private tabs never enter restart state', "filter(([,t]) => !t.private)" in main)
check('Private tabs never enter reopen-closed recovery', 'recentlyClosed.push' in main and 'if (!t.private)' in main)
check('Private navigation never enters Breeze history', 'if(privateMode) return null' in lib)
check('Private permissions have an ephemeral decision map', 'privateMaps=new WeakMap()' in perms and 'never writes a site decision to disk' in perms)
check('Private extensions are off by default', 'if (!privateMode) extensions.loadIntoSession' in main)
check('Private download metadata is not persisted', 'rows.filter(r => !r.private)' in dls)
check('Closing the last private session clears private download history', 'endPrivateSession' in main and 'endPrivateSession' in dls)
check('Renderer gets a named private action, not generic IPC', 'newPrivateTab' in pre and 'tab:createPrivate' in main and 'invoke: ' not in pre and 'invoke:' not in pre)
check('Desktop visibly marks Private browsing', 'privateMark' in desk and 'data-private="1"' in desk)
check('Desktop private home explains persistence boundary', 'Downloads you explicitly save remain on your computer' in desk)
check('Mobile is a separate source shell', "SHELLS = ['breeze-desktop.html', 'breeze-mobile.html']" in build and "adapter if name == 'breeze-desktop.html' else ''" in build)
check('Mobile keeps bottom-bar and sheet interaction model', 'BOTTOM BAR' in mob and 'MENU SHEET' in mob and '.sheet{' in mob)
check('Mobile has its own private presentation', 'mPrivate' in mob and 'Leave private browsing' in mob and 'data-private="0"' in mob)
check('Mobile history and saved pages are bottom sheets', 'id="shHist"' in mob and 'id="shBook"' in mob and "openSheet('hist')" in mob and "openSheet('book')" in mob)
check('Mobile private mode removes Continue/quick persistence surfaces', '[data-private="1"] #quick' in mob and '[data-private="1"] #cards' in mob)
check('Mobile does not falsely claim signed updates', 'Updates</span><span class="v">Signed' not in mob)
failed=[x for x in checks if not x[1]]
for name,ok in checks: print(('PASS' if ok else 'FAIL')+'  '+name)
print(f"\nPrivate/mobile: {len(checks)-len(failed)}/{len(checks)}")
sys.exit(1 if failed else 0)
