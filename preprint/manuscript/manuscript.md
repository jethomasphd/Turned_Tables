::: keypoints
**Question** When a person asks a free AI tool a health question, can they trace each claim in the answer back to the evidence that supports it?

**Findings** Six consumer health questions were each put to a free chatbot (Claude, Sonnet-class), a modeled search-engine AI summary, and Tables Turned, an open pipeline that answers only from PubMed abstracts the reader has seen. The chatbot fabricated none of the 40 references it produced when asked, and every one of the 15 PubMed IDs it volunteered was correct. But none of the 121 claims in its answers carried a citation. The search summary cited all of its claims, but 27 of its 30 cited pages were secondary web content. All 59 PubMed IDs cited by Tables Turned resolved to real records inside the reader's curated set; 91% of its answer and key-finding claims carried a citation; and 73% of the cited papers were systematic reviews, meta-analyses, or randomized trials.

**Meaning** Fabricated citations are no longer the main problem with AI health answers. Provenance is: answers are written first and sourced afterward, if at all. Binding every claim to an identifiable abstract is what made our claim-level audit possible, and it exposed the pipeline's own failure mode, numeric drift, well enough to fix.
:::

::: abstract
**Background** The United States funds the largest open index of biomedical knowledge in the world, but most people meet it through two gates: paywalls and specialist prose. A third gate has now opened in front of both. AI answer engines give fluent answers whose relation to the underlying evidence the reader cannot inspect.

**Objective** To describe Tables Turned, an open, browser-native pipeline that turns a plain-English health question into a one-page brief in which every claim cites a PubMed record the reader selected, and to audit it against the two AI answers most people can reach for free.

**System** A large language model (LLM) expands the question into three or four PubMed search strategies. NCBI E-utilities retrieve up to 25 records per strategy. A deterministic consensus score (3 × strategies matched + rank points) selects 12 papers, which are translated into plain language for the reader to keep or drop. A constrained synthesis then cites each claim as [PMID], marks unsupported claims [UNWITNESSED], and states its confidence. Every prompt, paper, and decision is exported as a JSON "Tablet."

**Methods** Six common consumer questions were posed to three arms: Tables Turned (headless replication using the production prompts, model, and proxy); a free-tier chatbot proxy (claude-sonnet-5-5, no system prompt or tools, followed by a request for its studies); and a modeled AI Overview (one live web search summarized in the AI Overview format). We verified every reference against PubMed and CrossRef, and screened for retractions. An independent judge model rated whether each cited claim was supported by its source. We also measured study design, readability, run-to-run stability, latency, and cost.

**Results** Tables Turned cited 59 PubMed IDs across eight runs; all 59 resolved and all came from the curated set. Of the claims it cited, 56% were fully supported by the cited abstracts, 41% partially (mostly broadened numeric ranges), and 3% not supported. Claims in the chatbot's answers were never cited (0 of 121), though all 40 references it later listed were real. The modeled overview drew 3 of its 30 cited pages from peer-reviewed literature. Tables Turned briefs read at grade 10.1, against 7.5 for the chatbot, took a median of 59 s, and cost USD 0.11 in API spend per session.

**Conclusions** Citation fabrication has largely given way to a subtler problem, answers without provenance. An open, evidence-first design that binds claims to abstracts the reader chose makes AI health answers auditable. The same audit shows where such pipelines still need work: numeric fidelity, reading level, and ranking noise.

**Keywords** health literacy · retrieval-augmented generation · PubMed · citation integrity · large language models · AI search · open access · consumer health information
:::

# 1 Introduction

The public paid for the biomedical record. The National Library of Medicine's PubMed index now holds 41,216,535 records [@nlm_pubmed], much of it produced with public funds and reviewed by unpaid peers. Yet two gates have long stood between that record and the people it concerns. The first is price: a large share of the literature still sits behind subscription paywalls [@piwowar2018], despite a federal policy shift toward immediate public access [@nelson2022]. The second is language. Abstracts are written for specialists, while more than a third of U.S. adults have basic or below-basic health literacy [@kutner2006], and patient-facing materials routinely exceed the sixth-to-eighth-grade reading levels that clinicians are advised to target [@weiss2007; @rooney2021].

A third gate has now arrived in front of both. Health questions are among the most common reasons people search the web [@fox2013], and the web's quality has been contested for as long as it has existed [@eysenbach2002; @suarezlledo2021]. Since 2024, many of those searches have returned an AI-written summary above the links [@reid2024a], and early versions produced widely reported errors [@reid2024b]. People click through to sources less often when such a summary appears [@pew2025]. Meanwhile, general-purpose chatbots answer medical questions fluently [@singhal2023; @ayers2023], but early studies found that 18–55% of the references they produced were fabricated, alongside frequent errors in the rest [@walters2023; @bhattacharyya2023; @alkaissi2023]. They can also reproduce harmful clinical myths [@omiye2023] and mix correct with incorrect treatment information [@chen2023].

