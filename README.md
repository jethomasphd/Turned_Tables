# Tables Turned

**Your taxes paid for 37 million medical papers. They keep you out.**

Search the U.S. medical database in plain English. AI translates the jargon, you curate the evidence, every claim cites its source. The public record, returned to the public.

---

## The Problem

The U.S. government helped build the largest biomedical knowledge engine on Earth: **PubMed** -- tens of millions of research papers. Your taxes funded the labs. Public universities did the work. Scientists wrote the findings. Other scientists peer-reviewed them for free.

Then private publishers captured the public record. They charge **$35 per paper** to read what you financed. And the language is engineered to keep ordinary people out -- clinical, credential-coded prose that requires years of training to decode.

Two walls. **Paywall:** "You can't read it." **Credential wall:** "Even if you read it, you won't understand it."

Tables Turned breaks both locks.

---

## How It Works

```
YOU ASK          →  AI SEARCHES      →  YOU CHOOSE       →  AI READS         →  YOUR BRIEF
plain English       PubMed (37M          which papers        the abstracts       every claim
                    papers, free)        matter to you                           has a receipt
```

1. **Ask** -- Type a health question in plain English. Add your decision context ("buying supplements tomorrow" vs. "writing a school paper").
2. **Search** -- AI generates 3-4 PubMed search strategies using real medical terminology (MeSH terms, boolean operators). Each strategy targets your question from a different angle.
3. **Rank** -- Papers are scored by cross-strategy overlap and PubMed relevance position. Top 12 are shown, translated into plain language.
4. **Curate** -- You choose which papers matter. Papers found by multiple strategies show a badge. The AI does not decide relevance -- you do.
5. **Synthesize** -- AI reads the abstracts and writes a cited brief. Every claim cites a real PubMed ID. Contradictions are surfaced, not smoothed. Confidence is stated honestly.
6. **Export** -- Download your brief as Word (.docx), Markdown (.md), or a full session Tablet (.json).

---

## Architecture

