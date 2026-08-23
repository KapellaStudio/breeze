import asyncio, json, sys
from playwright.async_api import async_playwright
import os, pathlib
_ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
DESKTOP_URL = (_ROOT / "breeze-desktop.html").as_uri()
MOBILE_URL  = (_ROOT / "breeze-mobile.html").as_uri()
P = "<img src=x onerror=\"window.__PWNED=(window.__PWNED||0)+1\">"

PROTO_PAYLOAD = json.dumps('{"__proto__":{"pwned":"yes"},"kind":"x","title":"t","domain":"d","read":"1","trackers":"0","weight":"1","note":"n"}')
B4_PAYLOAD = json.dumps('\"/><script>window.__PWNED=1<\\/script>')
B5_PAYLOAD = json.dumps('#fff\"/><script>window.__PWNED=1<\\/script><rect fill=\"')
B6_PAYLOAD = json.dumps('x\" onmouseover=\"window.__PWNED=1')
P_PAYLOAD = json.dumps(P)
SEARCH_PAYLOAD = json.dumps('offline ' + P)
B10_PAYLOAD = json.dumps('a <mark><img src=x onerror=\"window.__PWNED=1\"></mark> b')

ATTACKS = [
 ("B1 javascript: URL in a page link",
  """const a=document.querySelector('.article a'); a.href='javascript:window.__PWNED=1';
     a.click(); 'ran'"""),
 ("B2 malformed data-lp JSON crashes chrome (DoS)",
  """const a=document.querySelector('a[data-lp]'); a.dataset.lp='{{{not json';
     a.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); 'ran'"""),
 ("B3 prototype pollution via data-lp",
  f"""const a=document.querySelector('a[data-lp]');
      a.dataset.lp={PROTO_PAYLOAD};
      a.dispatchEvent(new MouseEvent('mouseenter',{{bubbles:true}}));
      window.__PROTO=(Object.prototype.pwned==='yes')?1:0; 'ran'"""),
 ("B4 svg/xlink markup smuggled through markHTML fallback letter",
  f"""const t=flatTabs()[0]; t.mark=null; t.f={B4_PAYLOAD};
      root.dataset.tabs='classic'; renderClassic(); renderTabs(); 'ran'"""),
 ("B5 tint attribute break-out in markHTML",
  f"""const t=flatTabs()[0]; t.mark=null; t.tint={B5_PAYLOAD};
      renderTabs(); 'ran'"""),
 ("B6 extension id attribute break-out",
  f"""EXTS[0].id={B6_PAYLOAD}; renderExts();
      const r=document.querySelector('.extRow'); r&&r.dispatchEvent(new MouseEvent('mouseover',{{bubbles:true}})); 'ran'"""),
 ("B7 workspace name injection into extension scope line",
  f"""const w=document.querySelector('.wsName'); w.textContent={P_PAYLOAD};
      renderExts(); 'ran'"""),
 ("B8 oversized query DoS in tab search",
  """renderTabResults('a'.repeat(200000)); 'ran'"""),
 ("B9 search query with markup -> results header",
  f"""runSearch({SEARCH_PAYLOAD}); 'ran'"""),
 ("B10 snippet marker forgery in search results",
  f"""SR_DATA[0].snip={B10_PAYLOAD};
      runSearch('x'); 'ran'"""),
]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); bad=[]
        for name, js in ATTACKS:
            pg=await b.new_page(viewport={'width':1440,'height':900})
            errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:70]))
            await pg.goto(DESKTOP_URL)
            await pg.wait_for_timeout(250)
            try: await pg.evaluate("()=>{"+js+"}")
            except Exception as ex: errs.append("EVAL:"+str(ex)[:70])
            await pg.wait_for_timeout(400)
            pwned = await pg.evaluate("(window.__PWNED||0)+(window.__PROTO||0)")
            alive = await pg.evaluate("!!document.querySelector('.chrome')")
            st = "*** BREACH ***" if pwned else ("*** CRASH ***" if errs and not alive else ("warn" if errs else "safe"))
            print(f"{st:15s} {name}" + (f"  [{errs[0]}]" if errs else ""))
            if pwned or (errs and not alive): bad.append(name)
            await pg.close()
        print(f"\n{len(bad)} of {len(ATTACKS)} succeeded.")
        await b.close()
        return len(bad)
_failed = asyncio.run(main())
if _failed:
    sys.exit(1)
