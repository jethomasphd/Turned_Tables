"""
01_run_tables_turned.py — headless, line-for-line replication of the Tables Turned pipeline.

What it does (mirrors commons-table/js/app.js handleSearch() + handleSynthesize()):

  1. ASK        question + decision context from config/questions.json
  2. EXPAND     Claude turns the question into 3-4 PubMed strategies   (SEARCH_SYSTEM)
  3. RETRIEVE   each strategy -> NCBI esearch (retmax 25, relevance) -> efetch abstracts
  4. RANK       score = 3 x overlap + sum(position points); keep top 12
  5. TRANSLATE  Claude writes a plain title + one-line summary per paper (SUMMARY_SYSTEM)
  6. CURATE     default UI state: every shown paper selected (zero-effort user)
  7. SYNTHESIZE Claude streams a receipted one-page brief            (SYNTH_SYSTEM)
  8. SEAL       a Tablet v2.0 JSON (the same bundle the site exports) + telemetry

System prompts and model ID are parsed out of synthesis.js at run time, so this
script sends exactly what the website sends.

Usage
-----
    pip install anthropic
    export TT_WORKER_URL=https://tables-turned-api.<you>.workers.dev   # or ANTHROPIC_API_KEY=...
    python scripts/01_run_tables_turned.py                 # all questions, 1 replicate
    python scripts/01_run_tables_turned.py --only Q1 --replicates 3

Outputs: data/tables_turned/<QID>_<slug>/run_<k>.json and brief_<k>.md
"""

from __future__ import annotations

import argparse
import time
import uuid

from tt_common import (DATA, esearch, efetch_papers, load_production_prompts, load_questions,
                       make_client, now_iso, parse_json_array, text_of, usage_dict, write_json)

MAX_PAPERS = 12          # app.js MAX_PAPERS
DEFAULT_DEPTH = 25       # search.html: "25 (deep dive)" is the selected default
DEFAULT_SORT = "relevance"


# ─────────────────────────────────────────────────────────────
#  Prompt builders — byte-compatible with synthesis.js
# ─────────────────────────────────────────────────────────────

def build_search_prompt(question: str, context: str) -> str:
    prompt = f"Question: {question}"
    if context:
        prompt += f"\nDecision context: {context}"
    prompt += "\n\nGenerate PubMed search queries for this question."
    return prompt


def build_summary_prompt(question: str, papers: list[dict]) -> str:
    prompt = f'The user\'s question: "{question}"\n\nPapers to translate:\n\n'
    for i, p in enumerate(papers):
        prompt += f"Paper {i + 1} (PMID: {p['pmid']}):\n"
        prompt += f"Title: {p['title']}\n"
        if p.get("abstract"):
            prompt += f"Abstract: {p['abstract'][:600]}\n"   # substring(0, 600)
        prompt += "\n"
    prompt += "Translate each paper into plain language."
    return prompt


def build_synthesis_user_message(question: str, context: str, papers: list[dict]) -> str:
    """Synthesis.buildUserMessage()."""
    lines = [f"**Question:** {question}"]
    if context:
        lines.append(f"**Context:** {context}")
    lines += ["", "---", "", f"**Papers provided ({len(papers)}):**", ""]
    for p in papers:
        lines.append(f"### PMID: {p['pmid']}")
        lines.append(f"**Title:** {p['title']}")
        authors = p.get("authors") or []
        if authors:
            display = ", ".join(authors[:5]) + " et al." if len(authors) > 5 else ", ".join(authors)
            lines.append(f"**Authors:** {display}")
        if p.get("journal"):
            yr = f" ({p['year']})" if p.get("year") else ""
            lines.append(f"**Journal:** {p['journal']}{yr}")
        if p.get("abstract"):
            lines.append("**Abstract:**")
            lines.append(p["abstract"])
        else:
            lines.append("**Abstract:** Not available.")
        lines += ["", "---", ""]
    lines.append("Based on these papers, generate a plain-language synthesis brief.")
    lines.append("CRITICAL: The brief MUST fit on ONE printed page. Be direct and concise. Cut all filler.")
    lines.append("Answer the question first. Every claim must cite PMID(s).")
    lines.append("Surface contradictions. State confidence honestly.")
    lines.append("Write for a regular person making a real decision.")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────
#  One full session
# ─────────────────────────────────────────────────────────────

