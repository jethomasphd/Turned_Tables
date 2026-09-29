"""
02_run_comparators.py — the two free-tier comparison arms.

ARM C · "Claude free" (free chatbot, parametric answer)
    Model   claude-sonnet-5-5, the Sonnet-class model tier offered to free Claude.ai users.
    Setup   no system prompt, no tools, default sampling — a person typing into a chat box.
    Turn 1  the chat_prompt (question + the same decision context Tables Turned receives).
    Turn 2  the standard follow-up a careful user asks: "Can you list the specific
            scientific studies this is based on? ... PubMed ID for each."
    Why     Turn 2 elicits the citations that the citation audit (03) then checks
            against PubMed and CrossRef.
    Caveat  Claude.ai adds its own system prompt and may invoke web search; neither is
            reproduced here. This arm models the modal "just ask the chatbot" case.

ARM G · "AI Overview" archetype (search-engine AI summary, MODELED)
    Google's AI Overview cannot be captured programmatically in a reproducible,
    terms-compliant way, so we model its architecture instead: one live web search on
    the query as typed into a search box, then a short LLM overview grounded only in
    the returned pages, in the AI Overview format (bold answer, 3-6 bullets, source
    chips, health disclaimer). Model: claude-sonnet-5-5 + basic web_search_20250305 tool
    (single search, no code-execution filtering, per-sentence citations; max_uses=1,
    US location). This is a conservative stand-in: a strong model reading the same
    kind of open-web pool that search engines rank.
    Manual capture: paste a real AI Overview into data/manual_captures/<QID>_ai_overview.json
    (template written by --write-templates); 04_analyze_and_plot.py then reports its source
    mix, citation coverage and reading level under "manual_ai_overview" in data/metrics/summary.json.

Usage
-----
    python scripts/02_run_comparators.py                       # both arms, all questions
    python scripts/02_run_comparators.py --arms claude_free --only Q1 --replicates 3
    python scripts/02_run_comparators.py --write-templates     # manual-capture templates
"""

from __future__ import annotations

import argparse
import time

from tt_common import DATA, load_questions, make_client, now_iso, text_of, usage_dict, write_json

CHAT_MODEL = "claude-sonnet-5-5"
OVERVIEW_MODEL = "claude-sonnet-5-5"

OVERVIEW_SYSTEM = """You are reproducing the AI-generated overview panel that a general-purpose web search engine shows above its organic results (for example, Google's "AI Overview"). Behave the way that product behaves:

- Run exactly one web search, using the user's query exactly as typed.
- Base the overview only on what the returned web pages say. Do not run additional searches and do not seek out primary research beyond what that one search surfaces.
- Format: open with a one- or two-sentence direct answer in bold. Then give 3 to 6 short bullet points of key considerations. Keep the whole overview under 200 words.
- Attribute points to the web pages they came from.
- End with this line on its own: "This is for informational purposes only. For medical advice or diagnosis, consult a professional."

Do not mention that you are reproducing anything; just present the overview."""

USER_LOCATION = {"type": "approximate", "city": "Austin", "region": "Texas",
                 "country": "US", "timezone": "America/Chicago"}


def _dump_blocks(message) -> list[dict]:
    """JSON-safe copy of content blocks, minus the bulky encrypted page payloads."""
    out = []
    for b in message.content:
        d = b.model_dump(mode="json", exclude_none=True)
        if d.get("type") == "web_search_tool_result" and isinstance(d.get("content"), list):
            for r in d["content"]:
                r.pop("encrypted_content", None)
        if d.get("type") in ("thinking", "redacted_thinking"):
            d.pop("signature", None)
            d.pop("data", None)
        out.append(d)
    return out


# ─────────────────────────────────────────────────────────────
#  ARM C — Claude free (parametric)
# ─────────────────────────────────────────────────────────────

def run_claude_free(client, q: dict, followup: str) -> dict:
    t = time.time()
    msgs = [{"role": "user", "content": q["chat_prompt"]}]
    r1 = client.messages.create(model=CHAT_MODEL, max_tokens=8000, messages=msgs)
    t1 = round(time.time() - t, 2)
    msgs.append({"role": "assistant", "content": r1.content})   # thinking blocks passed back unchanged
    msgs.append({"role": "user", "content": followup})
    t = time.time()
    r2 = client.messages.create(model=CHAT_MODEL, max_tokens=8000, messages=msgs)
    t2 = round(time.time() - t, 2)
    return {
        "arm": "claude_free", "model_requested": CHAT_MODEL, "served_model": r1.model,
        "turns": [
            {"role": "user", "text": q["chat_prompt"]},
            {"role": "assistant", "text": text_of(r1), "stop_reason": r1.stop_reason,
             "latency_s": t1, "usage": usage_dict(r1.usage)},
            {"role": "user", "text": followup},
            {"role": "assistant", "text": text_of(r2), "stop_reason": r2.stop_reason,
             "latency_s": t2, "usage": usage_dict(r2.usage)},
        ],
    }


# ─────────────────────────────────────────────────────────────
#  ARM G — AI Overview archetype (open-web search summary)
# ─────────────────────────────────────────────────────────────

