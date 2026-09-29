# Receipts, Not Answers: the Tables Turned preprint

**Jacob E. Thomas, MA, PhD · Daniel S. Kreitzberg, PhD**

This directory holds the preprint releasing Tables Turned and everything needed to reproduce it: the manuscript, the study's raw data, and the scripts that regenerate every number, figure and page.

| File | What it is |
|---|---|
| `Tables_Turned_preprint.docx` | The preprint (16 pages, US Letter) |
| `Tables_Turned_preprint.pdf` | The same document rendered with LibreOffice, for sharing |
| `manuscript/manuscript.md` | Manuscript source (small Markdown dialect; see `scripts/05_build_preprint.js`) |
| `manuscript/references.json` | Reference list; every PubMed-indexed entry pulled live from NCBI by `scripts/refs.py` |
| `figures/` | Figures 1–5 (300 dpi PNG) |
| `data/` | Frozen raw outputs, audits and metrics (details below) |
| `run_all.sh` | One command to rebuild everything |

## The study in one paragraph

Six common consumer health questions were each answered three ways. **Tables Turned** ran through a headless, byte-for-byte replication of the production pipeline, reading prompts and model from `commons-table/js/synthesis.js` and routing through the production Worker. **Claude free** was `claude-sonnet-5-5` with no system prompt or tools, followed by the question "list the studies this is based on". **AI Overview (modeled)** was one live web search summarized in the AI Overview format. Every reference was verified against PubMed and CrossRef and screened for retractions. An independent judge (`claude-opus-5-5`) rated whether each cited claim is supported by its source and whether each paper shown to the reader is relevant. We also measured study designs, source types, reading level, run-to-run stability (three flagship replicates), latency and cost.

Headline: the free chatbot fabricated **0 of 40** references, but **0 of 121** of its claims carried a citation. The modeled overview cited every claim, but only 3 of its 30 cited pages were research literature. Tables Turned's 59 cited PMIDs all resolved and all came from the reader's curated set; 91% of its findings claims were cited, but 41% of cited claims only partly matched their abstracts, mostly through numeric drift.

## Reproduce

```bash
cd preprint
./run_all.sh            # analysis mode: rebuild figures, metrics and the .docx from frozen data (free)
./run_all.sh full       # re-run every arm against live services (~USD 2.60); needs credentials:
export TT_WORKER_URL=https://tables-turned-api.<you>.workers.dev   # or: export ANTHROPIC_API_KEY=sk-ant-...
```

Requirements: Python ≥ 3.10, Node ≥ 18 (`npm install` pulls `docx`), and optionally LibreOffice Writer for the PDF. Figure 2 needs Playwright with an existing Chromium; set `TT_CHROMIUM` if it is not at `/opt/pw-browsers/chromium`. Setting `NCBI_API_KEY` / `NCBI_EMAIL` is polite for heavy use of the E-utilities.

## Scripts

| Script | Role | Network |
|---|---|---|
| `scripts/tt_common.py` | Prompt extraction from `synthesis.js` (with SHA-256), Anthropic client (Worker or direct), NCBI E-utilities and CrossRef helpers | — |
| `scripts/01_run_tables_turned.py` | Headless replication of the production pipeline; writes Tablet v2.0 JSON + telemetry | PubMed, Anthropic |
| `scripts/02_run_comparators.py` | Claude free (2 turns) and modeled AI Overview arms; `--write-templates` for manual captures | Anthropic (+ web search) |
| `scripts/03_audit_citations.py` | Reference extraction and verification, retraction screen, claim-support judge, ranker relevance judge | PubMed, CrossRef, Anthropic |
| `scripts/textstats.py` | Claim-unit segmentation, Flesch–Kincaid, URL source classification | — |
| `scripts/refs.py` | Builds `manuscript/references.json` from live PubMed records; records the PubMed total | PubMed |
| `scripts/fig_architecture.py` | Figure 1 | — |
| `scripts/06_screenshots.py` | Figure 2: drives the real `search.html` in headless Chromium, replaying the recorded session (no model calls) | fonts, PubMed efetch |
| `scripts/04_analyze_and_plot.py` | All metrics (`data/metrics/summary.json`, `per_run.csv`) and Figures 3–5 | — |
| `scripts/05_build_preprint.js` | Renders the manuscript to `.docx`; numbers citations by first appearance; embeds the production prompts verbatim | — |

## Data

```
data/
  tables_turned/<QID>_<slug>/run_<k>.json   Tablet v2.0 + telemetry (strategies, hits, full candidate pool, timings, tokens)
  tables_turned/<QID>_<slug>/brief_<k>.md   the brief exactly as generated
  comparators/<QID>_<slug>/claude_free_run_<k>.json          full two-turn transcript
  comparators/<QID>_<slug>/claude_free_run_<k>_references.json  structured reference extraction (cached)
  comparators/<QID>_<slug>/ai_overview_model_run_<k>.json    overview, retrieved + cited sources, raw blocks
  audit/tt_audit.json            PMID resolution, containment, claim units + judge verdicts and reasons
  audit/claude_free_audit.json   every reference: matched record, similarity, status, PMID check, retraction flag
  audit/ai_overview_audit.json   source classes, claim units + judge verdicts
  audit/relevance_audit.json     judge relevance of the 12 papers shown per Tables Turned run
  metrics/summary.json           every number quoted in the manuscript
  metrics/per_run.csv            one row per arm × question × replicate
  manual_captures/*.TEMPLATE.json  fill in with real AI Overview captures (see below)
  screenshots/                   raw interface captures used in Figure 2
  pubmed_total.json              live PubMed record count used in the paper
  logs/                          console logs of the original runs
```

## About the modeled AI Overview

Google's AI Overview cannot be captured programmatically in a way that is both reproducible and consistent with the search engine's terms of service, so the paper models its architecture (one search → short grounded summary) and says so throughout. To add real captures, open a private window (signed out, U.S. locale), search each `search_query` from `config/questions.json`, and transcribe the overview and its source chips into `data/manual_captures/<QID>_ai_overview.json` using the template. `04_analyze_and_plot.py` then reports their source mix, citation coverage and reading level under `manual_ai_overview` in `summary.json`.

## Before posting

Placeholders in brackets remain for items only the authors can supply: Dr. Kreitzberg's affiliation (front matter in `scripts/05_build_preprint.js`), and his CRediT contributions, funding, and any further competing interests (Declarations in `manuscript/manuscript.md`). Edit, then run `node scripts/05_build_preprint.js`.
