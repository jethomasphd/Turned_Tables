/**
 * Scrolls — Paper Card Model & Rendering
 *
 * Renders clean paper cards for each step of the rite.
 * Step 2 (Lay the Scrolls): Display cards with metadata.
 * Step 3 (Mark the Roles): Display cards with role tags.
 * Step 4 (Witness): Display cards with witness input + disposition + watch-outs.
 */

const Scrolls = (() => {
  const ROLES = [
    { key: 'background',  label: 'Background' },
    { key: 'supports',    label: 'Supports' },
    { key: 'contradicts', label: 'Contradicts' },
    { key: 'method',      label: 'Method' },
    { key: 'unsure',      label: 'Unsure' }
  ];

  const DISPOSITIONS = [
    { key: 'keep',    label: 'Keep' },
    { key: 'release', label: 'Release' },
    { key: 'unsure',  label: 'Unsure' }
  ];

  const WATCH_OUTS = [
    { key: 'confounding',      label: 'Confounding' },
    { key: 'selection_bias',   label: 'Selection Bias' },
    { key: 'measurement',      label: 'Measurement' },
    { key: 'small_sample',     label: 'Small Sample' },
    { key: 'no_control',       label: 'No Control' },
    { key: 'self_report',      label: 'Self-Report' },
    { key: 'short_followup',   label: 'Short Follow-up' },
    { key: 'funding_conflict', label: 'Funding Conflict' },
    { key: 'other',            label: 'Other' }
  ];

  /**
   * Format author list for display.
   */
  function formatAuthors(authors) {
    if (!authors || authors.length === 0) return 'Unknown authors';
    if (authors.length <= 3) return authors.join(', ');
    return `${authors[0]}, ${authors[1]}, ... ${authors[authors.length - 1]}`;
  }

  /**
   * Build the PubMed link for a PMID.
   */
  function pubmedLink(pmid) {
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  }

  /**
   * Render Step 2: Lay the Scrolls (display only).
   */
  function renderScrollCards(papers, container, duplicates) {
    container.innerHTML = '';
    const dupSet = new Set(duplicates || []);

    for (const paper of papers) {
      const card = document.createElement('div');
      card.className = 'scroll-card';
      card.dataset.pmid = paper.pmid;

      const isDup = dupSet.has(paper.pmid);

      card.innerHTML = `
        <div class="card-title">
          ${escapeHtml(paper.title)}
          ${isDup ? '<span class="duplicate-badge">Duplicate</span>' : ''}
        </div>
        <div class="card-meta">
          ${escapeHtml(formatAuthors(paper.authors))}
          ${paper.journal ? ` &middot; ${escapeHtml(paper.journal)}` : ''}
          ${paper.year ? ` &middot; ${paper.year}` : ''}
          &middot; <a href="${pubmedLink(paper.pmid)}" target="_blank" rel="noopener" class="pmid-link">PMID: ${paper.pmid}</a>
          ${paper.doi ? ` &middot; DOI: ${escapeHtml(paper.doi)}` : ''}
        </div>
        ${paper.abstract ? `
          <div class="card-abstract collapsed" data-pmid="${paper.pmid}">
            ${escapeHtml(paper.abstract)}
          </div>
          <button class="toggle-abstract" data-pmid="${paper.pmid}">Show full abstract</button>
        ` : '<div class="card-abstract" style="color: var(--text-muted); font-style: italic;">No abstract available.</div>'}
      `;

      container.appendChild(card);
    }

    // Toggle abstract handlers
    container.querySelectorAll('.toggle-abstract').forEach(btn => {
      btn.addEventListener('click', () => {
        const pmid = btn.dataset.pmid;
        const abstractDiv = container.querySelector(`.card-abstract[data-pmid="${pmid}"]`);
        if (abstractDiv.classList.contains('collapsed')) {
          abstractDiv.classList.remove('collapsed');
          btn.textContent = 'Collapse abstract';
        } else {
          abstractDiv.classList.add('collapsed');
          btn.textContent = 'Show full abstract';
        }
      });
    });
  }

  /**
   * Render Step 3: Mark the Roles.
   */
  function renderRoleCards(papers, container) {
    container.innerHTML = '';

    for (const paper of papers) {
      const card = document.createElement('div');
      card.className = 'scroll-card';
      card.dataset.pmid = paper.pmid;

      const roleTagsHtml = ROLES.map(r =>
        `<button class="role-tag ${paper.role === r.key ? 'selected' : ''}" data-role="${r.key}" data-pmid="${paper.pmid}">${r.label}</button>`
      ).join('');

      card.innerHTML = `
        <div class="card-title">${escapeHtml(paper.title)}</div>
        <div class="card-meta">
          ${paper.year || ''} &middot; <a href="${pubmedLink(paper.pmid)}" target="_blank" rel="noopener" class="pmid-link">PMID: ${paper.pmid}</a>
        </div>
        <div class="role-tags">${roleTagsHtml}</div>
      `;

      container.appendChild(card);
    }

    // Role tag handlers
    container.querySelectorAll('.role-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const pmid = btn.dataset.pmid;
        const role = btn.dataset.role;

        // Find the paper and update its role
        const paper = papers.find(p => p.pmid === pmid);
        if (paper) {
          paper.role = (paper.role === role) ? null : role;
        }

        // Update UI: deselect siblings, toggle this one
        const siblings = container.querySelectorAll(`.role-tag[data-pmid="${pmid}"]`);
        siblings.forEach(s => s.classList.remove('selected'));
        if (paper && paper.role === role) {
          btn.classList.add('selected');
        }
      });
    });
  }

  /**
   * Render Step 4: Witness.
   */
  function renderWitnessCards(papers, container) {
    container.innerHTML = '';

    for (const paper of papers) {
      const card = document.createElement('div');
      card.className = 'scroll-card';
      card.dataset.pmid = paper.pmid;

      const roleLabel = paper.role
        ? ROLES.find(r => r.key === paper.role)?.label || paper.role
        : 'No role assigned';

      const dispHtml = DISPOSITIONS.map(d =>
        `<button class="disposition-btn ${paper.disposition === d.key ? 'selected' : ''}" data-disp="${d.key}" data-pmid="${paper.pmid}">${d.label}</button>`
      ).join('');

      const watchOutHtml = WATCH_OUTS.map(w =>
        `<button class="watch-out-tag ${(paper.watch_outs || []).includes(w.key) ? 'selected' : ''}" data-watch="${w.key}" data-pmid="${paper.pmid}">${w.label}</button>`
      ).join('');

      card.innerHTML = `
        <div class="card-title">${escapeHtml(paper.title)}</div>
        <div class="card-meta">
          ${paper.year || ''} &middot; <span class="pmid-link">PMID: ${paper.pmid}</span>
          &middot; Role: ${roleLabel}
        </div>
        ${paper.abstract ? `
          <div class="card-abstract collapsed" data-pmid="${paper.pmid}">
            ${escapeHtml(paper.abstract)}
          </div>
          <button class="toggle-abstract" data-pmid="${paper.pmid}">Show abstract</button>
        ` : ''}
        <input type="text" class="witness-input" data-pmid="${paper.pmid}"
               placeholder="One sentence: what does this paper actually say?"
               value="${escapeHtml(paper.witness_line || '')}">
        <div class="disposition-row">${dispHtml}</div>
        <details class="watch-outs">
          <summary>Watch-outs</summary>
          <div class="watch-out-tags">${watchOutHtml}</div>
        </details>
      `;

      container.appendChild(card);
    }

    // Toggle abstract
    container.querySelectorAll('.toggle-abstract').forEach(btn => {
      btn.addEventListener('click', () => {
        const pmid = btn.dataset.pmid;
        const abstractDiv = container.querySelector(`.card-abstract[data-pmid="${pmid}"]`);
        if (abstractDiv.classList.contains('collapsed')) {
          abstractDiv.classList.remove('collapsed');
          btn.textContent = 'Collapse';
        } else {
          abstractDiv.classList.add('collapsed');
          btn.textContent = 'Show abstract';
        }
      });
    });

    // Witness line input
    container.querySelectorAll('.witness-input').forEach(input => {
      input.addEventListener('input', () => {
        const paper = papers.find(p => p.pmid === input.dataset.pmid);
        if (paper) paper.witness_line = input.value;
      });
    });

    // Disposition buttons
    container.querySelectorAll('.disposition-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pmid = btn.dataset.pmid;
        const disp = btn.dataset.disp;
        const paper = papers.find(p => p.pmid === pmid);
        if (paper) {
          paper.disposition = (paper.disposition === disp) ? null : disp;
        }
        const siblings = container.querySelectorAll(`.disposition-btn[data-pmid="${pmid}"]`);
        siblings.forEach(s => s.classList.remove('selected'));
        if (paper && paper.disposition === disp) {
          btn.classList.add('selected');
        }
      });
    });

    // Watch-out tags
    container.querySelectorAll('.watch-out-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const pmid = btn.dataset.pmid;
        const watch = btn.dataset.watch;
        const paper = papers.find(p => p.pmid === pmid);
        if (paper) {
          if (!paper.watch_outs) paper.watch_outs = [];
          const idx = paper.watch_outs.indexOf(watch);
          if (idx >= 0) {
            paper.watch_outs.splice(idx, 1);
            btn.classList.remove('selected');
          } else {
            paper.watch_outs.push(watch);
            btn.classList.add('selected');
          }
        }
      });
    });
  }

  /**
   * Escape HTML entities.
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    renderScrollCards,
    renderRoleCards,
    renderWitnessCards,
    ROLES,
    DISPOSITIONS,
    WATCH_OUTS,
    formatAuthors,
    pubmedLink,
    escapeHtml
  };
})();
