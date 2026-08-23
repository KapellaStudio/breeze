"""Breeze — mobile layout gate.

Checks two things at five device widths:

  1. Horizontal overflow that the user can actually see. Elements that sit
     outside the viewport *inside a deliberate horizontal scroller* (the home
     carousel) are not overflow — they are the point of a carousel. The old
     version of this file flagged them anyway and reported five red devices on
     a clean build, which is how a gate gets ignored.

  2. Touch targets below 44px. Measured as the effective hit area via
     elementFromPoint, not the border box, so a control that keeps a small
     visual size and expands its hit area with a pseudo-element passes — which
     is what .homeTop .tap and .wsPill do.

Exit code is 1 on any failure so CI can rely on it.
"""
import asyncio, os, pathlib, sys
from playwright.async_api import async_playwright

_ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
DESKTOP_URL = (_ROOT / "breeze-desktop.html").as_uri()
MOBILE_URL  = (_ROOT / "breeze-mobile.html").as_uri()

DEVICES = [("iPhone_SE",375,667),("iPhone_15_Pro",393,852),
           ("Pixel_8",412,915),("iPhone_Pro_Max",430,932),
           ("small_360",360,640)]

MIN_TAP = 44

OVERFLOW_JS = """()=>{
  const W = innerWidth, bad = [];
  const inScroller = e => {
    for (let a = e.parentElement; a; a = a.parentElement){
      const cs = getComputedStyle(a);
      if (a.scrollWidth > a.clientWidth + 1 && /auto|scroll/.test(cs.overflowX)) return true;
      if (a === document.body) return false;
    }
    return false;
  };
  document.querySelectorAll('.view:not([style*="display: none"]) *').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0) return;
    if (r.right <= W + 1 && r.left >= -1) return;
    if (inScroller(e)) return;
    bad.push(typeof e.className === 'string' && e.className ? e.className.split(' ')[0] : e.tagName);
  });
  return { W, scrollW: document.documentElement.scrollWidth, overflow: [...new Set(bad)].slice(0, 6) };
}"""

TAP_JS = """(MIN)=>{
  const sel = 'button, a[href], [role="button"], input, select, textarea, .tap';
  const scope = '.view:not([style*="display: none"]) ';
  const out = [], seen = new Set();
  document.querySelectorAll(scope + sel.split(', ').join(', ' + scope)).forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') return;
    if (Math.min(r.width, r.height) >= MIN) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = MIN / 2 - 1;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return;
    const pts = [[cx-h,cy-h],[cx+h,cy-h],[cx-h,cy+h],[cx+h,cy+h]];
    const hit = pts.every(([x,y]) => {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const t = document.elementFromPoint(x, y);
      return t && (t === e || e.contains(t) || t.contains(e) && t.closest(sel) === e);
    });
    if (hit) return;
    const key = (e.className || e.tagName) + ':' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ el: e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''),
               w: Math.round(r.width), h: Math.round(r.height) });
  });
  return out.slice(0, 8);
}"""

async def main():
    failures = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, w, h in DEVICES:
            ctx = await b.new_context(viewport={'width': w, 'height': h},
                                      device_scale_factor=1, is_mobile=True, has_touch=True)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:80]))
            await pg.goto(MOBILE_URL)
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'm_{name}_home.png')

            ov  = await pg.evaluate(OVERFLOW_JS)
            tap = await pg.evaluate(TAP_JS, MIN_TAP)
            doc_overflow = ov['scrollW'] > ov['W']

            ok = not ov['overflow'] and not tap and not errs and not doc_overflow
            print(f"{'PASS' if ok else 'FAIL'}  {name:16s} {w}x{h}  "
                  f"scrollW={ov['scrollW']} vw={ov['W']}  "
                  f"overflow={ov['overflow'] or 'none'}  "
                  f"sub{MIN_TAP}px={tap or 'none'}  errs={errs or 'none'}")
            if not ok:
                failures.append(name)
            await ctx.close()
        await b.close()

    print(f"\n{len(failures)} of {len(DEVICES)} devices failed.")
    if failures:
        sys.exit(1)

asyncio.run(main())