We argue that this third gate is best described not as *hallucination* but as missing *provenance*. An answer can be accurate and still unauditable. If the reader cannot see which sentence rests on which study, they have to take the answer on trust. The problem is not only that some citations are invented. It is that the answer is composed first, and the evidence, if requested, is reconstructed afterward.

Tables Turned inverts that order. It is an open, browser-native tool [@tt_repo] that searches PubMed first, shows the reader the papers it found in plain language, lets the reader decide which ones count, and only then writes a one-page brief in which every claim must cite one of those papers or be marked as unsupported. Its guiding rule is "receipts, not answers."

This paper makes three contributions. (i) A complete technical description of the pipeline, including a formal account of its cross-strategy consensus ranker and its synthesis contract (Sections 3 and 4). (ii) A reproducible, head-to-head audit against the two free AI answers most people can reach: a free-tier chatbot and a search-engine AI summary. The audit covers reference existence and accuracy, claim-level support judged by an independent model, the evidence base, readability, stability, latency, and cost (Sections 5 and 6). (iii) An open reproduction package that replicates the production pipeline headlessly, from the site's own prompts, and regenerates every number and figure in this paper.

# 2 Related work

**Citation integrity in LLM output.** Early audits of ChatGPT found high rates of fabricated references in medical writing [@walters2023; @bhattacharyya2023; @alkaissi2023]. More recent work shifts the question from whether a reference exists to whether it supports the statement it is attached to. SourceCheckup found that a substantial share of LLM responses to medical questions contained statements not fully supported by the sources cited [@wu2025]. In open-domain generative search, only about half of generated sentences were fully supported by their citations [@liu2023]. Benchmarks for citation-aware generation make citation recall and precision explicit targets [@gao2023]. We adopt this claim-level view and extend it to a setting the reader controls.

**Retrieval-augmented generation for medicine.** Retrieval-augmented generation (RAG) conditions an LLM on retrieved documents [@lewis2020]. Clinical RAG systems such as Almanac showed gains in factuality and safety for clinician-facing answers [@zakka2024], and AI is reshaping biomedical literature search more broadly [@jin2024]. Tables Turned differs in who it is for and what it stakes: it serves lay readers rather than clinicians, uses only the public PubMed index, and exposes every intermediate artifact (queries, ranked papers, prompts) instead of a single answer.

**Retrieval and fusion.** PubMed's Best Match ranking is a learned relevance model [@fiorini2018] over records indexed with the MeSH vocabulary [@lipscomb2000]. Combining several ranked lists is a classic information-retrieval technique, from CombSUM/CombMNZ [@fox1994] to reciprocal rank fusion [@cormack2009]. LLMs have been used to expand queries before retrieval [@wang2023]. Tables Turned combines LLM query expansion with a simple, transparent fusion rule (Section 4.3).

**People in the loop.** Automation invites complacency and automation bias [@parasuraman2010; @goddard2012]. Tables Turned's curation step is a deliberate countermeasure: the reader sees every candidate paper, with its original title, abstract, and PubMed link, before any synthesis happens.

# 3 Design commitments

Five commitments constrain every implementation decision.

- **Browser doctrine.** The product is vanilla HTML, CSS, and JavaScript with no framework, build step, account, or server-side state. The only server component is a stateless proxy that holds the API key (Section 4.7).
- **Receipts or silence.** Every claim in a brief must cite a PubMed identifier (PMID) from the papers provided to the model; anything it cannot cite must be marked [UNWITNESSED]. Contradictions are to be surfaced, not smoothed over, and confidence stated with reasons.
- **The reader decides relevance.** The model proposes; the reader disposes. Deselected papers never reach the synthesis model.
- **Radical transparency.** The three system prompts are viewable in the interface, and each session can be exported with every prompt, paper, score, and timestamped action.
- **Common tongue.** Plain language, short sentences, and no condescension. The synthesis prompt describes the reader as "intelligent and busy."

# 4 System architecture

::: figure fig1_architecture.png 6.5
**Figure 1. The Tables Turned pipeline.** Eight stages run in the reader's browser. Blue stages call Claude through a stateless Cloudflare Worker that holds the API key; the green stage calls NCBI E-utilities directly; grey stages are deterministic code. The reader acts twice: once to ask, and once to decide which of the 12 ranked papers the synthesis may use.
:::

Figure 1 shows the eight stages. The production front end is about 1,900 lines of JavaScript across four modules: an orchestrator, a PubMed ingestion module, an API-integration module, and an export module. The system prompts and the model identifier (claude-opus-4-6) live as constants in one file, so the reproduction package reads them from source rather than copying them (Appendix A).

## 4.1 Ask

The reader types a question and, optionally, why they are asking ("deciding whether to try melatonin gummies before school starts"). The decision context steers both query generation and synthesis toward the reader's actual decision.

## 4.2 Expand: from plain English to PubMed syntax

