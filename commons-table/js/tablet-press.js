/**
 * Tablet Press — Export Bundle Generator
 *
 * Produces three artifacts:
 * 1. Tablet.json   — The Seed Packet (schema-validated)
 * 2. Ledger.json   — Evidence table + provenance log
 * 3. Ledger.csv    — Evidence table as CSV
 * 4. Brief.md      — Markdown synthesis
 *
 * All generated in-browser. All downloadable. Nothing trapped.
 */

const TabletPress = (() => {

  /**
   * Generate a UUID v4.
   */
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Build the Tablet JSON object.
   */
  function buildTablet(opts) {
    const {
      title,
      sessionId,
      sessionCreated,
      intent,
      papers,
      allFoundPapers,
      selectedPMIDs,
      searchQueries,
      plainSummaries,
      claims,
      crossExam,
      provenance,
      nextSprint,
      briefMarkdown,
      synthUserMessage,
      status
    } = opts;

    function mapPaper(p, i) {
      const summary = plainSummaries && plainSummaries[i] ? plainSummaries[i] : {};
      return {
        pmid: p.pmid,
        doi: p.doi || null,
        title: p.title,
        authors: p.authors || [],
        journal: p.journal || null,
        year: p.year || null,
        abstract: p.abstract || null,
        plain_title: summary.plain_title || null,
        plain_summary: summary.plain_summary || null,
        selected: selectedPMIDs ? selectedPMIDs.has(p.pmid) : true,
        role: p.role || null,
        witness_line: p.witness_line || null,
        disposition: p.disposition || null,
        watch_outs: p.watch_outs || []
      };
    }

    return {
      version: '2.0',
      title: title || 'Untitled Table Flip',
      session: {
        id: sessionId || uuid(),
        created: sessionCreated || new Date().toISOString(),
        sealed: status === 'sealed' ? new Date().toISOString() : null,
        status: status || 'sealed',
        timebox_minutes: intent?.timebox || 30
      },
      intent: {
        decision_context: intent?.decision_context || '',
        useful_by: intent?.useful_by || '',
        question_draft: intent?.question_draft || ''
      },
      search: {
        queries: (searchQueries || []).map(q => ({
          query: q.query,
          strategy: q.strategy
        })),
        total_papers_found: allFoundPapers ? allFoundPapers.length : (papers || []).length,
        papers_shown: (papers || []).length
      },
      papers: (allFoundPapers || papers || []).map((p, i) => mapPaper(p, i)),
      prompts: {
        search_system: typeof Synthesis !== 'undefined' ? Synthesis.SEARCH_SYSTEM : null,
        summary_system: typeof Synthesis !== 'undefined' ? Synthesis.SUMMARY_SYSTEM : null,
        synthesis_system: typeof Synthesis !== 'undefined' ? Synthesis.SYNTH_SYSTEM : null,
        synthesis_user_message: synthUserMessage || null,
        model: typeof Synthesis !== 'undefined' ? Synthesis.MODEL : null
      },
      synthesis: {
        claims: (claims || []).map(c => ({
          text: c.text,
          receipts: c.receipts || [],
          status: c.status || 'unwitnessed'
        })),
        brief_markdown: briefMarkdown || null,
        cross_examination: {
          change_your_mind: crossExam?.change_your_mind || null,
          rival_explanation: crossExam?.rival_explanation || null,
          confidence: crossExam?.confidence || null,
          confidence_justification: crossExam?.confidence_justification || null
        }
      },
      provenance: provenance || [],
      next_sprint: nextSprint || []
    };
  }

  /**
   * Build the Ledger JSON object.
   * This is the evidence table: one row per paper with key fields.
   */
  function buildLedgerJSON(papers, provenance) {
    return {
      evidence_table: (papers || []).map(p => ({
        pmid: p.pmid,
        doi: p.doi || '',
        title: p.title,
        year: p.year || '',
        journal: p.journal || '',
        role: p.role || '',
        witness_line: p.witness_line || '',
        disposition: p.disposition || '',
        watch_outs: (p.watch_outs || []).join('; ')
      })),
      provenance: provenance || []
    };
  }

  /**
   * Build the Ledger CSV string.
   */
  function buildLedgerCSV(papers) {
    const headers = ['PMID', 'DOI', 'Title', 'Year', 'Journal', 'Role', 'Witness Line', 'Disposition', 'Watch-Outs'];
    const rows = [headers.join(',')];

    for (const p of (papers || [])) {
      const row = [
        csvEscape(p.pmid),
        csvEscape(p.doi || ''),
        csvEscape(p.title),
        csvEscape(String(p.year || '')),
        csvEscape(p.journal || ''),
        csvEscape(p.role || ''),
        csvEscape(p.witness_line || ''),
        csvEscape(p.disposition || ''),
        csvEscape((p.watch_outs || []).join('; '))
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  /**
   * Escape a value for CSV.
   */
  function csvEscape(value) {
    if (!value) return '""';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * Trigger a file download in the browser.
   */
  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Export Tablet.json
   */
  function exportTablet(opts) {
    const tablet = buildTablet(opts);
    const json = JSON.stringify(tablet, null, 2);
    downloadFile('Tablet.json', json, 'application/json');
    return tablet;
  }

  /**
   * Export Ledger.json
   */
  function exportLedgerJSON(papers, provenance) {
    const ledger = buildLedgerJSON(papers, provenance);
    const json = JSON.stringify(ledger, null, 2);
    downloadFile('Ledger.json', json, 'application/json');
  }

  /**
   * Export Ledger.csv
   */
  function exportLedgerCSV(papers) {
    const csv = buildLedgerCSV(papers);
    downloadFile('Ledger.csv', csv, 'text/csv');
  }

  /**
   * Export Brief.md
   */
  function exportBrief(markdown) {
    downloadFile('Brief.md', markdown, 'text/markdown');
  }

  /**
   * Export all three at once.
   */
  function exportAll(opts) {
    const tablet = exportTablet(opts);
    exportLedgerJSON(opts.papers, opts.provenance);
    exportLedgerCSV(opts.papers);
    if (opts.briefMarkdown) {
      exportBrief(opts.briefMarkdown);
    }
    return tablet;
  }

  /**
   * Import a Tablet.json and return the parsed object.
   */
  function importTablet(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const tablet = JSON.parse(e.target.result);
          if (tablet.version !== '1.0') {
            reject(new Error(`Unknown Tablet version: ${tablet.version}`));
            return;
          }
          resolve(tablet);
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsText(file);
    });
  }

  return {
    uuid,
    buildTablet,
    buildLedgerJSON,
    buildLedgerCSV,
    exportTablet,
    exportLedgerJSON,
    exportLedgerCSV,
    exportBrief,
    exportAll,
    importTablet
  };
})();
