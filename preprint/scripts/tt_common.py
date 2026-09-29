"""
tt_common.py — shared plumbing for the Tables Turned preprint reproduction package.

Everything the numbered scripts need lives here:

  * Paths and JSON I/O for the preprint/ directory.
  * load_production_prompts(): reads the three system prompts and the model ID
    straight out of commons-table/js/synthesis.js, so the headless replication
    can never drift from what the live site sends. A SHA-256 of each prompt is
    recorded with every run.
  * make_client(): an Anthropic SDK client that talks either to the Anthropic
    API directly (ANTHROPIC_API_KEY) or to the production Cloudflare Worker
    proxy (TT_WORKER_URL), which holds the key server-side exactly as the site does.
  * PubMed / NCBI E-utilities helpers (esearch, efetch, esummary) that mirror
    shoreline.js: same endpoints, same batch size, same 350 ms courtesy delay.
  * A small CrossRef client used only by the citation audit.

Standard library only, apart from the `anthropic` SDK.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

# ─────────────────────────────────────────────────────────────
#  Paths
# ─────────────────────────────────────────────────────────────

PREPRINT = pathlib.Path(__file__).resolve().parents[1]      # .../preprint
REPO = PREPRINT.parent                                        # repo root
SYNTHESIS_JS = REPO / "commons-table" / "js" / "synthesis.js"
CONFIG = PREPRINT / "config"
DATA = PREPRINT / "data"
FIGURES = PREPRINT / "figures"

# Production Worker (see worker/wrangler.toml). The Worker ignores the request
# path and forwards the JSON body to api.anthropic.com/v1/messages with its own key.
DEFAULT_WORKER_URL = "https://tables-turned-api.jethomasphd.workers.dev"


def read_json(path: pathlib.Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: pathlib.Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def load_questions() -> dict:
    return read_json(CONFIG / "questions.json")


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ─────────────────────────────────────────────────────────────
#  Production prompts, extracted verbatim from synthesis.js
# ─────────────────────────────────────────────────────────────

def load_production_prompts() -> dict:
    """Return {'SEARCH_SYSTEM', 'SUMMARY_SYSTEM', 'SYNTH_SYSTEM', 'MODEL', 'sha256'}.

    The prompts are JavaScript template literals (backtick strings) with no
    ${} interpolation, so a non-greedy regex between the backticks recovers
    them byte-for-byte.
    """
    src = SYNTHESIS_JS.read_text(encoding="utf-8")
    out: dict[str, Any] = {}
    for name in ("SEARCH_SYSTEM", "SUMMARY_SYSTEM", "SYNTH_SYSTEM"):
        m = re.search(rf"const {name} = `(.*?)`;", src, flags=re.S)
        if not m:
            raise RuntimeError(f"Could not find {name} in {SYNTHESIS_JS}")
        out[name] = m.group(1)
    m = re.search(r"const MODEL = '([^']+)';", src)
    if not m:
        raise RuntimeError("Could not find MODEL in synthesis.js")
    out["MODEL"] = m.group(1)
    out["sha256"] = {
        k: hashlib.sha256(out[k].encode("utf-8")).hexdigest()
        for k in ("SEARCH_SYSTEM", "SUMMARY_SYSTEM", "SYNTH_SYSTEM")
    }
    return out


# ─────────────────────────────────────────────────────────────
#  Anthropic client
# ─────────────────────────────────────────────────────────────

def make_client(worker_url: str | None = None):
    """Build an Anthropic SDK client.

    Priority:
      1. explicit worker_url argument or TT_WORKER_URL env var -> production proxy
      2. ANTHROPIC_API_KEY env var                            -> api.anthropic.com
    base_url is always passed explicitly so a stray ANTHROPIC_BASE_URL in the
    environment cannot silently reroute traffic.
    """
    import anthropic  # imported lazily so analysis scripts run without the SDK

    worker = worker_url or os.environ.get("TT_WORKER_URL")
    if worker:
        # The Worker injects the real key; the SDK just needs a non-empty string.
        client = anthropic.Anthropic(base_url=worker, api_key="held-by-worker",
                                     max_retries=3, timeout=300.0)
        return client, f"worker:{worker}"
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        client = anthropic.Anthropic(base_url="https://api.anthropic.com", api_key=key,
                                     max_retries=3, timeout=300.0)
        return client, "direct:api.anthropic.com"
    raise SystemExit(
        "No credentials. Set ANTHROPIC_API_KEY, or set TT_WORKER_URL "
        f"(e.g. {DEFAULT_WORKER_URL}) to route through a Tables Turned Worker."
    )


def usage_dict(usage: Any) -> dict:
    """Flatten an SDK Usage object into plain JSON."""
    if usage is None:
        return {}
    try:
        return json.loads(usage.model_dump_json())
    except Exception:  # pragma: no cover - defensive
        return {"input_tokens": getattr(usage, "input_tokens", None),
                "output_tokens": getattr(usage, "output_tokens", None)}


def text_of(message: Any) -> str:
    """Concatenate the text blocks of an SDK Message."""
    return "".join(b.text for b in message.content if getattr(b, "type", "") == "text")


def parse_json_array(raw: str) -> list:
    """Mirror synthesis.js: strip code fences, try JSON.parse, else grab the first [...] block."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", cleaned)
        if m:
            return json.loads(m.group(0))
        raise