The first model call asks for three to four PubMed strategies, "from broad to specific," using MeSH terms, Boolean operators, and synonyms, with a preference for systematic reviews, meta-analyses, and randomized trials where relevant. The model returns a JSON array of {query, strategy}; the strategy is a one-sentence plain-English description shown to the reader. For the flagship question the strategies ranged from the bare "melatonin sleep children" (1,199 hits) to a four-part Boolean query restricted to healthy or typically developing children (9 hits). Spanning several levels of specificity is the point: narrow strategies bring precision, broad ones bring recall.

## 4.3 Retrieve and rank: cross-strategy consensus

Each strategy is sent to NCBI esearch (sort = relevance, i.e., Best Match [@fiorini2018]; up to 25 PMIDs by default). New PMIDs are fetched in batches of 10 with efetch and parsed from XML (title, authors, journal, year, structured abstract, DOI), with 350 ms between requests to respect NCBI's courtesy limit of three requests per second [@sayers_eutils]. Let *S* be the set of strategies, *S*(*d*) ⊆ *S* the strategies that returned paper *d*, and *p*_{s}(*d*) the 1-based rank of *d* in strategy *s*. Tables Turned scores

::: equation
score(d) = 3·|S(d)| + Σ_{s ∈ S(d)} r(p_{s}(d)),    r(p) = max(1, 6 − min(p, 5))
:::

The rank points *r* are 5, 4, 3, 2, 1 for ranks 1–5 and 1 thereafter. Papers are sorted by score (stable sort, so ties keep retrieval order) and the top 12 are shown.

The rule belongs to the CombMNZ family [@fox1994]: agreement across independently phrased queries is treated as evidence of centrality. Two properties follow from the constants. First, overlap dominates. A paper returned by all four strategies at low ranks scores 16, and a paper returned by one strategy scores between 4 and 8. Second, one strategy's top hit (3 + 5 = 8) exactly ties two strategies' passing agreement (2 × 3 + 1 + 1 = 8). This is deliberate: it gives the narrowest, most targeted strategy a way into the top 12. In the flagship run it admitted the 2024 European expert guidance on melatonin for typically developing children [@bruni2024], which only one strategy found (Figure 3b). The cost is ties at the cutoff, which retrieval order breaks silently (Section 7.2). Scoring is linear in the number of retrieved results; the dominant costs are network I/O and the model calls.

## 4.4 Translate

A second model call rewrites each of the 12 papers as a plain-language title (5–12 words) and a one-sentence summary. To keep the call small, it sees each abstract truncated to 600 characters; the synthesis call later sees the full abstracts. The reader sees the plain title and summary alongside the original title, journal, year, a clickable PMID, the full abstract on demand, and an "n/4 strategies" badge when strategies agree.

## 4.5 Curate

All 12 papers start selected. The reader deselects anything off-target: a study in adults, a mechanism paper, a letter. Only the papers still selected are passed to synthesis, and the provenance log records how many were kept. This step is where a reader's judgment enters the pipeline, and our relevance audit (Section 6.1) shows it has work to do. Figure 2 shows the three screens a reader moves through.

::: figure fig2_interface.png 6.5
**Figure 2. The reader's view: the production interface, replaying the recorded Q1 session.** The screens come from the production search.html driven headlessly, with every network response (strategies, PubMed results, summaries, and the streamed brief) replayed from the study's frozen data, so the page's own code performed the ranking and rendering. (a) The question and decision context. (b) Curation: each card shows the plain-language title and summary, the original title, first author, journal, year, a clickable PMID, and a strategy-agreement badge; the full abstract is expanded here for an adult-insomnia guideline, a paper a careful reader might deselect. (c) The brief, with each claim carrying its PMID receipt.
:::

## 4.6 Synthesize under contract

The third call streams a one-page Markdown brief from the selected papers' full abstracts, authors, and journals (Appendix A). The contract has seven rules: answer the question first; cite every claim as [PMID: n] or mark it [UNWITNESSED]; surface contradictions; write in common tongue; do not patronize; state confidence as Low, Medium, or High with reasons; and never cite a PMID that was not provided. The output has a fixed shape: a short answer, four to six key findings, what is unknown, and a confidence statement. The maximum output is 1,500 tokens; in our runs, the first token arrived after a median of 1.9 s.

## 4.7 Seal, security, and privacy

Every session can be exported as a brief (.docx or .md) and as a Tablet v2.0 JSON document. The Tablet holds the question, context, strategies, all 12 papers with abstracts, plain summaries, ranking scores and matched strategies, selection state, all three system prompts, the full synthesis user message, the model identifier, the brief, and a timestamped provenance log. The Tablet is the persistence layer: nothing is stored on a server, and paper metadata is cached only in the browser's localStorage. The API key never reaches the browser. It is held as a secret by a stateless Cloudflare Worker that forwards requests to the Anthropic Messages API and restricts browser origins with CORS. Questions and abstracts do leave the browser for NCBI and Anthropic, and the interface says so.

