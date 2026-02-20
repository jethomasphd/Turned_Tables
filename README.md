# Tables Turned

**Read what you paid for.**

Search 37 million medical research papers in plain English. AI translates the jargon, you curate the evidence, every claim cites its source. The public record, returned to the public.

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

## Paper Selection Algorithm

When multiple search strategies return overlapping results, that overlap is signal. Papers found independently by multiple approaches are more likely to be central to your question.

**Scoring method:**
- **Cross-strategy overlap: +3 points per strategy** that returned the paper
- **PubMed position weight: +1-5 points** based on rank within each strategy's results (top result = 5 pts, 5th = 1 pt)
- **Composite score** = (overlap × 3) + position points
- **Top 12** by composite score are shown

Papers appearing in multiple strategies display a badge (e.g., "3/4 strategies"). Scores and matched strategies are recorded in the Tablet export for full transparency.

---

## Doesn't AI Already Do This?

| Tool | What It Does | The Problem |
|------|-------------|-------------|
| **Google AI Overviews** | Summarizes the open web | No sources. Wellness blogs weighted same as peer-reviewed research. |
| **ChatGPT** | Cites papers | Some real, some **hallucinated**. You can't tell which. |
| **Tables Turned** | Searches the actual U.S. medical database | Every paper is real. Every claim cites a PubMed ID you can click. Every prompt is visible. |

They give you *answers*. This gives you *evidence*.

---

## Quick Start

Three things. That's it.

1. A question ("Does melatonin help kids sleep?")
2. Why you're asking ("Deciding whether to try it before school")
3. An [Anthropic API key](https://console.anthropic.com/settings/keys) (yours, stays in your browser)

Open `commons-table/index.html` in any modern browser. No installation. No server. No account.

---

## For Researchers

Already have a corpus? Skip the search. Paste PubMed URLs, PMIDs, or DOIs directly. Tables Turned will fetch the abstracts, translate them into plain language, and let you curate before synthesis -- same workflow, your papers.

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

## Technical Details

| Component | Detail |
|-----------|--------|
| **Data source** | PubMed / NCBI E-utilities (public API, free, no account) |
| **AI model** | Claude by Anthropic (user provides their own API key) |
| **Architecture** | Static website. No server. No database. No tracking. |
| **Privacy** | API key stored in browser localStorage only. Questions, papers, and briefs exist only in your browser. |

---

## Repo Structure

```
commons-table/           Frontend web app
  index.html             Single-page application
  css/style.css          Companion Suite design system
  js/
    app.js               Main orchestrator (intro, search, curate, synthesize, export)
    synthesis.js          Anthropic API integration (search queries, summaries, synthesis)
    shoreline.js          PubMed ingestion, XML parsing, caching
    tablet-press.js       Export bundle generator (Tablet v2.0)
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
