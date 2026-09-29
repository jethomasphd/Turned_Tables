"""
04_analyze_and_plot.py — every number and figure in the preprint, computed from saved data.

Reads   data/tables_turned/**, data/comparators/**, data/audit/*.json, config/questions.json
Writes  data/metrics/summary.json   (the manuscript builder reads only this)
        data/metrics/per_run.csv     (table view of every run × metric)
        figures/fig3_consensus.png   (Q1 retrieval funnel + cross-strategy consensus matrix)
        figures/fig4_evidence.png    (what each arm's answer rests on, per question)
        figures/fig5_claims.png      (claim-level provenance + readability)

No network access and no API calls: re-running this script on the frozen data
reproduces the paper's numbers exactly.

    pip install matplotlib numpy
    python scripts/04_analyze_and_plot.py
"""

from __future__ import annotations

import csv
import itertools
import re
import statistics as st
from collections import Counter, defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Rectangle

from tt_common import DATA, FIGURES, load_questions, read_json, write_json
from textstats import SOURCE_CLASSES, claim_units, classify_source, fkgl, pmids_in

# ─────────────────────────────────────────────────────────────
#  Palette — dataviz reference instance (light mode, validated)
# ─────────────────────────────────────────────────────────────
INK, INK2, MUTED = "#0b0b0b", "#52514e", "#898781"
GRID, BASE, SURF = "#e1e0d9", "#c3c2b7", "#fcfcfb"
ARM_COLOR = {"tables_turned": "#2a78d6", "ai_overview_model": "#eb6834", "claude_free": "#1baf7a"}
ARM_LABEL = {"tables_turned": "Tables Turned", "ai_overview_model": "AI Overview (modeled)",
             "claude_free": "Claude free"}
CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
BLUE = {250: "#86b6ef", 350: "#5598e7", 450: "#2a78d6", 550: "#1c5cab", 650: "#104281"}
STATUS = {"good": "#0ca30c", "warning": "#fab219", "serious": "#ec835a", "critical": "#d03b3b"}

plt.rcParams.update({
    "font.family": "Liberation Sans", "font.size": 7.5, "axes.edgecolor": BASE, "axes.labelcolor": INK2,
    "xtick.color": INK2, "ytick.color": INK2, "axes.linewidth": 0.8, "xtick.major.width": 0.6,
    "ytick.major.width": 0, "axes.spines.top": False, "axes.spines.right": False,
    "axes.titleweight": "bold", "axes.titlesize": 8.5, "axes.titlecolor": INK, "axes.titlelocation": "left",
    "legend.frameon": False, "legend.fontsize": 6.8,
})