# 5 Comparative audit: methods

## 5.1 Questions

We chose six questions that people commonly bring to search engines and chatbots, spanning pediatric supplements, a widely prescribed drug, prevention, diet, and a social-media wellness trend (Table 1). Each question carries a decision context, and every arm received the same information in its native form: form fields for Tables Turned, a typed query for the search summary, and a conversational message for the chatbot. Q1 served as the flagship and was repeated three times in every arm.

::: table 600,3400,5360
**Table 1. Benchmark questions.** Every arm received the same question and decision context; the search-summary arm received the question as a search query.
| ID | Question | Decision context |
|---|---|---|
| Q1 | Does melatonin help kids sleep? | My 7-year-old has trouble falling asleep. Deciding whether to try melatonin gummies before school starts. |
| Q2 | Is Ozempic safe? | My doctor suggested semaglutide for weight loss and I want to understand the risks before I start. |
| Q3 | Does vitamin D prevent colds? | Deciding whether to give my family vitamin D supplements this winter. |
| Q4 | Is intermittent fasting better than regular dieting for losing weight? | Choosing a diet plan to lose about 20 pounds this year. |
| Q5 | Do probiotics prevent diarrhea from antibiotics? | My child was just prescribed amoxicillin and I'm wondering whether to give a probiotic too. |
| Q6 | Does apple cider vinegar help with weight loss? | Seen it all over social media; deciding whether it is worth buying. |
:::

## 5.2 Arms

**Tables Turned.** A headless Python replication of the production pipeline parses the three system prompts and the model identifier directly from the site's source and records SHA-256 hashes of each prompt. It builds every user message byte-for-byte as the site does, uses the same retrieval depth (25), sort order, batch size, scoring, and 12-paper cap, and sends traffic through the production Worker. Curation used the interface default (all 12 selected), representing a reader who accepts every suggestion, which is the least favorable case for the design.

**Claude free (chatbot proxy).** claude-sonnet-5-5, a Sonnet-class model of the kind served to free-tier users, called with no system prompt, no tools, and default sampling. Turn 1 was the question in conversational form. Turn 2 was the follow-up a careful user asks: "Can you list the specific scientific studies this is based on? Please include the authors, year, journal, and PubMed ID for each." This proxy omits the consumer app's own system prompt and any web search the app may invoke; it models the common "just ask" case.

**AI Overview (modeled).** Search-engine AI summaries cannot be captured programmatically in a way that is both reproducible and consistent with the search engine's terms of service, so we modeled the architecture instead. claude-sonnet-5-5 ran exactly one live web search on the query as typed (Anthropic web search tool [@anthropic_ws], U.S. location) and wrote an overview grounded only in the returned pages, in the AI Overview format: a bold direct answer, three to six bullets with per-sentence source attributions, and the standard health disclaimer. We consider this a conservative stand-in, since a capable model reads the same kind of open-web pool that search engines rank. The package includes templates for substituting manual captures of real AI Overviews.

All runs took place on 28–29 September 2026 through the production Worker.

## 5.3 Outcomes

**Reference existence and accuracy.** For Tables Turned, every cited PMID was resolved in PubMed and checked against the set of papers actually sent to the model. For the chatbot, references listed in turn 2 were parsed into fields by a structured-output call (extraction only, no judgment) and matched deterministically against PubMed using several routes: the supplied PMID, the DOI, an exact title phrase, fielded title terms, first author plus year plus journal, and a CrossRef fallback. Matches were required to agree on title similarity (≥0.90, or ≥0.60 with author and year agreement), first author, and year within one. We manually reviewed every reference that did not match exactly; this review exposed, and led us to fix, false negatives in our own matcher for references cited without a title or without a subtitle. All matched records were screened for PubMed's "Retracted Publication" flag.

**Claim-level provenance and support.** Answers were segmented into claim units: each bullet, or each prose sentence, excluding headings, disclaimers, and questions back to the reader. A unit counted as cited if it carried a resolvable identifier (a PMID or a numbered web source). An independent judge, claude-opus-5-5, a different model generation from the Tables Turned generator, read each cited unit alongside the full text of what it cites. For Tables Turned that was the full abstract(s); for the modeled overview, the page excerpts the search tool returned as the citation. The judge rated each unit supported, partially supported (gist present, but some element overstated, generalized, or numerically off), or not supported [@zheng2023]. The chatbot's turn-1 claims carried no identifiers, so support could not be assessed.

**Evidence base.** For Tables Turned, we recorded the study design of each cited paper from its PubMed publication types. For the modeled overview, we classified each retrieved and cited web page by source type using a published rule set (literature, government, professional society, academic or hospital, health media and nonprofits, commercial, news and other). For the chatbot, we recorded the verification status of each reference. The same judge also rated each of the 12 papers Tables Turned showed the reader as directly relevant, tangential, or off-topic.

