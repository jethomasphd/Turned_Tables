# Tables Turned

**The Commons Table. Receipts only.**

A browser-native tool that lets a regular person paste PubMed links, pull abstracts and citations from the public record, and produce an intelligible synthesis that is readable, honest, and grounded.

No paywall dependence. No jargon barrier. No "trust me."

---

## What This Is

Tables Turned exists to flip the pattern of information gatekeeping. Good information is hard to access: paywalled, buried in jargon, entombed in manuscripts no working person can parse, summarized by systems that do not show receipts.

This tool returns ordinary people to the record. It is a browser ritual built around one idea:

**Session in. Tablet out. Every time.**

The unit of work is a **Table Flip**: a 15-30 minute sprint that ends in a portable Tablet export.

---

## The Rite

The tool walks you through six steps:

1. **No Tribute** -- Paste 5-20 PubMed links (URLs, PMIDs, or DOIs). Abstracts and citations are fetched from NCBI.
2. **Lay the Scrolls** -- Review your papers. Clean cards with title, year, journal, abstract, PMID/DOI.
3. **Mark the Roles** -- One tap per paper: Background, Supports, Contradicts, Method, or Unsure.
4. **Witness** -- One sentence takeaway per paper. Keep, Release, or Unsure. Flag methodological watch-outs.
5. **Cross-Examine** -- Write claims linked to paper IDs. Stress-test: What would change your mind? Best rival explanation? Confidence level.
6. **Seal the Tablet** -- Export your work: Tablet.json, Ledger.csv/json, Brief.md. Downloaded and portable.

---

## The Browser Doctrine

The entire experience lives in a web browser. No installation. No native app. Mobile-first. Desktop-capable.

Open `commons-table/index.html` in any modern browser. That is all.

---

## Exports

Three artifacts:

- **Tablet.json** -- The Seed Packet. Schema-validated JSON containing everything: intent, papers, roles, witness lines, claims with receipts, cross-examination, provenance log, next sprint queue.
- **Ledger.csv / Ledger.json** -- Evidence table. One row per paper with metadata, role, witness line, disposition, watch-outs.
- **Brief.md** -- Plain-language markdown synthesis. What the papers say, separated from what we infer. Every claim has receipts.

All generated in-browser. All downloadable. Nothing trapped.

---

## Integrity Standards

- Every claim must cite ingested records (PMID/DOI). No receipts means UNWITNESSED.
- Contradictions are surfaced, not smoothed over.
- Confidence must be justified.
- Provenance or silence.

---

## Repo Structure

```
commons-table/       Frontend web app (the six-step rite)
  index.html         Main application
  css/style.css      Minimal, grave aesthetic
  js/
    app.js           Main orchestrator
    shoreline.js     PubMed API ingestion + caching
    scrolls.js       Paper card model + rendering
    receipts.js      Claim-to-paper linking engine
    cross-examine.js Stress-test widgets
    scribe.js        Brief markdown generation
    tablet-press.js  Export bundle generator

schemas/             Data contracts
  tablet.schema.json JSON Schema for the Tablet (Seed Packet)

examples/            Sample data
  tablet.example.json Example Tablet (vitamin D and respiratory infections)

scribe/              Brief templates
  brief-template.md  Template for Brief generation

prompts/             Synthesis prompt files
  synthesis.md       Prompt for AI-assisted synthesis
  witness.md         Prompt for witness line generation

from_beyond/         Session transcripts (Correspondence from Beyond)
  001_steve_jobs_sees_the_whole_machine.md
  002_jesus_flips_the_tables.md

data/                Working data directory
output/              Generated output directory

enrichment_grimoire.json  COMPANION Protocol binding structure
initiation_rite.md        COMPANION Protocol ritual documentation
seed.txt                  Project seed and architectural decisions
```

---

## The Lineage

This inherits from the long human tradition of witnessing: reading, marking, and speaking what is actually there.

It refuses: "second brain" vault apps, paywall-dependent workflows, AI summaries without receipts, infinite feeds, and hoarding mechanics.

---

## License

The COMPANION Protocol is released into the public domain (CC0 1.0).

Tables Turned is part of the COMPANION ecosystem by J.E. Thomas.