def run_ai_overview_model(client, q: dict) -> dict:
    tools = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 1,
              "user_location": USER_LOCATION}]
    msgs = [{"role": "user", "content": q["search_query"]}]
    t = time.time()
    raw_turns = []
    for _ in range(4):                                   # resume on pause_turn
        r = client.messages.create(model=OVERVIEW_MODEL, max_tokens=8000, system=OVERVIEW_SYSTEM,
                                   tools=tools, messages=msgs)
        raw_turns.append(r)
        if r.stop_reason != "pause_turn":
            break
        msgs.append({"role": "assistant", "content": r.content})
    latency = round(time.time() - t, 2)

    retrieved, cited_urls = [], []
    url_index: dict[str, int] = {}
    parts: list[str] = []
    cited_spans: list[dict] = []
    for r in raw_turns:
        for b in r.content:
            if b.type == "web_search_tool_result" and isinstance(b.content, list):
                for rank, res in enumerate(b.content, 1):
                    retrieved.append({"rank": rank, "url": res.url, "title": res.title,
                                      "page_age": getattr(res, "page_age", None)})
            elif b.type == "text":
                parts.append(b.text)
                cits = getattr(b, "citations", None) or []
                markers = []
                for c in cits:
                    url = getattr(c, "url", None)
                    if not url:
                        continue
                    if url not in url_index:
                        url_index[url] = len(url_index) + 1
                        cited_urls.append({"n": url_index[url], "url": url,
                                           "title": getattr(c, "title", None)})
                    cited_spans.append({"n": url_index[url], "text": b.text,
                                        "cited_text": getattr(c, "cited_text", None)})
                    if f"[{url_index[url]}]" not in markers:
                        markers.append(f"[{url_index[url]}]")
                if markers:
                    parts.append(" " + "".join(markers))
    overview = "".join(parts).strip()
    last = raw_turns[-1]
    return {
        "arm": "ai_overview_model", "model_requested": OVERVIEW_MODEL, "served_model": last.model,
        "query": q["search_query"], "system": OVERVIEW_SYSTEM, "user_location": USER_LOCATION,
        "overview_text": overview, "retrieved_sources": retrieved, "cited_sources": cited_urls,
        "cited_spans": cited_spans, "stop_reason": last.stop_reason, "latency_s": latency,
        "usage": [usage_dict(r.usage) for r in raw_turns],
        "raw_blocks": [_dump_blocks(r) for r in raw_turns],
    }


def write_templates(qs: list[dict]) -> None:
    d = DATA / "manual_captures"
    for q in qs:
        write_json(d / f"{q['id']}_ai_overview.TEMPLATE.json", {
            "question_id": q["id"], "search_query": q["search_query"],
            "captured_at": "YYYY-MM-DDTHH:MM:SSZ", "browser": "", "location": "", "signed_in": False,
            "overview_text": "Paste the AI Overview text verbatim. Put [n] after sentences that show a source chip.",
            "cited_sources": [{"n": 1, "url": "", "title": ""}],
            "screenshot_file": "",
            "_instructions": "Rename to <QID>_ai_overview.json once filled in. Capture in a private window, "
                             "signed out, US locale; record exact time. Screenshot the full panel.",
        })
    print(f"templates written to {d}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arms", nargs="*", default=["claude_free", "ai_overview_model"])
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--replicates", type=int, default=1)
    ap.add_argument("--start-rep", type=int, default=1)
    ap.add_argument("--worker", default=None)
    ap.add_argument("--write-templates", action="store_true")
    args = ap.parse_args()

    cfg = load_questions()
    qs = cfg["questions"]
    if args.only:
        qs = [q for q in qs if q["id"] in args.only]
    if args.write_templates:
        write_templates(qs)
        return

    client, route = make_client(args.worker)
    print(f"Comparator arms {args.arms} | route={route} | {len(qs)} question(s)")
    for q in qs:
        d = DATA / "comparators" / f"{q['id']}_{q['slug']}"
        for k in range(args.start_rep, args.start_rep + args.replicates):
            if "claude_free" in args.arms:
                print(f"[{q['id']}] claude_free rep {k} ...", end=" ", flush=True)
                out = run_claude_free(client, q, cfg["followup_prompt"])
                out.update({"question_id": q["id"], "replicate": k, "route": route, "captured_at": now_iso()})
                write_json(d / f"claude_free_run_{k}.json", out)
                print(f"{len(out['turns'][1]['text'])} + {len(out['turns'][3]['text'])} chars")
            if "ai_overview_model" in args.arms:
                print(f"[{q['id']}] ai_overview_model rep {k} ...", end=" ", flush=True)
                out = run_ai_overview_model(client, q)
                out.update({"question_id": q["id"], "replicate": k, "route": route, "captured_at": now_iso()})
                write_json(d / f"ai_overview_model_run_{k}.json", out)
                print(f"{len(out['retrieved_sources'])} retrieved, {len(out['cited_sources'])} cited, "
                      f"{len(out['overview_text'].split())} words")


if __name__ == "__main__":
    main()