**Readability, stability, latency, and cost.** We computed the Flesch–Kincaid grade level [@kincaid1975] after stripping markup and citation markers. Stability was the mean pairwise Jaccard overlap of evidence sets across the three Q1 replicates. Latency was wall-clock time, and cost was computed from token usage at Anthropic list prices.

## 5.4 Reproducibility

The preprint/ directory contains the question set; scripts that run each arm, audit citations, compute metrics, draw every figure, and build this document; the frozen raw outputs (full transcripts, Tablets, search results, and judge rationales); and a single run_all.sh. Re-running the analysis on the frozen data reproduces every number here exactly. Re-running the arms produces new samples from live systems (Section 7.2).

# 6 Results

## 6.1 The pipeline in operation

Every question produced four strategies (Table 2). The strategies matched a median of 1,509 records in total (range 697–3,948), and retrieval assembled a median of 60 candidates (52–73). Of the 72 papers shown to the reader across the six questions, 59 (82%) had been found by at least two strategies. The judge rated 47 (65%) directly relevant to the question, 18 (25%) tangential, and 7 (10%) off-topic. Four of the seven off-topic papers came from Q6, where broad acetate-related strategies admitted, among others, a 1995 editorial on Agent Orange and a 1981 study of dichloroacetate. The synthesis step cited none of the off-topic papers in the six primary runs: 39 of its 45 citations were to directly relevant papers and 6 to tangential ones. A median session took 59 s end to end (range 54–67): 6.7 s to generate queries, 5.7 s to retrieve, 22.6 s to translate, and 24.5 s to synthesize. Model usage cost a mean of USD 0.11 per session.

::: table 440,1880,700,700,1050,1650,700,1000,1240
**Table 2. Pipeline telemetry by question (replicate 1).** Hits are total PubMed matches per strategy. Candidates are unique PMIDs retrieved (≤25 per strategy). Relevance is the judge's rating of the 12 papers shown to the reader (directly relevant / tangential / off-topic). Cost is model usage at list price.
| ID | Hits per strategy | Candi­dates | ≥2 strat. | Tie at cutoff | Relevance (D/T/O) | Cited | Latency (s) | Cost (USD) |
|---|---|---|---|---|---|---|---|---|
| Q1 | 1,199 · 125 · 797 · 9 | 59 | 11/12 | 12 at 8 | 9 / 2 / 1 | 9 | 57.9 | 0.10 |
| Q2 | 620 · 1,843 · 291 · 1,194 | 52 | 12/12 | 8 at 12 | 8 / 4 / 0 | 8 | 62.4 | 0.12 |
| Q3 | 11 · 905 · 364 · 51 | 72 | 9/12 | none | 9 / 2 / 1 | 7 | 59.5 | 0.11 |
| Q4 | 751 · 421 · 451 · 64 | 73 | 12/12 | 2 at 9 | 7 / 4 / 1 | 7 | 66.8 | 0.11 |
| Q5 | 502 · 89 · 94 · 12 | 61 | 12/12 | none | 9 / 3 / 0 | 7 | 58.9 | 0.14 |
| Q6 | 11 · 459 · 621 · 2 | 58 | 3/12 | 3 at 5 | 5 / 3 / 4 | 7 | 53.6 | 0.08 |
^ "Tie at cutoff" gives the number of candidates sharing the 12th-place score and that score; "none" means the 12th paper's score was unique.
:::

## 6.2 Three answers to one question

Table 3 shows the three flagship answers side by side. All three agree on the headline: melatonin can help children fall asleep, with caveats. They differ in what the reader can do next. The chatbot's answer is well organized and humane: it covers behavioral steps first, low doses, gummy mislabeling, and red flags for a doctor. But not one of its 20 claim units can be traced to a source. When asked for its studies, it declined to supply PMIDs ("PMIDs are easy for me to get wrong, so a fabricated one might point you to an unrelated paper"), listed seven real studies by author and year, and asked the reader to verify each one in PubMed.

The modeled overview is brief and cites every sentence, but its sources are a sleep-health publisher, a children's mental-health nonprofit, a university health system's news page, and the American Academy of Pediatrics' parent site. One of its claims, that melatonin "doesn't help them stay asleep," does not hold for at least one population: in a randomized trial, prolonged-release melatonin increased total sleep time in children with autism by 32 minutes more than placebo [@gringras2017]. Only Tables Turned connects its sentences to the 24-trial meta-analysis [@choi2022], the 2-year growth-and-puberty safety trial [@malow2021], and the 2024 expert guidance [@bruni2024] that answer the question directly. It also marks the gummy-dosing caveat [UNWITNESSED] because none of the selected papers addressed it, although the chatbot correctly recalled a 2023 study showing that gummy contents ranged widely from their labels [@cohen2023].

