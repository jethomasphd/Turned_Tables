/**
 * App — Tables Turned
 *
 * Cinematic intro -> Ask question -> AI searches PubMed -> User curates ->
 * Claude synthesizes -> Beautiful brief with DOCX download.
 *
 * User journey: Confusion -> Awe -> Understanding -> Action
 */

const App = (() => {
  // ── State ──
  const state = {
    question: '',
    context: '',
    searchQueries: [],
    allFoundPapers: [],
    selectedPMIDs: new Set(),
    papers: [],
    briefMarkdown: null,
    provenance: []
  };

  const KEY_STORE = 'tt_api_key';
  const MODEL_STORE = 'tt_model';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function logProv(action, detail) {
    state.provenance.push({ timestamp: new Date().toISOString(), action, detail: detail || null });
  }

  function getKey() { return ($('key') ? $('key').value : '') || localStorage.getItem(KEY_STORE) || ''; }
  function getModel() { return ($('s-model') ? $('s-model').value : '') || localStorage.getItem(MODEL_STORE) || 'claude-sonnet-4-5-20250929'; }

  // ═══════════════════════════════════════════════════════════
  //  CINEMATIC INTRO
  // ═══════════════════════════════════════════════════════════

  const WOUND_LINES = [
    { id: 'w1', text: 'Every day, people make decisions about their health' },
    { id: 'w2', text: 'based on headlines, hearsay, and hope.' },
    { pause: 800 },
    { id: 'w3', text: 'The research exists. It is public. It is free.' },
    { id: 'w4', text: 'But it sits behind jargon, buried in abstracts nobody reads.' },
    { pause: 600 },
    { id: 'w5', text: 'The table is set against you.' }
  ];

  const TURN_LINES = [
    { id: 't1', text: 'This tool reads the public record.' },
    { pause: 600 },
    { id: 't2', text: 'You bring the question. We search the research.' },
    { id: 't3', text: 'AI translates the abstracts into plain language' },
    { id: 't4', text: 'with every claim traced back to its source.' },
    { pause: 600 },
    { id: 't5', text: 'No jargon. No hand-waving. Receipts only.' }
  ];

  let currentAct = 1;
  let introPlaying = false;
  let introSkipped = false;

  async function typeText(el, text) {
    el.classList.add('typing');
    for (let i = 0; i < text.length; i++) {
      if (introSkipped) { el.textContent = text; el.classList.remove('typing'); return; }
      el.textContent += text[i];
      await sleep(35 + Math.random() * 25);
    }
    el.classList.remove('typing');
  }

  async function playLines(lines) {
    for (const line of lines) {
      if (introSkipped) { for (const l of lines) { if (l.id) $(l.id).textContent = l.text; } return; }
      if (line.pause) { await sleep(line.pause); continue; }
      await typeText($(line.id), line.text);
      await sleep(250);
    }
  }

  function showAct(num) {
    document.querySelectorAll('.act').forEach(a => a.classList.remove('active'));
    const act = $('act-' + num);
    if (act) act.classList.add('active');
    currentAct = num;
  }

  async function advanceIntro() {
    if (introPlaying) return;
    if (currentAct === 1) { introPlaying = true; showAct(2); await playLines(WOUND_LINES); introPlaying = false; }
    else if (currentAct === 2) { introPlaying = true; showAct(3); await playLines(TURN_LINES); introPlaying = false; }
    else if (currentAct === 3) { showAct(4); }
  }

  function enterApp() {
    introSkipped = true;
    const intro = $('intro');
    intro.style.opacity = '0';
    intro.style.transition = 'opacity 0.6s ease';
    setTimeout(() => { intro.style.display = 'none'; show($('app')); initApp(); }, 600);
  }

  function initIntro() {
    $('intro').addEventListener('click', (e) => {
      if (e.target.id === 'enter-btn') { enterApp(); return; }
      if (e.target.id === 'skip-intro') { enterApp(); return; }
      advanceIntro();
    });
    document.addEventListener('keydown', (e) => {
      if ($('intro').style.display === 'none') return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (currentAct === 4) enterApp(); else advanceIntro(); }
      if (e.key === 'Escape') enterApp();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  INIT APP
  // ═══════════════════════════════════════════════════════════

  function initApp() {
    // Restore saved settings
    const savedKey = localStorage.getItem(KEY_STORE) || '';
    if (savedKey) {
      if ($('key')) $('key').value = savedKey;
      if ($('s-key')) $('s-key').value = savedKey;
    }
    const savedModel = localStorage.getItem(MODEL_STORE) || '';
    if (savedModel && $('s-model')) $('s-model').value = savedModel;

    // Settings sync
    if ($('s-key')) $('s-key').addEventListener('change', (e) => { localStorage.setItem(KEY_STORE, e.target.value); if ($('key')) $('key').value = e.target.value; });
    if ($('s-model')) $('s-model').addEventListener('change', (e) => { localStorage.setItem(MODEL_STORE, e.target.value); });
    if ($('key')) $('key').addEventListener('change', (e) => { localStorage.setItem(KEY_STORE, e.target.value); if ($('s-key')) $('s-key').value = e.target.value; });

    // Explainer toggle
    $('explainer-toggle').addEventListener('click', () => {
      $('explainer').classList.toggle('open');
    });

    // Docs toggle
    $('docs-toggle').addEventListener('click', () => {
      $('docs-section').classList.toggle('open');
      const body = $('docs-body');
      if ($('docs-section').classList.contains('open')) show(body);
      else hide(body);
    });

    // Search button (AI-powered PubMed search)
    $('search-btn').addEventListener('click', handleSearch);

    // Manual entry button
    $('manual-btn').addEventListener('click', handleManualEntry);

    // Curate actions
    $('select-all-btn').addEventListener('click', () => { state.allFoundPapers.forEach(p => state.selectedPMIDs.add(p.pmid)); renderCurateList(); });
    $('select-none-btn').addEventListener('click', () => { state.selectedPMIDs.clear(); renderCurateList(); });
    $('synthesize-btn').addEventListener('click', handleSynthesize);
    $('back-to-search').addEventListener('click', () => { hide($('curate-view')); show($('input-view')); });

    // Export
    $('dl-docx').addEventListener('click', () => { if (state.briefMarkdown) downloadDocx(state.briefMarkdown); });
    $('dl-brief').addEventListener('click', () => { if (state.briefMarkdown) TabletPress.exportBrief(state.briefMarkdown); });
    $('dl-tablet').addEventListener('click', exportTablet);

    // New question
    $('again-btn').addEventListener('click', resetToStart);
  }

  // ═══════════════════════════════════════════════════════════
  //  STEP 1: AI-POWERED PUBMED SEARCH
  // ═══════════════════════════════════════════════════════════

  async function handleSearch() {
    const question = ($('q').value || '').trim();
    const context = ($('ctx').value || '').trim();
    const apiKey = getKey();
    const model = getModel();
    const statusEl = $('search-status');

    if (!question) { statusEl.textContent = 'Ask a question first.'; statusEl.className = 'error'; return; }
    if (!apiKey) { statusEl.textContent = 'Enter your Anthropic API key.'; statusEl.className = 'error'; return; }

    localStorage.setItem(KEY_STORE, apiKey);
    localStorage.setItem(MODEL_STORE, model);

    state.question = question;
    state.context = context;

    $('search-btn').disabled = true;
    statusEl.textContent = 'Generating search terms...';
    statusEl.className = '';

    logProv('search_started', question);

    try {
      // Phase 1: Ask Claude for search queries
      const queries = await Synthesis.generateSearchQueries({ apiKey, model, question, context });
      state.searchQueries = queries;
      logProv('search_queries_generated', queries.map(q => q.query).join(' | '));

      statusEl.textContent = `${queries.length} search strategies generated. Searching PubMed...`;

      // Phase 2: Execute each query against PubMed
      const allPMIDs = new Set();
      const allPapers = [];
      const RATE_MS = 350;

      for (let i = 0; i < queries.length; i++) {
        statusEl.textContent = `Searching PubMed (${i + 1}/${queries.length}): ${queries[i].strategy}`;
        try {
          const result = await Synthesis.searchPubMed(queries[i].query, 8);
          logProv('pubmed_searched', `"${queries[i].query}" -> ${result.count} results, fetched ${result.pmids.length}`);

          // Collect unique PMIDs
          const newPMIDs = result.pmids.filter(id => !allPMIDs.has(id));
          newPMIDs.forEach(id => allPMIDs.add(id));

          if (newPMIDs.length > 0) {
            await sleep(RATE_MS);
            statusEl.textContent = `Fetching paper details...`;
            const papers = await Shoreline.ingest(newPMIDs.join('\n'));
            for (const p of papers.papers) {
              if (!allPapers.find(x => x.pmid === p.pmid)) {
                allPapers.push(p);
              }
            }
          }
          await sleep(RATE_MS);
        } catch (e) {
          console.error('Search query failed:', e);
          logProv('search_query_failed', queries[i].query + ': ' + e.message);
        }
      }

      if (allPapers.length === 0) {
        statusEl.textContent = 'No papers found. Try rephrasing your question.';
        statusEl.className = 'error';
        $('search-btn').disabled = false;
        return;
      }

      logProv('papers_found', allPapers.length + ' unique papers from ' + queries.length + ' queries');

      // Store and move to curate
      state.allFoundPapers = allPapers;
      state.selectedPMIDs = new Set(allPapers.map(p => p.pmid)); // Select all by default

      displaySearchTerms(queries);
      renderCurateList();

      hide($('input-view'));
      show($('curate-view'));
      window.scrollTo(0, 0);

    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'error';
    } finally {
      $('search-btn').disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  MANUAL ENTRY (skip AI search)
  // ═══════════════════════════════════════════════════════════

  async function handleManualEntry() {
    const linksText = ($('links').value || '').trim();
    const question = ($('q').value || '').trim();
    const context = ($('ctx').value || '').trim();
    const apiKey = getKey();
    const statusEl = $('search-status');

    if (!question) { statusEl.textContent = 'Ask a question first.'; statusEl.className = 'error'; return; }
    if (!linksText) { statusEl.textContent = 'Paste at least one PubMed link.'; statusEl.className = 'error'; return; }
    if (!apiKey) { statusEl.textContent = 'Enter your Anthropic API key.'; statusEl.className = 'error'; return; }

    localStorage.setItem(KEY_STORE, apiKey);
    state.question = question;
    state.context = context;

    $('manual-btn').disabled = true;
    statusEl.textContent = 'Fetching papers...';
    logProv('manual_entry', 'User provided links directly');

    try {
      const result = await Shoreline.ingest(linksText, (msg) => { statusEl.textContent = msg; });

      if (result.papers.length === 0) {
        statusEl.textContent = 'No papers found. Check your links.';
        statusEl.className = 'error';
        $('manual-btn').disabled = false;
        return;
      }

      logProv('papers_ingested', result.papers.length + ' papers');
      state.allFoundPapers = result.papers;
      state.selectedPMIDs = new Set(result.papers.map(p => p.pmid));
      state.searchQueries = [{ query: '(user-provided links)', strategy: 'Direct entry' }];

      displaySearchTerms(state.searchQueries);
      renderCurateList();

      hide($('input-view'));
      show($('curate-view'));
      window.scrollTo(0, 0);

    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'error';
    } finally {
      $('manual-btn').disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  STEP 2: CURATE
  // ═══════════════════════════════════════════════════════════

  function displaySearchTerms(queries) {
    const el = $('search-terms-display');
    let html = '<div class="search-term-label">Search strategies used</div>';
    for (const q of queries) {
      html += `<div style="margin-bottom:0.4rem;"><span style="color:var(--text)">${escapeHtml(q.query)}</span><br><span style="font-family:var(--sans);font-size:0.72rem;color:var(--text-muted)">${escapeHtml(q.strategy)}</span></div>`;
    }
    el.innerHTML = html;
  }

  function renderCurateList() {
    const list = $('curate-list');
    list.innerHTML = '';

    for (const p of state.allFoundPapers) {
      const selected = state.selectedPMIDs.has(p.pmid);
      const card = document.createElement('div');
      card.className = 'curate-card' + (selected ? ' selected' : '');
      card.dataset.pmid = p.pmid;

      const firstAuthor = p.authors && p.authors.length ? p.authors[0].split(' ')[0] : '';
      const meta = [firstAuthor, p.journal, p.year].filter(Boolean).join(' · ');
      const abstractSnip = p.abstract ? p.abstract.substring(0, 200) : 'No abstract available';

      card.innerHTML = `
        <div class="curate-check">${selected ? '\u2713' : ''}</div>
        <div class="curate-info">
          <div class="curate-title">${escapeHtml(p.title)}</div>
          <div class="curate-meta">${escapeHtml(meta)}</div>
          <div class="curate-abstract">${escapeHtml(abstractSnip)}</div>
          <div class="curate-pmid">PMID: ${p.pmid}</div>
        </div>`;

      card.addEventListener('click', () => {
        if (state.selectedPMIDs.has(p.pmid)) state.selectedPMIDs.delete(p.pmid);
        else state.selectedPMIDs.add(p.pmid);
        renderCurateList();
      });

      list.appendChild(card);
    }

    $('curate-count').textContent = `${state.selectedPMIDs.size} of ${state.allFoundPapers.length} selected`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════════════════════
  //  STEP 3: SYNTHESIZE
  // ═══════════════════════════════════════════════════════════

  async function handleSynthesize() {
    const selected = state.allFoundPapers.filter(p => state.selectedPMIDs.has(p.pmid));
    if (selected.length === 0) { alert('Select at least one paper.'); return; }

    state.papers = selected;
    logProv('papers_selected_for_synthesis', selected.length + ' papers');

    hide($('curate-view'));
    show($('processing-view'));
    window.scrollTo(0, 0);

    const procStatus = $('proc-status');
    const procPapers = $('proc-papers');
    const streamOut = $('stream-out');

    procPapers.innerHTML = '';
    streamOut.textContent = '';
    streamOut.classList.remove('visible');

    // Show papers being read
    for (const p of selected) {
      const div = document.createElement('div');
      div.className = 'paper-found';
      const shortTitle = p.title.length > 70 ? p.title.substring(0, 70) + '...' : p.title;
      div.textContent = shortTitle;
      procPapers.appendChild(div);
    }

    procStatus.textContent = selected.length + ' papers selected. Reading them now...';
    await sleep(600);

    streamOut.classList.add('visible');
    procStatus.textContent = 'Generating your brief...';

    const apiKey = getKey();
    const model = getModel();

    try {
      await Synthesis.generate({
        apiKey, model,
        question: state.question,
        context: state.context,
        papers: selected,
        onChunk(chunk, full) {
          streamOut.textContent = full;
          streamOut.scrollTop = streamOut.scrollHeight;
        },
        onDone(fullText) {
          state.briefMarkdown = fullText;
          logProv('synthesis_generated', fullText.length + ' chars, ' + selected.length + ' papers');

          setTimeout(() => {
            hide($('processing-view'));
            show($('results-view'));
            renderBrief(fullText);
            renderProvenance();
            window.scrollTo(0, 0);
          }, 500);
        },
        onError(err) {
          procStatus.textContent = 'Synthesis failed: ' + err.message;
          streamOut.classList.remove('visible');
          logProv('synthesis_failed', err.message);
          setTimeout(() => {
            hide($('processing-view'));
            show($('curate-view'));
          }, 3000);
        }
      });
    } catch (err) { /* handled in onError */ }
  }

  // ═══════════════════════════════════════════════════════════
  //  BRIEF RENDERER
  // ═══════════════════════════════════════════════════════════

  function renderBrief(markdown) {
    const container = $('brief-out');
    const lines = markdown.split('\n');
    const html = [];
    let inUl = false;
    let inOl = false;

    for (const line of lines) {
      if (line.startsWith('### ')) { closeList(); html.push('<h3>' + inline(line.slice(4)) + '</h3>'); }
      else if (line.startsWith('## ')) { closeList(); html.push('<h2>' + inline(line.slice(3)) + '</h2>'); }
      else if (line.startsWith('# ')) { closeList(); html.push('<h1>' + inline(line.slice(2)) + '</h1>'); }
      else if (/^---+\s*$/.test(line)) { closeList(); html.push('<hr>'); }
      else if (/^[-*]\s+/.test(line)) {
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (!inUl) { html.push('<ul>'); inUl = true; }
        html.push('<li>' + inline(line.replace(/^[-*]\s+/, '')) + '</li>');
      }
      else if (/^\d+\.\s+/.test(line)) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (!inOl) { html.push('<ol>'); inOl = true; }
        html.push('<li>' + inline(line.replace(/^\d+\.\s+/, '')) + '</li>');
      }
      else if (line.trim() === '') { closeList(); }
      else { closeList(); html.push('<p>' + inline(line) + '</p>'); }
    }
    closeList();

    function closeList() {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    }

    function inline(text) {
      return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[PMID:\s*(\d+)\]/g, '<span class="pmid">[PMID: $1]</span>')
        .replace(/\[UNWITNESSED\]/g, '<span class="tag-unwitnessed">[UNWITNESSED]</span>')
        .replace(/\[CONTESTED\]/g, '<span class="tag-contested">[CONTESTED]</span>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
    }

    container.innerHTML = html.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  PROVENANCE RENDERER
  // ═══════════════════════════════════════════════════════════

  function renderProvenance() {
    const log = $('provenance-log');
    if (!log) return;
    let html = '';
    for (const entry of state.provenance) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      html += `<div class="prov-entry"><span class="prov-time">${time}</span> <span class="prov-action">${escapeHtml(entry.action)}</span>${entry.detail ? ': ' + escapeHtml(entry.detail).substring(0, 120) : ''}</div>`;
    }
    log.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════
  //  DOCX EXPORT
  //  Generates a real .docx file from markdown using Open XML
  // ═══════════════════════════════════════════════════════════

  function downloadDocx(markdown) {
    // Build a .docx using HTML-in-docx approach (Word can open HTML files saved as .doc)
    // This gives us formatting without any external library.
    const htmlContent = markdownToDocxHtml(markdown);

    const docContent = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Tables Turned Brief</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
  @page { margin: 1in; }
  body { font-family: Georgia, serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 18pt; color: #8B6914; font-weight: normal; margin-bottom: 12pt; border-bottom: 1px solid #d4c5a9; padding-bottom: 6pt; }
  h2 { font-size: 14pt; color: #1a1a1a; font-weight: normal; margin-top: 18pt; margin-bottom: 8pt; border-bottom: 1px solid #e0d8c8; padding-bottom: 4pt; }
  h3 { font-size: 12pt; color: #666; font-weight: normal; margin-top: 14pt; margin-bottom: 6pt; }
  p { margin-bottom: 8pt; }
  hr { border: none; border-top: 1px solid #d4c5a9; margin: 16pt 0; }
  ul, ol { margin-bottom: 8pt; margin-left: 20pt; }
  li { margin-bottom: 4pt; }
  strong { color: #1a1a1a; }
  em { color: #666; }
  .pmid { font-family: Courier New, monospace; font-size: 9pt; color: #8B6914; background: #FFF8E7; padding: 1px 3px; }
  .unwitnessed { font-family: Arial, sans-serif; font-size: 8pt; color: #8B0000; background: #FFF0F0; padding: 1px 4px; text-transform: uppercase; }
  .footer { font-size: 9pt; color: #999; font-style: italic; margin-top: 24pt; padding-top: 8pt; border-top: 1px solid #e0d8c8; }
</style>
</head>
<body>
${htmlContent}
<div class="footer">Generated by Tables Turned &middot; ${new Date().toLocaleDateString()} &middot; Receipts only.</div>
</body>
</html>`;

    const blob = new Blob([docContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Tables_Turned_Brief.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logProv('brief_downloaded', 'DOCX format');
  }

  function markdownToDocxHtml(markdown) {
    const lines = markdown.split('\n');
    const html = [];
    let inUl = false, inOl = false;

    for (const line of lines) {
      if (line.startsWith('### ')) { close(); html.push('<h3>' + docInline(line.slice(4)) + '</h3>'); }
      else if (line.startsWith('## ')) { close(); html.push('<h2>' + docInline(line.slice(3)) + '</h2>'); }
      else if (line.startsWith('# ')) { close(); html.push('<h1>' + docInline(line.slice(2)) + '</h1>'); }
      else if (/^---+\s*$/.test(line)) { close(); html.push('<hr>'); }
      else if (/^[-*]\s+/.test(line)) {
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (!inUl) { html.push('<ul>'); inUl = true; }
        html.push('<li>' + docInline(line.replace(/^[-*]\s+/, '')) + '</li>');
      }
      else if (/^\d+\.\s+/.test(line)) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (!inOl) { html.push('<ol>'); inOl = true; }
        html.push('<li>' + docInline(line.replace(/^\d+\.\s+/, '')) + '</li>');
      }
      else if (line.trim() === '') { close(); }
      else { close(); html.push('<p>' + docInline(line) + '</p>'); }
    }
    close();

    function close() {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    }

    function docInline(text) {
      return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[PMID:\s*(\d+)\]/g, '<span class="pmid">[PMID: $1]</span>')
        .replace(/\[UNWITNESSED\]/g, '<span class="unwitnessed">[UNWITNESSED]</span>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
    }

    return html.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  TABLET EXPORT
  // ═══════════════════════════════════════════════════════════

  function exportTablet() {
    TabletPress.exportTablet({
      title: (state.question || '').substring(0, 100) || 'Untitled Table Flip',
      sessionId: TabletPress.uuid(),
      sessionCreated: new Date().toISOString(),
      intent: { question_draft: state.question, decision_context: state.context, useful_by: '', timebox: 0 },
      papers: state.papers,
      claims: [],
      crossExam: {},
      provenance: state.provenance,
      nextSprint: [],
      briefMarkdown: state.briefMarkdown,
      status: 'sealed'
    });
    logProv('tablet_exported', 'JSON');
  }

  // ═══════════════════════════════════════════════════════════
  //  RESET
  // ═══════════════════════════════════════════════════════════

  function resetToStart() {
    hide($('results-view'));
    hide($('processing-view'));
    hide($('curate-view'));
    show($('input-view'));
    state.papers = [];
    state.allFoundPapers = [];
    state.selectedPMIDs = new Set();
    state.briefMarkdown = null;
    state.searchQueries = [];
    state.provenance = [];
    $('search-status').textContent = '';
    $('search-status').className = '';
    window.scrollTo(0, 0);
  }

  // ── Boot ──
  document.addEventListener('DOMContentLoaded', initIntro);

  return { state };
})();
