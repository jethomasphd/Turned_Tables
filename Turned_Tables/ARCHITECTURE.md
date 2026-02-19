# Tables Turned -- Architecture Notes

## Design Philosophy

One non-negotiable idea: the Browser Doctrine. Everything lives in a browser. No build step. No bundler. No server. No dependencies. Vanilla HTML, CSS, and JavaScript.

The aesthetic is "a table at night with one lamp." Minimal. Clean. Grave. The myth is in the framing, not in clutter.

---

## Module Architecture

The application is organized as six JavaScript modules, each corresponding to a stage of the rite or a core capability:

### Shoreline (`shoreline.js`)
PubMed ingestion. Takes raw text input (PubMed URLs, PMIDs, DOIs), parses identifiers, resolves DOIs via NCBI esearch, fetches paper metadata and abstracts via NCBI efetch (XML), and caches results in localStorage.

- Parses three input formats: PubMed URLs, plain PMIDs, DOIs (including doi.org URLs)
- Batches fetch requests (10 PMIDs per batch) with rate limiting (350ms between requests)
- Deduplicates across the session
- Caches papers in localStorage to avoid refetching across sessions
- Returns structured paper objects with: pmid, doi, title, authors, journal, year, abstract

### Scrolls (`scrolls.js`)
Paper card rendering for three different contexts:
- **Scroll Cards** (Step 2): Display-only cards with metadata and collapsible abstracts
- **Role Cards** (Step 3): Cards with clickable role tags (Background/Supports/Contradicts/Method/Unsure)
- **Witness Cards** (Step 4): Cards with witness line input, disposition buttons (Keep/Release/Unsure), and watch-out flags

All rendering mutates the shared paper objects in-place, so state is always synchronized.

### Receipts (`receipts.js`)
Claim-to-paper linking engine. The core integrity mechanism.

- Creates claim objects with text, receipts (array of PMIDs), and status
- Computes claim status: WITNESSED (has receipts), UNWITNESSED (no receipts), CONTESTED (linked papers have conflicting roles)
- Renders a claims editor with toggleable PMID tags for each available paper
- Claims without receipts are visibly marked. No silent failures.

### Cross-Examine (`cross-examine.js`)
Three stress-test widgets:
1. "What would change your mind?" (free text)
2. "Best rival explanation?" (free text)
3. Confidence: Low / Medium / High (toggle buttons). Selecting "High" reveals a justification field.

These are guardrails against overconfidence, not decorations.

### Scribe (`scribe.js`)
Brief generation. Produces a plain-language markdown document from the session data:
- Separates "what the papers say" from "what we infer"
- Groups papers by role (supporting, contradicting, background, methods)
- Lists claims with receipt tags
- Includes cross-examination results and watch-outs
- Includes a simple markdown-to-HTML renderer for in-app preview

### Tablet Press (`tablet-press.js`)
Export bundle generator. Produces four downloadable files:
- `Tablet.json` -- Schema-validated Seed Packet with full session data
- `Ledger.json` -- Evidence table + provenance log
- `Ledger.csv` -- Evidence table as CSV (for spreadsheets)
- `Brief.md` -- Markdown synthesis

Also handles Tablet import for session resumption.

### App (`app.js`)
Main orchestrator. Manages:
- Session state (papers, claims, provenance log)
- Step navigation (linear path with back-navigation to completed steps)
- Timebox progress bar
- Event binding for all buttons and inputs
- Tablet import/resume logic

---

## Data Flow

```
User Input (URLs/PMIDs/DOIs)
        |
    Shoreline.ingest()
        |
    Paper Objects (shared state)
        |
    Scrolls.renderScrollCards()  --> Step 2: Display
    Scrolls.renderRoleCards()    --> Step 3: Role assignment
    Scrolls.renderWitnessCards() --> Step 4: Witness + disposition
        |
    Receipts.renderClaimsEditor() --> Step 5: Claims + linking
    CrossExamine.getState()       --> Step 5: Stress test
    Scribe.generateBrief()        --> Step 5: Brief preview
        |
    TabletPress.exportAll()       --> Step 6: Download bundle
```

---

## External Dependencies

**None.** Zero external libraries. Zero CDN imports. Zero build tools.

The only external service used is the NCBI E-utilities API:
- `eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` -- DOI-to-PMID resolution
- `eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi` -- Paper metadata + abstracts (XML)

These are free, public, CORS-enabled APIs maintained by the National Library of Medicine.

---

## Storage

- **Session state**: In-memory JavaScript objects. Not persisted between page loads (except via Tablet export/import).
- **Paper cache**: localStorage (`tables_turned_paper_cache`). Papers fetched once are cached so repeated sessions do not refetch.
- **No server. No database. No account.** The Tablet export IS the persistence layer.

---

## Tablet Schema

The Tablet (Seed Packet) is a JSON document validated against `schemas/tablet.schema.json`. It contains:

- Project title
- Session metadata (ID, timestamps, status, timebox)
- User intent (question, decision context, deadline)
- Papers array (PMID, DOI, title, authors, journal, year, abstract, role, witness line, disposition, watch-outs)
- Synthesis (claims with receipts and statuses, brief markdown, cross-examination results)
- Provenance log (timestamped action log)
- Next sprint queue

The Tablet is the continuity artifact. A user can export it, close the browser, and import it months later to resume exactly where they left off.

---

## Open Decisions (from the Seed)

These decisions were resolved for the MVP:

1. **Public name**: "Tables Turned" is the product name. "The Commons Table" is the internal name for the frontend.
2. **Citation style**: Simple numbered list with PMID/DOI. Readable for regular people.
3. **Scope**: PubMed only for v1. Hard limit for purity.
4. **Synthesis voice**: Common tongue. No jargon. Not patronizing. Short sentences.
5. **Storage**: Local-first only. The Tablet export is the persistence layer.
6. **Contradiction handling**: Map disagreement. Surface conflicts, do not smooth them.
