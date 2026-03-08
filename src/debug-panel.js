// src/debug-panel.js
// Renders the retrieval debug panel.
// All DOM manipulation for the panel lives here.

/**
 * Inject the debug panel shell into the page.
 * Call once at startup. The panel starts collapsed.
 *
 * @param {HTMLElement} parentEl  — element to append the panel to
 * @returns {{ panelEl: HTMLElement, toggleBtn: HTMLElement, bodyEl: HTMLElement }}
 */
export function createDebugPanel(parentEl) {
  const panelEl = document.createElement('div');
  panelEl.className = 'debug-panel';
  panelEl.setAttribute('aria-label', 'Retrieval debug panel');

panelEl.innerHTML = `
  <button class="debug-panel__toggle" aria-expanded="true" aria-controls="debug-panel-body">
    <span class="debug-panel__toggle-icon">&#9660;</span>
    <span>Retrieval Debug</span>
    <span class="debug-panel__badge" id="debug-badge">&mdash;</span>
  </button>
  <div class="debug-panel__body" id="debug-panel-body">
    <div class="debug-panel__placeholder">Run a query to see retrieval metrics.</div>
  </div>
`;

  parentEl.appendChild(panelEl);

  const toggleBtn = panelEl.querySelector('.debug-panel__toggle');
  const bodyEl    = panelEl.querySelector('.debug-panel__body');
  const iconEl    = panelEl.querySelector('.debug-panel__toggle-icon');

  toggleBtn.addEventListener('click', () => {
    const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!expanded));
    bodyEl.hidden = expanded;
    iconEl.textContent = expanded ? '\u25B6' : '\u25BC';
  });

  return { panelEl, toggleBtn, bodyEl };
}

/**
 * Populate the debug panel body with metrics from the latest query.
 *
 * @param {HTMLElement} bodyEl   — the panel body element
 * @param {object}      metrics  — output of buildMetrics() from metrics.js
 */
