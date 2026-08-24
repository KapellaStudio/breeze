"""Breeze public site gate for the current McCloskey landing experience.

This test serves site/ locally and exercises the parts a visitor can actually use:
brand/release copy, navigation anchors, accent controls, search routing, download
routes, Flow presentation, responsive overflow, and page-error hygiene.

Exits non-zero on any failure.
"""
import asyncio, http.server, json, os, pathlib, socketserver, sys, threading
from playwright.async_api import async_playwright

ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
SITE = ROOT / "site"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def do_GET(self):
        if self.path.startswith("/download"):
            self.send_response(302)
            self.send_header("Location", "https://example.invalid/breeze")
            self.end_headers()
            return
        return super().do_GET()

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


fails = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))
    if not cond:
        fails.append(name)


async def overflow_detail(page):
    return await page.evaluate("""() => [...document.querySelectorAll('*')]
      .map(el => { const r=el.getBoundingClientRect(); return {
        node: el.id ? '#'+el.id : el.classList.length ? el.tagName.toLowerCase()+'.'+[...el.classList].join('.') : el.tagName.toLowerCase(),
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width)
      }})
      .filter(x => x.left < -1 || x.right > innerWidth + 1)
      .sort((a,b) => Math.max(b.right-innerWidth,-b.left)-Math.max(a.right-innerWidth,-a.left))
      .slice(0,6)""")


def real_opened(values):
    return [u for u in values if u and u != "null"]


async def main():
    srv, port = serve()
    base = f"http://127.0.0.1:{port}"
    print("\n── BREEZE PUBLIC SITE ──")

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        pg = await browser.new_page(viewport={"width": 1280, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
        await pg.goto(base + "/index.html")
        await pg.wait_for_timeout(500)

        check("no page errors", not errs, str(errs[:1]))
        check("page title carries Breeze promise", "Breeze" in await pg.title() and "friction" in (await pg.title()).lower())
        body = await pg.locator("body").inner_text()
        check("McCloskey is spelled and branded correctly", "McCloskey" in body and "McCluskey" not in body)
        check("release chapter language is present", "first public chapter of breeze" in body.lower())
        check("Flow is a first-class section", await pg.locator("#flow").count() == 1 and "One browser. Fewer detours." in body)
        check("experience section exists", await pg.locator("#experience").count() == 1)
        check("download section exists", await pg.locator("#download").count() == 1)

        nav_hrefs = await pg.locator("nav a").evaluate_all("els => els.map(a => a.getAttribute('href'))")
        check("navigation reaches Experience", "#experience" in nav_hrefs, str(nav_hrefs))
        check("navigation reaches Flow", "#flow" in nav_hrefs, str(nav_hrefs))
        check("navigation reaches Download", "#download" in nav_hrefs, str(nav_hrefs))

        tiles = pg.locator("a.downloadTile")
        hrefs = await tiles.evaluate_all("els => els.map(a => a.getAttribute('href'))")
        check("three platform download choices are visible", await tiles.count() == 3, str(await tiles.count()))
        check("macOS download is wired", any("platform=macos-arm" in (h or "") for h in hrefs), str(hrefs))
        check("Windows download is wired", any("platform=windows-x64" in (h or "") for h in hrefs), str(hrefs))
        check("Linux download is wired", any("platform=linux-x64" in (h or "") for h in hrefs), str(hrefs))

        swatches = pg.locator(".swatch")
        check("all four Breeze accent modes exist", await swatches.count() == 4, str(await swatches.count()))
        await pg.locator('.swatch[data-accent="mint"]').click()
        accent = await pg.locator("html").get_attribute("data-accent")
        pressed = await pg.locator('.swatch[data-accent="mint"]').get_attribute("aria-pressed")
        check("accent control changes the actual page state", accent == "mint" and pressed == "true", f"accent={accent} pressed={pressed}")

        await pg.evaluate("window.__opened=[]; window.open=(u)=>{window.__opened.push(String(u)); return null}")
        search = pg.locator("#searchForm input")
        await search.fill("breeze browser privacy")
        await pg.locator("#searchForm").evaluate("form => form.requestSubmit()")
        opened = real_opened(await pg.evaluate("window.__opened.slice()"))
        check("search form routes a query to Brave Search", any(u.startswith("https://search.brave.com/search?q=") and "breeze%20browser%20privacy" in u for u in opened), str(opened))

        await pg.locator("#omni").fill("example.com")
        await pg.locator("#omni").press("Enter")
        opened = real_opened(await pg.evaluate("window.__opened.slice()"))
        check("demo omnibox treats a hostname as a real URL", bool(opened) and opened[-1] == "https://example.com", str(opened[-2:] if opened else opened))

        flow_buttons = await pg.locator(".flowSidebar button").all_inner_texts()
        check("Flow tool families are visible", all(name in flow_buttons for name in ["Convert", "Compress", "PDF", "Image", "Media"]), str(flow_buttons))
        check("Flow conversion example is visible", "PDF" in await pg.locator(".flowDropzone").inner_text() and "JPG" in await pg.locator(".flowDropzone").inner_text())

        for w, h in [(1440, 900), (1024, 800), (768, 900), (430, 932), (390, 844), (360, 640)]:
            pgx = await browser.new_page(viewport={"width": w, "height": h}, is_mobile=(w < 500))
            perrs = []
            pgx.on("pageerror", lambda e: perrs.append(str(e)[:120]))
            await pgx.goto(base + "/index.html")
            await pgx.wait_for_timeout(350)
            ov = await pgx.evaluate("() => ({sw: document.documentElement.scrollWidth, w: innerWidth})")
            detail = f"{ov['sw']}/{ov['w']}"
            if ov["sw"] > ov["w"] + 1:
                offenders = await overflow_detail(pgx)
                detail += " offenders=" + json.dumps(offenders, separators=(",", ":"))
            check(f"no horizontal overflow at {w}px", ov["sw"] <= ov["w"] + 1, detail)
            check(f"no page errors at {w}px", not perrs, str(perrs[:1]))
            await pgx.close()

        await pg.close()
        await browser.close()

    srv.shutdown()
    print(f"\n  {len(fails)} failures.\n")
    if fails:
        sys.exit(1)


asyncio.run(main())
