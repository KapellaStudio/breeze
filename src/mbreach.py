import asyncio, json, sys
from playwright.async_api import async_playwright
import os, pathlib
_ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
DESKTOP_URL = (_ROOT / "breeze-desktop.html").as_uri()
MOBILE_URL  = (_ROOT / "breeze-mobile.html").as_uri()
P = "<img src=x onerror=\"window.__PWNED=(window.__PWNED||0)+1\">"
ATTACKS = [
 ("M1 tab title -> tab switcher grid",
  f"""TABS[0].t={json.dumps('Evil '+P)}; renderTabGrid(); 'ran'"""),
 ("M2 site key -> mark node / tint",
  f"""TABS[0].k={json.dumps('\"/><script>window.__PWNED=1<\\/script>')}; renderTabGrid(); renderQuick(); 'ran'"""),
 ("M3 search result title/domain/snippet",
  f"""SR_DATA[0].title={json.dumps('T '+P)}; SR_DATA[0].dom={json.dumps('d '+P)};
      SR_DATA[0].snip={json.dumps('s '+P)}; renderSearch(); 'ran'"""),
 ("M4 snippet <mark> forgery",
  f"""SR_DATA[0].snip={json.dumps('a <mark><img src=x onerror=\"window.__PWNED=1\"></mark> b')};
      renderSearch(); 'ran'"""),
 ("M5 search query -> results header",
  f"""runSearch({json.dumps('q '+P)}); 'ran'"""),
 ("M6 queue title -> queue sheet",
  f"""QUEUE[0].t={json.dumps('Q '+P)}; renderQueue(); 'ran'"""),
 ("M7 workspace name -> ws sheet + strip",
  f"""WORKSPACES[0].n={json.dumps('W '+P)}; renderWsList(); renderWsStrip(); 'ran'"""),
 ("M8 privacy value row",
  f"""PRIV[0][1]={json.dumps(P)}; renderPriv(); 'ran'"""),
 ("M9 card title -> home carousel",
  f"""CARDS[0].t={json.dumps('C '+P)}; renderCards(); 'ran'"""),
 ("M10 quick-link name -> home grid",
  f"""QUICK[0][1]={json.dumps('L '+P)}; renderQuick(); 'ran'"""),
]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); bad=0
        for name,js in ATTACKS:
            ctx=await b.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True)
            pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:60]))
            await pg.goto(MOBILE_URL); await pg.wait_for_timeout(300)
            try: await pg.evaluate("()=>{"+js+"}")
            except Exception as ex: errs.append("EVAL:"+str(ex)[:60])
            await pg.wait_for_timeout(400)
            pw = await pg.evaluate("window.__PWNED||0")
            print(f"{'*** XSS ***' if pw else 'safe':12s} {name}" + (f"  [{errs[0]}]" if errs else ""))
            if pw: bad+=1
            await ctx.close()
        print(f"\n{bad} of {len(ATTACKS)} succeeded.")
        await b.close()
        return bad
_failed = asyncio.run(main())
if _failed:
    sys.exit(1)
