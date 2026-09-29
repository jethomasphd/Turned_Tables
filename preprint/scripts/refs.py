"""
refs.py — build the preprint's reference list with verified metadata.

Every PubMed-indexed reference is fetched live from NCBI esummary (authors, title,
journal, year, volume, issue, pages, DOI) and formatted in Vancouver style, so no
bibliographic detail is typed by hand. The few sources outside PubMed (reports,
conference proceedings, web pages) are entered manually in MANUAL below.
Also records the live PubMed record count used in the paper.

    python scripts/refs.py   ->  manuscript/references.json, data/pubmed_total.json
"""

from __future__ import annotations

from tt_common import PREPRINT, DATA, _ncbi_get, esearch, now_iso, write_json

PUBMED = {
    "walters2023": "37679503", "bhattacharyya2023": "37337480", "alkaissi2023": "36811129",
    "piwowar2018": "29456894", "eysenbach2002": "12020305", "guyatt2008": "18436948",
    "singhal2023": "37438534", "ayers2023": "37115527", "wu2025": "40240349", "zakka2024": "38343631",
    "jin2024": "38306900", "lipscomb2000": "10928714", "fiorini2018": "30153250",
    "suarezlledo2021": "33470931", "chen2023": "37615976", "rooney2021": "34179407",
    "cohen2023": "37097362", "gringras2017": "29096777",
    "aboukhalil2024": "38966098", "choi2022": "36179487", "bruni2024": "38625388",
    "malow2021": "31982581", "omiye2023": "37864012",
    "parasuraman2010": "21077562", "goddard2012": "21685142",
}

MANUAL = {
    "nlm_pubmed": "National Library of Medicine. PubMed [database]. Bethesda (MD): National Library of Medicine; "
                  "record count retrieved via E-utilities 2026 Sep 28. Available from: https://pubmed.ncbi.nlm.nih.gov/",
    "sayers_eutils": "Sayers E. A general introduction to the E-utilities. In: Entrez Programming Utilities Help "
                     "[Internet]. Bethesda (MD): National Center for Biotechnology Information (US); 2010–. "
                     "Available from: https://www.ncbi.nlm.nih.gov/books/NBK25497/",
    "kutner2006": "Kutner M, Greenberg E, Jin Y, Paulsen C. The Health Literacy of America's Adults: Results From "
                  "the 2003 National Assessment of Adult Literacy (NCES 2006-483). Washington (DC): U.S. Department "
                  "of Education, National Center for Education Statistics; 2006.",
    "fox2013": "Fox S, Duggan M. Health Online 2013. Washington (DC): Pew Research Center; 2013.",
    "nelson2022": "Nelson A. Ensuring free, immediate, and equitable access to federally funded research "
                  "[memorandum]. Washington (DC): White House Office of Science and Technology Policy; 2022 Aug 25.",
    "reid2024a": "Reid L. Generative AI in Search: let Google do the searching for you. The Keyword [Google blog]. "
                 "2024 May 14.",
    "reid2024b": "Reid L. AI Overviews: about last week. The Keyword [Google blog]. 2024 May 30.",
    "pew2025": "Chapekis A, Lieb A. Google users are less likely to click on links when an AI summary appears in "
               "the results. Washington (DC): Pew Research Center; 2025 Jul 22.",
    "lewis2020": "Lewis P, Perez E, Piktus A, Petroni F, Karpukhin V, Goyal N, et al. Retrieval-augmented "
                 "generation for knowledge-intensive NLP tasks. Adv Neural Inf Process Syst. 2020;33:9459–74.",
    "liu2023": "Liu NF, Zhang T, Liang P. Evaluating verifiability in generative search engines. In: Findings of "
               "the Association for Computational Linguistics: EMNLP 2023. Singapore: Association for "
               "Computational Linguistics; 2023.",
    "gao2023": "Gao T, Yen H, Yu J, Chen D. Enabling large language models to generate text with citations. In: "
               "Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing. "
               "Singapore: Association for Computational Linguistics; 2023.",
    "zheng2023": "Zheng L, Chiang WL, Sheng Y, Zhuang S, Wu Z, Zhuang Y, et al. Judging LLM-as-a-judge with "
                 "MT-Bench and Chatbot Arena. Adv Neural Inf Process Syst. 2023;36.",
    "wang2023": "Wang L, Yang N, Wei F. Query2doc: query expansion with large language models. In: Proceedings of "
                "the 2023 Conference on Empirical Methods in Natural Language Processing. Singapore: Association "
                "for Computational Linguistics; 2023.",
    "cormack2009": "Cormack GV, Clarke CLA, Büttcher S. Reciprocal rank fusion outperforms Condorcet and "
                   "individual rank learning methods. In: Proceedings of the 32nd International ACM SIGIR "
                   "Conference on Research and Development in Information Retrieval. New York: ACM; 2009. p. 758–9.",
    "fox1994": "Fox EA, Shaw JA. Combination of multiple searches. In: Harman DK, editor. The Second Text REtrieval "
               "Conference (TREC-2). NIST Special Publication 500-215. Gaithersburg (MD): National Institute of "
               "Standards and Technology; 1994.",
    "kincaid1975": "Kincaid JP, Fishburne RP, Rogers RL, Chissom BS. Derivation of new readability formulas "
                   "(Automated Readability Index, Fog Count and Flesch Reading Ease Formula) for Navy enlisted "
                   "personnel. Research Branch Report 8-75. Millington (TN): Naval Technical Training Command; 1975.",
    "weiss2007": "Weiss BD. Health Literacy and Patient Safety: Help Patients Understand. Manual for Clinicians. "
                 "2nd ed. Chicago: American Medical Association Foundation; 2007.",
    "anthropic_ws": "Anthropic. Web search tool. Claude Developer Platform documentation [Internet]. San Francisco "
                    "(CA): Anthropic; 2026 [cited 2026 Sep 28].",
    "tt_repo": "Thomas JE. Tables Turned [software]. GitHub; 2026. Available from: "
               "https://github.com/jethomasphd/Turned_Tables. Live service: https://tables-turned.com",
}


