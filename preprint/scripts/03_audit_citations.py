"""
03_audit_citations.py — does every answer's evidence exist, and does it say what the answer says?

Three audits, one per arm, written to data/audit/:

  TABLES TURNED   (tt_audit.json)
    a. Resolution   every [PMID: n] in the brief is looked up in PubMed (esummary).
    b. Containment  every cited PMID must belong to the curated set actually sent to the model.
    c. Support      an independent judge model (claude-opus-5-5, a different model generation
                    from the generator, claude-opus-4-6) reads each claim + the full abstract(s)
                    it cites and returns supported / partially_supported / not_supported.
    d. Honesty      [UNWITNESSED] markers are counted.

  CLAUDE FREE     (claude_free_audit.json)
    a. Extraction   references listed in turn 2 are parsed into fields by a structured-output
                    call (saved verbatim for inspection; extraction does not judge validity).
    b. Existence    deterministic matching against PubMed (PMID, DOI, title, author+year
                    searches) and CrossRef; best title similarity decides.
    c. Accuracy     year (+/-1), first author, and any supplied PMID are checked against the
                    matched record.

  AI OVERVIEW MODEL (ai_overview_audit.json)
    a. Source class every retrieved and cited URL is classified (textstats.classify_source).
    b. Support      the judge compares each cited sentence with the page excerpt the search
                    tool returned as its citation (cited_text).

Usage
-----
    python scripts/03_audit_citations.py            # needs TT_WORKER_URL or ANTHROPIC_API_KEY for b/c judges
    python scripts/03_audit_citations.py --no-llm   # deterministic checks only
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter

from tt_common import (DATA, crossref_search, esearch, esummary, journal_match, make_client, norm_title,
                       now_iso, read_json, text_of, title_similarity, usage_dict, write_json)
from textstats import claim_units, classify_source, pmids_in

JUDGE_MODEL = "claude-opus-5-5"
EXTRACT_MODEL = "claude-sonnet-5-5"
AUDIT = DATA / "audit"

# ─────────────────────────────────────────────────────────────
#  Structured-output schemas
# ─────────────────────────────────────────────────────────────

REF_SCHEMA = {
    "type": "object",
    "properties": {"references": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "raw": {"type": "string"},
            "authors": {"type": "string"},
            "first_author_surname": {"type": "string"},
            "year": {"type": "string"},
            "title": {"type": "string"},
            "journal": {"type": "string"},
            "pmid": {"type": "string"},
            "doi": {"type": "string"},
            "kind": {"type": "string", "enum": ["journal_article", "guideline_or_org_statement",
                                                "book_or_report", "database_or_website", "other"]},
        },
        "required": ["raw", "authors", "first_author_surname", "year", "title", "journal", "pmid", "doi", "kind"],
        "additionalProperties": False}}},
    "required": ["references"], "additionalProperties": False,
}

EXTRACT_SYSTEM = """You convert a chatbot's list of sources into structured fields. Copy what the text says; never correct, complete, or look up anything. Use an empty string for any field the text does not state. 'year' is the four-digit year as written. 'pmid' and 'doi' only if written in the text. Classify 'kind' from how the source is described. Include every distinct source the text presents as a basis for its answer, including organizations' guidance that is cited without a title."""

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {"judgments": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "claim_id": {"type": "integer"},
            "verdict": {"type": "string", "enum": ["supported", "partially_supported", "not_supported"]},
            "reason": {"type": "string"},
        },
        "required": ["claim_id", "verdict", "reason"], "additionalProperties": False}}},
    "required": ["judgments"], "additionalProperties": False,
}

JUDGE_SYSTEM = """You audit citations in consumer health summaries. For each numbered claim you receive the claim text and the full text of the source(s) it cites. Decide whether the cited source(s), taken together, support the claim as a reader would understand it.

- supported: every factual element of the claim (direction, population, magnitude, certainty) is stated in or directly follows from the source(s).
- partially_supported: the gist is in the source(s) but some element is overstated, generalized to a different population, numerically off, or missing.
- not_supported: the source(s) do not contain the claim, or contradict it.

