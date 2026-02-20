/**
 * Synthesis — Anthropic API Integration
 *
 * Capabilities:
 * 1. generateSearchQueries: Turn a plain-English question into PubMed search terms
 * 2. generatePlainSummaries: Translate paper titles/abstracts into plain language
 * 3. generate: Synthesize papers into a receipted brief (streaming)
 * 4. searchPubMed: Execute search queries against NCBI E-utilities
 */

const Synthesis = (() => {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-opus-4-6';

  // ── Shared API call (non-streaming) ──

  async function callAPI(apiKey, system, userContent, maxTokens) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens || 1024,
        system: system,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      let msg = `API error (${response.status})`;
      try {
        const errJson = JSON.parse(errBody);
        if (errJson.error && errJson.error.message) msg = errJson.error.message;
      } catch (e) { /* use default */ }
      throw new Error(msg);
    }

    const data = await response.json();
    return data.content && data.content[0] ? data.content[0].text : '';
  }

  // ═══════════════════════════════════════════════════════════
  //  SEARCH QUERY GENERATION
  // ═══════════════════════════════════════════════════════════

  const SEARCH_SYSTEM = `You are a PubMed search expert. Your job is to turn a plain-English health or science question into optimized PubMed search queries.

## Rules
1. Generate 3-4 PubMed search queries, from broad to specific.
2. Use proper MeSH terms and boolean operators (AND, OR) where helpful.
3. Include relevant synonyms and alternative phrasings.
4. Prioritize queries that will find systematic reviews, meta-analyses, and RCTs when relevant.
5. Keep queries concise but effective.

## Output Format
Return ONLY a JSON array of objects. No markdown, no explanation, no code fences.
Each object has:
- "query": the PubMed search string
- "strategy": a brief plain-English description of what this query targets (1 sentence)

Example output:
[{"query":"vitamin D supplementation respiratory infection children","strategy":"Broad search for vitamin D and respiratory infections in children"},{"query":"(vitamin D OR cholecalciferol) AND (respiratory tract infection OR RTI OR common cold) AND (child OR pediatric) AND (randomized controlled trial OR meta-analysis)","strategy":"Targeted search for high-quality trials on vitamin D and respiratory infections in kids"}]`;

  async function generateSearchQueries(opts) {
    const { apiKey, question, context } = opts;

    let prompt = `Question: ${question}`;
    if (context) prompt += `\nDecision context: ${context}`;
    prompt += '\n\nGenerate PubMed search queries for this question.';

    const raw = await callAPI(apiKey, SEARCH_SYSTEM, prompt);

    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Failed to parse search queries from AI response');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PLAIN-LANGUAGE SUMMARIES
  //  Translate paper titles/abstracts into plain English
  // ═══════════════════════════════════════════════════════════

  const SUMMARY_SYSTEM = `You translate medical research paper titles and abstracts into plain language for people without medical training.

## Rules
1. Use no medical jargon. If a technical concept is essential, explain it in parentheses.
2. Be specific about findings (numbers, effects) when the abstract provides them.
3. Each summary should help a non-expert decide if this paper is relevant to their question.

## Output Format
Return ONLY a JSON array in the same order as the papers provided. No markdown, no explanation.
Each object has:
- "plain_title": A clear, jargon-free title (5-12 words)
- "plain_summary": One sentence explaining the key finding or purpose in everyday language`;

  async function generatePlainSummaries(opts) {
    const { apiKey, papers, question } = opts;

    let prompt = `The user's question: "${question}"\n\nPapers to translate:\n\n`;
    for (let i = 0; i < papers.length; i++) {
      prompt += `Paper ${i + 1} (PMID: ${papers[i].pmid}):\n`;
      prompt += `Title: ${papers[i].title}\n`;
      if (papers[i].abstract) {
        prompt += `Abstract: ${papers[i].abstract.substring(0, 600)}\n`;
      }
      prompt += '\n';
    }
    prompt += 'Translate each paper into plain language.';

    const raw = await callAPI(apiKey, SUMMARY_SYSTEM, prompt, 2048);

    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      return papers.map(() => ({ plain_title: '', plain_summary: '' }));
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBMED SEARCH (via NCBI esearch)
  // ═══════════════════════════════════════════════════════════

  async function searchPubMed(query, maxResults, sort) {
    maxResults = maxResults || 10;
    sort = sort || 'relevance';
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&sort=${sort}&retmode=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`PubMed search failed: ${response.status}`);
    const data = await response.json();
    return {
      pmids: data.esearchresult?.idlist || [],
      count: parseInt(data.esearchresult?.count || '0', 10),
      query: query
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  BRIEF SYNTHESIS (streaming)
  // ═══════════════════════════════════════════════════════════

  const SYNTH_SYSTEM = `You are a research translator for Tables Turned, a tool that helps regular people understand PubMed research and make informed decisions.

## Your Rules

1. **Separate observation from inference.** First state what the papers actually say. Then state what you infer. Never blend the two.

2. **Every claim needs receipts.** Link each claim to one or more PMIDs. Format citations as [PMID: XXXXX]. If you cannot link a claim to a paper provided, mark it as [UNWITNESSED].

3. **Surface contradictions.** If papers disagree, say so. Do not smooth over disagreement. Map it: which papers say what, and why they might differ.

4. **Write in common tongue.** No jargon. If a technical term is unavoidable, translate it in parentheses immediately. Short sentences. No em dashes. No corporate language.

5. **Do not patronize.** The reader is not stupid. They are busy. Respect their time and intelligence.

6. **State confidence honestly.** Say whether the evidence is strong, mixed, or thin. Give reasons: number of studies, study size, consistency, design strength.

7. **Name what is unknown.** If the papers do not address a question the reader likely cares about, say so.

8. **Do not hallucinate.** If you are unsure, say so. Never invent findings. Never cite a PMID that was not provided to you.

## Output Format

Produce a markdown document with exactly these sections:

# [Title derived from the question]

**Question:** [The user's question]
**Context:** [The user's decision context]

---

## What the papers say

[For each key finding, state what the papers found in plain language. Group by theme. Always cite with [PMID: XXXXX].]

## What we infer (with receipts)

[Numbered claims. Each claim MUST be followed by [PMID: XXXXX] citations. Surface contradictions. Mark anything without receipts as [UNWITNESSED].]

## What is unknown

[Questions the papers do not answer that the reader probably cares about.]

## Confidence

[Low / Medium / High with clear reasoning based on study count, size, consistency, and design.]

---

*Generated by Tables Turned. Receipts only.*`;

  function buildUserMessage(question, context, papers) {
    const lines = [];
    lines.push(`**Question:** ${question}`);
    if (context) lines.push(`**Context:** ${context}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`**Papers provided (${papers.length}):**`);
    lines.push('');

    for (const p of papers) {
      lines.push(`### PMID: ${p.pmid}`);
      lines.push(`**Title:** ${p.title}`);
      if (p.authors && p.authors.length) {
        const display = p.authors.length > 5
          ? p.authors.slice(0, 5).join(', ') + ' et al.'
          : p.authors.join(', ');
        lines.push(`**Authors:** ${display}`);
      }
      if (p.journal) {
        lines.push(`**Journal:** ${p.journal}${p.year ? ` (${p.year})` : ''}`);
      }
      if (p.abstract) {
        lines.push(`**Abstract:**`);
        lines.push(p.abstract);
      } else {
        lines.push(`**Abstract:** Not available.`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    lines.push('Based on these papers, generate a plain-language synthesis brief.');
    lines.push('Follow all rules strictly. Every claim must cite PMID(s).');
    lines.push('Surface contradictions. State confidence honestly.');
    lines.push('Write for a regular person making a real decision.');

    return lines.join('\n');
  }

  async function generate(opts) {
    const { apiKey, question, context, papers, onChunk, onDone, onError } = opts;
    const userMessage = buildUserMessage(question, context, papers);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          stream: true,
          system: SYNTH_SYSTEM,
          messages: [{ role: 'user', content: userMessage }]
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        let msg = `API error (${response.status})`;
        try {
          const errJson = JSON.parse(errBody);
          if (errJson.error && errJson.error.message) msg = errJson.error.message;
        } catch (e) { /* use default */ }
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.type === 'text_delta') {
              fullText += parsed.delta.text;
              if (onChunk) onChunk(parsed.delta.text, fullText);
            }
            if (parsed.type === 'error') {
              throw new Error(parsed.error ? parsed.error.message : 'Stream error');
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        }
      }

      if (onDone) onDone(fullText);
      return fullText;

    } catch (err) {
      if (onError) onError(err);
      throw err;
    }
  }

  // ── Public API ──

  return {
    generateSearchQueries,
    generatePlainSummaries,
    searchPubMed,
    generate,
    buildUserMessage,
    // Expose prompts for transparency
    SEARCH_SYSTEM,
    SUMMARY_SYSTEM,
    SYNTH_SYSTEM,
    MODEL
  };
})();
