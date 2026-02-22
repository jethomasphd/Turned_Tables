/**
 * App — Tables Turned
 *
 * Cinematic intro -> Ask question -> AI searches PubMed -> AI translates papers ->
 * User curates -> Claude synthesizes -> Beautiful brief with DOCX download.
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
    plainSummaries: [],
    selectedPMIDs: new Set(),
    papers: [],
    briefMarkdown: null,
    synthUserMessage: '',
    provenance: []
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function logProv(action, detail) {
    state.provenance.push({ timestamp: new Date().toISOString(), action, detail: detail || null });
  }

  // ── Educational Scaffolding (main page) ──
  const EDU_MESSAGES = [
    'Google AI Overviews weighs wellness blogs the same as peer-reviewed research. This searches the actual U.S. medical database.',
    'ChatGPT invents citations. Fake authors, fake titles, real confidence. Here, every paper is real and every PMID links to PubMed.',
    'Other tools give you answers. This gives you evidence.',
    'Every claim in your brief cites a real paper you can verify in seconds.',
    'Your taxes funded this research. AI just broke the jargon barrier.',
    'Every search term, every prompt, every source. Nothing hidden.'
  ];
  let eduInterval = null;
  let eduIdx = 0;

  function startEduScaffold() {
    const msgEl = $('edu-scaffold-msg');
    if (!msgEl) return;
    eduIdx = 0;
    msgEl.textContent = EDU_MESSAGES[0];
    eduInterval = setInterval(() => {
      eduIdx = (eduIdx + 1) % EDU_MESSAGES.length;
      msgEl.style.opacity = '0';
      setTimeout(() => {
        msgEl.textContent = EDU_MESSAGES[eduIdx];
        msgEl.style.opacity = '1';
      }, 400);
    }, 9000);
  }

  function stopEduScaffold() {
    if (eduInterval) { clearInterval(eduInterval); eduInterval = null; }
  }

  function setPhase(n) {
    for (let i = 1; i <= 4; i++) {
      const el = $('prog-phase-' + i);
      if (!el) continue;
      el.classList.remove('active', 'done');
      if (i < n) el.classList.add('done');
      else if (i === n) el.classList.add('active');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CINEMATIC INTRO
  //  Auto-playing typewriter → "Flip the Tables" → 3D card
  //  flip revealing logo → fade to app
  // ═══════════════════════════════════════════════════════════

  const INTRO_LINES = [
    { id: 'ln1', text: '37 million medical papers.' },
    { pause: 600 },
    { id: 'ln2', text: 'Your taxes paid for them\u2026' },
    { pause: 900 },
    { id: 'ln3', text: 'But the gatekeepers lock you out.' },
    { pause: 1000 },
    { id: 'ln4', text: 'When you have a health question\u2026' },
    { pause: 1200 },
    { id: 'ln5', text: 'The tables are set against you.' }
  ];

  let introSkipped = false;

  async function typeText(el, text) {
    el.classList.add('typing');
    for (let i = 0; i < text.length; i++) {
      if (introSkipped) { el.textContent = text; el.classList.remove('typing'); return; }
      el.textContent += text[i];
      await sleep(25 + Math.random() * 20);
    }
    el.classList.remove('typing');
  }

  async function playIntro() {
    await sleep(800); // initial pause in the void
    for (const line of INTRO_LINES) {
      if (introSkipped) {
        for (const l of INTRO_LINES) { if (l.id) $(l.id).textContent = l.text; }
        return;
      }
      if (line.pause) { await sleep(line.pause); continue; }
      await typeText($(line.id), line.text);
      await sleep(400);
    }
    // After last line, show the flip button
    if (!introSkipped) {
      await sleep(1000);
      const flipBtn = $('flip-btn');
      show(flipBtn);
    }
  }

  function doFlip() {
    const card = $('intro-card');
    card.classList.add('flipped');
    // After flip completes, hold the logo, then transition to app
    setTimeout(() => {
      const intro = $('intro');
      intro.style.opacity = '0';
      intro.style.transition = 'opacity 0.8s ease';
      setTimeout(() => {
        intro.style.display = 'none';
        show($('app'));
        initApp();
      }, 800);
    }, 1800); // 1.4s flip + 0.4s pause to see logo
  }

  function enterApp() {
    introSkipped = true;
    const intro = $('intro');
    intro.style.opacity = '0';
    intro.style.transition = 'opacity 0.6s ease';
    setTimeout(() => { intro.style.display = 'none'; show($('app')); initApp(); }, 600);
  }

  function initIntro() {
    // Skip button
    $('skip-intro').addEventListener('click', enterApp);

    // Flip button
    $('flip-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      doFlip();
    });

    // Keyboard: Escape skips, Enter/Space flips if button visible
    document.addEventListener('keydown', (e) => {
      if ($('intro').style.display === 'none') return;
      if (e.key === 'Escape') { enterApp(); return; }
      if ((e.key === ' ' || e.key === 'Enter') && !$('flip-btn').classList.contains('hidden')) {
        e.preventDefault();
        doFlip();
      }
    });

    // Auto-start the typewriter
    playIntro();
  }

  // ═══════════════════════════════════════════════════════════
  //  INIT APP
  // ═══════════════════════════════════════════════════════════

  // Detect fast mode (resolved at boot time, after DOMContentLoaded)
  let fastMode = false;

  function initApp() {
    // Scroll reveal system (matches Companion Dossier)
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      }
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

    // About toggle (only in full mode)
    if ($('about-toggle')) {
      $('about-toggle').addEventListener('click', () => {
        $('about-section').classList.toggle('open');
        const body = $('about-body');
        if ($('about-section').classList.contains('open')) {
          show(body);
          populatePromptDocs();
          body.querySelectorAll('.reveal:not(.visible)').forEach(el => revealObserver.observe(el));
        } else {
          hide(body);
        }
      });
    }

    // Learn more link (only in full mode)
    if ($('learn-more-link')) {
      $('learn-more-link').addEventListener('click', (e) => {
        e.preventDefault();
        $('about-section').classList.add('open');
        show($('about-body'));
        populatePromptDocs();
        $('about-section').scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Search button (only in full mode — fast mode wires its own)
    if ($('search-btn')) $('search-btn').addEventListener('click', handleSearch);

    // Manual entry (only in full mode)
    if ($('manual-btn')) $('manual-btn').addEventListener('click', handleManualEntry);

    // Curate actions
    $('select-all-btn').addEventListener('click', () => { state.allFoundPapers.forEach(p => state.selectedPMIDs.add(p.pmid)); renderCurateList(); });
    $('select-none-btn').addEventListener('click', () => { state.selectedPMIDs.clear(); renderCurateList(); });
    $('synthesize-btn').addEventListener('click', handleSynthesize);
    $('back-to-search').addEventListener('click', () => {
      hide($('curate-view'));
      if (fastMode) {
        show($('fast-hero'));
        window.dispatchEvent(new CustomEvent('tables-turned-reset'));
      } else {
        show($('landing-wrap'));
      }
    });

    // Export
    $('dl-docx').addEventListener('click', () => { if (state.briefMarkdown) downloadDocx(state.briefMarkdown); });
    $('dl-brief').addEventListener('click', () => { if (state.briefMarkdown) TabletPress.exportBrief(state.briefMarkdown); });
    $('dl-tablet').addEventListener('click', exportTablet);

    // New question
    $('again-btn').addEventListener('click', resetToStart);

    // Listen for fast-mode search trigger
    window.addEventListener('tables-turned-search', () => { handleSearch(); });
  }

  // ═══════════════════════════════════════════════════════════
  //  POPULATE PROMPT DOCS
  // ═══════════════════════════════════════════════════════════

  function populatePromptDocs() {
    const searchEl = $('doc-prompt-search');
    const summaryEl = $('doc-prompt-summary');
    const synthEl = $('doc-prompt-synth');
    if (searchEl && !searchEl.textContent) searchEl.textContent = Synthesis.SEARCH_SYSTEM;
    if (summaryEl && !summaryEl.textContent) summaryEl.textContent = Synthesis.SUMMARY_SYSTEM;
    if (synthEl && !synthEl.textContent) synthEl.textContent = Synthesis.SYNTH_SYSTEM;
  }

  // ═══════════════════════════════════════════════════════════
  //  STEP 1: AI-POWERED PUBMED SEARCH
  // ═══════════════════════════════════════════════════════════

  async function handleSearch() {
    const question = ($('q').value || '').trim();
    const context = ($('ctx').value || '').trim();
    const statusEl = $('search-status');
    const depth = parseInt(($('s-depth') ? $('s-depth').value : '10'), 10);
    const sort = ($('s-sort') ? $('s-sort').value : 'relevance');

    if (!question) { statusEl.textContent = 'Ask a question first.'; statusEl.className = 'error'; return; }

    state.question = question;
    state.context = context;

    if ($('search-btn')) $('search-btn').disabled = true;
    statusEl.textContent = '';
    statusEl.className = '';

    // Show progress indicator
    const progEl = $('search-progress');
    show(progEl);
    setPhase(1);
    if (!fastMode) startEduScaffold();

    logProv('search_started', question);

    try {
      // Phase 1: Translate question into search queries
      const queries = await Synthesis.generateSearchQueries({ question, context });
      state.searchQueries = queries;
      logProv('search_queries_generated', queries.map(q => q.query).join(' | '));

      setPhase(2);
      $('prog-phase-2').querySelector('.progress-detail').textContent =
        `${queries.length} strategies across 37 million papers`;

      // Phase 2: Execute each query against PubMed
      // Track scoring: papers found by multiple strategies rank higher,
      // plus positional weight from PubMed's relevance ordering.
      const paperScores = {}; // pmid -> { overlap: N, positionPts: N, strategies: [] }
      const allPapers = [];
      const RATE_MS = 350;
      const MAX_PAPERS = 12;

      for (let i = 0; i < queries.length; i++) {
        $('prog-phase-2').querySelector('.progress-detail').textContent =
          `Strategy ${i + 1} of ${queries.length}: ${queries[i].strategy}`;
        try {
          const result = await Synthesis.searchPubMed(queries[i].query, depth, sort);
          logProv('pubmed_searched', `"${queries[i].query}" -> ${result.count} total, fetched ${result.pmids.length}`);

          // Score each PMID by position and overlap
          for (let pos = 0; pos < result.pmids.length; pos++) {
            const pmid = result.pmids[pos];
            if (!paperScores[pmid]) {
              paperScores[pmid] = { overlap: 0, positionPts: 0, strategies: [] };
            }
            paperScores[pmid].overlap += 1;
            // Position weight: top 5 get 5/4/3/2/1 pts, rest get 1
            paperScores[pmid].positionPts += Math.max(1, 6 - Math.min(pos + 1, 5));
            paperScores[pmid].strategies.push(queries[i].strategy);
          }

          // Fetch any new papers
          const allPMIDs = new Set(allPapers.map(p => p.pmid));
          const newPMIDs = result.pmids.filter(id => !allPMIDs.has(id));

          if (newPMIDs.length > 0) {
            await sleep(RATE_MS);
            setPhase(3);
            $('prog-phase-3').querySelector('.progress-detail').textContent =
              `${allPapers.length + newPMIDs.length} papers so far`;
            const papers = await Shoreline.ingest(newPMIDs.join('\n'));
            for (const p of papers.papers) {
              if (!allPapers.find(x => x.pmid === p.pmid)) {
                allPapers.push(p);
              }
            }
            // Back to searching if more queries remain
            if (i < queries.length - 1) setPhase(2);
          }
          await sleep(RATE_MS);
        } catch (e) {
          console.error('Search query failed:', e);
          logProv('search_query_failed', queries[i].query + ': ' + e.message);
        }
      }

      if (allPapers.length === 0) {
        hide(progEl);
        stopEduScaffold();
        statusEl.textContent = 'No papers found. Try rephrasing your question.';
        statusEl.className = 'error';
        $('search-btn').disabled = false;
        return;
      }

      // Rank papers by composite score (overlap * 3 + position points)
      // Papers found by multiple strategies are strongly favored.
      for (const p of allPapers) {
        const s = paperScores[p.pmid] || { overlap: 1, positionPts: 1, strategies: [] };
        p._score = (s.overlap * 3) + s.positionPts;
        p._overlap = s.overlap;
        p._strategies = s.strategies;
      }
      allPapers.sort((a, b) => b._score - a._score);

      const cappedPapers = allPapers.slice(0, MAX_PAPERS);
      const topScore = cappedPapers[0]?._score || 0;
      const bottomScore = cappedPapers[cappedPapers.length - 1]?._score || 0;
      logProv('papers_ranked', `${allPapers.length} papers scored. Top ${cappedPapers.length} selected (scores ${topScore}-${bottomScore}). Method: cross-strategy overlap (x3) + PubMed position weight.`);

      // Phase 4: Generate plain-language summaries
      setPhase(4);
      $('prog-phase-4').querySelector('.progress-detail').textContent =
        `Translating ${cappedPapers.length} papers`;
      let summaries = [];
      try {
        summaries = await Synthesis.generatePlainSummaries({ papers: cappedPapers, question });
        logProv('plain_summaries_generated', summaries.length + ' papers translated');
      } catch (e) {
        console.error('Plain summary generation failed:', e);
        logProv('plain_summaries_failed', e.message);
        summaries = cappedPapers.map(() => ({ plain_title: '', plain_summary: '' }));
      }

      hide(progEl);
      stopEduScaffold();

      // Store and move to curate
      state.allFoundPapers = cappedPapers;
      state.plainSummaries = summaries;
      state.selectedPMIDs = new Set(cappedPapers.map(p => p.pmid));

      // Populate search prompt display
      const searchPromptEl = $('search-prompt-display');
      if (searchPromptEl) {
        searchPromptEl.textContent = Synthesis.SEARCH_SYSTEM + '\n\n---\n\nUser message:\nQuestion: ' + question + (context ? '\nDecision context: ' + context : '') + '\n\nGenerate PubMed search queries for this question.';
      }

      // Populate search evolution
      const evoQ = $('evolution-question');
      if (evoQ) evoQ.textContent = '"' + question + '"' + (context ? ' \u2014 ' + context : '');
      displaySearchTerms(queries);
      const multiHits = cappedPapers.filter(p => p._overlap > 1).length;
      let statsText = `PubMed returned ${allPapers.length} papers across ${queries.length} strategies. Showing the top ${cappedPapers.length}, ranked by cross-strategy overlap and PubMed relevance.`;
      if (multiHits > 0) statsText += ` ${multiHits} papers appeared in multiple search strategies.`;
      $('search-stats').textContent = statsText;
      renderCurateList();

      if (fastMode) {
        hide($('fast-hero'));
      } else {
        hide($('landing-wrap'));
      }
      show($('curate-view'));
      window.scrollTo(0, 0);

    } catch (err) {
      hide(progEl);
      stopEduScaffold();
      statusEl.textContent = err.message;
      statusEl.className = 'error';
    } finally {
      if ($('search-btn')) $('search-btn').disabled = false;
      if (fastMode) window.dispatchEvent(new CustomEvent('tables-turned-reset'));
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  MANUAL ENTRY (skip AI search)
  // ═══════════════════════════════════════════════════════════

  async function handleManualEntry() {
    const linksText = ($('links').value || '').trim();
    const question = ($('q').value || '').trim();
    const context = ($('ctx').value || '').trim();
    const statusEl = $('search-status');

    if (!question) { statusEl.textContent = 'Ask a question first.'; statusEl.className = 'error'; return; }
    if (!linksText) { statusEl.textContent = 'Paste at least one PubMed link.'; statusEl.className = 'error'; return; }
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

      // Generate plain-language summaries
      statusEl.textContent = `Translating ${result.papers.length} papers into plain language...`;
      let summaries = [];
      try {
        summaries = await Synthesis.generatePlainSummaries({ papers: result.papers, question });
      } catch (e) {
        summaries = result.papers.map(() => ({ plain_title: '', plain_summary: '' }));
      }

      state.allFoundPapers = result.papers;
      state.plainSummaries = summaries;
      state.selectedPMIDs = new Set(result.papers.map(p => p.pmid));
      state.searchQueries = [{ query: '(user-provided links)', strategy: 'Direct entry' }];

      const evoQ = $('evolution-question');
      if (evoQ) evoQ.textContent = '"' + question + '"' + (context ? ' \u2014 ' + context : '');
      displaySearchTerms(state.searchQueries);
      $('search-stats').textContent = `${result.papers.length} papers from direct entry.`;
      renderCurateList();

      if (fastMode) {
        hide($('fast-hero'));
      } else {
        hide($('landing-wrap'));
      }
      show($('curate-view'));
      window.scrollTo(0, 0);

    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'error';
    } finally {
      if ($('manual-btn')) $('manual-btn').disabled = false;
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

    for (let i = 0; i < state.allFoundPapers.length; i++) {
      const p = state.allFoundPapers[i];
      const summary = state.plainSummaries[i] || {};
      const selected = state.selectedPMIDs.has(p.pmid);
      const card = document.createElement('div');
      card.className = 'curate-card' + (selected ? ' selected' : '');
      card.dataset.pmid = p.pmid;

      const firstAuthor = p.authors && p.authors.length ? p.authors[0].split(' ')[0] : '';
      const meta = [firstAuthor, p.journal, p.year].filter(Boolean).join(' \u00B7 ');
      const plainTitle = summary.plain_title || '';
      const plainSummary = summary.plain_summary || '';
      const abstractText = p.abstract || 'No abstract available.';

      // Card top: checkbox + info (clickable to toggle selection)
      const displayTitle = plainTitle || p.title;
      const overlapBadge = p._overlap > 1
        ? `<span class="curate-overlap" title="Found in ${p._overlap} of ${state.searchQueries.length} search strategies">${p._overlap}/${state.searchQueries.length} strategies</span>`
        : '';
      const topHtml = `
        <div class="curate-card-top" data-action="toggle">
          <div class="curate-check">${selected ? '\u2713' : ''}</div>
          <div class="curate-info">
            <div class="curate-plain-title">${escapeHtml(displayTitle)}${overlapBadge}</div>
            ${plainSummary ? `<div class="curate-plain-summary">${escapeHtml(plainSummary)}</div>` : ''}
            ${plainTitle ? `<div class="curate-technical-title">${escapeHtml(p.title)}</div>` : ''}
            <div class="curate-meta">${escapeHtml(meta)}</div>
            <div class="curate-pmid"><a href="https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/" target="_blank" rel="noopener">PMID: ${p.pmid}</a></div>
          </div>
        </div>`;

      // Expand button
      const expandBtnHtml = `<button class="curate-expand-btn" data-action="expand">Show full abstract \u25BE</button>`;

      // Expandable abstract
      const expandHtml = `
        <div class="curate-expand">
          <div class="curate-abstract-full">${escapeHtml(abstractText)}</div>
        </div>`;

      card.innerHTML = topHtml + expandBtnHtml + expandHtml;

      // Prevent PMID links from triggering card toggle
      const pmidLink = card.querySelector('.curate-pmid a');
      if (pmidLink) pmidLink.addEventListener('click', (e) => e.stopPropagation());

      // Toggle selection on card-top click
      card.querySelector('[data-action="toggle"]').addEventListener('click', () => {
        if (state.selectedPMIDs.has(p.pmid)) state.selectedPMIDs.delete(p.pmid);
        else state.selectedPMIDs.add(p.pmid);
        renderCurateList();
      });

      // Expand/collapse abstract
      card.querySelector('[data-action="expand"]').addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.toggle('expanded');
        const btn = card.querySelector('.curate-expand-btn');
        btn.textContent = card.classList.contains('expanded') ? 'Hide abstract \u25B4' : 'Show full abstract \u25BE';
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

    // Populate synthesis prompt display
    const userMsg = Synthesis.buildUserMessage(state.question, state.context, selected);
    state.synthUserMessage = userMsg;
    const synthPromptEl = $('synth-prompt-display');
    if (synthPromptEl) {
      synthPromptEl.textContent = 'SYSTEM PROMPT:\n' + Synthesis.SYNTH_SYSTEM + '\n\n---\n\nUSER MESSAGE:\n' + userMsg.substring(0, 3000) + (userMsg.length > 3000 ? '\n...(truncated for display)' : '');
    }
    // Also populate result prompt display
    const resultPromptEl = $('result-prompt-display');
    if (resultPromptEl) {
      resultPromptEl.textContent = synthPromptEl.textContent;
    }

    procStatus.textContent = selected.length + ' papers selected. Reading them now...';
    await sleep(600);

    streamOut.classList.add('visible');
    const streamNotice = $('stream-notice');
    if (streamNotice) streamNotice.classList.add('visible');
    procStatus.textContent = 'Generating your brief with Claude Opus...';

    try {
      await Synthesis.generate({
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
          if (streamNotice) streamNotice.classList.remove('visible');

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
          if (streamNotice) streamNotice.classList.remove('visible');
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
        .replace(/\[PMID:\s*(\d+)\]/g, '<a href="https://pubmed.ncbi.nlm.nih.gov/$1/" target="_blank" rel="noopener" class="pmid">[PMID: $1]</a>')
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
      html += `<div class="prov-entry"><span class="prov-time">${time}</span> <span class="prov-action">${escapeHtml(entry.action)}</span>${entry.detail ? ': ' + escapeHtml(entry.detail).substring(0, 140) : ''}</div>`;
    }
    log.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════
  //  DOCX EXPORT
  // ═══════════════════════════════════════════════════════════

  function downloadDocx(markdown) {
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
  @page { margin: 0.6in 0.7in; }
  body { font-family: 'Crimson Pro', Georgia, serif; font-size: 10pt; line-height: 1.4; color: #1a1a1a; }
  h1 { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 14pt; color: #8B6914; font-weight: normal; margin-bottom: 6pt; border-bottom: 1px solid #d4c5a9; padding-bottom: 4pt; }
  h2 { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 11pt; color: #1a1a1a; font-weight: 600; margin-top: 10pt; margin-bottom: 4pt; border-bottom: 1px solid #e0d8c8; padding-bottom: 2pt; }
  h3 { font-size: 10pt; color: #666; font-weight: normal; margin-top: 8pt; margin-bottom: 3pt; }
  p { margin-bottom: 4pt; }
  hr { border: none; border-top: 1px solid #d4c5a9; margin: 8pt 0; }
  ul, ol { margin-bottom: 4pt; margin-left: 16pt; }
  li { margin-bottom: 2pt; }
  strong { color: #1a1a1a; }
  em { color: #666; }
  a.pmid { font-family: 'IBM Plex Mono', Courier New, monospace; font-size: 8pt; color: #8B6914; background: #FFF8E7; padding: 1px 3px; text-decoration: none; }
  .unwitnessed { font-family: Arial, sans-serif; font-size: 7pt; color: #8B0000; background: #FFF0F0; padding: 1px 4px; text-transform: uppercase; }
  .footer { font-size: 8pt; color: #999; font-style: italic; margin-top: 10pt; padding-top: 4pt; border-top: 1px solid #e0d8c8; }
</style>
</head>
<body>
${htmlContent}
<div class="footer">Generated by Tables Turned &middot; ${new Date().toLocaleDateString()} &middot; Receipts only. &middot; The Word Against The Flood</div>
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
        .replace(/\[PMID:\s*(\d+)\]/g, '<a href="https://pubmed.ncbi.nlm.nih.gov/$1/" class="pmid">[PMID: $1]</a>')
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
      allFoundPapers: state.allFoundPapers,
      selectedPMIDs: state.selectedPMIDs,
      searchQueries: state.searchQueries,
      plainSummaries: state.plainSummaries,
      synthUserMessage: state.synthUserMessage,
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
    if (fastMode) {
      const hero = $('fast-hero');
      if (hero) { hero.classList.remove('collapsed'); show(hero); }
    } else {
      show($('landing-wrap'));
    }
    state.papers = [];
    state.allFoundPapers = [];
    state.plainSummaries = [];
    state.selectedPMIDs = new Set();
    state.briefMarkdown = null;
    state.searchQueries = [];
    state.synthUserMessage = '';
    state.provenance = [];
    $('search-status').textContent = '';
    $('search-status').className = '';
    hide($('search-progress'));
    stopEduScaffold();
    const sn = $('stream-notice');
    if (sn) sn.classList.remove('visible');
    window.scrollTo(0, 0);
    if (fastMode) window.dispatchEvent(new CustomEvent('tables-turned-reset'));
  }

  // ── Boot ──
  document.addEventListener('DOMContentLoaded', () => {
    fastMode = !$('intro');
    if (!fastMode) {
      initIntro();
    } else {
      // Fast mode: no cinematic intro, go straight to app
      show($('app'));
      initApp();
    }
  });

  return { state };
})();