Judge only against the provided source text, not your own knowledge. Give a one-sentence reason."""


def structured_call(client, model: str, system: str, user: str, schema: dict, max_tokens: int = 16000):
    msg = client.messages.create(model=model, max_tokens=max_tokens, system=system,
                                 messages=[{"role": "user", "content": user}],
                                 output_config={"format": {"type": "json_schema", "schema": schema}})
    return json.loads(text_of(msg)), usage_dict(msg.usage), msg.model


# ─────────────────────────────────────────────────────────────
#  Reference verification (deterministic)
# ─────────────────────────────────────────────────────────────

# PubMed's stopword list (terms PubMed ignores; including them in a fielded AND query returns nothing)
STOP = set("""a about again all almost also although always among an and another any are as at be because been
before being between both but by can could did do does done due during each either enough especially etc for
found from further had has have having here how however i if in into is it its itself just kg km made mainly
make may mg might ml mm most mostly must nearly neither no nor obtained of often on our overall perhaps pmid
quite rather really regarding seem seen several should show showed shown shows significantly since so some
such than that the their theirs them then there therefore these they this those through thus to upon use used
using various very was we were what when which while with within without would vs versus or not""".split())


def _key_terms(title: str, n: int = 8) -> list[str]:
    return [w for w in norm_title(title).split() if w not in STOP and len(w) > 2][:n]


def is_retracted(rec: dict) -> bool:
    """PubMed marks retracted articles with the 'Retracted Publication' type and a 'Retracted:' title."""
    types = [t.lower() for t in rec.get("pubtypes", []) or []]
    return "retracted publication" in types or (rec.get("title") or "").lower().startswith("retracted")


def _author_ok(surname: str, rec: dict) -> bool:
    if not surname:
        return True
    sn = norm_title(surname).replace(" ", "")
    return any(sn and sn in norm_title(a).replace(" ", "") for a in (rec.get("authors") or [])[:3])


def _year_ok(year: int | None, rec: dict) -> bool:
    return year is None or rec.get("year") is None or abs(rec["year"] - year) <= 1


def verify_reference(ref: dict) -> dict:
    """Match one extracted reference to a real record. Returns an audit record with a status:

    verified               title matches (>=0.90) and first author + year agree
    exists_paraphrased     same first author/year/journal; title reworded (0.60-0.90)
    locatable_no_title     no title given, but author + year + journal identify a real article
    exists_metadata_error  title matches but author or year is wrong, or a supplied PMID is wrong
    not_found              nothing in PubMed or CrossRef fits (probable fabrication)
    non_article_source     guidance, fact sheets, labels, books - not journal articles
    """
    title = ref.get("title", "").strip()
    surname = ref.get("first_author_surname", "").strip()
    journal = ref.get("journal", "").strip()
    year = int(ref["year"]) if re.fullmatch(r"\d{4}", ref.get("year", "").strip() or "") else None
    kind = ref.get("kind", "")

    if kind in ("guideline_or_org_statement", "database_or_website", "book_or_report") and not journal:
        return {"ref": ref, "status": "non_article_source", "pmid_status": "none_given", "matched": None,
                "best_similarity": None, "match_source": None, "matched_is_retracted": False}

    cands: dict[str, dict] = {}

    def add(pmids: list[str], via: str) -> None:
        new = [p for p in pmids if p not in cands]
        for pid, rec in esummary(new).items():
            rec["via"] = via
            cands[pid] = rec

    pmid_status = "none_given"
    supplied = ref.get("pmid", "").strip()
    if supplied.isdigit():
        add([supplied], "supplied_pmid")
        pmid_status = "pending" if supplied in cands else "does_not_exist"
    if ref.get("doi", "").strip():
        add(esearch(f'{ref["doi"].strip()}[doi]', retmax=3)["pmids"], "doi")
    if title:
        main = re.split(r"[:(]", title)[0].strip() or title
        add(esearch(f'"{main}"[ti]', retmax=5)["pmids"], "exact_title")
        add(esearch(" AND ".join(f"{w}[ti]" for w in _key_terms(title, 6)), retmax=5)["pmids"], "title_terms")
        add(esearch(title, retmax=5)["pmids"], "title_freetext")
    if surname and year:
        clean_surname = re.sub(r"[^A-Za-z\u00C0-\u00FF '-]", "", surname)
        au = f"{clean_surname}[1au] AND {year - 1}:{year + 1}[dp]"
        if journal:
            j = journal.replace("&", "and")
            add(esearch(f'{au} AND "{j}"[jour]', retmax=10)["pmids"], "author_year_journal")
            add(esearch(au, retmax=20)["pmids"], "author_year")
        if title:
            add(esearch(au + " AND " + " AND ".join(f"{w}[tiab]" for w in _key_terms(title, 3)),
                        retmax=10)["pmids"], "author_year_terms")

    def score(rec: dict) -> tuple[float, float]:
        tsim = title_similarity(title, rec["title"]) if title else 0.0
        bonus = 0.2 * _author_ok(surname, rec) * bool(surname) + 0.1 * _year_ok(year, rec) * bool(year) \
            + 0.1 * journal_match(journal, rec.get("journal"), rec.get("source")) * bool(journal)
        return tsim + bonus, tsim

    best, best_score, best_sim, source = None, -1.0, 0.0, "pubmed"
    for rec in cands.values():
        sc, ts = score(rec)
        if sc > best_score:
            best, best_score, best_sim = rec, sc, ts

    if supplied and pmid_status == "pending":
        rec = cands[supplied]
        ok = (title_similarity(title, rec["title"]) >= 0.85) if title else \
            (_author_ok(surname, rec) and _year_ok(year, rec))
        pmid_status = "correct" if ok else "points_to_different_paper"

    def classify(rec: dict | None, tsim: float) -> str:
        if rec is None:
            return "not_found"
        a_ok, y_ok = _author_ok(surname, rec), _year_ok(year, rec)
        j_ok = journal_match(journal, rec.get("journal"), rec.get("source")) if journal else True
        if title:
            if tsim >= 0.90:
                return "verified" if (a_ok and y_ok) else "exists_metadata_error"
            if tsim >= 0.60 and a_ok and y_ok and (j_ok or tsim >= 0.75):
                return "exists_paraphrased"
            return "not_found"
        if surname and year and journal and a_ok and y_ok and j_ok:
            return "locatable_no_title"
        return "not_found"

    status = classify(best, best_sim)
    if status == "not_found" and title:           # CrossRef for non-PubMed records (MMWR, books...)
        biblio = " ".join(x for x in [ref.get("authors", ""), title, journal, ref.get("year", "")] if x)
        for rec in crossref_search(biblio, rows=5):
            ts = title_similarity(title, rec["title"])
            st = classify(rec, ts)
            if st != "not_found":
                best, best_sim, source, status = rec, ts, "crossref", st
                break
    if status == "verified" and pmid_status == "points_to_different_paper":
        status = "exists_metadata_error"

    record = {"ref": ref, "status": status, "pmid_status": pmid_status,
              "match_source": source if best is not None and status != "not_found" else None,
              "best_similarity": best_sim, "matched": best if status != "not_found" else None,
              "near_miss": best if status == "not_found" else None,
              "matched_is_retracted": bool(best and status != "not_found" and is_retracted(best))}
    if best is not None and status != "not_found":
        record.update({"matched_year": best.get("year"),
                       "matched_first_author": (best.get("authors") or [""])[0]})
    return record


# ─────────────────────────────────────────────────────────────
#  Arm audits
# ─────────────────────────────────────────────────────────────

def audit_tables_turned(client, use_llm: bool) -> list[dict]:
    out = []
    for run_path in sorted((DATA / "tables_turned").glob("*/run_*.json")):
        run = read_json(run_path)
        tab = run["tablet"]
        brief = tab["synthesis"]["brief_markdown"]
        corpus = {p["pmid"]: p for p in tab["papers"] if p["selected"]}
        cited = pmids_in(brief)
        resolved = esummary(sorted(set(cited) | set(corpus)))
        retracted = [p for p in corpus if p in resolved and is_retracted(resolved[p])]
        units = claim_units(brief)
        claims = []
        for u in units:
            ids = pmids_in(u["text"])
            claims.append({**u, "pmids": ids, "unwitnessed": "UNWITNESSED" in u["text"].upper()})
        rec = {
            "question_id": run["run"]["question_id"], "replicate": run["run"]["replicate"],
            "file": str(run_path.relative_to(DATA.parent)),
            "n_cited_pmids": len(cited),
            "n_resolved_in_pubmed": sum(1 for p in cited if p in resolved),
            "n_in_curated_corpus": sum(1 for p in cited if p in corpus),
            "out_of_corpus_pmids": [p for p in cited if p not in corpus],
            "n_corpus": len(corpus), "corpus_coverage": round(len(set(cited) & set(corpus)) / max(1, len(corpus)), 3),
            "n_unwitnessed_markers": len(re.findall(r"UNWITNESSED", brief)),
            "retracted_in_corpus": retracted,
            "retracted_cited": [p for p in retracted if p in cited],
            "claims": claims,
        }
        if use_llm:
            to_judge = [(i, c) for i, c in enumerate(claims) if c["pmids"]]
            blocks = []
            for i, c in to_judge:
                src = []
                for pid in c["pmids"]:
                    p = corpus.get(pid)
                    src.append(f"[PMID {pid}] {p['title']}\n{p.get('abstract') or 'No abstract.'}" if p
                               else f"[PMID {pid}] NOT IN PROVIDED SET")
                blocks.append(f"### Claim {i}\n{c['text']}\n\n#### Cited source(s)\n" + "\n\n".join(src))
            judged, usage, model = structured_call(client, JUDGE_MODEL, JUDGE_SYSTEM, "\n\n".join(blocks), JUDGE_SCHEMA)
            vmap = {j["claim_id"]: j for j in judged["judgments"]}
            for i, c in to_judge:
                j = vmap.get(i)
                c["verdict"] = j["verdict"] if j else None
                c["verdict_reason"] = j["reason"] if j else None
            rec["judge"] = {"model": model, "usage": usage}
        out.append(rec)
        print(f"  TT {rec['question_id']} r{rec['replicate']}: {rec['n_cited_pmids']} PMIDs, "
              f"{rec['n_in_curated_corpus']} in corpus, {rec['n_resolved_in_pubmed']} resolve, "
              f"{rec['n_unwitnessed_markers']} UNWITNESSED")
    return out


def audit_claude_free(client, use_llm: bool) -> list[dict]:
    out = []
    for path in sorted((DATA / "comparators").glob("*/claude_free_run_*.json")):
        if path.stem.endswith("_references"):
            continue                                   # cached extraction, not a run
        run = read_json(path)
        t1, t2 = run["turns"][1]["text"], run["turns"][3]["text"]
        rec = {"question_id": run["question_id"], "replicate": run["replicate"],
               "file": str(path.relative_to(DATA.parent)),
               "declined_pmids": bool(re.search(r"(can't|cannot|can not|don't|do not|unable)[^.]{0,80}(PMID|PubMed ID)", t2, re.I)),
               "pmids_offered": re.findall(r"PMID:?\s*(\d{5,9})", t2)}
        cache = path.with_name(path.stem + "_references.json")
        if cache.exists():
            refs = read_json(cache)["references"]
        elif use_llm:
            data, usage, model = structured_call(client, EXTRACT_MODEL, EXTRACT_SYSTEM,
                                                 f"Chatbot answer listing its sources:\n\n{t2}", REF_SCHEMA)
            refs = data["references"]
            write_json(cache, {"extracted_by": model, "usage": usage, "extracted_at": now_iso(), "references": refs})
        else:
            refs = []
        rec["references"] = [verify_reference(r) for r in refs]
        counts: dict[str, int] = {}
        for r in rec["references"]:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        rec["status_counts"] = counts
        out.append(rec)
        print(f"  CF {rec['question_id']} r{rec['replicate']}: {len(refs)} refs -> {counts} "
              f"| declined PMIDs={rec['declined_pmids']} | PMIDs offered={len(rec['pmids_offered'])}")
    return out


def audit_ai_overview(client, use_llm: bool) -> list[dict]:
    out = []
    for path in sorted((DATA / "comparators").glob("*/ai_overview_model_run_*.json")):
        run = read_json(path)
        text = run["overview_text"]
        units = claim_units(text)
        spans = run.get("cited_spans", [])
        claims = []
        for u in units:
            marks = sorted({int(m) for m in re.findall(r"\[(\d{1,2})\]", u["text"])})
            claims.append({**u, "source_ns": marks})
        rec = {"question_id": run["question_id"], "replicate": run["replicate"],
               "file": str(path.relative_to(DATA.parent)),
               "retrieved": [{**s, "class": classify_source(s["url"])} for s in run["retrieved_sources"]],
               "cited": [{**s, "class": classify_source(s["url"])} for s in run["cited_sources"]],
               "claims": claims}
        if use_llm:
            by_n: dict[int, list[str]] = {}
            for s in spans:
                if s.get("cited_text"):
                    by_n.setdefault(s["n"], []).append(s["cited_text"])
            to_judge = [(i, c) for i, c in enumerate(claims) if c["source_ns"]]
            if to_judge:
                blocks = []
                for i, c in to_judge:
                    src = []
                    for n in c["source_ns"]:
                        url = next((s["url"] for s in run["cited_sources"] if s["n"] == n), "?")
                        excerpt = "\n...\n".join(dict.fromkeys(by_n.get(n, [])))
                        src.append(f"[{n}] {url}\n{excerpt or '(no excerpt returned)'}")
                    blocks.append(f"### Claim {i}\n{c['text']}\n\n#### Cited source(s)\n" + "\n\n".join(src))
                judged, usage, model = structured_call(client, JUDGE_MODEL, JUDGE_SYSTEM, "\n\n".join(blocks), JUDGE_SCHEMA)
                vmap = {j["claim_id"]: j for j in judged["judgments"]}
                for i, c in to_judge:
                    j = vmap.get(i)
                    c["verdict"] = j["verdict"] if j else None
                    c["verdict_reason"] = j["reason"] if j else None
                rec["judge"] = {"model": model, "usage": usage}
        out.append(rec)
        classes = [r["class"] for r in rec["retrieved"]]
        print(f"  AO {rec['question_id']} r{rec['replicate']}: {len(rec['retrieved'])} retrieved "
              f"({sum(c == 'Peer-reviewed literature' for c in classes)} peer-reviewed), {len(rec['cited'])} cited")
    return out


REL_SCHEMA = {
    "type": "object",
    "properties": {"ratings": {"type": "array", "items": {
        "type": "object",
        "properties": {"pmid": {"type": "string"},
                       "relevance": {"type": "string", "enum": ["directly_relevant", "tangential", "off_topic"]},
                       "reason": {"type": "string"}},
        "required": ["pmid", "relevance", "reason"], "additionalProperties": False}}},
    "required": ["ratings"], "additionalProperties": False,
}

REL_SYSTEM = """You rate how useful each retrieved paper is for answering a consumer's health question.
- directly_relevant: studies the exposure/intervention and outcome the question asks about (any population or design).
- tangential: related background (mechanism, adjacent population, a different but related outcome) that could inform the answer indirectly.
- off_topic: would not help answer the question.
Judge from the title and abstract excerpt only. One short reason each."""


def audit_relevance(client) -> list[dict]:
    """Precision of the ranker: how many of the 12 papers shown to the reader bear on the question?"""
    out = []
    for run_path in sorted((DATA / "tables_turned").glob("*/run_*.json")):
        run = read_json(run_path)
        tab = run["tablet"]
        cited = set(pmids_in(tab["synthesis"]["brief_markdown"]))
        blocks = [f"PMID {p['pmid']} | {p['title']}\n{(p.get('abstract') or 'No abstract.')[:900]}" for p in tab["papers"]]
        user = f"Question: {tab['intent']['question']}\nContext: {tab['intent']['decision_context']}\n\n" + "\n\n".join(blocks)
        data, usage, model = structured_call(client, JUDGE_MODEL, REL_SYSTEM, user, REL_SCHEMA)
        ratings = {r["pmid"]: r for r in data["ratings"]}
        rows = [{"pmid": p["pmid"], "title": p["title"], "relevance": ratings.get(p["pmid"], {}).get("relevance"),
                 "reason": ratings.get(p["pmid"], {}).get("reason"), "cited": p["pmid"] in cited,
                 "score": p["ranking"]["score"], "overlap": p["ranking"]["overlap"]} for p in tab["papers"]]
        c = Counter(r["relevance"] for r in rows)
        out.append({"question_id": run["run"]["question_id"], "replicate": run["run"]["replicate"],
                    "papers": rows, "counts": dict(c),
                    "off_topic_cited": [r["pmid"] for r in rows if r["relevance"] == "off_topic" and r["cited"]],
                    "judge": {"model": model, "usage": usage}})
        print(f"  REL {run['run']['question_id']} r{run['run']['replicate']}: {dict(c)} | off-topic cited: "
              f"{out[-1]['off_topic_cited']}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-llm", action="store_true", help="skip extraction/judge calls (deterministic checks only)")
    ap.add_argument("--arms", nargs="*", default=["tables_turned", "claude_free", "ai_overview", "relevance"])
    ap.add_argument("--worker", default=None)
    args = ap.parse_args()
    client = None
    if not args.no_llm:
        client, route = make_client(args.worker)
        print(f"Audit | judge={JUDGE_MODEL} extractor={EXTRACT_MODEL} | route={route}")
    use_llm = not args.no_llm
    if "tables_turned" in args.arms:
        write_json(AUDIT / "tt_audit.json", audit_tables_turned(client, use_llm))
    if "claude_free" in args.arms:
        write_json(AUDIT / "claude_free_audit.json", audit_claude_free(client, use_llm))
    if "ai_overview" in args.arms:
        write_json(AUDIT / "ai_overview_audit.json", audit_ai_overview(client, use_llm))
    if "relevance" in args.arms and use_llm:
        write_json(AUDIT / "relevance_audit.json", audit_relevance(client))
    print("audit written to", AUDIT)


if __name__ == "__main__":
    main()