::: figure fig3_consensus.png 6.5
**Figure 3. How Tables Turned narrows the record (Q1, replicate 1).** (a) The funnel from the full PubMed index to the nine papers cited in the brief (log scale). (b) The consensus matrix for the 18 highest-scoring of 59 candidates. Each cell shows a paper's rank within one strategy, shaded by rank points. The bar is the consensus score, and a check marks papers the brief cited. The 2024 European expert guidance (PMID 38625388) was found by only one strategy, as its #1 result, and enters the top 12 through the tie between one strategy's top rank and two strategies' agreement. Strategies (abridged): S1 "melatonin sleep children"; S2 melatonin AND (sleep initiation disorders OR sleep onset latency OR insomnia) AND children AND (RCT OR meta-analysis OR systematic review); S3 melatonin AND sleep AND children AND (efficacy OR safety OR adverse effects); S4 (melatonin supplementation OR gummies) AND sleep outcomes AND (healthy OR typically developing children) AND (review OR trial).
:::

::: table 3120,3120,3120
**Table 3. Flagship answers, verbatim excerpts (Q1, replicate 1).** Ellipses mark omissions. Source lists are complete.
| Tables Turned | AI Overview (modeled) | Claude free |
|---|---|---|
| "Yes, melatonin helps children fall asleep faster and sleep somewhat longer, and it appears safe in the short and medium term. A meta-analysis of 24 trials found melatonin was significantly effective at reducing the time to fall asleep and increasing total sleep time specifically in children and adolescents [PMID: 36179487]. However, European pediatric sleep experts recommend trying good sleep habits and consistent bedtime routines first … [PMID: 38625388]." | "Melatonin can help some children fall asleep, especially kids with autism or ADHD, but it doesn't help them stay asleep. [1] Evidence is limited, and experts generally treat it as a short-term aid, not a first-line fix. … The FDA hasn't approved melatonin for kids' sleep disorders [2] … This is for informational purposes only." | "It can help some kids, but it's usually not the first thing to try, and gummies come with some caveats. … In kids with trouble falling asleep, it typically shortens the time to fall asleep by roughly 15-30 minutes. … A 2023 JAMA analysis found gummies contained anywhere from about 75% to 350% of the labeled melatonin amount." |
| "Most rigorous trials used pharmaceutical-grade prolonged-release tablets, not over-the-counter gummies … [UNWITNESSED from these papers]." · Confidence: Medium. | Cited: childmind.org; sleepfoundation.org; uclahealth.org (news); healthychildren.org (AAP). | Turn 2: "I can't give you PubMed IDs reliably … Please verify these yourself." Seven studies listed by author, year, and journal. |
| Sources: 9 PMIDs, all in the reader's set of 12: 3 systematic reviews/meta-analyses, 2 RCTs, 2 guidelines, 2 reviews. | Sources: 4 web pages; 0 peer-reviewed. | Sources in answer: none. Listed on request: 7 real studies, 2 organizational sources. |
:::

## 6.3 Do the references exist?

Tables Turned cited 59 PMIDs across eight runs. All 59 (100%) resolved in PubMed and all 59 were among the papers the reader's curation passed to the model; none was out of set. One [UNWITNESSED] marker appeared, and no retracted paper appeared in any curated set.

The chatbot result is the study's most important finding: it did not fabricate. Across the six primary runs it listed 40 sources when asked. Of these, 29 matched a PubMed record exactly, 1 was a real paper with a paraphrased title, 3 were real papers identified by author, year, and journal without a title, and 7 were organizational sources such as FDA labeling, NHS guidance, and dietary reference intakes (Figure 4c). None was fabricated. The chatbot volunteered 15 PMIDs, all correct, and in all eight runs it warned that its identifiers might be wrong. One cited trial of apple cider vinegar for weight loss has since been retracted [@aboukhalil2024]; the chatbot itself hedged that the study had been "criticized and, I believe, retracted." In the Q4 run it disclosed its method plainly: "My previous answer summarized the general state of the evidence and wasn't built from a specific citation list."

::: figure fig4_evidence.png 6.5
**Figure 4. What each answer rests on (replicate 1).** (a) Tables Turned: cited papers by PubMed publication type. (b) Modeled AI Overview: cited web pages by source type. (c) Claude free: references listed in turn 2, by verification result. † The retracted apple cider vinegar trial (PMID 38966098), which the chatbot itself flagged as probably retracted. Source-type rules and every URL are in the reproduction package.
:::

## 6.4 What do the answers rest on?

The three evidence bases barely overlap in kind (Figure 4). Of the 45 papers cited in the primary Tables Turned briefs, 19 (42%) were systematic reviews or meta-analyses and 14 (31%) randomized trials. Their median publication year was 2022, and 73% had been published since 2021. The chatbot's verified references were older (median 2019; 42% since 2021) because they were recalled from training data rather than retrieved. The modeled overview's single searches returned 56 pages, only 6 (11%) of them peer-reviewed literature. Of its 30 cited pages, 3 (10%) were literature, all in Q5 (PubMed Central articles and a Cochrane summary); the rest were academic or hospital pages (40%), health media and nonprofits (30%), news (17%), and one professional-society page. The Ozempic safety overview (Q2) was assembled from U.S. News, INTEGRIS Health, Healthgrades, GoodRx, Forbes Health, and TODAY, and cited no trial.