# ─────────────────────────────────────────────────────────────
#  NCBI E-utilities (mirrors shoreline.js)
# ─────────────────────────────────────────────────────────────

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
RATE_LIMIT_S = 0.35          # shoreline.js RATE_LIMIT_MS = 350 (NCBI: <=3 req/s without a key)
_last_ncbi_call = 0.0


def _ncbi_get(endpoint: str, params: dict, want: str = "json") -> Any:
    """GET an E-utilities endpoint with polite rate limiting and simple retries."""
    global _last_ncbi_call
    params = dict(params)
    params.setdefault("tool", "tables_turned_preprint")
    if os.environ.get("NCBI_EMAIL"):
        params.setdefault("email", os.environ["NCBI_EMAIL"])
    if os.environ.get("NCBI_API_KEY"):
        params.setdefault("api_key", os.environ["NCBI_API_KEY"])
    url = f"{EUTILS}/{endpoint}?{urllib.parse.urlencode(params)}"
    for attempt in range(5):
        wait = RATE_LIMIT_S - (time.time() - _last_ncbi_call)
        if wait > 0:
            time.sleep(wait)
        _last_ncbi_call = time.time()
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                body = resp.read().decode("utf-8")
            return json.loads(body) if want == "json" else body
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt == 4:
                raise
            time.sleep(1.5 * (attempt + 1))
            print(f"    [ncbi] retry {attempt + 1} after {type(e).__name__}")
    raise RuntimeError("unreachable")


def esearch(term: str, retmax: int = 25, sort: str = "relevance") -> dict:
    """Synthesis.searchPubMed(): returns {'pmids': [...], 'count': int, 'query': term}."""
    data = _ncbi_get("esearch.fcgi", {"db": "pubmed", "term": term, "retmax": retmax,
                                      "sort": sort, "retmode": "json"})
    r = data.get("esearchresult", {})
    return {"pmids": r.get("idlist", []) or [], "count": int(r.get("count", "0") or 0),
            "query": term, "querytranslation": r.get("querytranslation")}


def _text(el: ET.Element | None) -> str | None:
    """textContent equivalent: all nested text (handles <i>, <sup> inside titles)."""
    if el is None:
        return None
    return "".join(el.itertext()).strip()


def parse_pubmed_xml(xml_text: str) -> list[dict]:
    """Replicates shoreline.js extractPaperFromXML() field-for-field."""
    root = ET.fromstring(xml_text)
    papers = []
    for art in root.iter("PubmedArticle"):
        pmid = _text(art.find(".//PMID"))
        if not pmid:
            continue
        title = _text(art.find(".//ArticleTitle")) or "Untitled"
        authors = []
        for a in art.iter("Author"):
            last, fore = a.find("LastName"), a.find("ForeName")
            if last is not None:
                authors.append(f"{_text(last)} {_text(fore)}" if fore is not None else _text(last))
        journal = _text(art.find(".//Journal/Title")) or _text(art.find(".//ISOAbbreviation"))
        year = None
        y = art.find(".//PubDate/Year")
        if y is not None and _text(y):
            year = int(_text(y))
        else:
            md = art.find(".//PubDate/MedlineDate")
            if md is not None:
                m = re.search(r"(\d{4})", _text(md) or "")
                year = int(m.group(1)) if m else None
        parts = []
        for ab in art.iter("AbstractText"):
            label = ab.get("Label")
            txt = _text(ab) or ""
            parts.append(f"{label}: {txt}" if label else txt)
        abstract = "\n\n".join(parts) if parts else None
        doi = None
        for aid in art.iter("ArticleId"):
            if aid.get("IdType") == "doi":
                doi = _text(aid)
                break
        pubtypes = [_text(p) for p in art.iter("PublicationType")]
        papers.append({"pmid": pmid, "doi": doi, "title": title, "authors": authors,
                       "journal": journal, "year": year, "abstract": abstract,
                       "publication_types": pubtypes})
    return papers


def efetch_papers(pmids: list[str], batch_size: int = 10) -> list[dict]:
    """Shoreline.ingest(): fetch in batches of 10, preserve input order, drop failures."""
    fetched: dict[str, dict] = {}
    for i in range(0, len(pmids), batch_size):
        batch = pmids[i:i + batch_size]
        xml_text = _ncbi_get("efetch.fcgi", {"db": "pubmed", "id": ",".join(batch),
                                             "retmode": "xml"}, want="text")
        for p in parse_pubmed_xml(xml_text):
            fetched[p["pmid"]] = p
    return [fetched[p] for p in pmids if p in fetched]


