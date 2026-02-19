/**
 * Scribe — Brief Generation Module
 *
 * Generates a plain-language markdown Brief from session data.
 *
 * Writing standards (from the Seed):
 * - Intelligible to regular people.
 * - Jargon is translated, not celebrated.
 * - Short sentences.
 * - No corporate product language.
 * - No em dashes.
 * - Always separate what the papers say from what we infer.
 */

const Scribe = (() => {

  /**
   * Generate the Brief markdown from session data.
   *
   * @param {Object} opts
   * @param {string} opts.title - Session title
   * @param {Object} opts.intent - Intent object (question, context, deadline)
   * @param {Array}  opts.papers - Paper objects (with roles, witness lines, dispositions)
   * @param {Array}  opts.claims - Claim objects (with receipts and statuses)
   * @param {Object} opts.crossExam - Cross-examination state
   * @returns {string} Markdown text
   */
  function generateBrief(opts) {
    const { title, intent, papers, claims, crossExam } = opts;

    const keptPapers = papers.filter(p => p.disposition !== 'release');
    const lines = [];

    // Title
    lines.push(`# ${title || 'Untitled Table Flip'}`);
    lines.push('');

    // Question
    if (intent && intent.question_draft) {
      lines.push(`**Question:** ${intent.question_draft}`);
      lines.push('');
    }

    if (intent && intent.decision_context) {
      lines.push(`**Context:** ${intent.decision_context}`);
      lines.push('');
    }

    // Separator
    lines.push('---');
    lines.push('');

    // What the papers say
    lines.push('## What the papers say');
    lines.push('');

    const supporting = keptPapers.filter(p => p.role === 'supports');
    const contradicting = keptPapers.filter(p => p.role === 'contradicts');
    const background = keptPapers.filter(p => p.role === 'background');
    const methods = keptPapers.filter(p => p.role === 'method');
    const unsure = keptPapers.filter(p => p.role === 'unsure' || !p.role);

    if (supporting.length > 0) {
      lines.push('### Supporting evidence');
      lines.push('');
      for (const p of supporting) {
        lines.push(`- **${p.title}** (PMID: ${p.pmid}${p.year ? `, ${p.year}` : ''})`);
        if (p.witness_line) {
          lines.push(`  ${p.witness_line}`);
        }
        lines.push('');
      }
    }

    if (contradicting.length > 0) {
      lines.push('### Contradicting evidence');
      lines.push('');
      for (const p of contradicting) {
        lines.push(`- **${p.title}** (PMID: ${p.pmid}${p.year ? `, ${p.year}` : ''})`);
        if (p.witness_line) {
          lines.push(`  ${p.witness_line}`);
        }
        lines.push('');
      }
    }

    if (background.length > 0) {
      lines.push('### Background');
      lines.push('');
      for (const p of background) {
        lines.push(`- **${p.title}** (PMID: ${p.pmid}${p.year ? `, ${p.year}` : ''})`);
        if (p.witness_line) {
          lines.push(`  ${p.witness_line}`);
        }
        lines.push('');
      }
    }

    if (methods.length > 0) {
      lines.push('### Methods papers');
      lines.push('');
      for (const p of methods) {
        lines.push(`- **${p.title}** (PMID: ${p.pmid}${p.year ? `, ${p.year}` : ''})`);
        if (p.witness_line) {
          lines.push(`  ${p.witness_line}`);
        }
        lines.push('');
      }
    }

    if (unsure.length > 0) {
      lines.push('### Not yet classified');
      lines.push('');
      for (const p of unsure) {
        lines.push(`- **${p.title}** (PMID: ${p.pmid}${p.year ? `, ${p.year}` : ''})`);
        if (p.witness_line) {
          lines.push(`  ${p.witness_line}`);
        }
        lines.push('');
      }
    }

    // Claims with receipts
    if (claims && claims.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## What we infer (with receipts)');
      lines.push('');

      for (let i = 0; i < claims.length; i++) {
        const claim = claims[i];
        const receiptStr = claim.receipts.length > 0
          ? claim.receipts.map(r => `PMID: ${r}`).join(', ')
          : 'NO RECEIPTS';

        const statusTag = claim.status === 'unwitnessed'
          ? ' **[UNWITNESSED]**'
          : claim.status === 'contested'
            ? ' **[CONTESTED]**'
            : '';

        lines.push(`${i + 1}. ${claim.text} [${receiptStr}]${statusTag}`);
        lines.push('');
      }
    }

    // Cross-examination
    if (crossExam) {
      lines.push('---');
      lines.push('');
      lines.push('## Stress test');
      lines.push('');

      if (crossExam.change_your_mind) {
        lines.push(`**What would change your mind?** ${crossExam.change_your_mind}`);
        lines.push('');
      }

      if (crossExam.rival_explanation) {
        lines.push(`**Best rival explanation?** ${crossExam.rival_explanation}`);
        lines.push('');
      }

      if (crossExam.confidence) {
        const confLabel = crossExam.confidence.charAt(0).toUpperCase() + crossExam.confidence.slice(1);
        lines.push(`**Confidence:** ${confLabel}`);
        if (crossExam.confidence_justification) {
          lines.push(`${crossExam.confidence_justification}`);
        }
        lines.push('');
      }
    }

    // Watch-outs summary
    const papersWithWatchOuts = keptPapers.filter(p => p.watch_outs && p.watch_outs.length > 0);
    if (papersWithWatchOuts.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Watch-outs flagged');
      lines.push('');
      for (const p of papersWithWatchOuts) {
        const flags = p.watch_outs.map(w => w.replace(/_/g, ' ')).join(', ');
        lines.push(`- PMID: ${p.pmid}: ${flags}`);
      }
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push(`*Generated by Tables Turned. ${new Date().toISOString().split('T')[0]}. Receipts only.*`);

    return lines.join('\n');
  }

  /**
   * Render the Brief as styled HTML inside a container.
   */
  function renderBriefPreview(markdown, container) {
    // Simple markdown-to-HTML for preview purposes.
    // Handles: headings, bold, lists, horizontal rules, paragraphs.
    let html = markdown
      // Headings
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr>')
      // Bold
      .replace(/\*\*\[([A-Z]+)\]\*\*/g, '<strong class="receipt-tag">[$1]</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // PMID references
      .replace(/PMID: (\d+)/g, '<span class="receipt-tag">PMID: $1</span>')
      // List items
      .replace(/^(\d+)\. (.+)$/gm, '<p style="margin-left: 1em;">$1. $2</p>')
      .replace(/^- (.+)$/gm, '<p style="margin-left: 1em;">&bull; $1</p>')
      // Paragraphs (lines that are not already tagged)
      .replace(/^(?!<)(.+)$/gm, '<p>$1</p>')
      // Remove empty paragraphs
      .replace(/<p><\/p>/g, '');

    container.innerHTML = html;
  }

  return {
    generateBrief,
    renderBriefPreview
  };
})();
