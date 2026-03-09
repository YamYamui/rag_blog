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

    <!-- Embedding Map -->
    <section class="dm-map-section">
      <h3 class="dm-heading">Embedding Space
        <span class="dm-info" title="2D PCA projection of all chunk vectors. Each dot is a knowledge chunk, coloured by source page. The red ◆ shows where your query lands. Top-5 retrieved chunks are larger and labelled.">&#9432;</span>
      </h3>
      <canvas class="dm-map-canvas" id="dm-map-canvas" width="1" height="1"></canvas>
      <div class="dm-map-legend" id="dm-map-legend"></div>
    </section>
  `;

  setTimeout(() => {
    const canvas   = document.getElementById('dm-map-canvas');
    const legendEl = document.getElementById('dm-map-legend');
    if (canvas && metrics.chunksXY?.length) {
      renderEmbeddingMap(canvas, legendEl, metrics.chunksXY, metrics.queryXY, metrics.fusedIds);
    }
  }, 0);
}

// ─── Embedding map ────────────────────────────────────────────────────────────────────
const SOURCE_PALETTE = {
  'about':           '#2563eb',
  'education':       '#0891b2',
  'hackathons':      '#ea580c',
  'projects':        '#7c3aed',
  'skills':          '#059669',
  'student-life':    '#db2777',
  'work-experience': '#d97706',
};

function renderEmbeddingMap(canvasEl, legendEl, chunksXY, queryXY, fusedIds) {
  const W = 334, H = 220;
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width  = W * dpr;
  canvasEl.height = H * dpr;
  canvasEl.style.width  = W + 'px';
  canvasEl.style.height = H + 'px';

  const ctx = canvasEl.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = 20;

  // Compute bounds across all points including query
  const allX = chunksXY.filter(c => c.xy).map(c => c.xy[0]);
  const allY = chunksXY.filter(c => c.xy).map(c => c.xy[1]);
  if (queryXY) { allX.push(queryXY[0]); allY.push(queryXY[1]); }
  if (!allX.length) return;

  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  function toCanvas(x, y) {
    return [
      PAD + ((x - xMin) / xRange) * (W - 2 * PAD),
      H - PAD - ((y - yMin) / yRange) * (H - 2 * PAD),
    ];
  }

  ctx.clearRect(0, 0, W, H);

  // Grid lines (subtle)
  ctx.strokeStyle = 'rgba(0,0,0,0.04)';
  ctx.lineWidth = 1;
  const [ox, oy] = toCanvas(0, 0);
  if (ox > PAD && ox < W - PAD) { ctx.beginPath(); ctx.moveTo(ox, PAD); ctx.lineTo(ox, H - PAD); ctx.stroke(); }
  if (oy > PAD && oy < H - PAD) { ctx.beginPath(); ctx.moveTo(PAD, oy); ctx.lineTo(W - PAD, oy); ctx.stroke(); }

  // Draw all chunk dots
  for (const chunk of chunksXY) {
    if (!chunk.xy) continue;
    const source  = chunk.id.replace(/-chunk\d+$/, '');
    const color   = SOURCE_PALETTE[source] ?? '#888888';
    const isTop5  = fusedIds?.has(chunk.id);
    const [cx, cy] = toCanvas(...chunk.xy);
    const r = isTop5 ? 7 : 4;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = isTop5 ? color : color + '55';
    ctx.fill();

    if (isTop5) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Short label
      ctx.font = `bold 8px monospace`;
      ctx.fillStyle = color;
      const label = source.replace('work-experience', 'work').slice(0, 7);
      ctx.fillText(label, cx + 9, cy + 3);
    }
  }

  // Query marker (diamond)
  if (queryXY) {
    const [qx, qy] = toCanvas(...queryXY);
    const s = 7;
    ctx.beginPath();
    ctx.moveTo(qx, qy - s);
    ctx.lineTo(qx + s, qy);
    ctx.lineTo(qx, qy + s);
    ctx.lineTo(qx - s, qy);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('query', qx + 10, qy + 3);
  }

  // Legend
  const sources = [...new Set(chunksXY.map(c => c.id.replace(/-chunk\d+$/, '')))];
  legendEl.innerHTML =
    sources.map(s => {
      const c = SOURCE_PALETTE[s] ?? '#888888';
      return `<span class="dm-map-legend-item"><span class="dm-map-legend-dot" style="background:${c}"></span>${esc(s)}</span>`;
    }).join('') +
    `<span class="dm-map-legend-item"><span class="dm-map-legend-diamond"></span>query</span>`;
}

function timingRow(label, ms, bold = false, tooltip = '') {  const cls = bold ? ' dm-timing--total' : '';
  const bar = `<span class="dm-time-bar" style="--ms:${Math.min(ms,500)}"></span>`;
  const info = tooltip ? ` <span class="dm-info" title="${esc(tooltip)}">ⓘ</span>` : '';
  return `<dt class="${cls}">${label}${info}</dt><dd class="${cls}">${bar}${ms} ms</dd>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