## 6.5 Can each claim be traced to a source that says it?

Figure 5a is the study's central measurement. Tables Turned cited 67% of all claim units, and 91% of those in its answer and key-findings sections. Most uncited units were "what is unknown" statements and confidence rationales, which describe gaps rather than report findings. The judge rated 56% of Tables Turned's cited claims fully supported by the cited abstracts, 41% partially supported, and 3% not supported. In the answer and key-findings sections, no cited claim was rated unsupported. The dominant failure was numeric drift. For example, one brief reported a total-sleep-time gain of about 58 minutes in children with autism; that is the within-group change, and the abstract's placebo-adjusted difference is 32 minutes [@gringras2017]. Other partial ratings came from ranges widened beyond what the abstracts state, and from findings in one population generalized to another. The modeled overview cited 100% of its claims, and 61% were fully supported by the page excerpts. Its support, however, is fidelity to secondary web copy, not to the underlying studies.

::: figure fig5_claims.png 6.5
**Figure 5. Claim-level provenance and readability (six questions, replicate 1).** (a) Share of claim units (bullets and sentences) that carry a resolvable citation, and the judge's support rating for each cited unit. Tables Turned is judged against full PubMed abstracts; the modeled AI Overview against the page excerpts its search returned. The chatbot's answers contained no resolvable citations. (b) Flesch–Kincaid grade level of each answer; the shaded band marks the grade 6–8 target for patient materials.
:::

## 6.6 Readability, stability, latency, and cost

Tables Turned was the hardest to read (Figure 5b): its briefs averaged grade 10.1 (range 8.7–10.9), against 8.2 for the modeled overview and 7.5 for the chatbot. Numbers, study designs, and parenthetical definitions, the very material that makes a brief checkable, raise the grade level. Over the three Q1 replicates, Tables Turned's 12-paper sets overlapped with a mean Jaccard of 0.50: 7 papers appeared in all three runs, and 5 papers were cited in all three briefs. The first strategy was identical across runs; later strategies varied. The confidence rating was Medium, Medium, and Medium-High. The chatbot's listed references were comparably unstable (Jaccard 0.48). The modeled overview was the most stable (cited-page Jaccard 0.87), because its single search returned identical results each time. Tables Turned was also the slowest and costliest arm (Table 4): a median of 59 s and USD 0.11 per session, against 11 s and USD 0.01 for the chatbot and 6 s and USD 0.05 for the modeled overview. Across all arms, replicates, and audits, the study cost USD 2.57 in API usage.

::: table 2560,2280,2280,2240
**Table 4. The three arms compared (six questions, replicate 1).** Panel A describes design properties; panel B gives measured outcomes. Support percentages are shares of cited claim units.
| | Tables Turned | AI Overview (modeled) | Claude free |
|---|---|---|---|
| **A. Evidence pool** | PubMed abstracts retrieved per question | Open-web pages from one search | Model memory (training data) |
| **When evidence is chosen** | Before writing; by reader | Before writing; by search engine | After writing, if asked |
| **Citation unit** | Claim → PMID | Sentence → web page | None in answer |
| **Reader sees sources first** | Yes (12 cards, full abstracts) | No | No |
| **Prompts and audit trail** | All visible; exportable Tablet | Not visible | Not visible |
| **B. Claim units cited** | 67% (91% in findings) | 100% | 0% |
| **Cited claims fully / partly / not supported** | 56% / 41% / 3% | 61% / 36% / 3% | not assessable |
| **References that exist** | 59/59 PMIDs (100%) | 30/30 URLs (web) | 33/33 articles; 0 fabricated |
| **Cited sources from the research literature** | 100% (PubMed records) | 10% (3 of 30) | 83% (33 of 40) |
| **SR/MA or RCT share of cited papers** | 73% | n/a | n/a |
| **Median year of cited research** | 2022 | n/a | 2019 |
| **Reading grade (FKGL), mean** | 10.1 | 8.2 | 7.5 |
| **Words, mean** | 367 | 164 | 361 |
| **Latency, median** | 59 s | 6 s | 11 s |
| **Model cost per answer** | USD 0.11 | USD 0.05 | USD 0.01 |
:::

# 7 Discussion

## 7.1 From fabrication to provenance

The benchmark that framed early debate about AI health answers, whether the references are real, is now passed by a free-tier model: we found no fabricated reference and no wrong PMID. What remains is structural. The chatbot's answer came first, and its citations came afterward, reconstructed from memory, older than the retrieved literature, attached to no particular sentence, and handed back to the reader with instructions to go and check. The search summary does attach a source to every sentence, but the sources are the open web's secondary retellings. For a drug-safety question, that meant a morning-television website and a business magazine's health vertical rather than the trials. Neither arm lets the reader answer the question that matters most to evidence-based practice [@guyatt2008]: *which study says this, and what kind of study is it?*