def run_session(client, prompts: dict, q: dict, depth: int, sort: str) -> dict:
    model = prompts["MODEL"]
    question, context = q["question"], q["context"]
    prov: list[dict] = []
    timings: dict[str, float] = {}
    usage: dict[str, dict] = {}

    def log(action: str, detail: str | None = None) -> None:
        prov.append({"timestamp": now_iso(), "action": action, "detail": detail})

    t_start = time.time()
    log("search_started", question)

    # ── Stage 1: question -> PubMed strategies ──
    t = time.time()
    msg = client.messages.create(model=model, max_tokens=1024, system=prompts["SEARCH_SYSTEM"],
                                 messages=[{"role": "user", "content": build_search_prompt(question, context)}])
    queries = parse_json_array(text_of(msg))
    timings["query_generation_s"] = round(time.time() - t, 2)
    usage["search"] = usage_dict(msg.usage)
    log("search_queries_generated", " | ".join(x["query"] for x in queries))
    print(f"  {len(queries)} strategies generated")

    # ── Stage 2: retrieve + score (app.js scoring loop) ──
    t = time.time()
    paper_scores: dict[str, dict] = {}
    all_papers: list[dict] = []
    per_query: list[dict] = []
    for qi, sq in enumerate(queries):
        try:
            res = esearch(sq["query"], retmax=depth, sort=sort)
        except Exception as e:  # app.js swallows per-query failures
            log("search_query_failed", f"{sq['query']}: {e}")
            per_query.append({"query": sq["query"], "strategy": sq.get("strategy"), "error": str(e)})
            continue
        log("pubmed_searched", f'"{sq["query"]}" -> {res["count"]} total, fetched {len(res["pmids"])}')
        per_query.append({"query": sq["query"], "strategy": sq.get("strategy"),
                          "total_hits": res["count"], "returned": res["pmids"],
                          "querytranslation": res.get("querytranslation")})
        print(f"    S{qi + 1}: {res['count']:>9,} hits  | {sq['query'][:80]}")
        for pos, pmid in enumerate(res["pmids"]):
            s = paper_scores.setdefault(pmid, {"overlap": 0, "positionPts": 0, "strategies": [],
                                               "strategy_idx": [], "positions": []})
            s["overlap"] += 1
            s["positionPts"] += max(1, 6 - min(pos + 1, 5))      # top 5 -> 5/4/3/2/1, rest -> 1
            s["strategies"].append(sq.get("strategy"))
            s["strategy_idx"].append(qi)
            s["positions"].append(pos + 1)
        have = {p["pmid"] for p in all_papers}
        new = [p for p in res["pmids"] if p not in have]
        if new:
            for p in efetch_papers(new):
                if p["pmid"] not in {x["pmid"] for x in all_papers}:
                    all_papers.append(p)
    timings["retrieval_s"] = round(time.time() - t, 2)

    if not all_papers:
        raise RuntimeError("No papers found")

    for p in all_papers:
        s = paper_scores.get(p["pmid"], {"overlap": 1, "positionPts": 1, "strategies": []})
        p["_score"] = s["overlap"] * 3 + s["positionPts"]
        p["_overlap"] = s["overlap"]
        p["_strategies"] = s["strategies"]
        p["_strategy_idx"] = s.get("strategy_idx", [])
        p["_positions"] = s.get("positions", [])
    ranked = sorted(all_papers, key=lambda p: -p["_score"])      # stable, like Array.sort
    capped = ranked[:MAX_PAPERS]
    log("papers_ranked", f"{len(all_papers)} papers scored. Top {len(capped)} selected "
                         f"(scores {capped[0]['_score']}-{capped[-1]['_score']}). "
                         "Method: cross-strategy overlap (x3) + PubMed position weight.")
    print(f"  pool {len(all_papers)} -> top {len(capped)} (scores {capped[0]['_score']}..{capped[-1]['_score']})")

    # ── Stage 3: plain-language translation ──
    t = time.time()
    msg = client.messages.create(model=model, max_tokens=2048, system=prompts["SUMMARY_SYSTEM"],
                                 messages=[{"role": "user", "content": build_summary_prompt(question, capped)}])
    try:
        summaries = parse_json_array(text_of(msg))
    except Exception:
        summaries = [{"plain_title": "", "plain_summary": ""} for _ in capped]
    timings["translation_s"] = round(time.time() - t, 2)
    usage["summary"] = usage_dict(msg.usage)
    log("plain_summaries_generated", f"{len(summaries)} papers translated")

    # ── Stage 4: curation (default = all selected) ──
    selected = list(capped)
    log("papers_selected_for_synthesis", f"{len(selected)} papers")

    # ── Stage 5: streamed synthesis ──
    user_msg = build_synthesis_user_message(question, context, selected)
    t = time.time()
    first_token_s = None
    with client.messages.stream(model=model, max_tokens=1500, system=prompts["SYNTH_SYSTEM"],
                                messages=[{"role": "user", "content": user_msg}]) as stream:
        for _ in stream.text_stream:
            if first_token_s is None:
                first_token_s = round(time.time() - t, 2)
        final = stream.get_final_message()
    brief = text_of(final)
    timings["synthesis_s"] = round(time.time() - t, 2)
    timings["synthesis_first_token_s"] = first_token_s
    timings["total_s"] = round(time.time() - t_start, 2)
    usage["synthesis"] = usage_dict(final.usage)
    log("synthesis_generated", f"{len(brief)} chars, {len(selected)} papers")
    print(f"  brief: {len(brief)} chars, stop={final.stop_reason}, total {timings['total_s']}s")

    selected_ids = {p["pmid"] for p in selected}

    def map_paper(p: dict, i: int) -> dict:      # tablet-press.js mapPaper()
        s = summaries[i] if i < len(summaries) and isinstance(summaries[i], dict) else {}
        return {
            "pmid": p["pmid"], "doi": p.get("doi"), "title": p["title"], "authors": p.get("authors", []),
            "journal": p.get("journal"), "year": p.get("year"), "abstract": p.get("abstract"),
            "plain_title": s.get("plain_title") or None, "plain_summary": s.get("plain_summary") or None,
            "selected": p["pmid"] in selected_ids,
            "ranking": {"score": p["_score"], "overlap": p["_overlap"],
                        "strategies_matched": p["_strategies"],
                        "method": "cross-strategy overlap (x3) + PubMed position weight"},
            # analysis-only extras (not in the production Tablet):
            "publication_types": p.get("publication_types", []),
            "strategy_idx": p["_strategy_idx"], "positions": p["_positions"],
        }

    tablet = {
        "version": "2.0",
        "title": question,
        "session": {"id": str(uuid.uuid4()), "created": prov[0]["timestamp"], "sealed": now_iso(),
                    "status": "sealed"},
        "intent": {"question": question, "decision_context": context},
        "search": {"queries": [{"query": x["query"], "strategy": x.get("strategy")} for x in queries],
                   "total_papers_found": len(capped), "papers_shown": len(selected)},
        "papers": [map_paper(p, i) for i, p in enumerate(capped)],
        "prompts": {"search_system": prompts["SEARCH_SYSTEM"], "summary_system": prompts["SUMMARY_SYSTEM"],
                    "synthesis_system": prompts["SYNTH_SYSTEM"], "synthesis_user_message": user_msg,
                    "model": model},
        "synthesis": {"brief_markdown": brief},
        "provenance": prov,
    }
    # Everything below is study telemetry, not part of the user-facing Tablet.
    telemetry = {
        "prompt_sha256": prompts["sha256"],
        "search_depth": depth, "search_sort": sort,
        "per_query": per_query,
        "candidate_pool": [{"pmid": p["pmid"], "title": p["title"], "year": p.get("year"),
                            "score": p["_score"], "overlap": p["_overlap"],
                            "strategy_idx": p["_strategy_idx"], "positions": p["_positions"],
                            "publication_types": p.get("publication_types", []),
                            "has_abstract": bool(p.get("abstract"))} for p in ranked],
        "timings": timings, "usage": usage,
        "synthesis_stop_reason": final.stop_reason,
        "served_model": final.model,
    }
    return {"tablet": tablet, "telemetry": telemetry}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*", help="question IDs to run (default: all)")
    ap.add_argument("--replicates", type=int, default=1)
    ap.add_argument("--start-rep", type=int, default=1, help="replicate index to start numbering at")
    ap.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    ap.add_argument("--sort", default=DEFAULT_SORT)
    ap.add_argument("--worker", default=None, help="Worker URL (overrides TT_WORKER_URL)")
    args = ap.parse_args()

    prompts = load_production_prompts()
    client, route = make_client(args.worker)
    qs = load_questions()["questions"]
    if args.only:
        qs = [q for q in qs if q["id"] in args.only]
    print(f"Tables Turned replication | model={prompts['MODEL']} | route={route} | {len(qs)} question(s)")

    for q in qs:
        for k in range(args.start_rep, args.start_rep + args.replicates):
            print(f"\n[{q['id']}] {q['question']}  (replicate {k})")
            out = run_session(client, prompts, q, args.depth, args.sort)
            out["run"] = {"question_id": q["id"], "replicate": k, "route": route, "captured_at": now_iso()}
            d = DATA / "tables_turned" / f"{q['id']}_{q['slug']}"
            write_json(d / f"run_{k}.json", out)
            (d / f"brief_{k}.md").write_text(out["tablet"]["synthesis"]["brief_markdown"], encoding="utf-8")
            print(f"  saved -> {d.relative_to(DATA.parent)}/run_{k}.json")


if __name__ == "__main__":
    main()