export function renderMetrics(bodyEl, metrics) {
  // Update the badge in the toggle button header
  const badge = document.getElementById('debug-badge');
  if (badge) {
    badge.textContent = `${metrics.timing.totalMs}ms \u00B7 cos ${Number(metrics.topCosineSimilarity).toFixed(2)} \u00B7 overlap ${metrics.resultOverlap}`;
  }

  bodyEl.innerHTML = `
    <div class="dm-grid">

      <!-- Query Analysis -->
      <section class="dm-section">
        <h3 class="dm-heading">Query Analysis</h3>
        <dl class="dm-dl">
          <dt>Raw query <span class="dm-info" title="The exact text you typed into the search box, before any processing.">ⓘ</span></dt>
          <dd class="dm-mono">${esc(metrics.query)}</dd>
          <dt>Tokenised terms (${metrics.queryTerms.length}) <span class="dm-info" title="Your query after lowercasing, removing punctuation, and filtering out common stop-words (e.g. 'the', 'is', 'and'). These are the actual keywords matched against the index.">ⓘ</span></dt>
          <dd class="dm-mono dm-wrap">${metrics.queryTerms.map(t => `<span class="dm-tag">${esc(t)}</span>`).join(' ')}</dd>
        </dl>
      </section>

      <!-- Timing -->
      <section class="dm-section">
        <h3 class="dm-heading">Timing</h3>
        <dl class="dm-dl dm-timing">
          ${timingRow('BM25',   metrics.timing.bm25Ms, false, 'Keyword-based sparse retrieval using term frequency and inverse document frequency.')}
          ${timingRow('Dense',  metrics.timing.denseMs, false, 'Semantic retrieval — the query is embedded into a 384-dim vector and compared against all chunk vectors via cosine similarity.')}
          ${timingRow('Fusion', metrics.timing.fusionMs, false, 'Reciprocal Rank Fusion (RRF) merges the BM25 and dense ranked lists into a single ranking.')}
          ${timingRow('Total',  metrics.timing.totalMs, true, 'Total wall-clock time from query submission to results.')}
        </dl>
      </section>

      <!-- Index Stats -->
      <section class="dm-section">
        <h3 class="dm-heading">Index</h3>
        <dl class="dm-dl">
          <dt>Chunks <span class="dm-info" title="Total number of text chunks in the pre-built index. Each chunk is ~250 words, split on section headings.">ⓘ</span></dt><dd>${metrics.indexStats.documents}</dd>
          <dt>Vocabulary <span class="dm-info" title="Number of unique terms across all chunks after tokenisation and stop-word removal.">ⓘ</span></dt><dd>${metrics.indexStats.vocabSize.toLocaleString()} terms</dd>
          <dt>Avg chunk length <span class="dm-info" title="Average number of tokens per chunk. Longer chunks provide more context but may dilute relevance.">ⓘ</span></dt><dd>${metrics.indexStats.avgDocLength} tokens</dd>
          <dt>Retriever overlap <span class="dm-info" title="Fraction of top-5 results that appear in both the BM25 and dense retriever lists. High overlap = both methods agree, suggesting higher confidence.">ⓘ</span></dt>
          <dd>
            <span class="dm-overlap-bar" style="--pct:${Number(metrics.resultOverlap)*100}%"></span>
            ${Math.round(Number(metrics.resultOverlap)*100)}% of top-5 shared
          </dd>
        </dl>
      </section>

    </div>

    <!-- Ranked Lists -->
    <div class="dm-lists">

      <div class="dm-list">
        <h3 class="dm-heading">BM25 Top 5</h3>
        <table class="dm-table">
          <thead><tr><th>#</th><th>Chunk ID</th><th>Score</th></tr></thead>
          <tbody>
            ${metrics.bm25Top5.map(r => `
              <tr>
                <td class="dm-rank">${r.rank}</td>
                <td class="dm-mono dm-truncate">${esc(r.id)}</td>
                <td class="dm-score">${r.score}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="dm-list">
        <h3 class="dm-heading">Dense (Cosine) Top 5</h3>
        <table class="dm-table">
          <thead><tr><th>#</th><th>Chunk ID</th><th>Score</th></tr></thead>
          <tbody>
            ${metrics.denseTop5.map(r => `
              <tr>
                <td class="dm-rank">${r.rank}</td>
                <td class="dm-mono dm-truncate">${esc(r.id)}</td>
                <td class="dm-score">${r.score}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="dm-list dm-list--fused">
        <h3 class="dm-heading">Fused (RRF) Top 5</h3>
        <table class="dm-table">
          <thead>
            <tr>
              <th>#</th><th>Title</th>
              <th title="Reciprocal Rank Fusion score">RRF</th>
              <th title="BM25 rank in sparse list">B\u2191</th>
              <th title="Dense rank in cosine list">D\u2191</th>
              <th title="Cosine similarity">Cos</th>
            </tr>
          </thead>
          <tbody>
            ${metrics.fusedTop5.map(r => `
              <tr>
                <td class="dm-rank">${r.rank}</td>
                <td class="dm-truncate">${esc(r.title)}</td>
                <td class="dm-score">${r.rrfScore}</td>
                <td class="dm-rank ${r.bm25Rank === 1 ? 'dm-rank--top' : ''}">${r.bm25Rank ?? '\u2014'}</td>
                <td class="dm-rank ${r.denseRank === 1 ? 'dm-rank--top' : ''}">${r.denseRank ?? '\u2014'}</td>
                <td class="dm-score">${r.cosine}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

    </div>
  `;
}

function timingRow(label, ms, bold = false, tooltip = '') {
  const cls = bold ? ' dm-timing--total' : '';
  const bar = `<span class="dm-time-bar" style="--ms:${Math.min(ms,500)}"></span>`;
  const info = tooltip ? ` <span class="dm-info" title="${esc(tooltip)}">ⓘ</span>` : '';
  return `<dt class="${cls}">${label}${info}</dt><dd class="${cls}">${bar}${ms} ms</dd>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
