"""
06_screenshots.py — Figure 2: the real Tables Turned interface, replaying a recorded session.

Opens commons-table/search.html in headless Chromium and answers every network request
the page makes from the frozen study data (no model calls, no cost):

  * Worker (Anthropic) calls  -> the recorded search strategies, plain-language summaries,
                                 and brief from data/tables_turned/Q1_melatonin_kids/run_1.json
                                 (the brief is replayed as a server-sent-event stream)
  * NCBI esearch             -> the recorded PMID lists and hit counts for each strategy
  * NCBI efetch / web fonts   -> fetched by Python (urllib) and handed to the page

The page's own JavaScript does everything else: ranking, card rendering, curation state,
brief rendering. So the screenshots show what a reader would see for this session.

    pip install playwright pillow      (uses the system Chromium; no browser download)
    python scripts/06_screenshots.py   ->  figures/fig2_interface.png
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

from tt_common import FIGURES, DATA, REPO, load_production_prompts, read_json

RUN = DATA / "tables_turned" / "Q1_melatonin_kids" / "run_1.json"
PAGE = (REPO / "commons-table" / "search.html").as_uri()
CHROMIUM = os.environ.get("TT_CHROMIUM", "/opt/pw-browsers/chromium")
SHOTS = DATA / "screenshots"


def fetch_bytes(url: str) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 tables-turned-preprint"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get("Content-Type", "application/octet-stream")


def sse_stream(text: str) -> str:
    """Re-encode a finished brief as Anthropic-style streaming events."""
    events = [{"type": "message_start", "message": {"id": "replay", "type": "message", "role": "assistant", "content": []}},
              {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}]
    for i in range(0, len(text), 60):
        events.append({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text[i:i + 60]}})
    events += [{"type": "content_block_stop", "index": 0}, {"type": "message_stop"}]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)


async def main() -> None:
    run = read_json(RUN)
    tab, tele = run["tablet"], run["telemetry"]
    prompts = load_production_prompts()
    queries = [{"query": q["query"], "strategy": q["strategy"]} for q in tab["search"]["queries"]]
    summaries = [{"plain_title": p["plain_title"] or "", "plain_summary": p["plain_summary"] or ""} for p in tab["papers"]]
    esearch = {q["query"]: q for q in tele["per_query"]}
    cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"}

    async def handle(route):
        req = route.request
        url = req.url
        if url.startswith("file://"):
            return await route.continue_()
        if req.method == "OPTIONS":
            return await route.fulfill(status=204, headers=cors)
        if "workers.dev" in url:
            body = json.loads(req.post_data or "{}")
            system = body.get("system", "")
            if body.get("stream"):
                return await route.fulfill(status=200, body=sse_stream(tab["synthesis"]["brief_markdown"]),
                                           headers={**cors, "Content-Type": "text/event-stream"})
            text = json.dumps(queries) if system == prompts["SEARCH_SYSTEM"] else json.dumps(summaries)
            return await route.fulfill(status=200, headers={**cors, "Content-Type": "application/json"},
                                       body=json.dumps({"content": [{"type": "text", "text": text}]}))
        if "esearch.fcgi" in url:
            term = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["term"][0]
            q = esearch[term]
            payload = {"esearchresult": {"count": str(q["total_hits"]), "idlist": q["returned"]}}
            return await route.fulfill(status=200, headers={**cors, "Content-Type": "application/json"},
                                       body=json.dumps(payload))
        try:
            data, ctype = await asyncio.to_thread(fetch_bytes, url)
            return await route.fulfill(status=200, body=data, headers={**cors, "Content-Type": ctype})
        except Exception:
            return await route.abort()

    SHOTS.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=CHROMIUM)
        ctx = await browser.new_context(viewport={"width": 780, "height": 1120}, device_scale_factor=2)
        page = await ctx.new_page()
        await page.route("**/*", handle)
        await page.goto(PAGE, wait_until="load")
        await page.wait_for_timeout(1500)
        await page.fill("#q", tab["intent"]["question"])
        await page.fill("#ctx", tab["intent"]["decision_context"])
        await page.screenshot(path=str(SHOTS / "a_ask.png"))
        await page.click("#fast-search-btn")
        await page.wait_for_selector("#curate-view:not(.hidden)", timeout=180_000)
        await page.wait_for_timeout(1200)
        # expand the abstract on the second card to show the full-abstract affordance
        cards = await page.query_selector_all(".curate-card")
        if len(cards) > 1:
            btn = await cards[1].query_selector(".curate-expand-btn")
            if btn:
                await btn.click()
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(SHOTS / "b_curate.png"), full_page=False)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.click("#synthesize-btn")
        await page.wait_for_selector("#results-view:not(.hidden)", timeout=180_000)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(SHOTS / "c_brief.png"), full_page=False)
        await browser.close()
    compose()


def compose() -> None:
    """Three panels side by side, cropped to the informative region, with a/b/c labels."""
    shots = [Image.open(SHOTS / f) for f in ("a_ask.png", "b_curate.png", "c_brief.png")]
    w, h = shots[0].size
    panel_w = w
    crops = [s.crop((0, 0, w, int(h * 0.985))) for s in shots]
    gap, top = 50, 100
    out = Image.new("RGB", (panel_w * 3 + gap * 2, crops[0].height + top), "white")
    draw = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", 58)
    except OSError:
        font = ImageFont.load_default()
    labels = ["a  Ask", "b  Curate: the reader's 12 papers", "c  The receipted brief"]
    for i, (c, lab) in enumerate(zip(crops, labels)):
        x = i * (panel_w + gap)
        out.paste(c, (x, top))
        draw.rectangle([x, top, x + panel_w - 1, top + c.height - 1], outline=(195, 194, 183), width=3)
        draw.text((x + 4, 18), lab, fill=(11, 11, 11), font=font)
    FIGURES.mkdir(parents=True, exist_ok=True)
    scale = 3000 / out.width                      # keep the embedded image a sensible size
    out = out.resize((3000, int(out.height * scale)), Image.LANCZOS)
    out.save(FIGURES / "fig2_interface.png", optimize=True)
    print("wrote", FIGURES / "fig2_interface.png")


if __name__ == "__main__":
    asyncio.run(main())
