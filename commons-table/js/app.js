/**
 * App — Tables Turned
 *
 * Cinematic intro -> Simple input -> AI synthesis -> Receipted brief.
 *
 * User journey: Confusion -> Awe -> Understanding -> Action
 *
 * Session in -> Brief out. Every time.
 */

const App = (() => {
  // ── State ──
  const state = {
    papers: [],
    briefMarkdown: null,
    provenance: []
  };

  const KEY_STORE = 'tt_api_key';
  const MODEL_STORE = 'tt_model';

  // ── Utilities ──
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  // ═══════════════════════════════════════════════════════════
  //  CINEMATIC INTRO
  //  Four acts: Void -> Wound -> Turn -> Enter
  //  Maps to: Confusion -> Awe -> Understanding -> Action
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
    { id: 't2', text: 'You bring the articles. You ask the question.' },
    { id: 't3', text: 'It returns a plain-language brief' },
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
      if (introSkipped) {
        el.textContent = text;
        el.classList.remove('typing');
        return;
      }
      el.textContent += text[i];
      await sleep(35 + Math.random() * 25);
    }
    el.classList.remove('typing');
  }

  async function playLines(lines) {
    for (const line of lines) {
      if (introSkipped) {
        // Instantly show all remaining text
        for (const l of lines) {
          if (l.id) $(l.id).textContent = l.text;
        }
        return;
      }
      if (line.pause) {
        await sleep(line.pause);
        continue;
      }
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

    if (currentAct === 1) {
      introPlaying = true;
      showAct(2);
      await playLines(WOUND_LINES);
      introPlaying = false;
    } else if (currentAct === 2) {
      introPlaying = true;
      showAct(3);
      await playLines(TURN_LINES);
      introPlaying = false;
    } else if (currentAct === 3) {
      showAct(4);
    }
  }

  function enterApp() {
    introSkipped = true;
    const intro = $('intro');
    intro.style.opacity = '0';
    intro.style.transition = 'opacity 0.6s ease';
    setTimeout(() => {
      intro.style.display = 'none';
      show($('app'));
      initApp();
    }, 600);
  }

  function initIntro() {
    $('intro').addEventListener('click', (e) => {
      if (e.target.id === 'enter-btn') { enterApp(); return; }
      if (e.target.id === 'skip-intro') { enterApp(); return; }
      advanceIntro();
    });

    document.addEventListener('keydown', (e) => {
      if ($('intro').style.display === 'none') return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (currentAct === 4) enterApp();
        else advanceIntro();
      }
      if (e.key === 'Escape') enterApp();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  THE APP
  // ═══════════════════════════════════════════════════════════

  function initApp() {
    // Restore saved API key
    const savedKey = localStorage.getItem(KEY_STORE) || '';
    if (savedKey && $('key')) {
      $('key').value = savedKey;
    }
    if (savedKey && $('s-key')) {
      $('s-key').value = savedKey;
    }

    // Restore saved model
    const savedModel = localStorage.getItem(MODEL_STORE) || '';
    if (savedModel && $('s-model')) {
      $('s-model').value = savedModel;
    }

    // Settings sync
    if ($('s-key')) {
      $('s-key').addEventListener('change', (e) => {
        localStorage.setItem(KEY_STORE, e.target.value);
        if ($('key')) $('key').value = e.target.value;
      });
    }
    if ($('s-model')) {
      $('s-model').addEventListener('change', (e) => {
        localStorage.setItem(MODEL_STORE, e.target.value);
      });
    }

    // Main key field sync
    if ($('key')) {
      $('key').addEventListener('change', (e) => {
        localStorage.setItem(KEY_STORE, e.target.value);
        if ($('s-key')) $('s-key').value = e.target.value;
      });
    }

    // Flip button
    $('flip-btn').addEventListener('click', handleFlip);

    // Export: Brief
    $('dl-brief').addEventListener('click', () => {
      if (state.briefMarkdown) {
        TabletPress.exportBrief(state.briefMarkdown);
      }
    });

    // Export: Tablet
    $('dl-tablet').addEventListener('click', () => {
      TabletPress.exportTablet({
        title: ($('q').value || '').substring(0, 100) || 'Untitled Table Flip',
        sessionId: TabletPress.uuid(),
        sessionCreated: new Date().toISOString(),
        intent: {
          question_draft: $('q').value || '',
          decision_context: $('ctx').value || '',
          useful_by: '',
          timebox: 0
        },
        papers: state.papers,
        claims: [],
        crossExam: {},
        provenance: state.provenance,
        nextSprint: [],
        briefMarkdown: state.briefMarkdown,
        status: 'sealed'
      });
    });

    // New question
    $('again-btn').addEventListener('click', () => {
      hide($('results-view'));
      hide($('processing-view'));
      show($('input-view'));
      state.papers = [];
      state.briefMarkdown = null;
      $('flip-status').textContent = '';
      $('flip-status').className = '';
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  THE FLIP
  //  Fetch papers from PubMed -> Send to Claude -> Stream brief
  // ═══════════════════════════════════════════════════════════

  async function handleFlip() {
    const question = ($('q').value || '').trim();
    const context = ($('ctx').value || '').trim();
    const linksText = ($('links').value || '').trim();
    const apiKey = ($('key') ? $('key').value : '') || localStorage.getItem(KEY_STORE) || '';
    const model = ($('s-model') ? $('s-model').value : '') || localStorage.getItem(MODEL_STORE) || 'claude-sonnet-4-5-20250929';
    const statusEl = $('flip-status');

    // Validate
    if (!question) {
      statusEl.textContent = 'Ask a question first.';
      statusEl.className = 'error';
      return;
    }
    if (!linksText) {
      statusEl.textContent = 'Paste at least one PubMed link.';
      statusEl.className = 'error';
      return;
    }
    if (!apiKey) {
      statusEl.textContent = 'Enter your Anthropic API key.';
      statusEl.className = 'error';
      return;
    }

    // Save key and model
    localStorage.setItem(KEY_STORE, apiKey);
    localStorage.setItem(MODEL_STORE, model);

    // Disable button
    $('flip-btn').disabled = true;

    // Switch to processing view
    hide($('input-view'));
    show($('processing-view'));

    const procStatus = $('proc-status');
    const procPapers = $('proc-papers');
    const streamOut = $('stream-out');

    procStatus.textContent = 'Fetching from the public record...';
    procPapers.innerHTML = '';
    streamOut.textContent = '';
    streamOut.classList.remove('visible');

    // ── Phase 1: Fetch papers from PubMed ──
    try {
      const result = await Shoreline.ingest(linksText, (msg) => {
        procStatus.textContent = msg;
      });

      state.papers = result.papers;

      if (result.papers.length === 0) {
        procStatus.textContent = 'No papers found. Check your identifiers.';
        await sleep(2500);
        hide($('processing-view'));
        show($('input-view'));
        statusEl.textContent = 'No papers found. Check your links and try again.';
        statusEl.className = 'error';
        $('flip-btn').disabled = false;
        return;
      }

      // Show fetched papers
      for (const p of result.papers) {
        const div = document.createElement('div');
        div.className = 'paper-found';
        const shortTitle = p.title.length > 70
          ? p.title.substring(0, 70) + '...'
          : p.title;
        const firstAuthor = p.authors && p.authors.length
          ? p.authors[0].split(' ')[0]
          : '';
        div.textContent = `${shortTitle} ${firstAuthor ? '(' + firstAuthor + (p.year ? ', ' + p.year : '') + ')' : ''}`;
        procPapers.appendChild(div);
      }

      state.provenance.push({
        timestamp: new Date().toISOString(),
        action: 'papers_ingested',
        detail: result.papers.length + ' papers'
      });

    } catch (err) {
      procStatus.textContent = 'Failed to fetch papers: ' + err.message;
      await sleep(3000);
      hide($('processing-view'));
      show($('input-view'));
      $('flip-btn').disabled = false;
      return;
    }

    // ── Phase 2: Synthesize with Claude ──
    procStatus.textContent = state.papers.length + ' papers gathered. Reading them now...';
    await sleep(800);

    streamOut.classList.add('visible');
    procStatus.textContent = 'Generating your brief...';

    try {
      await Synthesis.generate({
        apiKey: apiKey,
        model: model,
        question: question,
        context: context,
        papers: state.papers,
        onChunk: function(chunk, full) {
          streamOut.textContent = full;
          streamOut.scrollTop = streamOut.scrollHeight;
        },
        onDone: function(fullText) {
          state.briefMarkdown = fullText;
          state.provenance.push({
            timestamp: new Date().toISOString(),
            action: 'synthesis_generated',
            detail: fullText.length + ' chars'
          });

          // Transition to results
          setTimeout(() => {
            hide($('processing-view'));
            show($('results-view'));
            renderBrief(fullText);
            $('flip-btn').disabled = false;
            window.scrollTo(0, 0);
          }, 500);
        },
        onError: function(err) {
          procStatus.textContent = 'Synthesis failed: ' + err.message;
          streamOut.classList.remove('visible');
          setTimeout(() => {
            hide($('processing-view'));
            show($('input-view'));
            statusEl.textContent = err.message;
            statusEl.className = 'error';
            $('flip-btn').disabled = false;
          }, 3000);
        }
      });
    } catch (err) {
      // Errors already handled by onError callback
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  BRIEF RENDERER
  //  Converts markdown to styled HTML
  // ═══════════════════════════════════════════════════════════

  function renderBrief(markdown) {
    const container = $('brief-out');
    const lines = markdown.split('\n');
    const html = [];
    let inUl = false;
    let inOl = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Headings
      if (line.startsWith('### ')) {
        closeList();
        html.push('<h3>' + inline(line.slice(4)) + '</h3>');
      } else if (line.startsWith('## ')) {
        closeList();
        html.push('<h2>' + inline(line.slice(3)) + '</h2>');
      } else if (line.startsWith('# ')) {
        closeList();
        html.push('<h1>' + inline(line.slice(2)) + '</h1>');
      }
      // Horizontal rules
      else if (/^---+\s*$/.test(line)) {
        closeList();
        html.push('<hr>');
      }
      // Unordered list
      else if (/^[-*]\s+/.test(line)) {
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (!inUl) { html.push('<ul>'); inUl = true; }
        html.push('<li>' + inline(line.replace(/^[-*]\s+/, '')) + '</li>');
      }
      // Ordered list
      else if (/^\d+\.\s+/.test(line)) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (!inOl) { html.push('<ol>'); inOl = true; }
        html.push('<li>' + inline(line.replace(/^\d+\.\s+/, '')) + '</li>');
      }
      // Empty line
      else if (line.trim() === '') {
        closeList();
      }
      // Paragraph
      else {
        closeList();
        html.push('<p>' + inline(line) + '</p>');
      }
    }
    closeList();

    function closeList() {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    }

    function inline(text) {
      return text
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // PMID references highlighted in gold
        .replace(/\[PMID:\s*(\d+)\]/g, '<span class="pmid">[PMID: $1]</span>')
        // Inline code
        .replace(/`(.+?)`/g, '<code>$1</code>');
    }

    container.innerHTML = html.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOT
  // ═══════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', initIntro);

  return { state };
})();