```
  ╔══════════════════════════════════════════════════════════════════════════════════════╗
  ║                          T A B L E S   T U R N E D                                 ║
  ║                    Information Flow & Technical Architecture                        ║
  ╚══════════════════════════════════════════════════════════════════════════════════════╝


       ┌─────────────────┐
       │   YOU            │    "Is Ozempic safe?"
       │   plain English  │    + optional decision context
       └────────┬────────┘
                │
                ▼
  ┌──────────────────────────┐       ┌──────────────────────────────────┐
  │  ◎  CLAUDE               │       │  Cloudflare Worker Proxy         │
  │     Search Query Engine   │──────▶│  tables-turned-api.workers.dev   │
  │                          │       │  (API key secured, CORS, logs)   │
  │  System prompt instructs │       └──────────────────────────────────┘
  │  3-4 queries: broad →    │
  │  specific, MeSH terms,   │
  │  boolean operators       │
  └──────────┬───────────────┘
             │
             │  e.g.  "ozempic OR semaglutide AND adverse effects"
             │        "(GLP-1 receptor agonist) AND safety AND RCT"
             │        "semaglutide AND (side effects OR cardiovascular)"
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │   ╔═══════════════════════════════════════════════════════╗      │
  │   ║  NCBI / PubMed  ·  U.S. National Library of Medicine ║      │
  │   ║  37,000,000+ peer-reviewed medical papers             ║      │
  │   ╚═══════════════════════════════════════════════════════╝      │
  │                                                                  │
  │   eutils.ncbi.nlm.nih.gov                                       │
  │   ├── esearch.fcgi  →  find PMIDs matching each query            │
  │   └── efetch.fcgi   →  retrieve titles, authors, abstracts       │
  │                                                                  │
  └──────────┬───────────────────────────────────────────────────────┘
             │
             │  Papers returned per strategy
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  CROSS-STRATEGY SCORING                                          │
  │                                                                  │
  │   score = (overlap × 3) + positionPts                            │
  │                                                                  │
  │   overlap     = how many queries returned this same paper        │
  │   positionPts = PubMed relevance weight (top 5 → 5/4/3/2/1 pts) │
  │                                                                  │
  │   Papers found by multiple strategies rank highest.              │
  │   Cap: top 12 papers.                                            │
  └──────────┬───────────────────────────────────────────────────────┘
             │
             ▼
  ┌──────────────────────────┐
  │  ◎  CLAUDE               │
  │     Plain-Language        │    Each paper gets:
  │     Translator            │    · plain_title   (no jargon)
  │                          │    · plain_summary  (one sentence)
  │  Abstracts truncated to  │
  │  600 chars per paper     │
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │   ✓  YOU CURATE                                                  │
  │                                                                  │
  │   ┌──────────────────────────────────────────┐                   │
  │   │ [✓] Can semaglutide cause pancreatitis?  │  ← plain title   │
  │   │     One study found elevated risk in...  │  ← plain summary │
  │   │     ─────────────────────────────────    │                   │
  │   │     Semaglutide-Associated Pancreatic... │  ← original      │
  │   │     Smith · NEJM · 2023                  │  ← metadata      │
  │   │     PMID: 37291836  [click to verify]    │  ← real link     │
  │   │     ▸ Show full abstract                 │                   │
  │   │     ░░░░░ 3/4 strategies                 │  ← overlap badge │
  │   └──────────────────────────────────────────┘                   │
  │   ┌──────────────────────────────────────────┐                   │
  │   │ [✓] ...                                  │                   │
  │   └──────────────────────────────────────────┘                   │
  │   ┌──────────────────────────────────────────┐                   │
  │   │ [ ] (deselected — doesn't go to brief)   │                   │
  │   └──────────────────────────────────────────┘                   │
  │                                                                  │
  │   "8 of 12 selected"          [Select All] [Select None]         │
  │                                                                  │
  └──────────┬───────────────────────────────────────────────────────┘
             │
             │  Only selected papers
             ▼
  ┌──────────────────────────┐
  │  ◎  CLAUDE               │     STREAMING synthesis
  │     Synthesis Engine      │
  │                          │     Rules enforced:
  │  Model: claude-opus-4-6  │     · Every claim cites [PMID: XXXXX]
  │  Max tokens: 1500        │     · Or marked [UNWITNESSED]
  │                          │     · Surface contradictions
  │  Full abstracts sent     │     · No jargon, no patronizing
  │  (not truncated)         │     · State confidence: Low/Med/High
  └──────────┬───────────────┘
             │
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │   💡  YOUR BRIEF                                                 │
  │                                                                  │
  │   # Is Ozempic Safe?                                             │
  │   **Question:** ... · **Context:** ...                           │
  │                                                                  │
  │   ## The short answer                                            │
  │   Semaglutide appears effective for weight loss with             │
  │   manageable side effects [PMID: 37291836], though...            │
  │                                                                  │
  │   ## Key findings                                                │
  │   · Nausea reported in 44% of participants [PMID: 35441470]     │
  │   · Cardiovascular benefit observed in SELECT trial              │
  │     [PMID: 37385644]                                             │
  │   · Thyroid C-cell concerns in animal models [UNWITNESSED        │
  │     in human trials]                                             │
  │                                                                  │
  │   ## What is unknown                                             │
  │   · Long-term effects beyond 2 years                             │
  │   · Impact after discontinuation                                 │
  │                                                                  │
  │   ## Confidence: Medium                                          │
  │                                                                  │
  └──────────┬───────────────────────────────────────────────────────┘
             │
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  PROVENANCE LOG  (audit trail of every decision)                 │
  │                                                                  │
  │  14:32:01  search_started      "Is Ozempic safe?"               │
  │  14:32:03  queries_generated   ozempic OR semaglutide AND...    │
  │  14:32:05  pubmed_searched     "ozempic..." → 847 total         │
  │  14:32:08  papers_ranked       42 scored. Top 12 selected.      │
  │  14:32:12  summaries_generated 12 papers translated             │
  │  14:32:45  papers_selected     8 of 12 selected                 │
  │  14:33:02  synthesis_generated 1247 chars from 8 papers         │
  └──────────┬───────────────────────────────────────────────────────┘
             │
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  EXPORT                                                          │
  │                                                                  │
  │  ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────────┐  │
  │  │ Tablet.json │ │ Ledger.json│ │Ledger.csv│ │ Brief.md/.docx │  │
  │  │             │ │            │ │          │ │                │  │
  │  │ Full session│ │ Evidence   │ │ For Excel│ │ The brief +    │  │
  │  │ + all AI    │ │ table +    │ │ / Sheets │ │ citations      │  │
  │  │ prompts +   │ │ provenance │ │          │ │                │  │
  │  │ provenance  │ │            │ │          │ │                │  │
  │  └────────────┘ └────────────┘ └──────────┘ └────────────────┘  │
  │                                                                  │
  │  Nothing hidden. Every prompt visible. Every paper verifiable.   │
  └──────────────────────────────────────────────────────────────────┘


  ── TECH STACK ──────────────────────────────────────────────

  Frontend:   Vanilla HTML / CSS / JS  (no frameworks)
  AI:         Claude claude-opus-4-6 via Cloudflare Worker proxy
  Data:       NCBI E-utilities (esearch + efetch)
  Hosting:    Cloudflare Pages
  Storage:    Browser only (localStorage cache for papers)
  Backend:    None — all state lives client-side
```