def esummary(pmids: list[str]) -> dict[str, dict]:
    """Lightweight metadata (title, authors, year, journal, pubtypes) keyed by PMID."""
    out: dict[str, dict] = {}
    for i in range(0, len(pmids), 100):
        batch = pmids[i:i + 100]
        data = _ncbi_get("esummary.fcgi", {"db": "pubmed", "id": ",".join(batch),
                                           "retmode": "json"})
        res = data.get("result", {})
        for pid in res.get("uids", []):
            r = res.get(pid, {})
            if r.get("error"):
                continue
            year = None
            m = re.search(r"(\d{4})", r.get("pubdate", "") or "")
            if m:
                year = int(m.group(1))
            out[pid] = {
                "pmid": pid,
                "title": r.get("title", ""),
                "authors": [a.get("name", "") for a in r.get("authors", [])],
                "journal": r.get("fulljournalname") or r.get("source"),
                "source": r.get("source"),
                "year": year,
                "pubtypes": r.get("pubtype", []),
                "doi": next((a.get("value") for a in r.get("articleids", [])
                             if a.get("idtype") == "doi"), None),
            }
    return out


# ─────────────────────────────────────────────────────────────
#  CrossRef (citation audit fallback for non-PubMed records)
# ─────────────────────────────────────────────────────────────

def crossref_search(bibliographic: str, rows: int = 5) -> list[dict]:
    """Query CrossRef's bibliographic matcher; returns [] on persistent rate limiting."""
    params = {"query.bibliographic": bibliographic, "rows": rows,
              "select": "DOI,title,author,issued,container-title,type"}
    if os.environ.get("CROSSREF_MAILTO") or os.environ.get("NCBI_EMAIL"):
        params["mailto"] = os.environ.get("CROSSREF_MAILTO") or os.environ.get("NCBI_EMAIL")
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "tables-turned-preprint/1.0"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                items = json.loads(resp.read().decode("utf-8"))["message"]["items"]
            out = []
            for it in items:
                year = None
                try:
                    year = it["issued"]["date-parts"][0][0]
                except Exception:
                    pass
                out.append({
                    "doi": it.get("DOI"),
                    "title": (it.get("title") or [""])[0],
                    "authors": [f"{a.get('family', '')} {a.get('given', '')}".strip()
                                for a in it.get("author", [])],
                    "year": year,
                    "journal": (it.get("container-title") or [""])[0],
                    "type": it.get("type"),
                })
            return out
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:
                time.sleep(3 * (attempt + 1))
                continue
            print(f"    [crossref] HTTP {e.code}; skipping")
            return []
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2)
    return []


# ─────────────────────────────────────────────────────────────
#  Text helpers shared by the audit and analysis scripts
# ─────────────────────────────────────────────────────────────

def norm_title(s: str | None) -> str:
    s = (s or "").lower()
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def title_similarity(a: str | None, b: str | None) -> float:
    """Similarity in [0, 1] between a cited title and a database title.

    Max of: character-level ratio; token containment weighted by length parity; and a
    main-title rule — citing a title without its subtitle ("...(STEP 2): a randomised...")
    is standard practice, so a >=6-word prefix match of the main title scores 0.95.
    """
    import difflib
    na, nb = norm_title(a), norm_title(b)
    if not na or not nb:
        return 0.0
    ratio = difflib.SequenceMatcher(None, na, nb).ratio()
    ta, tb = set(na.split()), set(nb.split())
    contain = len(ta & tb) / max(1, min(len(ta), len(tb)))
    parity = min(len(ta), len(tb)) / max(len(ta), len(tb))
    score = max(ratio, contain * (0.5 + 0.5 * parity))
    short, long_ = sorted((na, nb), key=len)
    if len(short.split()) >= 6 and long_.startswith(short):
        score = max(score, 0.95)
    for raw in (a or "", b or ""):                      # compare against the pre-subtitle main title
        main = norm_title(re.split(r"[:(]|\s[-–—]\s", raw)[0])
        other = nb if raw == (a or "") else na
        if len(main.split()) >= 6 and (other.startswith(main) or main == other):
            score = max(score, 0.95)
    return round(min(score, 1.0), 4)


def journal_match(claimed: str | None, *names: str | None) -> bool:
    """True if a cited journal matches any database form (full name or ISO abbreviation).

    Handles abbreviations: every claimed token must be a prefix of successive tokens
    of the database name ('n engl j med' ~ 'new england journal of medicine').
    """
    def toks(x: str) -> list[str]:
        x = (x or "").lower().replace("&", " and ")
        x = re.sub(r"[^a-z0-9 ]+", " ", x)
        return [t for t in x.split() if t not in ("the", "of", "and", "for", "in", "berl")]
    c = toks(claimed or "")
    if not c:
        return False
    for n in names:
        t = toks(n or "")
        if not t:
            continue
        if c == t:
            return True
        j = 0
        for tok in t:
            if j < len(c) and tok.startswith(c[j]):
                j += 1
        if j == len(c) and len(c) >= max(1, len(t) - 2):
            return True
        if " ".join(c) in " ".join(t) or " ".join(t) in " ".join(c):
            return True
    return False
