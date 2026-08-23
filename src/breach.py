import asyncio, json, sys
from playwright.async_api import async_playwright
import os, pathlib
_ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
DESKTOP_URL = (_ROOT / "breeze-desktop.html").as_uri()
MOBILE_URL  = (_ROOT / "breeze-mobile.html").as_uri()

PAYLOAD = "<img src=x onerror=\"window.__PWNED=(window.__PWNED||0)+1\">"

ATTACKS = [
 ("A1 tab TITLE -> renderClassic()",
  f"""root.dataset.tabs='classic';
      const t=flatTabs()[0]; t.t={json.dumps('Evil '+PAYLOAD)};
      renderClassic(); 'ran'"""),
 ("A2 tab URL -> selectTab() omnibox",
  f"""const t=flatTabs()[1]; t.u={json.dumps('evil.com/'+PAYLOAD)};
      selectTab(t); 'ran'"""),
 ("A3 tab search query -> renderTabResults()",
  f"""renderTabResults({json.dumps(PAYLOAD)}); 'ran'"""),
 ("A4 page-supplied link data -> link hover card",
  f"""const a=document.querySelector('a[data-lp]');
      const d=JSON.parse(a.dataset.lp); d.trackers={json.dumps('0'+PAYLOAD)};
      a.dataset.lp=JSON.stringify(d);
      a.dispatchEvent(new MouseEvent('mouseenter',{{bubbles:true}})); 'ran'"""),
 ("A5 page-supplied link data -> Glance panel",
  f"""const a=document.querySelector('a[data-lp]');
      const d=JSON.parse(a.dataset.lp); d.weight={json.dumps('1MB'+PAYLOAD)};
      a.dataset.lp=JSON.stringify(d);
      openGlance(JSON.parse(a.dataset.lp)); 'ran'"""),
 ("A6 extension name -> renderExts()",
  f"""EXTS[0].name={json.dumps('Ext '+PAYLOAD)}; EXTS[0].desc={json.dumps(PAYLOAD)}; renderExts(); renderExtPop(); 'ran'"""),
 ("A7 queue item title -> home queue",
  f"""QUEUE[0].t={json.dumps('Q '+PAYLOAD)};
      renderQueueHome(); 'ran'"""),
 ("A8 search result title/snippet -> renderSearch()",
  f"""SR_DATA[0].title={json.dumps('T '+PAYLOAD)};
      SR_DATA[0].snip={json.dumps('S '+PAYLOAD)};
      SR_DATA[0].dom={json.dumps('d '+PAYLOAD)};
      runSearch('x'); 'ran'"""),
 ("A9 omnibox query -> renderOmni()",
  f"""renderOmni('/'+{json.dumps(PAYLOAD)}); 'ran'"""),
]

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        hits=[]
        for name, js in ATTACKS:
            pg=await b.new_page(viewport={'width':1440,'height':900})
            errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:90]))
            await pg.goto(DESKTOP_URL)
            await pg.wait_for_timeout(300)
            try:
                await pg.evaluate("()=>{"+js+"}")
            except Exception as ex:
                errs.append("EVAL:"+str(ex)[:90])
            await pg.wait_for_timeout(450)
            pwned = await pg.evaluate("window.__PWNED||0")
            status = "*** XSS ***" if pwned else "safe"
            print(f"{status:12s} {name}" + (f"   [{errs[0]}]" if errs else ""))
            if pwned: hits.append(name)
            await pg.close()
        print(f"\n{len(hits)} of {len(ATTACKS)} vectors executed script in browser chrome.")
        await b.close()
        return len(hits)
_failed = asyncio.run(main())
if _failed:
    sys.exit(1)
