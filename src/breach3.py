import asyncio, json, sys
from playwright.async_api import async_playwright
import os, pathlib
_ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
DESKTOP_URL = (_ROOT / "breeze-desktop.html").as_uri()
MOBILE_URL  = (_ROOT / "breeze-mobile.html").as_uri()
P = "<img src=x onerror=\"window.__PWNED=(window.__PWNED||0)+1\">"
SVG_BREAKOUT = 'M0 0\\\"/><script>window.__PWNED=1<\\/script><path d=\\\"'
ATTACKS = [
 ("C1 app menu item label -> renderAppMenu",
  f"""APP_MENU[0].t={json.dumps('Evil '+P)}; renderAppMenu(); 'ran'"""),
 ("C2 app menu icon path -> svgIcon attribute breakout",
  "AM_ICON.tab=" + json.dumps(SVG_BREAKOUT) + "; renderAppMenu(); 'ran'"),
 ("C3 history entry label -> renderHistory",
  f"""pushHistory({{view:'browse',kind:'page',host:'h',label:{json.dumps('H '+P)}}});
      renderHistory(); openPanel('history'); 'ran'"""),
 ("C4 history host -> renderHistory",
  f"""pushHistory({{view:'browse',kind:'page',host:{json.dumps('x '+P)},label:'L'}});
      renderHistory(); 'ran'"""),
 ("C5 find query injected into page content",
  f"""openFind(); $('#findInput').value={json.dumps('<img src=x onerror=alert(1)>')};
      runFind($('#findInput').value); 'ran'"""),
 ("C6 find over hostile page text (range building)",
  f"""const a=document.querySelector('.article p'); a.textContent={json.dumps(P+' browser')};
      openFind(); runFind('browser'); 'ran'"""),
 ("C7 settings clear-data row label",
  f"""DATA_ROWS[0].t={json.dumps('D '+P)}; renderDataRows(); 'ran'"""),
 ("C8 search engine name -> renderEngines",
  f"""ENGINES[0]={json.dumps('E '+P)}; renderEngines(); 'ran'"""),
 ("C9 VERSION name -> About pane",
  f"""VERSION.name={json.dumps('V '+P)}; paintAbout(); 'ran'"""),
 ("C10 settings pane title injection",
  f"""SET_PANES[0].t={json.dumps('T '+P)}; renderSetNav(); setPane('appearance'); 'ran'"""),
 ("C11 hostile __BREEZE_SHELL__ impersonation",
  f"""window.__BREEZE_SHELL__={{minimize:()=>{{window.__PWNED=1;}}}}; shellCall('minimize'); 'ran'"""),
 ("C12 find DoS: 200k-char query",
  """openFind(); runFind('a'.repeat(200000)); 'ran'"""),
]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); bad=0
        for name,js in ATTACKS:
            pg=await b.new_page(viewport={'width':1440,'height':900})
            errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:60]))
            await pg.goto(DESKTOP_URL); await pg.wait_for_timeout(300)
            await pg.evaluate("setView('browse')")
            try: await pg.evaluate("()=>{"+js+"}")
            except Exception as ex: errs.append("EVAL:"+str(ex)[:60])
            await pg.wait_for_timeout(450)
            pw = await pg.evaluate("window.__PWNED||0")
            alive = await pg.evaluate("!!document.querySelector('.chrome')")
            st = "*** XSS ***" if pw else ("*** DEAD ***" if not alive else "safe")
            print(f"{st:12s} {name}" + (f"  [{errs[0]}]" if errs else ""))
            if pw or not alive: bad+=1
            await pg.close()
        print(f"\n{bad} of {len(ATTACKS)} succeeded.")
        await b.close()
        return bad
_failed = asyncio.run(main())
if _failed:
    sys.exit(1)
