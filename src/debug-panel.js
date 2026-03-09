// src/debug-panel.js
// Renders the retrieval debug panel.
// All DOM manipulation for the panel lives here.

// ─── Session state ────────────────────────────────────────────────────────────
let queryCount    = 0;
let bestCosine    = 0;
let fastestMs     = Infinity;
let totalLatency  = 0;

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
  // Track session stats
  queryCount++;
  totalLatency += metrics.timing.totalMs;
  if (metrics.topCosineSimilarity > bestCosine) bestCosine = metrics.topCosineSimilarity;
  if (metrics.timing.totalMs < fastestMs) fastestMs = metrics.timing.totalMs;
  const avgLatency = Math.round(totalLatency / queryCount);

  // Update the badge in the toggle button header
  const badge = document.getElementById('debug-badge');
  if (badge) {
    badge.textContent = `${metrics.timing.totalMs}ms \u00B7 cos ${Number(metrics.topCosineSimilarity).toFixed(2)} \u00B7 overlap ${metrics.resultOverlap}`;
  }


  // Exploration prompts — suggest queries that explore different KB regions
  const EXPLORE_PROMPTS = [
    'What is your tech stack?',
    'Tell me about your leadership roles',
    'What certifications do you have?',
    'Describe your hackathon projects',
    'What was your internship about?',
    'How does this RAG system work?',
    'What are your hobbies?',
    'Tell me about CS6101',
  ];
  const nextPrompt = EXPLORE_PROMPTS[queryCount % EXPLORE_PROMPTS.length];

  bodyEl.innerHTML = `
    <!-- Session stats bar -->
    <div class="dm-session-bar">
      <span class="dm-session-stat" title="Queries this session"><span class="dm-session-icon">#</span>${queryCount}</span>
      <span class="dm-session-stat" title="Average latency"><span class="dm-session-icon">\u23f1</span>${avgLatency}ms avg</span>
      <span class="dm-session-stat" title="Fastest query"><span class="dm-session-icon">\u26a1</span>${fastestMs}ms best</span>
      <span class="dm-session-stat" title="Best cosine similarity"><span class="dm-session-icon">\u2605</span>${bestCosine.toFixed(3)}</span>
    </div>

    <!-- Embedding Map -->
    <section class="dm-map-section">
      <h3 class="dm-heading">Embedding Space
        <span class="dm-info" title="2D PCA projection of all chunk vectors. Each dot is a knowledge chunk, coloured by source page. The red \u25c6 shows where your query lands. Top-5 retrieved chunks are larger and labelled.">\u2139</span>
      </h3>
      <canvas class="dm-map-canvas" id="dm-map-canvas" width="1" height="1"></canvas>
      <div class="dm-map-tooltip" id="dm-map-tooltip"></div>
      <div class="dm-map-legend" id="dm-map-legend"></div>
    </section>

    <!-- Try next -->
    <div class="dm-try-next">
      <span class="dm-try-next__label">Try next \u2192</span>
      <button class="dm-try-next__btn" data-query="${esc(nextPrompt)}">${esc(nextPrompt)}</button>
    </div>

    <div class="dm-grid">

      <!-- Query Analysis -->
      <section class="dm-section dm-collapsible" data-section="query">
        <button class="dm-section-toggle" aria-expanded="true">
          <span class="dm-section-arrow">\u25BC</span>
          <h3 class="dm-heading" style="margin-bottom:0">Query Analysis</h3>
        </button>
        <div class="dm-section-body">
          <dl class="dm-dl">
            <dt>Raw query <span class="dm-info" title="The exact text you typed into the search box, before any processing.">\u24d8</span></dt>
            <dd class="dm-mono">${esc(metrics.query)}</dd>
            <dt>Tokenised terms (${metrics.queryTerms.length}) <span class="dm-info" title="Your query after lowercasing, removing punctuation, and filtering out common stop-words (e.g. 'the', 'is', 'and'). These are the actual keywords matched against the index.">\u24d8</span></dt>
            <dd class="dm-mono dm-wrap">${metrics.queryTerms.map(t => `<span class="dm-tag">${esc(t)}</span>`).join(' ')}</dd>
            <dt>Retriever mode <span class="dm-info" title="Which retriever is weighted more heavily based on query type heuristics.">\u24d8</span></dt>
          </dl>
        </div>
      </section>

      <!-- Timing -->
      <section class="dm-section dm-collapsible" data-section="timing">
        <button class="dm-section-toggle" aria-expanded="true">
          <span class="dm-section-arrow">\u25BC</span>
          <h3 class="dm-heading" style="margin-bottom:0">Timing</h3>
        </button>
        <div class="dm-section-body">
          <dl class="dm-dl dm-timing">
            ${timingRow('BM25',   metrics.timing.bm25Ms, false, 'Keyword-based sparse retrieval using term frequency and inverse document frequency.')}
            ${timingRow('Dense',  metrics.timing.denseMs, false, 'Semantic retrieval \u2014 the query is embedded into a 384-dim vector and compared against all chunk vectors via cosine similarity.')}
            ${timingRow('Fusion', metrics.timing.fusionMs, false, 'Reciprocal Rank Fusion (RRF) merges the BM25 and dense ranked lists into a single ranking.')}
            ${timingRow('Total',  metrics.timing.totalMs, true, 'Total wall-clock time from query submission to results.')}
          </dl>
        </div>
      </section>

      <!-- Index Stats -->
      <section class="dm-section dm-collapsible" data-section="index">
        <button class="dm-section-toggle" aria-expanded="true">
          <span class="dm-section-arrow">\u25BC</span>
          <h3 class="dm-heading" style="margin-bottom:0">Index</h3>
        </button>
        <div class="dm-section-body">
          <dl class="dm-dl">
            <dt>Chunks <span class="dm-info" title="Total number of text chunks in the pre-built index. Each chunk is ~250 words, split on section headings.">\u24d8</span></dt><dd>${metrics.indexStats.documents}</dd>
            <dt>Vocabulary <span class="dm-info" title="Number of unique terms across all chunks after tokenisation and stop-word removal.">\u24d8</span></dt><dd>${metrics.indexStats.vocabSize.toLocaleString()} terms</dd>
            <dt>Avg chunk length <span class="dm-info" title="Average number of tokens per chunk. Longer chunks provide more context but may dilute relevance.">\u24d8</span></dt><dd>${metrics.indexStats.avgDocLength} tokens</dd>
            <dt>Retriever overlap <span class="dm-info" title="Fraction of top-5 results that appear in both the BM25 and dense retriever lists. High overlap = both methods agree, suggesting higher confidence.">\u24d8</span></dt>
            <dd>
              <span class="dm-overlap-bar" style="--pct:${Number(metrics.resultOverlap)*100}%"></span>
              ${Math.round(Number(metrics.resultOverlap)*100)}% of top-5 shared
            </dd>
          </dl>
        </div>
      </section>

    </div>

    <!-- Ranked Lists -->
    <div class="dm-lists">

      <section class="dm-list dm-collapsible" data-section="bm25">
        <button class="dm-section-toggle" aria-expanded="true">
          <span class="dm-section-arrow">\u25BC</span>
          <h3 class="dm-heading" style="margin-bottom:0">BM25 Top 5</h3>
        </button>
        <div class="dm-section-body">
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
      </section>

      <section class="dm-list dm-collapsible" data-section="dense">
        <button class="dm-section-toggle" aria-expanded="true">
          <span class="dm-section-arrow">\u25BC</span>
          <h3 class="dm-heading" style="margin-bottom:0">Dense (Cosine) Top 5</h3>
        </button>
        <div class="dm-section-body">
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
      </section>

      <section class="dm-list dm-list--fused dm-collapsible" data-section="fused">
        <button class="dm-section-toggle" aria-expanded="true">
          <span class="dm-section-arrow">\u25BC</span>
          <h3 class="dm-heading" style="margin-bottom:0">Fused (RRF) Top 5</h3>
        </button>
        <div class="dm-section-body">
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
      </section>

    </div>
  `;

  // Wire collapsible sections
  bodyEl.querySelectorAll('.dm-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      btn.nextElementSibling.hidden = expanded;
      btn.querySelector('.dm-section-arrow').textContent = expanded ? '\u25B6' : '\u25BC';
    });
  });

  // Wire "try next" button
  const tryBtn = bodyEl.querySelector('.dm-try-next__btn');
  if (tryBtn) {
    tryBtn.addEventListener('click', () => {
      const q = tryBtn.dataset.query;
      const input = document.getElementById('query-input');
      const form  = document.getElementById('query-form');
      if (input && form) {
        input.value = q;
        form.dispatchEvent(new Event('submit', { bubbles: true }));
      }
    });
  }

  // Render embedding map with hover tooltips
  setTimeout(() => {
    const canvas   = document.getElementById('dm-map-canvas');
    const legendEl = document.getElementById('dm-map-legend');
    const tooltip  = document.getElementById('dm-map-tooltip');
    if (canvas && metrics.chunksXY?.length) {
      renderEmbeddingMap(canvas, legendEl, tooltip, metrics.chunksXY, metrics.queryXY, metrics.fusedIds);
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

function renderEmbeddingMap(canvasEl, legendEl, tooltipEl, chunksXY, queryXY, fusedIds) {
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

  // Build hit-test list (canvas coords + metadata)
  const hitTargets = [];

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
      ctx.font = `bold 8px monospace`;
      ctx.fillStyle = color;
      const label = source.replace('work-experience', 'work').slice(0, 7);
      ctx.fillText(label, cx + 9, cy + 3);
    }

    hitTargets.push({ cx, cy, r: Math.max(r, 6), id: chunk.id, source, isTop5 });
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

  // Hover / touch tooltip
  if (tooltipEl) {
    const showTooltip = (e) => {
      const rect = canvasEl.getBoundingClientRect();
      const mx = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - rect.left;
      const my = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - rect.top;
      let nearest = null, bestDist = 12; // max px distance
      for (const t of hitTargets) {
        const d = Math.hypot(t.cx - mx, t.cy - my);
        if (d < bestDist) { bestDist = d; nearest = t; }
      }
      if (nearest) {
        tooltipEl.style.display = 'block';
        tooltipEl.style.left = nearest.cx + 'px';
        tooltipEl.style.top  = (nearest.cy - 28) + 'px';
        tooltipEl.textContent = nearest.id;
        canvasEl.style.cursor = 'pointer';
      } else {
        tooltipEl.style.display = 'none';
        canvasEl.style.cursor = '';
      }
    };
    canvasEl.addEventListener('mousemove', showTooltip);
    canvasEl.addEventListener('touchstart', showTooltip, { passive: true });
    canvasEl.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none';
      canvasEl.style.cursor = '';
    });
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
