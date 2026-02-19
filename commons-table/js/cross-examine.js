/**
 * Cross-Examine — Stress-Test Widgets
 *
 * Three questions that enforce honest thinking:
 * 1. What would change your mind?
 * 2. Best rival explanation?
 * 3. Confidence (Low / Medium / High) with justification if High.
 *
 * These are not decorations. They are guardrails against self-deception.
 */

const CrossExamine = (() => {

  let state = {
    change_your_mind: null,
    rival_explanation: null,
    confidence: null,
    confidence_justification: null
  };

  /**
   * Initialize the cross-examination widgets.
   * Binds event listeners to existing DOM elements.
   */
  function init() {
    // Change your mind
    const changeMindEl = document.getElementById('cross-change-mind');
    if (changeMindEl) {
      changeMindEl.addEventListener('input', () => {
        state.change_your_mind = changeMindEl.value || null;
      });
    }

    // Rival explanation
    const rivalEl = document.getElementById('cross-rival');
    if (rivalEl) {
      rivalEl.addEventListener('input', () => {
        state.rival_explanation = rivalEl.value || null;
      });
    }

    // Confidence buttons
    const confidenceBtns = document.querySelectorAll('.confidence-btn');
    const justArea = document.getElementById('justification-area');
    const justInput = document.getElementById('cross-justification');

    confidenceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const level = btn.dataset.level;

        // Toggle: clicking same level deselects
        if (state.confidence === level) {
          state.confidence = null;
          btn.classList.remove('selected');
        } else {
          state.confidence = level;
          confidenceBtns.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        }

        // Show justification field only for "high"
        if (justArea) {
          if (state.confidence === 'high') {
            justArea.classList.add('visible');
          } else {
            justArea.classList.remove('visible');
            state.confidence_justification = null;
            if (justInput) justInput.value = '';
          }
        }
      });
    });

    // Justification input
    if (justInput) {
      justInput.addEventListener('input', () => {
        state.confidence_justification = justInput.value || null;
      });
    }
  }

  /**
   * Get the current cross-examination state.
   */
  function getState() {
    return { ...state };
  }

  /**
   * Set state (e.g., when restoring from an imported Tablet).
   */
  function setState(newState) {
    state = { ...state, ...newState };

    // Update DOM to match
    const changeMindEl = document.getElementById('cross-change-mind');
    if (changeMindEl && state.change_your_mind) changeMindEl.value = state.change_your_mind;

    const rivalEl = document.getElementById('cross-rival');
    if (rivalEl && state.rival_explanation) rivalEl.value = state.rival_explanation;

    if (state.confidence) {
      const btn = document.querySelector(`.confidence-btn[data-level="${state.confidence}"]`);
      if (btn) {
        document.querySelectorAll('.confidence-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      }

      if (state.confidence === 'high') {
        const justArea = document.getElementById('justification-area');
        if (justArea) justArea.classList.add('visible');
        const justInput = document.getElementById('cross-justification');
        if (justInput && state.confidence_justification) justInput.value = state.confidence_justification;
      }
    }
  }

  /**
   * Validate: check if cross-examination is minimally complete.
   */
  function validate() {
    const issues = [];

    if (!state.confidence) {
      issues.push('Confidence level not set.');
    }

    if (state.confidence === 'high' && !state.confidence_justification) {
      issues.push('High confidence requires justification.');
    }

    return issues;
  }

  return {
    init,
    getState,
    setState,
    validate
  };
})();