---

## Doesn't AI Already Do This?

| Tool | What It Does | The Problem |
|------|-------------|-------------|
| **Google AI Overviews** | Summarizes the open web | Wellness blogs and supplement ads weighted the same as peer-reviewed research. No sources you can verify. |
| **ChatGPT** | Cites papers | Some real, some **completely fabricated**. Invented authors, fake titles, made-up findings delivered with total confidence. You cannot tell which are real. |
| **Tables Turned** | Searches the actual U.S. medical database | Every paper is real. Every claim cites a PubMed ID you can click. Every prompt is visible. Nothing is hidden. Nothing is invented. |

They give you *answers*. This gives you *evidence*.

---

## Quick Start

Three things. That's it.

1. A question ("Does melatonin help kids sleep?")
2. Why you're asking ("Deciding whether to try it before school")
3. An [Anthropic API key](https://console.anthropic.com/settings/keys) (yours, stays in your browser)

**Two entry points:**

- **`index.html`** -- Cinematic intro (typewriter sequence + card flip) that lands you at the search page. The full story.
- **`search.html`** -- Straight to the search interface. No preamble.

No installation. No server. No account.

---

## For Researchers

Already have a corpus? Skip the search. Paste PubMed URLs, PMIDs, or DOIs directly. Tables Turned will fetch the abstracts, translate them into plain language, and let you curate before synthesis -- same workflow, your papers.

---

## Paper Selection Algorithm

When multiple search strategies return overlapping results, that overlap is signal. Papers found independently by multiple approaches are more likely to be central to your question.

**Scoring method:**
- **Cross-strategy overlap: +3 points per strategy** that returned the paper
- **PubMed position weight: +1-5 points** based on rank within each strategy's results (top result = 5 pts, 5th = 1 pt)
- **Composite score** = (overlap x 3) + position points
- **Top 12** by composite score are shown

Papers appearing in multiple strategies display a badge (e.g., "3/4 strategies"). Scores and matched strategies are recorded in the Tablet export for full transparency.

---

## Exports

### Download Brief (.docx)
Your brief as a Word document. Share it with your doctor, print it, or keep it for reference. Every claim cites its source.

### Download Brief (.md)
Plain text with formatting. Opens in any text editor. Good for pasting into notes or emails.

### Download Tablet (.json)
The full session archive -- everything in one structured file:

- Your question and decision context
- All search queries and strategies generated
- All papers found (with selected/unselected status)
- Plain-language summaries per paper
- Relevance scores and matched strategies per paper
- All three AI prompts (search, summary, synthesis)
- The full synthesis user message
- The AI model used
- The generated brief
- Timestamped provenance log of every action

---

## Integrity Standards

- Every claim must cite ingested records (PMID). No receipts means **[UNWITNESSED]**.
- Contradictions are surfaced, not smoothed over.
- Confidence must be justified (study count, size, consistency, design).
- Every AI prompt is visible to the user. Nothing is hidden.
- Provenance or silence.

---

## Repo Structure

```
commons-table/               Frontend web app
  index.html                 Cinematic intro → redirects to search.html
  search.html                Main search interface (primary entry point)
  css/style.css              Companion Suite design system
  js/
    app.js                   Main orchestrator (intro, search, curate, synthesize, export)
    synthesis.js             Anthropic API integration (search queries, summaries, synthesis)
    shoreline.js             PubMed ingestion, XML parsing, localStorage caching
    tablet-press.js          Export bundle generator (Tablet v2.0, Ledger, Brief)
```

---

## Honest Limits

- **Abstracts only.** Tables Turned reads abstracts, not full papers. If a paper matters to your decision, find and read the full text.
- **AI can err.** Despite strict instructions, Claude may occasionally misinterpret an abstract. Every claim includes a PMID -- click it and read the abstract yourself.
- **Not medical advice.** This gives you better questions to ask your doctor, not answers to follow blindly.
- **English-dominant.** PubMed indexes predominantly English-language abstracts.
- **Search boundaries.** Very new papers may not be indexed yet. Very niche topics may have little published research.

---

## The Lineage

Tables Turned inherits from a long tradition of putting knowledge back in common hands.

William Tyndale translated the Bible into English in 1526. He was burned at the stake. Andrew Carnegie built 2,509 free public libraries. Aaron Swartz tried to free academic papers from JSTOR. He was prosecuted and died at 26. The papers are still behind paywalls.

The pattern is always the same. Knowledge exists. Gatekeepers insist it must be mediated. Translators refuse the premise.

*Not an answer box. A dialogue with evidence you already own.*

---

## License

Tables Turned is part of the COMPANION ecosystem by J.E. Thomas.

The COMPANION Protocol is released into the public domain (CC0 1.0).