# Anthropic list prices (USD per million tokens) at time of study; web search $10 per 1,000.
PRICE = {"claude-opus-4-6": (5.0, 25.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-opus-5-5": (4.0, 20.0)}
SEARCH_PRICE = 0.01


def cost(usage: dict, model: str) -> float:
    pin, pout = PRICE[model]
    tin = (usage.get("input_tokens") or 0) + (usage.get("cache_creation_input_tokens") or 0) \
        + (usage.get("cache_read_input_tokens") or 0)
    c = tin * pin / 1e6 + (usage.get("output_tokens") or 0) * pout / 1e6
    stu = usage.get("server_tool_use") or {}
    return c + (stu.get("web_search_requests") or 0) * SEARCH_PRICE


# ─────────────────────────────────────────────────────────────
#  Study design from PubMed publication types
# ─────────────────────────────────────────────────────────────
DESIGNS = ["Systematic review / meta-analysis", "Randomized trial", "Guideline / consensus",
           "Other primary study", "Narrative review", "Other / not typed"]
DESIGN_COLOR = [BLUE[650], BLUE[550], BLUE[450], BLUE[350], BLUE[250], "#d8d7d1"]


def design_of(pubtypes: list[str]) -> str:
    t = {x.lower() for x in pubtypes or []}
    if t & {"meta-analysis", "systematic review"}:
        return DESIGNS[0]
    if any("randomized controlled trial" in x or "clinical trial, phase" in x for x in t):
        return DESIGNS[1]
    if t & {"practice guideline", "guideline", "consensus development conference", "consensus statement"}:
        return DESIGNS[2]
    if t & {"clinical trial", "observational study", "comparative study", "multicenter study",
            "controlled clinical trial", "evaluation study", "validation study", "twin study"}:
        return DESIGNS[3]
    if "review" in t:
        return DESIGNS[4]
    return DESIGNS[5]


CF_STATUS_ORDER = ["verified", "exists_paraphrased", "locatable_no_title", "exists_metadata_error",
                   "not_found", "non_article_source"]
CF_STATUS_LABEL = {"verified": "Verified (title, author, year match)",
                   "exists_paraphrased": "Real; title paraphrased",
                   "locatable_no_title": "Real; no title given (author + year + journal)",
                   "exists_metadata_error": "Real; author/year/PMID wrong",
                   "not_found": "Not found (probable fabrication)",
                   "non_article_source": "Non-article source (guidance, labels)"}
CF_STATUS_COLOR = {"verified": STATUS["good"], "exists_paraphrased": STATUS["warning"],
                   "locatable_no_title": "#fcd27a", "exists_metadata_error": STATUS["serious"],
                   "not_found": STATUS["critical"], "non_article_source": "#d8d7d1"}


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if (a | b) else 1.0


def mean_pairwise_jaccard(sets: list[set]) -> float | None:
    pairs = list(itertools.combinations(sets, 2))
    return round(st.mean(jaccard(a, b) for a, b in pairs), 3) if pairs else None


# ─────────────────────────────────────────────────────────────
#  Load
# ─────────────────────────────────────────────────────────────

def load_all() -> dict:
    qcfg = load_questions()
    Q = {q["id"]: q for q in qcfg["questions"]}
    tt_runs = {}
    for p in sorted((DATA / "tables_turned").glob("*/run_*.json")):
        r = read_json(p)
        tt_runs[(r["run"]["question_id"], r["run"]["replicate"])] = r
    cf_runs, ao_runs = {}, {}
    for p in sorted((DATA / "comparators").glob("*/*_run_*.json")):
        if p.stem.endswith("_references"):
            continue
        r = read_json(p)
        (cf_runs if r["arm"] == "claude_free" else ao_runs)[(r["question_id"], r["replicate"])] = r
    audits = {k: {(a["question_id"], a["replicate"]): a for a in read_json(DATA / "audit" / f"{k}.json")}
              for k in ("tt_audit", "claude_free_audit", "ai_overview_audit")}
    return {"Q": Q, "cfg": qcfg, "tt": tt_runs, "cf": cf_runs, "ao": ao_runs, **audits}


# ─────────────────────────────────────────────────────────────
#  Metrics
# ─────────────────────────────────────────────────────────────

FINDINGS_SECTIONS = ("the short answer", "key findings")


def claim_tally(claims: list[dict], cite_key: str, findings_only: bool = False) -> Counter:
    c = Counter()
    for cl in claims:
        if findings_only and not any(cl.get("section", "").lower().startswith(s) for s in FINDINGS_SECTIONS):
            continue
        if cl.get(cite_key):
            c[cl.get("verdict") or "unjudged"] += 1
        else:
            c["uncited"] += 1
    return c


def per_run_rows(D: dict) -> list[dict]:
    rows = []
    for (qid, rep), r in sorted(D["tt"].items()):
        brief = r["tablet"]["synthesis"]["brief_markdown"]
        a = D["tt_audit"][(qid, rep)]
        tally = claim_tally(a["claims"], "pmids")
        rs = fkgl(brief)
        u = r["telemetry"]["usage"]
        c = sum(cost(u[k], "claude-opus-4-6") for k in ("search", "summary", "synthesis"))
        rows.append({"arm": "tables_turned", "qid": qid, "rep": rep, "words": rs["words"], "fkgl": rs["fkgl"],
                     "claims": sum(tally.values()), "cited": sum(v for k, v in tally.items() if k != "uncited"),
                     "supported": tally["supported"], "partial": tally["partially_supported"],
                     "not_supported": tally["not_supported"], "sources": a["n_cited_pmids"],
                     "latency_s": r["telemetry"]["timings"]["total_s"], "cost_usd": round(c, 4)})
    for (qid, rep), r in sorted(D["ao"].items()):
        a = D["ai_overview_audit"][(qid, rep)]
        tally = claim_tally(a["claims"], "source_ns")
        rs = fkgl(r["overview_text"])
        c = sum(cost(u, "claude-sonnet-5-5") for u in r["usage"])
        rows.append({"arm": "ai_overview_model", "qid": qid, "rep": rep, "words": rs["words"], "fkgl": rs["fkgl"],
                     "claims": sum(tally.values()), "cited": sum(v for k, v in tally.items() if k != "uncited"),
                     "supported": tally["supported"], "partial": tally["partially_supported"],
                     "not_supported": tally["not_supported"], "sources": len(r["cited_sources"]),
                     "latency_s": r["latency_s"], "cost_usd": round(c, 4)})
    for (qid, rep), r in sorted(D["cf"].items()):
        t1 = r["turns"][1]["text"]
        units = claim_units(t1)
        cited = [u for u in units if re.search(r"PMID|doi\.org|https?://|\[\d+\]", u["text"])]
        rs = fkgl(t1)
        a = D["claude_free_audit"][(qid, rep)]
        c = cost(r["turns"][1]["usage"], "claude-sonnet-5-5")
        rows.append({"arm": "claude_free", "qid": qid, "rep": rep, "words": rs["words"], "fkgl": rs["fkgl"],
                     "claims": len(units), "cited": len(cited), "supported": 0, "partial": 0, "not_supported": 0,
                     "sources": len(a["references"]), "latency_s": r["turns"][1]["latency_s"],
                     "cost_usd": round(c, 4)})
    return rows


def summarize(D: dict, rows: list[dict]) -> dict:
    S: dict = {"questions": [{k: q[k] for k in ("id", "question", "context", "topic")} for q in D["Q"].values()]}
    prim = [r for r in rows if r["rep"] == 1]

    # Arm-level aggregates (primary analysis: replicate 1 of every question)
    arms = {}
    for arm in ARM_LABEL:
        rr = [r for r in prim if r["arm"] == arm]
        claims = sum(r["claims"] for r in rr)
        cited = sum(r["cited"] for r in rr)
        arms[arm] = {
            "n_runs": len(rr), "claims": claims, "cited": cited,
            "pct_cited": round(100 * cited / claims, 1) if claims else 0.0,
            "supported": sum(r["supported"] for r in rr), "partial": sum(r["partial"] for r in rr),
            "not_supported": sum(r["not_supported"] for r in rr),
            "fkgl_mean": round(st.mean(r["fkgl"] for r in rr), 1),
            "fkgl_range": [min(r["fkgl"] for r in rr), max(r["fkgl"] for r in rr)],
            "words_mean": round(st.mean(r["words"] for r in rr)),
            "latency_median_s": round(st.median(r["latency_s"] for r in rr), 1),
            "cost_mean_usd": round(st.mean(r["cost_usd"] for r in rr), 3),
            "sources_mean": round(st.mean(r["sources"] for r in rr), 1),
        }
        j = arms[arm]["supported"] + arms[arm]["partial"] + arms[arm]["not_supported"]
        for k in ("supported", "partial", "not_supported"):
            arms[arm][f"pct_{k}_of_cited"] = round(100 * arms[arm][k] / j, 1) if j else None
    # TT findings-section coverage (short answer + key findings)
    fs = Counter()
    for (qid, rep), a in D["tt_audit"].items():
        if rep == 1:
            fs += claim_tally(a["claims"], "pmids", findings_only=True)
    arms["tables_turned"]["findings_supported"] = fs["supported"]
    arms["tables_turned"]["findings_partial"] = fs["partially_supported"]
    arms["tables_turned"]["findings_not_supported"] = fs["not_supported"]
    arms["tables_turned"]["findings_claims"] = sum(fs.values())
    arms["tables_turned"]["findings_cited"] = sum(v for k, v in fs.items() if k != "uncited")
    arms["tables_turned"]["findings_pct_cited"] = round(100 * arms["tables_turned"]["findings_cited"] / sum(fs.values()), 1)
    S["arms"] = arms

    # Tables Turned integrity checks, all runs
    tta = list(D["tt_audit"].values())
    S["tt_integrity"] = {
        "runs": len(tta),
        "cited_pmids": sum(a["n_cited_pmids"] for a in tta),
        "resolved": sum(a["n_resolved_in_pubmed"] for a in tta),
        "in_corpus": sum(a["n_in_curated_corpus"] for a in tta),
        "out_of_corpus": sum(len(a["out_of_corpus_pmids"]) for a in tta),
        "unwitnessed_markers": sum(a["n_unwitnessed_markers"] for a in tta),
        "retracted_in_corpus": sum(len(a.get("retracted_in_corpus", [])) for a in tta),
        "corpus_coverage_mean": round(st.mean(a["corpus_coverage"] for a in tta), 3),
    }

    # Pipeline telemetry per question (replicate 1)
    tele = []
    for qid in D["Q"]:
        r = D["tt"][(qid, 1)]
        t = r["telemetry"]
        top = r["tablet"]["papers"]
        a = D["tt_audit"][(qid, 1)]
        u = t["usage"]
        tele.append({
            "qid": qid, "n_strategies": len(t["per_query"]),
            "hits_per_strategy": [q.get("total_hits") for q in t["per_query"]],
            "hits_total": sum(q.get("total_hits") or 0 for q in t["per_query"]),
            "pool": len(t["candidate_pool"]),
            "top12_multi_strategy": sum(1 for p in top if (p["ranking"]["overlap"] or 0) >= 2),
            "score_range": [top[-1]["ranking"]["score"], top[0]["ranking"]["score"]],
            "ties_at_cutoff": sum(1 for c in t["candidate_pool"] if c["score"] == top[-1]["ranking"]["score"]),
            "cited": a["n_cited_pmids"], "coverage": a["corpus_coverage"],
            "unwitnessed": a["n_unwitnessed_markers"],
            "designs_top12": Counter(design_of(p["publication_types"]) for p in top),
            "timings": t["timings"],
            "tokens_in": sum(u[k].get("input_tokens", 0) for k in u),
            "tokens_out": sum(u[k].get("output_tokens", 0) for k in u),
            "cost_usd": round(sum(cost(u[k], "claude-opus-4-6") for k in u), 4),
            "queries": [q["query"] for q in t["per_query"]],
        })
    S["telemetry"] = tele
    S["telemetry_totals"] = {
        "hits_median": st.median(x["hits_total"] for x in tele),
        "hits_range": [min(x["hits_total"] for x in tele), max(x["hits_total"] for x in tele)],
        "pool_median": st.median(x["pool"] for x in tele),
        "pool_range": [min(x["pool"] for x in tele), max(x["pool"] for x in tele)],
        "multi_strategy_share": round(sum(x["top12_multi_strategy"] for x in tele) / (12 * len(tele)), 3),
        "latency_median_s": st.median(x["timings"]["total_s"] for x in tele),
        "latency_range_s": [min(x["timings"]["total_s"] for x in tele), max(x["timings"]["total_s"] for x in tele)],
        "first_token_median_s": st.median(x["timings"]["synthesis_first_token_s"] for x in tele),
        "cost_mean_usd": round(st.mean(x["cost_usd"] for x in tele), 3),
        "stage_median_s": {k: st.median(x["timings"][k] for x in tele)
                           for k in ("query_generation_s", "retrieval_s", "translation_s", "synthesis_s")},
    }

    # Evidence bases
    tt_design, tt_years = defaultdict(Counter), []
    for qid in D["Q"]:
        r = D["tt"][(qid, 1)]
        papers = {p["pmid"]: p for p in r["tablet"]["papers"]}
        for pid in pmids_in(r["tablet"]["synthesis"]["brief_markdown"]):
            if pid in papers:
                tt_design[qid][design_of(papers[pid]["publication_types"])] += 1
                if papers[pid].get("year"):
                    tt_years.append(papers[pid]["year"])
    ao_class, ao_retrieved_class = defaultdict(Counter), Counter()
    for (qid, rep), a in D["ai_overview_audit"].items():
        if rep != 1:
            continue
        for s in a["cited"]:                       # classify at analysis time so rule fixes apply
            ao_class[qid][classify_source(s["url"])] += 1
        for s in a["retrieved"]:
            ao_retrieved_class[classify_source(s["url"])] += 1
    cf_status, cf_years, cf_pmids, cf_retracted = defaultdict(Counter), [], Counter(), []
    for (qid, rep), a in D["claude_free_audit"].items():
        if rep != 1:
            continue
        for ref in a["references"]:
            cf_status[qid][ref["status"]] += 1
            if ref.get("matched_year") and ref["status"] != "not_found":
                cf_years.append(ref["matched_year"])
            if ref["ref"].get("pmid"):
                cf_pmids[ref["pmid_status"]] += 1
            if ref.get("matched_is_retracted"):
                cf_retracted.append({"qid": qid, "title": ref["ref"]["title"], "pmid": ref["matched"].get("pmid")})
    S["evidence"] = {
        "tt_design": {q: dict(c) for q, c in tt_design.items()},
        "tt_design_total": dict(sum(tt_design.values(), Counter())),
        "tt_years_median": st.median(tt_years), "tt_share_2021plus": round(sum(y >= 2021 for y in tt_years) / len(tt_years), 3),
        "ao_cited_class": {q: dict(c) for q, c in ao_class.items()},
        "ao_cited_class_total": dict(sum(ao_class.values(), Counter())),
        "ao_retrieved_class_total": dict(ao_retrieved_class),
        "ao_retrieved_total": sum(ao_retrieved_class.values()),
        "cf_status": {q: dict(c) for q, c in cf_status.items()},
        "cf_status_total": dict(sum(cf_status.values(), Counter())),
        "cf_years_median": st.median(cf_years) if cf_years else None,
        "cf_share_2021plus": round(sum(y >= 2021 for y in cf_years) / len(cf_years), 3) if cf_years else None,
        "cf_pmid_status": dict(cf_pmids),
        "cf_retracted": cf_retracted,
        "cf_declined_pmids_runs": sum(1 for a in D["claude_free_audit"].values() if a["declined_pmids"]),
        "cf_runs": len(D["claude_free_audit"]),
    }

    # Flagship stability across replicates
    tt_top = [set(p["pmid"] for p in D["tt"][("Q1", k)]["tablet"]["papers"]) for k in (1, 2, 3) if ("Q1", k) in D["tt"]]
    tt_cit = [set(pmids_in(D["tt"][("Q1", k)]["tablet"]["synthesis"]["brief_markdown"])) for k in (1, 2, 3) if ("Q1", k) in D["tt"]]
    tt_q = [[q["query"] for q in D["tt"][("Q1", k)]["telemetry"]["per_query"]] for k in (1, 2, 3) if ("Q1", k) in D["tt"]]
    cf_sets = []
    for k in (1, 2, 3):
        a = D["claude_free_audit"].get(("Q1", k))
        if a:
            cf_sets.append({(r["matched"] or {}).get("pmid") for r in a["references"]
                            if r.get("matched") and (r["matched"] or {}).get("pmid")})
    ao_sets = [{s["url"] for s in D["ai_overview_audit"][("Q1", k)]["cited"]} for k in (1, 2, 3) if ("Q1", k) in D["ai_overview_audit"]]
    ao_ret = [{s["url"] for s in D["ai_overview_audit"][("Q1", k)]["retrieved"]} for k in (1, 2, 3) if ("Q1", k) in D["ai_overview_audit"]]
    S["stability_Q1"] = {
        "tt_top12_jaccard": mean_pairwise_jaccard(tt_top),
        "tt_top12_in_all_runs": len(set.intersection(*tt_top)) if tt_top else None,
        "tt_cited_jaccard": mean_pairwise_jaccard(tt_cit),
        "tt_cited_in_all_runs": len(set.intersection(*tt_cit)) if tt_cit else None,
        "tt_identical_queries_first": len({q[0] for q in tt_q}) == 1,
        "cf_ref_pmid_jaccard": mean_pairwise_jaccard(cf_sets),
        "cf_ref_in_all_runs": len(set.intersection(*cf_sets)) if cf_sets else None,
        "ao_cited_jaccard": mean_pairwise_jaccard(ao_sets),
        "ao_retrieved_jaccard": mean_pairwise_jaccard(ao_ret),
        "tt_confidence": [re.search(r"Confidence:\s*\**\s*([A-Za-z\- ]+?)\**\s*$", D["tt"][("Q1", k)]["tablet"]["synthesis"]["brief_markdown"], re.M).group(1).strip()
                          for k in (1, 2, 3) if ("Q1", k) in D["tt"]],
    }

    # Ranker precision (judge-rated relevance of the 12 papers shown to the reader)
    rel = read_json(DATA / "audit" / "relevance_audit.json")
    prim_rel = [r for r in rel if r["replicate"] == 1]
    rc = Counter()
    for r in prim_rel:
        rc.update(r["counts"])
    per_q = {r["question_id"]: r["counts"] for r in prim_rel}
    S["relevance"] = {"counts": dict(rc), "n": sum(rc.values()), "per_question": per_q,
                      "off_topic_cited_primary": sum(len(r["off_topic_cited"]) for r in prim_rel),
                      "off_topic_cited_all": [{"qid": r["question_id"], "rep": r["replicate"], "pmids": r["off_topic_cited"]}
                                              for r in rel if r["off_topic_cited"]],
                      "cited_relevance": dict(Counter(p["relevance"] for r in prim_rel for p in r["papers"] if p["cited"]))}

    # Real AI Overview captures, if the authors add them (data/manual_captures/<QID>_ai_overview.json)
    manual = {}
    for f in sorted((DATA / "manual_captures").glob("Q*_ai_overview.json")):
        cap = read_json(f)
        text = cap.get("overview_text", "")
        manual[cap["question_id"]] = {
            "captured_at": cap.get("captured_at"), "words": fkgl(text)["words"], "fkgl": fkgl(text)["fkgl"],
            "claims": len(claim_units(text)),
            "cited_units": sum(1 for u in claim_units(text) if re.search(r"\[\d+\]", u["text"])),
            "cited_classes": dict(Counter(classify_source(c["url"]) for c in cap.get("cited_sources", []) if c.get("url"))),
        }
    S["manual_ai_overview"] = manual

    # Judge + cost bookkeeping
    judge_cost = 0.0
    for key in ("tt_audit", "ai_overview_audit"):
        for a in D[key].values():
            if a.get("judge"):
                judge_cost += cost(a["judge"]["usage"], "claude-opus-5-5")
    for r in rel:
        judge_cost += cost(r["judge"]["usage"], "claude-opus-5-5")
    S["study_cost_usd"] = round(sum(r["cost_usd"] for r in rows) + judge_cost, 2)
    S["pubmed_total"] = read_json(DATA / "pubmed_total.json")
    S["n_api_runs"] = len(rows)
    return S


# ─────────────────────────────────────────────────────────────
#  Figures
# ─────────────────────────────────────────────────────────────

QSHORT = {"Q1": "Q1 Melatonin for kids", "Q2": "Q2 Ozempic safety", "Q3": "Q3 Vitamin D & colds",
          "Q4": "Q4 Intermittent fasting", "Q5": "Q5 Probiotics & antibiotics", "Q6": "Q6 Apple cider vinegar"}


def _hbar_segments(ax, y, values, colors, height=0.56, total=None, labels=True, min_label=0.07):
    """Horizontal stacked bar with 2px surface gaps and optional in-segment count labels."""
    x = 0.0
    tot = total or sum(values)
    for v, c in zip(values, colors):
        if v <= 0:
            continue
        ax.barh(y, v, left=x, height=height, color=c, edgecolor="white", linewidth=1.0)
        if labels and v / max(tot, 1e-9) >= min_label:
            lum = matplotlib.colors.to_rgb(c)
            dark = (0.299 * lum[0] + 0.587 * lum[1] + 0.114 * lum[2]) < 0.55
            ax.text(x + v / 2, y, f"{v:g}", ha="center", va="center", fontsize=6.4,
                    color="white" if dark else INK)
        x += v
    return x


def fig_consensus(D: dict, S: dict) -> None:
    r = D["tt"][("Q1", 1)]
    t = r["telemetry"]
    pool = t["candidate_pool"]
    kept = {p["pmid"] for p in r["tablet"]["papers"]}
    cited = set(pmids_in(r["tablet"]["synthesis"]["brief_markdown"]))
    rows = pool[:18]
    nq = len(t["per_query"])

    fig = plt.figure(figsize=(7.0, 5.15), dpi=300)
    gs = fig.add_gridspec(2, 1, height_ratios=[1.0, 4.1], hspace=0.28)

    # (a) funnel
    ax = fig.add_subplot(gs[0])
    tele = next(x for x in S["telemetry"] if x["qid"] == "Q1")
    pm_total = read_json(DATA / "pubmed_total.json")["count"]
    stages = [("PubMed records (28 Sep 2026)", pm_total), ("Matched by ≥1 strategy (Σ hits)", tele["hits_total"]),
              ("Retrieved candidates (≤25 per strategy)", tele["pool"]), ("Shown to reader (top 12)", 12),
              ("Cited in brief", tele["cited"])]
    ys = np.arange(len(stages))[::-1]
    for (lab, v), y in zip(stages, ys):
        ax.barh(y, v, height=0.62, color=BLUE[550] if lab != "Cited in brief" else BLUE[650])
        ax.text(v * 1.25, y, f"{v:,.0f}", va="center", fontsize=6.8, color=INK)
        ax.text(0.62, y, lab, va="center", ha="right", fontsize=6.8, color=INK2)
    ax.set_xscale("log")
    ax.set_xlim(1, 4e9)
    ax.set_yticks([])
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="x", labelsize=6.2)
    ax.set_xticks([1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7])
    ax.set_xticklabels(["1", "10", "100", "1K", "10K", "100K", "1M", "10M"])
    ax.grid(axis="x", color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    ax.set_title(f"a   From {pm_total / 1e6:.0f} million records to {tele['cited']} receipts: Q1, “Does melatonin help kids sleep?” (log scale)",
                 pad=4, fontsize=8)
    ax.set_position([0.33, ax.get_position().y0, 0.64, ax.get_position().height])

    # (b) consensus matrix
    ax = fig.add_subplot(gs[1])
    ax.set_xlim(-11.2, nq + 4.4)
    ax.set_ylim(len(rows) + 0.9, -1.35)
    ax.axis("off")
    ramp = {5: BLUE[650], 4: BLUE[550], 3: BLUE[450], 2: BLUE[350], 1: "#b7d3f6"}
    for j, q in enumerate(t["per_query"]):
        ax.text(j, -1.05, f"S{j + 1}", ha="center", va="center", fontsize=7.4, fontweight="bold", color=INK)
        ax.text(j, -0.6, f"{q['total_hits']:,}", ha="center", va="center", fontsize=5.4, color=MUTED)
    ax.text(nq + 0.25, -1.05, "score", ha="left", va="center", fontsize=7.0, fontweight="bold", color=INK)
    ax.text(nq + 3.55, -1.05, "cited", ha="center", va="center", fontsize=7.0, fontweight="bold", color=INK)
    ax.text(-11.1, -1.05, "PMID       year  design", ha="left", va="center", fontsize=6.6,
            fontweight="bold", color=INK)
    ax.text(-7.2, -1.05, "title (PubMed)", ha="left", va="center", fontsize=6.6, fontweight="bold", color=INK)
    smax = max(p["score"] for p in rows)
    for i, p in enumerate(rows):
        is_kept = p["pmid"] in kept
        alpha_txt = INK if is_kept else MUTED
        des = {DESIGNS[0]: "SR/MA", DESIGNS[1]: "RCT", DESIGNS[2]: "Guide", DESIGNS[3]: "Prim.",
               DESIGNS[4]: "Review", DESIGNS[5]: "Other"}[design_of(p["publication_types"])]
        title = p["title"].rstrip(".")
        title = title if len(title) <= 46 else title[:45].rstrip() + "…"
        ax.text(-11.1, i, f"{p['pmid']}  {p['year']}  {des}", ha="left", va="center", fontsize=5.5, color=alpha_txt,
                family="Liberation Mono")
        ax.text(-7.2, i, title, ha="left", va="center", fontsize=5.8, color=alpha_txt)
        for j in range(nq):
            ax.add_patch(Rectangle((j - 0.46, i - 0.42), 0.92, 0.84, fc="#f4f3ef", ec="white", lw=0.8))
            if j in p["strategy_idx"]:
                pos = p["positions"][p["strategy_idx"].index(j)]
                pts = max(1, 6 - min(pos, 5))
                c = ramp[pts]
                ax.add_patch(Rectangle((j - 0.46, i - 0.42), 0.92, 0.84, fc=c, ec="white", lw=0.8,
                                       alpha=1.0 if is_kept else 0.45))
                ax.text(j, i, f"#{pos}", ha="center", va="center", fontsize=5.6,
                        color="white" if pts >= 3 else INK)
        w = 2.6 * p["score"] / smax
        ax.add_patch(Rectangle((nq + 0.25, i - 0.28), w, 0.56, fc=BLUE[450] if is_kept else BASE, ec="none"))
        ax.text(nq + 0.25 + w + 0.08, i, f"{p['score']}", va="center", fontsize=5.8, color=alpha_txt)
        if p["pmid"] in cited:
            ax.text(nq + 3.55, i, "✓", ha="center", va="center", fontsize=8, color=STATUS["good"], fontweight="bold", family="DejaVu Sans")
    cut = len([p for p in rows if p["pmid"] in kept]) - 0.5
    ax.plot([-11.15, nq + 4.3], [cut, cut], color=INK2, lw=0.8, ls=(0, (3, 2)))
    cut_score = rows[11]["score"]
    tied = sum(1 for p in pool if p["score"] == cut_score)
    tied_kept = sum(1 for p in pool if p["score"] == cut_score and p["pmid"] in kept)
    ax.text(nq + 4.3, cut + 0.1, "top-12 cutoff", ha="right", va="top", fontsize=5.8, color=INK2, style="italic")
    ly = len(rows) - 0.05
    ax.text(-11.1, ly + 0.15, "Numbers under S1–S4: total PubMed hits per strategy. Cell: rank of the paper in that strategy's results; "
            "shade: rank points (#1 = 5 … #5 or lower = 1).", fontsize=5.6, color=INK2, va="top")
    ax.text(-11.1, ly + 0.75, f"Score = 3 × strategies matched + Σ rank points. Grey rows fell below the cutoff; {tied} candidates "
            f"tie at score {cut_score} and {tied_kept} were kept by retrieval order (stable-sort tie-break).",
            fontsize=5.6, color=INK2, va="top")
    ax.set_title("b   Cross-strategy consensus ranking: the 18 highest-scoring of %d candidates" % len(pool), pad=2)
    fig.savefig(FIGURES / "fig3_consensus.png", dpi=300, bbox_inches="tight", facecolor="white", pad_inches=0.04)
    plt.close(fig)


def fig_evidence(D: dict, S: dict) -> None:
    qids = list(D["Q"])
    fig, axes = plt.subplots(1, 3, figsize=(7.0, 3.05), dpi=300, sharey=True)
    y = np.arange(len(qids))

    # (a) TT cited PMIDs by design
    ax = axes[0]
    for i, q in enumerate(qids):
        c = S["evidence"]["tt_design"].get(q, {})
        _hbar_segments(ax, i, [c.get(d, 0) for d in DESIGNS], DESIGN_COLOR)
    ax.set_title("a  Tables Turned: papers cited\n    in the brief, by study design", fontsize=7.6)
    handles = [Rectangle((0, 0), 1, 1, fc=c) for c in DESIGN_COLOR]
    ax.legend(handles, ["Systematic review / meta-analysis", "Randomized trial", "Guideline / consensus",
                        "Other primary study", "Narrative review", "Other (letters, comments)"],
              loc="upper left", bbox_to_anchor=(-0.02, -0.13), ncol=1, handlelength=1.0, fontsize=6.0)

    # (b) AIO cited web pages by source class
    ax = axes[1]
    cls_color = {c: CAT[i] for i, c in enumerate(SOURCE_CLASSES)}
    present = [c for c in SOURCE_CLASSES if S["evidence"]["ao_cited_class_total"].get(c)]
    for i, q in enumerate(qids):
        c = S["evidence"]["ao_cited_class"].get(q, {})
        _hbar_segments(ax, i, [c.get(k, 0) for k in present], [cls_color[k] for k in present])
    ax.set_title("b  AI Overview (modeled): cited\n    web pages by source type", fontsize=7.6)
    ax.legend([Rectangle((0, 0), 1, 1, fc=cls_color[k]) for k in present], present,
              loc="upper left", bbox_to_anchor=(-0.02, -0.13), ncol=1, handlelength=1.0, fontsize=6.0)

    # (c) Claude free references by verification status
    ax = axes[2]
    for i, q in enumerate(qids):
        c = S["evidence"]["cf_status"].get(q, {})
        end = _hbar_segments(ax, i, [c.get(k, 0) for k in CF_STATUS_ORDER], [CF_STATUS_COLOR[k] for k in CF_STATUS_ORDER])
        if any(r["qid"] == q for r in S["evidence"]["cf_retracted"]):
            ax.text(end + 0.25, i, "1 retracted†", va="center", fontsize=6.0, color=STATUS["critical"])
    ax.set_title("c  Claude free: references it listed\n    when asked, by verification result", fontsize=7.6)
    present = [k for k in CF_STATUS_ORDER if S["evidence"]["cf_status_total"].get(k) or k == "not_found"]
    n_refs = sum(S["evidence"]["cf_status_total"].values())
    n_nf = S["evidence"]["cf_status_total"].get("not_found", 0)
    ax.legend([Rectangle((0, 0), 1, 1, fc=CF_STATUS_COLOR[k]) for k in present],
              [CF_STATUS_LABEL[k].replace(" (title, author, year match)", "").replace(" (author + year + journal)", "")
               .replace(" (guidance, labels)", "").replace(" (probable fabrication)", f" ({n_nf} of {n_refs})")
               for k in present],
              loc="upper left", bbox_to_anchor=(-0.02, -0.13), ncol=1, handlelength=1.0, fontsize=6.0)

    for ax in axes:
        ax.set_yticks(y)
        ax.set_yticklabels([QSHORT[q] for q in qids], fontsize=6.6)
        ax.invert_yaxis()
        ax.grid(axis="x", color=GRID, lw=0.6)
        ax.set_axisbelow(True)
        ax.tick_params(axis="x", labelsize=6.2)
        ax.set_xlabel("count", fontsize=6.4)
        ax.xaxis.set_major_locator(matplotlib.ticker.MaxNLocator(integer=True))
    fig.subplots_adjust(wspace=0.12)
    fig.savefig(FIGURES / "fig4_evidence.png", dpi=300, bbox_inches="tight", facecolor="white", pad_inches=0.04)
    plt.close(fig)


def fig_claims(D: dict, S: dict, rows: list[dict]) -> None:
    fig = plt.figure(figsize=(7.0, 2.95), dpi=300)
    gs = fig.add_gridspec(1, 2, width_ratios=[1.35, 1.0], wspace=0.42)

    # (a) claim-level provenance
    ax = fig.add_subplot(gs[0])
    order = ["tables_turned", "ai_overview_model", "claude_free"]
    cats = [("supported", STATUS["good"], "Cited · supported"),
            ("partial", STATUS["warning"], "Cited · partially supported"),
            ("not_supported", STATUS["critical"], "Cited · not supported"),
            ("uncited", "#d8d7d1", "No resolvable citation")]
    tt = S["arms"]["tables_turned"]
    bars = [("Tables Turned\n(whole brief)", [tt["supported"], tt["partial"], tt["not_supported"], tt["claims"] - tt["cited"]], tt["claims"]),
            ("Tables Turned\n(answer + key findings)", [tt["findings_supported"], tt["findings_partial"], tt["findings_not_supported"],
              tt["findings_claims"] - tt["findings_cited"]], tt["findings_claims"])]
    for arm in order[1:]:
        a = S["arms"][arm]
        bars.append((ARM_LABEL[arm], [a["supported"], a["partial"], a["not_supported"], a["claims"] - a["cited"]], a["claims"]))
    for i, (label, vals, n) in enumerate(bars):
        pct = [100 * v / n for v in vals]
        x = 0
        for (k, c, _), p in zip(cats, pct):
            if p <= 0:
                continue
            ax.barh(i, p, left=x, height=0.62, color=c, edgecolor="white", linewidth=1.0)
            if p >= 8:
                ax.text(x + p / 2, i, f"{p:.0f}%", ha="center", va="center", fontsize=6.4,
                        color="white" if k in ("supported", "not_supported") else INK)
            x += p
        ax.text(101.5, i, f"n={n}", va="center", fontsize=6.2, color=INK2)
    ax.set_yticks(range(len(bars)))
    ax.set_yticklabels([b[0] for b in bars], fontsize=6.6)
    ax.invert_yaxis()
    ax.set_xlim(0, 100)
    ax.set_xlabel("% of claim units (bullets and sentences), six questions", fontsize=6.4)
    ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:.0f}%"))
    ax.tick_params(axis="x", labelsize=6.2)
    ax.grid(axis="x", color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    ax.legend([Rectangle((0, 0), 1, 1, fc=c) for _, c, _ in cats], [l for _, _, l in cats],
              loc="upper center", bbox_to_anchor=(0.45, -0.22), ncol=2, fontsize=6.0, handlelength=1.0)
    ax.set_title("a  Can each claim be traced to a source that says it?", fontsize=7.8)

    # (b) readability
    ax = fig.add_subplot(gs[1])
    qids = list(D["Q"])
    ax.axvspan(6, 8, color="#eef4fb", zorder=0)
    ax.text(7, -0.62, "grade 6–8 target", ha="center", va="center", fontsize=5.8, color=INK2)
    offs = {"tables_turned": -0.18, "ai_overview_model": 0.0, "claude_free": 0.18}
    for arm in order:
        xs = [next(r["fkgl"] for r in rows if r["arm"] == arm and r["qid"] == q and r["rep"] == 1) for q in qids]
        ax.scatter(xs, np.arange(len(qids)) + offs[arm], s=16, color=ARM_COLOR[arm], edgecolor="white",
                   linewidth=0.8, zorder=3, label=ARM_LABEL[arm])
    ax.set_yticks(range(len(qids)))
    ax.set_yticklabels([QSHORT[q].split(" ", 1)[0] for q in qids], fontsize=6.6)
    ax.set_ylim(len(qids) - 0.5, -0.9)
    ax.set_xlim(4, 16)
    ax.set_xlabel("Flesch–Kincaid grade level", fontsize=6.4)
    ax.tick_params(axis="x", labelsize=6.2)
    ax.grid(axis="x", color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=3, fontsize=6.0, handletextpad=0.2,
              columnspacing=0.6)
    ax.set_title("b  Reading level of the answer", fontsize=7.8)
    fig.savefig(FIGURES / "fig5_claims.png", dpi=300, bbox_inches="tight", facecolor="white", pad_inches=0.04)
    plt.close(fig)


def main() -> None:
    D = load_all()
    rows = per_run_rows(D)
    S = summarize(D, rows)
    out = DATA / "metrics"
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "per_run.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    def plain(o):
        if isinstance(o, Counter):
            return dict(o)
        if isinstance(o, dict):
            return {k: plain(v) for k, v in o.items()}
        if isinstance(o, list):
            return [plain(v) for v in o]
        return o
    write_json(out / "summary.json", plain(S))
    FIGURES.mkdir(parents=True, exist_ok=True)
    fig_consensus(D, S)
    fig_evidence(D, S)
    fig_claims(D, S, rows)
    print("metrics ->", out)
    print("figures ->", FIGURES)
    for arm, a in S["arms"].items():
        print(f"  {ARM_LABEL[arm]:22s} claims={a['claims']:3d} cited={a['pct_cited']:5.1f}%  "
              f"sup/part/not={a['supported']}/{a['partial']}/{a['not_supported']}  FKGL={a['fkgl_mean']}  "
              f"words={a['words_mean']}  cost=${a['cost_mean_usd']}")


if __name__ == "__main__":
    main()
