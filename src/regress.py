import asyncio, sys
from playwright.async_api import async_playwright
import os, pathlib
_ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
DESKTOP_URL = (_ROOT / "breeze-desktop.html").as_uri()
MOBILE_URL  = (_ROOT / "breeze-mobile.html").as_uri()
STEPS = [
 ("home",        None),
 ("browse",      "setView('browse')"),
 ("search",      "runSearch('offline-first architecture')"),
 ("filter",      "document.querySelectorAll('.srChip')[2].click()"),
 ("read",        "setView('read')"),
 ("extensions",  "setView('ext')"),
 ("pdf tab",     "setView('browse');selectTab(flatTabs().find(t=>t.kind==='pdf'))"),
 ("video tab",   "selectTab(flatTabs().find(t=>t.kind==='video'))"),
 ("split",       "selectTab(flatTabs()[0]);openSplit()"),
 ("swap",        "$('#pbSwap').click()"),
 ("unsplit",     "closeSplit()"),
 ("compact rail","root.dataset.rail='1'"),
 ("rail off",    "root.dataset.rail='0'"),
 ("classic tabs","setSeg('tabs','classic')"),
 ("side tabs",   "setSeg('tabs','side')"),
 ("dark",        "setSeg('theme','dark')"),
 ("dark dim",    "setSeg('comfort','dim')"),
 ("dark bright", "setSeg('comfort','bright')"),
 ("light dim",   "setSeg('theme','light');setSeg('comfort','dim')"),
 ("light comfort","setSeg('comfort','comfort')"),
 ("accent mint", "setAccent('mint')"),
 ("accent blue", "setAccent('blue')"),
 ("density comp","setSeg('density','compact')"),
 ("density std", "setSeg('density','standard')"),
 ("ws sealed",   "$('#sideWsBtn').click();document.querySelector('[data-ws=\"Client — Northwind\"]').click()"),
 ("ws back",     "$('#sideWsBtn').click();document.querySelector('[data-ws=\"Design Research\"]').click()"),
 ("stuck",       "setStuck(true,'A background worker went stale.')"),
 ("fix rebuild", "runFix('rebuild')"),
 ("settings",    "openScrim('set')"),
 ("omnibox",     "closeAll();openScrim('omni')"),
 ("tabsearch",   "closeAll();openScrim('tabs')"),
 ("close",       "closeAll()"),
]
async def main():
    bad_widths=[]
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for vw,vh in [(1440,900),(1180,800),(1024,720)]:
            pg=await b.new_page(viewport={'width':vw,'height':vh})
            errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:100]))
            await pg.goto(DESKTOP_URL); await pg.wait_for_timeout(450)
            fails=[]
            for name,js in STEPS:
                if js:
                    try: await pg.evaluate(js)
                    except Exception as ex: fails.append(f"{name}: {str(ex)[:70]}")
                await pg.wait_for_timeout(160)
            ov = await pg.evaluate("""()=>{const W=innerWidth,bad=[];
              document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();
                if(r.width>2&&r.height>2&&(r.right>W+2)) bad.push(e.className&&typeof e.className==='string'?e.className.split(' ')[0]:e.tagName);});
              return {sw:document.documentElement.scrollWidth,W,bad:[...new Set(bad)].slice(0,4)};}""")
            print(f"{vw}x{vh}  scrollW={ov['sw']}/{ov['W']}  overflow={ov['bad']}")
            print(f"          step failures: {fails or 'none'}")
            print(f"          page errors:   {errs or 'none'}")
            if fails or errs or ov['bad'] or ov['sw'] > ov['W']:
                bad_widths.append(f"{vw}x{vh}")
            await pg.close()
        await b.close()
    print(f"\n{len(bad_widths)} of 3 widths failed." + (f"  {bad_widths}" if bad_widths else ""))
    if bad_widths:
        sys.exit(1)
asyncio.run(main())
