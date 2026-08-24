"""Breeze — download site gate.

Serves site/ locally with a stubbed /api/releases and checks the page in BOTH
states, because the interesting one is the state nobody tests: no builds
published yet. A download page whose buttons are dead before launch is worse
than no download page.

Exits non-zero on any failure.
"""
import asyncio, http.server, json, os, pathlib, socketserver, sys, threading
from playwright.async_api import async_playwright

ROOT = pathlib.Path(os.environ.get("BREEZE_BUILD_DIR") or pathlib.Path(__file__).resolve().parent.parent)
SITE = ROOT / "site"

PUBLISHED = {
    "version": "1.0", "codename": "McCloskey", "notes": None,
    "builds": [
        {"platform": "macos-arm",   "size": 98234112,  "sha256": "a" * 64, "released_at": "2026-08-17T00:00:00Z"},
        {"platform": "windows-x64", "size": 104857600, "sha256": "b" * 64, "released_at": "2026-08-17T00:00:00Z"},
        {"platform": "linux-x64",   "size": 128974848, "sha256": "c" * 64, "released_at": "2026-08-17T00:00:00Z"},
    ],
}
EMPTY = {"version": None, "codename": None, "notes": None, "builds": []}

state = {"payload": EMPTY}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def do_GET(self):
        if self.path.startswith("/api/releases"):
            body = json.dumps(state["payload"]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/download"):
            self.send_response(302)
            self.send_header("Location", "https://example.invalid/breeze.dmg")
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


async def main():
    srv, port = serve()
    base = f"http://127.0.0.1:{port}"
    print("\n── BREEZE DOWNLOAD SITE ──")

    async with async_playwright() as p:
        b = await p.chromium.launch()

        state["payload"] = EMPTY
        pg = await b.new_page(viewport={"width": 1280, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        await pg.goto(base + "/index.html")
        await pg.wait_for_timeout(700)

        check("no page errors before launch", not errs, str(errs[:1]))
        head = await pg.inner_text("#getHead")
        check("pre-launch says it is not released", "Not released" in head, head)
        label = await pg.inner_text("#dlGoLabel")
        href = await pg.get_attribute("#dlGo", "href")
        check("the button offers the waitlist instead of a dead download",
              "notified" in label.lower() and href.endswith("#waitlist"), label + " -> " + str(href))
        check("no checksum row invented with nothing to check",
              await pg.locator("#dlCost .costRow").count() == 0)

        state["payload"] = PUBLISHED
        await pg.goto(base + "/index.html")
        await pg.wait_for_timeout(700)
        check("no page errors after launch", not errs, str(errs[:1]))

        head = await pg.inner_text("#getHead")
        check("names the platform it detected", head.startswith("Breeze for"), head)
        rel = await pg.inner_text("#getRel")
        check("version and codename come from the API, not the markup",
              "1.0" in rel and "McCloskey" in rel, rel)

        await pg.locator(".osTab", has_text="Windows").click()
        await pg.wait_for_timeout(250)
        cost = await pg.inner_text("#dlCost")
        check("windows size shown", "100 MB" in cost, cost.split("\n")[3] if cost else "")
        check("windows warning stated up front", "SmartScreen" in cost, "")
        check("sha-256 published", "b" * 64 in cost)
        why = await pg.inner_text("#dlUnsigned")
        check("the warning is explained, not just flagged", "certificate" in why.lower(), why[:60])
        steps = await pg.locator("#dlSteps .step").count()
        check("install steps present for windows", steps == 3, str(steps))
        href = await pg.get_attribute("#dlGo", "href")
        check("download link carries the right platform",
              href.endswith("platform=windows-x64"), str(href))

        await pg.locator(".osTab", has_text="Linux").click()
        await pg.wait_for_timeout(250)
        cost = await pg.inner_text("#dlCost")
        check("linux says it just opens", "Opens straight away" in cost)
        check("no unsigned warning on linux", (await pg.inner_text("#dlUnsigned")).strip() == "")

        await pg.locator(".osTab", has_text="Apple silicon").click()
        await pg.wait_for_timeout(250)
        why = await pg.inner_text("#dlUnsigned")
        check("macos gatekeeper explained with the real reason",
              "notaris" in why.lower() or "notariz" in why.lower(), why[:60])

        await pg.locator(".osTab", has_text="Intel").click()
        await pg.wait_for_timeout(250)
        head = await pg.inner_text("#getHead")
        check("a missing platform build says so plainly", "No macOS Intel build yet" in head, head)

        for w, h in [(1440, 900), (1024, 800), (390, 844)]:
            pgx = await b.new_page(viewport={"width": w, "height": h}, is_mobile=(w < 500))
            await pgx.goto(base + "/index.html")
            await pgx.wait_for_timeout(600)
            ov = await pgx.evaluate(
                "() => ({sw: document.documentElement.scrollWidth, w: innerWidth})")
            detail = f"{ov['sw']}/{ov['w']}"
            if ov["sw"] > ov["w"] + 1:
                offenders = await overflow_detail(pgx)
                detail += " offenders=" + json.dumps(offenders, separators=(",", ":"))
            check(f"no horizontal overflow at {w}px", ov["sw"] <= ov["w"] + 1, detail)
            await pgx.close()

        await pg.close()
        await b.close()

    srv.shutdown()
    print(f"\n  {len(fails)} failures.\n")
    if fails:
        sys.exit(1)


asyncio.run(main())