Tables Turned answers that question by construction. Every cited PMID came from a set the reader had seen, and three-quarters of cited papers were systematic reviews, meta-analyses, or randomized trials. The design also has a less obvious benefit: it makes the pipeline's own errors measurable. Because each claim points to an identifiable abstract, an independent judge could show that about four in ten cited claims overreached their source, and why: within-group changes reported as treatment effects, ranges widened, populations generalized. A system that does not bind claims to evidence cannot even be audited for these errors. We regard the partial-support rate not as a verdict on the idea but as the first measurement of something that can now be driven down.

## 7.2 Limitations

This is a small, descriptive study. Six questions and three flagship replicates cannot estimate population-level rates; the confidence intervals would be wide, and we report counts rather than inferential statistics. The AI Overview arm is modeled, not captured: a real search engine's ranking, model, and presentation differ, and our proxy used a strong model on one search's results. The chatbot proxy omits the consumer app's system prompt and its optional web search. Claude models appear in every arm, as generator, comparator, and judge. We used a different model generation for judging, but shared-family bias cannot be excluded, and no human expert has yet validated the judge's ratings. Tables Turned reads abstracts only, which can omit harms, subgroups, and conflicts of interest reported in full texts. Its ranker admits off-topic papers (10% in our sample), and retrieval order breaks ties at the cutoff. LLM query generation makes evidence sets vary from run to run (Jaccard 0.50). Our simulated reader accepted every suggested paper, so the value of real curation remains unmeasured. The pipeline does not yet screen for retractions; none appeared in our sample. Finally, AI models and search results change continuously. Our frozen data record one moment, and re-running the arms will sample a different one.

## 7.3 Ethics, safety, and disclosure

Tables Turned is not a clinical decision tool, and the interface says so: a brief is meant to support a better conversation with a clinician, not to replace one. Its safeguards are procedural (receipts, [UNWITNESSED], stated confidence, visible prompts) rather than guarantees. Questions and abstracts are sent to NCBI and Anthropic; nothing is stored server-side. J.E.T. built Tables Turned, and the tool uses Anthropic's models, which also served as a comparator and as the judge in this study. Readers should weigh the results with both facts in mind.

## 7.4 What comes next

The audit points to specific next steps: (i) quote-anchored numbers, requiring every figure in a brief to appear verbatim in the cited abstract, with a verification pass before display; (ii) a plain-language rewrite pass targeting grade 8 without dropping receipts; (iii) retraction and erratum screening at retrieval; (iv) deterministic or ensembled query generation, with a score margin rather than retrieval order to resolve ties; (v) full text from PubMed Central's open-access subset where licenses allow; (vi) study-design and sample-size badges on the curation cards so readers can weigh evidence as they select it; and (vii) a preregistered user study with lay readers and clinicians that compares decisions, comprehension, and trust across the three kinds of answer. We also invite replication: the package runs end to end for about USD 2.60.

# 8 Conclusion

The question is no longer whether AI can write a plausible answer about health. It clearly can. The question is whether the reader can hold the answer to account. Tables Turned shows that an open, inexpensive, browser-native pipeline can put the reader between retrieval and synthesis, bind claims to the public record they paid for, and export every step for anyone to check. The same receipts that make its answers trustworthy make its mistakes visible. That is the standard we propose for AI in public health information: not answers, but receipts.

# Declarations

**Author contributions (CRediT).** Jacob E. Thomas: conceptualization, software, methodology, investigation, data curation, formal analysis, visualization, writing – original draft. Daniel S. Kreitzberg: [contributions to be confirmed before posting].

**Competing interests.** J.E.T. is the developer of Tables Turned. Tables Turned uses Anthropic's Claude models, which also served as a comparator and as the judge in this study. [Authors to declare any further competing interests before posting.]

**Funding.** [To be completed by the authors.]

**Data and code availability.** Code, prompts, raw outputs (complete transcripts, Tablets, search results, extracted references, and judge rationales), and the scripts that regenerate every number, figure, and this document are in the preprint/ directory of the Tables Turned repository [@tt_repo]. The live tool is at https://tables-turned.com.

**Use of AI assistance.** The reproduction package, analyses, figures, and first draft of this manuscript were produced with the assistance of Claude (Anthropic), working under the authors' direction in Claude Code. The authors reviewed the work and take full responsibility for its content. Every model output analyzed here is preserved verbatim in the reproduction package.

**Acknowledgments.** We thank the U.S. National Library of Medicine for maintaining PubMed and the E-utilities as a free public service.

# References

::: references
:::

# Appendix A. The three production prompts, verbatim

These prompts are read at build time from commons-table/js/synthesis.js, the same file the website loads. The model is claude-opus-4-6; maximum output is 1,024 tokens for search, 2,048 for translation, and 1,500 for synthesis.

::: prompts
:::
