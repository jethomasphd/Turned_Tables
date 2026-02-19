/**
 * App — Main Orchestrator
 *
 * Binds the six steps of the rite into one linear path.
 * Manages state, navigation, timebox, and session lifecycle.
 *
 * Session in -> Tablet out. Every time.
 */

const App = (() => {
  // ── Session State ──
  const session = {
    id: TabletPress.uuid(),
    created: new Date().toISOString(),
    status: 'in_progress',
    papers: [],
    claims: [],
    duplicates: [],
    provenance: [],
    briefMarkdown: null,
    currentStep: 0,
    timeboxStart: null,
    timeboxMinutes: 30
  };

  const STEP_COUNT = 6;

  // ── Provenance Logging ──
  function log(action, detail) {
    session.provenance.push({
      timestamp: new Date().toISOString(),
      action,
      detail: detail || null
    });
  }

  // ── Intent Helpers ──
  function getIntent() {
    return {
      question_draft: document.getElementById('intent-question')?.value || '',
      decision_context: document.getElementById('intent-context')?.value || '',
      useful_by: document.getElementById('intent-deadline')?.value || '',
      timebox: parseInt(document.getElementById('intent-timebox')?.value, 10) || 30
    };
  }

  function getTitle() {
    const q = document.getElementById('intent-question')?.value;
    return q ? q.substring(0, 100) : 'Untitled Table Flip';
  }

  // ── Navigation ──
  function goToStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= STEP_COUNT) return;

    // Hide all steps
    document.querySelectorAll('.rite-step').forEach(el => el.classList.remove('active'));

    // Show target step
    const target = document.getElementById(`step-${stepIndex}`);
    if (target) target.classList.add('active');

    // Update nav indicators
    document.querySelectorAll('.rite-step-indicator').forEach(el => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.remove('active', 'completed', 'clickable');
      if (s === stepIndex) {
        el.classList.add('active');
      } else if (s < stepIndex) {
        el.classList.add('completed', 'clickable');
      }
    });

    session.currentStep = stepIndex;
    window.scrollTo(0, 0);
  }

  // ── Timebox ──
  function startTimebox() {
    session.timeboxMinutes = parseInt(document.getElementById('intent-timebox')?.value, 10) || 30;
    session.timeboxStart = Date.now();

    const fill = document.getElementById('timebox-fill');
    if (!fill) return;

    function update() {
      if (!session.timeboxStart) return;
      const elapsed = (Date.now() - session.timeboxStart) / 1000 / 60;
      const pct = Math.min((elapsed / session.timeboxMinutes) * 100, 100);
      fill.style.width = `${pct}%`;

      if (pct >= 100) {
        fill.style.background = 'var(--role-contradicts)';
      } else if (pct >= 75) {
        fill.style.background = 'var(--accent-warm)';
      }

      if (pct < 100) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  // ── Step 1: Ingest ──
  async function handleIngest() {
    const input = document.getElementById('links-input');
    const status = document.getElementById('ingest-status');
    const btn = document.getElementById('ingest-btn');

    if (!input || !input.value.trim()) {
      status.textContent = 'Paste at least one PubMed link, PMID, or DOI.';
      status.className = 'error';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-indicator"></span>Fetching from PubMed...';
    status.textContent = '';
    status.className = '';

    try {
      const result = await Shoreline.ingest(input.value, (msg) => {
        status.textContent = msg;
      });

      session.papers = result.papers;
      session.duplicates = result.duplicates;

      // Log
      log('session_created', `Timebox: ${session.timeboxMinutes} minutes`);
      log('papers_ingested', `${result.papers.length} papers ingested. ${result.duplicates.length} duplicates. ${result.errors.length} parse errors. ${result.failedDOIs.length} unresolved DOIs. ${result.failedPMIDs.length} failed PMIDs.`);

      // Status messages
      const messages = [];
      if (result.papers.length > 0) {
        messages.push(`${result.papers.length} paper(s) ingested.`);
      }
      if (result.duplicates.length > 0) {
        messages.push(`${result.duplicates.length} duplicate(s) removed.`);
      }
      if (result.failedDOIs.length > 0) {
        messages.push(`${result.failedDOIs.length} DOI(s) could not be resolved.`);
      }
      if (result.failedPMIDs.length > 0) {
        messages.push(`${result.failedPMIDs.length} PMID(s) could not be fetched.`);
      }
      if (result.errors.length > 0) {
        messages.push(`${result.errors.length} line(s) not recognized.`);
      }

      status.textContent = messages.join(' ');

      if (result.papers.length > 0) {
        // Start timebox and advance
        startTimebox();

        // Render scroll cards
        const scrollContainer = document.getElementById('scroll-cards');
        Scrolls.renderScrollCards(session.papers, scrollContainer, session.duplicates);

        const paperCount = document.getElementById('paper-count');
        if (paperCount) paperCount.textContent = `${session.papers.length} scrolls laid.`;

        goToStep(1);
      } else {
        status.className = 'error';
        if (messages.length === 0) {
          status.textContent = 'No papers found. Check your identifiers.';
        }
      }
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'error';
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Lay the Scrolls &rarr;';
    }
  }

  // ── Step 2 -> 3: Roles ──
  function handleToRoles() {
    Scrolls.renderRoleCards(session.papers, document.getElementById('role-cards'));
    log('scrolls_reviewed', `${session.papers.length} papers displayed.`);
    goToStep(2);
  }

  // ── Step 3 -> 4: Witness ──
  function handleToWitness() {
    // Count roles assigned
    const roled = session.papers.filter(p => p.role).length;
    log('roles_assigned', `${roled} of ${session.papers.length} papers assigned roles.`);

    Scrolls.renderWitnessCards(session.papers, document.getElementById('witness-cards'));
    goToStep(3);
  }

  // ── Step 4 -> 5: Cross-Examine ──
  function handleToCrossExamine() {
    const witnessed = session.papers.filter(p => p.witness_line).length;
    log('witness_complete', `${witnessed} papers witnessed.`);

    // Initialize claims if empty
    if (session.claims.length === 0) {
      session.claims.push(Receipts.createClaim());
    }

    // Render claims editor
    Receipts.renderClaimsEditor(
      session.claims,
      session.papers,
      document.getElementById('claims-list'),
      () => {
        // Re-render on change
        Receipts.renderClaimsEditor(
          session.claims,
          session.papers,
          document.getElementById('claims-list'),
          null
        );
      }
    );

    // Init cross-examine widgets
    CrossExamine.init();

    goToStep(4);
  }

  // ── Generate Brief ──
  function handleGenerateBrief() {
    const crossExam = CrossExamine.getState();

    session.briefMarkdown = Scribe.generateBrief({
      title: getTitle(),
      intent: getIntent(),
      papers: session.papers,
      claims: session.claims,
      crossExam
    });

    const preview = document.getElementById('brief-preview');
    const output = document.getElementById('brief-output');
    if (preview && output) {
      preview.style.display = 'block';
      Scribe.renderBriefPreview(session.briefMarkdown, output);
    }

    log('synthesis_generated', `${session.claims.length} claims. ${session.claims.filter(c => c.status === 'witnessed').length} witnessed.`);
  }

  // ── Step 5 -> 6: Seal ──
  function handleToSeal() {
    const crossExam = CrossExamine.getState();
    log('cross_examination_complete', `Confidence: ${crossExam.confidence || 'not set'}`);

    // Generate brief if not yet generated
    if (!session.briefMarkdown) {
      handleGenerateBrief();
    }

    goToStep(5);
  }

  // ── Exports ──
  function getExportOpts() {
    const crossExam = CrossExamine.getState();
    const nextSprintText = document.getElementById('next-sprint-input')?.value || '';
    const nextSprint = nextSprintText.split('\n').map(l => l.trim()).filter(l => l);

    return {
      title: getTitle(),
      sessionId: session.id,
      sessionCreated: session.created,
      intent: getIntent(),
      papers: session.papers,
      claims: session.claims,
      crossExam,
      provenance: session.provenance,
      nextSprint,
      briefMarkdown: session.briefMarkdown,
      status: 'sealed'
    };
  }

  function handleExportAll() {
    const opts = getExportOpts();
    TabletPress.exportAll(opts);
    log('tablet_sealed', 'Exported: Tablet.json, Ledger.json, Ledger.csv, Brief.md');
  }

  function handleExportTablet() {
    TabletPress.exportTablet(getExportOpts());
  }

  function handleExportLedgerJSON() {
    TabletPress.exportLedgerJSON(session.papers, session.provenance);
  }

  function handleExportLedgerCSV() {
    TabletPress.exportLedgerCSV(session.papers);
  }

  function handleExportBrief() {
    if (session.briefMarkdown) {
      TabletPress.exportBrief(session.briefMarkdown);
    }
  }

  // ── Import Tablet ──
  async function handleImportTablet(file) {
    try {
      const tablet = await TabletPress.importTablet(file);

      // Restore session state
      session.id = tablet.session?.id || TabletPress.uuid();
      session.created = tablet.session?.created || new Date().toISOString();
      session.papers = tablet.papers || [];
      session.claims = tablet.synthesis?.claims || [];
      session.provenance = tablet.provenance || [];
      session.briefMarkdown = tablet.synthesis?.brief_markdown || null;

      // Restore intent fields
      if (tablet.intent) {
        const q = document.getElementById('intent-question');
        const c = document.getElementById('intent-context');
        const d = document.getElementById('intent-deadline');
        if (q) q.value = tablet.intent.question_draft || '';
        if (c) c.value = tablet.intent.decision_context || '';
        if (d) d.value = tablet.intent.useful_by || '';
      }

      // Restore cross-examination
      if (tablet.synthesis?.cross_examination) {
        CrossExamine.setState(tablet.synthesis.cross_examination);
      }

      // Restore next sprint
      if (tablet.next_sprint && tablet.next_sprint.length > 0) {
        const ns = document.getElementById('next-sprint-input');
        if (ns) ns.value = tablet.next_sprint.join('\n');
      }

      log('tablet_imported', `Restored ${session.papers.length} papers, ${session.claims.length} claims.`);

      // Render and go to last meaningful step
      if (session.papers.length > 0) {
        startTimebox();

        Scrolls.renderScrollCards(session.papers, document.getElementById('scroll-cards'), []);
        const paperCount = document.getElementById('paper-count');
        if (paperCount) paperCount.textContent = `${session.papers.length} scrolls laid.`;

        // Determine which step to resume at
        const hasRoles = session.papers.some(p => p.role);
        const hasWitness = session.papers.some(p => p.witness_line);
        const hasClaims = session.claims.some(c => c.text);

        if (hasClaims) {
          // Go to cross-examine
          Scrolls.renderRoleCards(session.papers, document.getElementById('role-cards'));
          Scrolls.renderWitnessCards(session.papers, document.getElementById('witness-cards'));
          Receipts.renderClaimsEditor(session.claims, session.papers, document.getElementById('claims-list'), null);
          CrossExamine.init();
          if (session.briefMarkdown) {
            const preview = document.getElementById('brief-preview');
            const output = document.getElementById('brief-output');
            if (preview && output) {
              preview.style.display = 'block';
              Scribe.renderBriefPreview(session.briefMarkdown, output);
            }
          }
          goToStep(4);
        } else if (hasWitness) {
          Scrolls.renderRoleCards(session.papers, document.getElementById('role-cards'));
          Scrolls.renderWitnessCards(session.papers, document.getElementById('witness-cards'));
          goToStep(3);
        } else if (hasRoles) {
          Scrolls.renderRoleCards(session.papers, document.getElementById('role-cards'));
          goToStep(2);
        } else {
          goToStep(1);
        }
      }
    } catch (err) {
      const status = document.getElementById('ingest-status');
      if (status) {
        status.textContent = `Import failed: ${err.message}`;
        status.className = 'error';
      }
    }
  }

  // ── Initialize ──
  function init() {
    // Forward buttons
    document.getElementById('ingest-btn')?.addEventListener('click', handleIngest);
    document.getElementById('to-roles-btn')?.addEventListener('click', handleToRoles);
    document.getElementById('to-witness-btn')?.addEventListener('click', handleToWitness);
    document.getElementById('to-cross-btn')?.addEventListener('click', handleToCrossExamine);
    document.getElementById('generate-brief-btn')?.addEventListener('click', handleGenerateBrief);
    document.getElementById('to-seal-btn')?.addEventListener('click', handleToSeal);

    // Add claim button
    document.getElementById('add-claim-btn')?.addEventListener('click', () => {
      session.claims.push(Receipts.createClaim());
      Receipts.renderClaimsEditor(
        session.claims,
        session.papers,
        document.getElementById('claims-list'),
        null
      );
    });

    // Export buttons
    document.getElementById('export-all-btn')?.addEventListener('click', handleExportAll);
    document.getElementById('export-tablet-btn')?.addEventListener('click', handleExportTablet);
    document.getElementById('export-ledger-json-btn')?.addEventListener('click', handleExportLedgerJSON);
    document.getElementById('export-ledger-csv-btn')?.addEventListener('click', handleExportLedgerCSV);
    document.getElementById('export-brief-btn')?.addEventListener('click', handleExportBrief);

    // Import
    document.getElementById('import-tablet')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImportTablet(file);
    });

    // Back buttons
    document.querySelectorAll('.btn-back').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = parseInt(btn.dataset.to, 10);
        goToStep(target);
      });
    });

    // Nav indicator clicks (only completed steps)
    document.querySelectorAll('.rite-step-indicator').forEach(el => {
      el.addEventListener('click', () => {
        if (el.classList.contains('clickable')) {
          const step = parseInt(el.dataset.step, 10);
          goToStep(step);
        }
      });
    });

    // Hide intent block after first step
    const intentBlock = document.getElementById('intent-block');
    // Intent block stays visible on step 0; we can collapse it later if needed.

    log('session_initialized', `Session ID: ${session.id}`);
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  return {
    session,
    goToStep
  };
})();
