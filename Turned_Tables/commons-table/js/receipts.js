/**
 * Receipts — Claim-to-Paper Linking Engine
 *
 * Every claim must have receipts: one or more paper IDs (PMIDs/DOIs).
 * If a claim has no receipts, it is UNWITNESSED.
 * If its receipts include papers that disagree, it is CONTESTED.
 *
 * No hallucinated authority. No "trust me."
 */

const Receipts = (() => {

  /**
   * Create a new empty claim.
   */
  function createClaim() {
    return {
      text: '',
      receipts: [],
      status: 'unwitnessed'
    };
  }

  /**
   * Update the status of a claim based on its receipts and linked papers.
   *
   * @param {Object} claim - The claim object
   * @param {Array} papers - All papers in the session
   * @returns {string} - 'witnessed', 'unwitnessed', or 'contested'
   */
  function computeStatus(claim, papers) {
    if (!claim.receipts || claim.receipts.length === 0) {
      return 'unwitnessed';
    }

    // Check if any linked papers have conflicting roles
    const linkedPapers = papers.filter(p => claim.receipts.includes(p.pmid));
    const hasSupports = linkedPapers.some(p => p.role === 'supports');
    const hasContradicts = linkedPapers.some(p => p.role === 'contradicts');

    if (hasSupports && hasContradicts) {
      return 'contested';
    }

    return 'witnessed';
  }

  /**
   * Update all claim statuses.
   */
  function updateAllStatuses(claims, papers) {
    for (const claim of claims) {
      claim.status = computeStatus(claim, papers);
    }
    return claims;
  }

  /**
   * Render the claims editor UI.
   *
   * @param {Array} claims - Array of claim objects
   * @param {Array} papers - Array of paper objects (for receipt linking)
   * @param {HTMLElement} container - DOM container for the claims list
   * @param {Function} onChange - Callback when claims change
   */
  function renderClaimsEditor(claims, papers, container, onChange) {
    container.innerHTML = '';

    // Only show papers that are kept or unsure (not released)
    const availablePapers = papers.filter(p => p.disposition !== 'release');

    claims.forEach((claim, index) => {
      const row = document.createElement('div');
      row.className = 'claim-row';

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-claim-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        claims.splice(index, 1);
        renderClaimsEditor(claims, papers, container, onChange);
        if (onChange) onChange(claims);
      });

      // Claim text input
      const textInput = document.createElement('textarea');
      textInput.className = 'claim-text';
      textInput.rows = 2;
      textInput.placeholder = 'Write a claim. What do the papers show?';
      textInput.value = claim.text;
      textInput.addEventListener('input', () => {
        claim.text = textInput.value;
        if (onChange) onChange(claims);
      });

      // Receipt tags (toggle PMIDs)
      const receiptsDiv = document.createElement('div');
      receiptsDiv.className = 'claim-receipts';

      for (const paper of availablePapers) {
        const tag = document.createElement('button');
        tag.className = 'claim-receipt-tag';
        const isLinked = claim.receipts.includes(paper.pmid);
        tag.classList.add(isLinked ? 'linked' : 'unlinked');
        tag.textContent = `PMID:${paper.pmid}`;
        tag.title = paper.title;

        tag.addEventListener('click', () => {
          const idx = claim.receipts.indexOf(paper.pmid);
          if (idx >= 0) {
            claim.receipts.splice(idx, 1);
          } else {
            claim.receipts.push(paper.pmid);
          }
          claim.status = computeStatus(claim, papers);
          renderClaimsEditor(claims, papers, container, onChange);
          if (onChange) onChange(claims);
        });

        receiptsDiv.appendChild(tag);
      }

      // Status badge
      claim.status = computeStatus(claim, papers);
      const statusEl = document.createElement('div');
      statusEl.className = `claim-status ${claim.status}`;
      const statusLabels = {
        witnessed: 'WITNESSED',
        unwitnessed: 'UNWITNESSED',
        contested: 'CONTESTED'
      };
      statusEl.textContent = statusLabels[claim.status] || claim.status.toUpperCase();

      row.appendChild(removeBtn);
      row.appendChild(textInput);
      row.appendChild(receiptsDiv);
      row.appendChild(statusEl);
      container.appendChild(row);
    });
  }

  /**
   * Validate all claims. Returns issues found.
   */
  function validate(claims) {
    const issues = [];

    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i];
      if (!claim.text.trim()) {
        issues.push(`Claim ${i + 1}: Empty text.`);
      }
      if (claim.status === 'unwitnessed') {
        issues.push(`Claim ${i + 1}: No receipts. Will be marked UNWITNESSED.`);
      }
    }

    return issues;
  }

  return {
    createClaim,
    computeStatus,
    updateAllStatuses,
    renderClaimsEditor,
    validate
  };
})();
