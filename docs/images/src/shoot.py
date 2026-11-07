"""Render diagram pages to light and dark PNGs.

usage: uv run --with playwright python shoot.py OUT_DIR page1.html [page2.html ...]
Each page must load kit.css and dark.js and wrap the figure in <div id="fig">.
Writes OUT_DIR/<stem>-light.png and OUT_DIR/<stem>-dark.png at 2x, cropped to #fig.
"""
import asyncio, pathlib, sys
from playwright.async_api import async_playwright

async def main(out, pages):
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=2)
        for page in pages:
            for mode, q in (("light", ""), ("dark", "?dark=1")):
                await pg.goto(page.resolve().as_uri() + q)
                await pg.evaluate("document.fonts.ready")
                await pg.wait_for_timeout(250)
                fig = pg.locator("#fig")
                dest = out / f"{page.stem}-{mode}.png"
                await fig.screenshot(path=str(dest))
                box = await fig.bounding_box()
                print(f"{dest}  {int(box['width'])}x{int(box['height'])}")
        await b.close()

asyncio.run(main(pathlib.Path(sys.argv[1]), [pathlib.Path(a) for a in sys.argv[2:]]))
