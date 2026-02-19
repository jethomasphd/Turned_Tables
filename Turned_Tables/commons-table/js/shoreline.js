/**
 * Shoreline — PubMed Ingestion Module
 *
 * Takes PubMed URLs, PMIDs, or DOIs. Returns structured paper objects
 * with title, authors, journal, year, abstract, PMID, DOI.
 *
 * Uses NCBI E-utilities (public, free, CORS-enabled).
 * No paywall. No tribute. Abstracts and metadata only.
 */

const Shoreline = (() => {
  const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const RATE_LIMIT_MS = 350; // NCBI asks for max 3 requests/sec without API key
  const CACHE_KEY = 'tables_turned_paper_cache';

  /**
   * Parse a line of input into a PMID.
   * Accepts:
   *   - PubMed URL: https://pubmed.ncbi.nlm.nih.gov/28202713/
   *   - Plain PMID: 28202713
   *   - DOI: 10.1136/bmj.i6583 (will be resolved via esearch)
   *
   * Returns { type: 'pmid'|'doi', value: string }
   */
  function parseIdentifier(line) {
    line = line.trim();
    if (!line) return null;

    // PubMed URL
    const pmidUrlMatch = line.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
    if (pmidUrlMatch) {
      return { type: 'pmid', value: pmidUrlMatch[1] };
    }

    // Plain PMID (all digits, 1-10 chars)
    if (/^\d{1,10}$/.test(line)) {
      return { type: 'pmid', value: line };
    }

    // DOI (starts with 10.)
    const doiMatch = line.match(/(10\.\d{4,}\/\S+)/);
    if (doiMatch) {
      return { type: 'doi', value: doiMatch[1] };
    }

    // DOI URL
    const doiUrlMatch = line.match(/doi\.org\/(10\.\d{4,}\/\S+)/);
    if (doiUrlMatch) {
      return { type: 'doi', value: doiUrlMatch[1] };
    }

    return null;
  }

  /**
   * Parse all input lines into identifiers.
   */
  function parseInput(text) {
    const lines = text.split('\n');
    const results = [];
    const errors = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const id = parseIdentifier(trimmed);
      if (id) {
        results.push(id);
      } else {
        errors.push(trimmed);
      }
    }

    return { identifiers: results, errors };
  }

  /**
   * Resolve a DOI to a PMID using NCBI esearch.
   */
  async function resolveDOI(doi) {
    const url = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi)}[doi]&retmode=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`DOI resolution failed: ${response.status}`);

    const data = await response.json();
    const idList = data.esearchresult?.idlist;
    if (idList && idList.length > 0) {
      return idList[0];
    }
    return null;
  }

  /**
   * Fetch paper metadata and abstracts for a batch of PMIDs.
   * Uses efetch with XML return for abstracts.
   */
  async function fetchPapers(pmids) {
    if (pmids.length === 0) return [];

    const idString = pmids.join(',');
    const url = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${idString}&retmode=xml`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`PubMed fetch failed: ${response.status}`);

    const xmlText = await response.text();
    return parsePubMedXML(xmlText);
  }

  /**
   * Parse PubMed XML response into structured paper objects.
   */
  function parsePubMedXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const articles = doc.querySelectorAll('PubmedArticle');
    const papers = [];

    for (const article of articles) {
      const paper = extractPaperFromXML(article);
      if (paper) papers.push(paper);
    }

    return papers;
  }

  /**
   * Extract a single paper object from a PubmedArticle XML element.
   */
  function extractPaperFromXML(articleEl) {
    try {
      // PMID
      const pmidEl = articleEl.querySelector('PMID');
      const pmid = pmidEl ? pmidEl.textContent.trim() : null;
      if (!pmid) return null;

      // Title
      const titleEl = articleEl.querySelector('ArticleTitle');
      const title = titleEl ? titleEl.textContent.trim() : 'Untitled';

      // Authors
      const authorEls = articleEl.querySelectorAll('Author');
      const authors = [];
      for (const authorEl of authorEls) {
        const lastName = authorEl.querySelector('LastName');
        const foreName = authorEl.querySelector('ForeName');
        if (lastName) {
          const name = foreName
            ? `${lastName.textContent} ${foreName.textContent}`
            : lastName.textContent;
          authors.push(name);
        }
      }

      // Journal
      const journalEl = articleEl.querySelector('Journal Title');
      const isoEl = articleEl.querySelector('ISOAbbreviation');
      const journal = journalEl
        ? journalEl.textContent.trim()
        : (isoEl ? isoEl.textContent.trim() : null);

      // Year
      const yearEl = articleEl.querySelector('PubDate Year');
      const medlineDateEl = articleEl.querySelector('PubDate MedlineDate');
      let year = null;
      if (yearEl) {
        year = parseInt(yearEl.textContent.trim(), 10);
      } else if (medlineDateEl) {
        const yearMatch = medlineDateEl.textContent.match(/(\d{4})/);
        if (yearMatch) year = parseInt(yearMatch[1], 10);
      }

      // Abstract
      const abstractParts = articleEl.querySelectorAll('AbstractText');
      let abstract = null;
      if (abstractParts.length > 0) {
        const parts = [];
        for (const part of abstractParts) {
          const label = part.getAttribute('Label');
          const text = part.textContent.trim();
          if (label) {
            parts.push(`${label}: ${text}`);
          } else {
            parts.push(text);
          }
        }
        abstract = parts.join('\n\n');
      }

      // DOI
      const idEls = articleEl.querySelectorAll('ArticleId');
      let doi = null;
      for (const idEl of idEls) {
        if (idEl.getAttribute('IdType') === 'doi') {
          doi = idEl.textContent.trim();
          break;
        }
      }

      return {
        pmid,
        doi,
        title,
        authors,
        journal,
        year,
        abstract,
        role: null,
        witness_line: null,
        disposition: null,
        watch_outs: []
      };
    } catch (e) {
      console.error('Failed to parse article:', e);
      return null;
    }
  }

  /**
   * Load the paper cache from localStorage.
   */
  function loadCache() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  }

  /**
   * Save paper cache to localStorage.
   */
  function saveCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Storage full or unavailable. That is fine.
    }
  }

  /**
   * Sleep for rate limiting.
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Main ingestion function.
   *
   * Takes raw text input, returns:
   * {
   *   papers: [...],       // Structured paper objects
   *   duplicates: [...],   // PMIDs that appeared more than once
   *   errors: [...],       // Lines that could not be parsed
   *   failedDOIs: [...],   // DOIs that could not be resolved
   *   failedPMIDs: [...]   // PMIDs that could not be fetched
   * }
   */
  async function ingest(text, onProgress) {
    const { identifiers, errors } = parseInput(text);

    if (identifiers.length === 0) {
      return {
        papers: [],
        duplicates: [],
        errors: errors.length > 0 ? errors : ['No valid identifiers found.'],
        failedDOIs: [],
        failedPMIDs: []
      };
    }

    const cache = loadCache();
    const pmids = [];
    const failedDOIs = [];
    const seenPMIDs = new Set();
    const duplicates = [];

    // Phase 1: Resolve all identifiers to PMIDs
    if (onProgress) onProgress('Resolving identifiers...');

    for (const id of identifiers) {
      if (id.type === 'pmid') {
        if (seenPMIDs.has(id.value)) {
          duplicates.push(id.value);
        } else {
          seenPMIDs.add(id.value);
          pmids.push(id.value);
        }
      } else if (id.type === 'doi') {
        try {
          if (onProgress) onProgress(`Resolving DOI: ${id.value}...`);
          const resolved = await resolveDOI(id.value);
          await sleep(RATE_LIMIT_MS);

          if (resolved) {
            if (seenPMIDs.has(resolved)) {
              duplicates.push(resolved);
            } else {
              seenPMIDs.add(resolved);
              pmids.push(resolved);
            }
          } else {
            failedDOIs.push(id.value);
          }
        } catch {
          failedDOIs.push(id.value);
        }
      }
    }

    // Phase 2: Separate cached from uncached PMIDs
    const uncached = [];
    const fromCache = [];

    for (const pmid of pmids) {
      if (cache[pmid]) {
        fromCache.push(cache[pmid]);
      } else {
        uncached.push(pmid);
      }
    }

    if (onProgress && fromCache.length > 0) {
      onProgress(`${fromCache.length} paper(s) loaded from cache.`);
    }

    // Phase 3: Fetch uncached papers in batches of 10
    const fetched = [];
    const failedPMIDs = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
      if (onProgress) {
        onProgress(`Fetching papers ${i + 1}-${Math.min(i + BATCH_SIZE, uncached.length)} of ${uncached.length}...`);
      }

      try {
        const batchPapers = await fetchPapers(batch);
        const fetchedPMIDs = new Set(batchPapers.map(p => p.pmid));

        for (const paper of batchPapers) {
          cache[paper.pmid] = paper;
          fetched.push(paper);
        }

        // Track PMIDs that were requested but not returned
        for (const pmid of batch) {
          if (!fetchedPMIDs.has(pmid)) {
            failedPMIDs.push(pmid);
          }
        }

        await sleep(RATE_LIMIT_MS);
      } catch (e) {
        console.error('Batch fetch failed:', e);
        failedPMIDs.push(...batch);
      }
    }

    // Save updated cache
    saveCache(cache);

    // Combine cached + fetched, preserving order
    const allPapers = [];
    for (const pmid of pmids) {
      const paper = fetched.find(p => p.pmid === pmid) || fromCache.find(p => p.pmid === pmid);
      if (paper) allPapers.push(paper);
    }

    if (onProgress) onProgress(`Done. ${allPapers.length} paper(s) ingested.`);

    return {
      papers: allPapers,
      duplicates,
      errors,
      failedDOIs,
      failedPMIDs
    };
  }

  // Public API
  return {
    parseInput,
    parseIdentifier,
    ingest
  };
})();
