// src/worker.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
import { BM25Index }     from './bm25.js';
import { reciprocalRankFusion, hydrateResults } from './retrieval.js';

env.allowLocalModels = false;
env.useBrowserCache  = true;

let embedder  = null;
let indexData = null;
let bm25      = null;

// ─── Cosine similarity ────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initialize(baseUrl) {
  // 1. Load embedding model
  self.postMessage({ type: 'status', payload: 'loading_model' });

  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
    progress_callback: (info) => {
      if (info.status === 'progress' && typeof info.progress === 'number') {
        self.postMessage({ type: 'progress', payload: Math.round(info.progress) });
      }
    },
  });

  // 2. Fetch pre-computed index
  self.postMessage({ type: 'status', payload: 'loading_index' });
  const indexUrl = baseUrl.replace(/\/?$/, '/') + 'index.json';
  const res = await fetch(indexUrl);
  if (!res.ok) throw new Error(`index.json fetch failed: ${res.status} (${indexUrl})`);
  indexData = await res.json();

  // 3. Build BM25 index in-memory
  self.postMessage({ type: 'status', payload: 'building_bm25' });
  bm25 = new BM25Index();
  const bm25Stats = bm25.build(indexData);

  self.postMessage({
    type: 'ready',
    payload: {
      chunks:    indexData.length,
      vocabSize: bm25Stats.vocabSize,
      bm25BuildMs: bm25Stats.buildMs,
    },
  });
}

// ─── Hybrid query ─────────────────────────────────────────────────────────────
async function query(text, topK = 5) {
  if (!embedder || !indexData || !bm25) throw new Error('Worker not initialised');

  const tTotal = performance.now();

  // ── BM25 retrieval ──
  const { results: bm25Raw, queryTerms, bm25Ms } = bm25.search(text, 20);

  // ── Dense retrieval ──
  const tDense = performance.now();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const queryVec = Array.from(output.data);

  const denseRaw = indexData
    .map(r => ({ id: r.id, score: cosineSimilarity(queryVec, r.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const denseMs = Math.round(performance.now() - tDense);

  // ── RRF fusion ──
  const tFusion = performance.now();
  const fused   = reciprocalRankFusion([bm25Raw, denseRaw]);
  const results = hydrateResults(fused, indexData, bm25Raw, denseRaw, topK);
  const fusionMs = Math.round(performance.now() - tFusion);

  const totalMs = Math.round(performance.now() - tTotal);

  return {
    results,
    metrics: {
      query:      text,
      queryTerms,
      bm25Top20:  bm25Raw,
      denseTop20: denseRaw,
      fusedTop5:  results,
      timing: { bm25Ms, denseMs, fusionMs, totalMs },
      indexStats: bm25.getStats(),
    },
  };
}

// ─── Message router ───────────────────────────────────────────────────────────
self.addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'init') {
      await initialize(data.baseUrl);
    } else if (data.type === 'query') {
      self.postMessage({ type: 'status', payload: 'searching' });
      const { results, metrics } = await query(data.payload, data.topK ?? 5);
      self.postMessage({ type: 'results', payload: results });
      self.postMessage({ type: 'metrics', payload: metrics });
    }
  } catch (err) {
    self.postMessage({ type: 'error', payload: err.message });
  }
});