def vancouver(r: dict, pmid: str) -> dict:
    authors = [a["name"] for a in r.get("authors", []) if a.get("authtype", "Author") == "Author"]
    au = ", ".join(authors[:6]) + (", et al" if len(authors) > 6 else "")
    title = r.get("title", "").rstrip(".")
    year = (r.get("pubdate") or "")[:4]
    vol, iss, pages = r.get("volume", ""), r.get("issue", ""), r.get("pages", "")
    loc = f"{year}"
    if vol:
        loc += f";{vol}"
        if iss:
            loc += f"({iss})"
    if pages:
        loc += f":{pages}"
    elif r.get("elocationid"):
        loc += f":{r['elocationid'].replace('doi: ', '').split(' ')[0]}" if not r["elocationid"].startswith("doi") else ""
    doi = next((a["value"] for a in r.get("articleids", []) if a.get("idtype") == "doi"), None)
    retracted = "Retracted Publication" in (r.get("pubtype") or [])
    text = f"{au}. {title}. {r.get('source', '')}. {loc}."
    if retracted:
        text += " [Retracted]"
    return {"text": text, "pmid": pmid, "doi": doi, "retracted": retracted}


def main() -> None:
    ids = list(PUBMED.values())
    data = _ncbi_get("esummary.fcgi", {"db": "pubmed", "id": ",".join(ids), "retmode": "json"})["result"]
    out = {}
    for key, pmid in PUBMED.items():
        out[key] = vancouver(data[pmid], pmid)
    for key, text in MANUAL.items():
        out[key] = {"text": text, "pmid": None, "doi": None, "retracted": False}
    write_json(PREPRINT / "manuscript" / "references.json", out)
    total = esearch("all[sb]", retmax=0)["count"]
    write_json(DATA / "pubmed_total.json", {"count": total, "retrieved_at": now_iso(), "query": "all[sb]"})
    print(f"{len(out)} references written; PubMed total = {total:,}")
    for k, v in out.items():
        print(f"  {k:18s} {v['text'][:120]}")


if __name__ == "__main__":
    main()
