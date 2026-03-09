// src/worker.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
import { BM25Index }     from './bm25.js';
import { reciprocalRankFusion, hydrateResults } from './retrieval.js';
import { MODEL, CANDIDATE_POOL, TOP_K, CACHE_MAX } from './config.js';

env.allowLocalModels = false;
env.useBrowserCache  = true;

let embedder  = null;
let indexData = null;
let bm25      = null;
let pcaData   = null;

// ─── Query embedding cache ─────────────────────────────────────────────────
const queryCache = new Map();

function getCachedVec(text) { return queryCache.get(text) ?? null; }
function cacheVec(text, vec) {
  if (queryCache.size >= CACHE_MAX) queryCache.delete(queryCache.keys().next().value);
  queryCache.set(text, vec);
}

// ─── PCA projection (new query point → 2D) ───────────────────────────────────
function projectPCA(vec, pca) {
  const [pc1, pc2] = pca.components;
  const centered   = vec.map((x, j) => x - pca.mean[j]);
  return [
    centered.reduce((s, x, j) => s + x * pc1[j], 0),
    centered.reduce((s, x, j) => s + x * pc2[j], 0),
  ];
}

// ─── Adaptive retriever weights ─────────────────────────────────────────────
function detectWeights(text) {
  const isQuestion = /^(what|who|where|when|why|how|tell|describe|explain|show)\b/i.test(text.trim());
  if (isQuestion || text.trim().split(/\s+/).length > 4) return [0.35, 0.65]; // favour dense
  if (text.trim().split(/\s+/).length <= 2)              return [0.6,  0.4];  // favour BM25
  return [0.45, 0.55];
}

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

  embedder = await pipeline('feature-extraction', MODEL, {
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

  // 2b. Fetch PCA metadata (optional — graceful if missing)
  try {
    const pcaUrl = baseUrl.replace(/\/?$/, '/') + 'pca.json';
    const pcaRes = await fetch(pcaUrl);
    if (pcaRes.ok) pcaData = await pcaRes.json();
  } catch { /* pca.json unavailable — map will be skipped */ }

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
  const { results: bm25Raw, queryTerms, bm25Ms } = bm25.search(text, CANDIDATE_POOL);

  // ── Dense retrieval ──
  const tDense = performance.now();
  let queryVec = getCachedVec(text);
  if (!queryVec) {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    queryVec = Array.from(output.data);
    cacheVec(text, queryVec);
  }

  const denseRaw = indexData
    .map(r => ({ id: r.id, score: cosineSimilarity(queryVec, r.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL);
  const denseMs = Math.round(performance.now() - tDense);

  // ── Weighted RRF fusion ──
  const tFusion = performance.now();
  const weights = detectWeights(text);
  const fused   = reciprocalRankFusion([bm25Raw, denseRaw], 60, weights);
  const results = hydrateResults(fused, indexData, bm25Raw, denseRaw, topK);
  const fusionMs = Math.round(performance.now() - tFusion);

  const totalMs = Math.round(performance.now() - tTotal);

  const queryXY  = pcaData ? projectPCA(queryVec, pcaData) : null;
  const chunksXY = indexData.map(r => ({ id: r.id, title: r.title, xy: r.xy ?? null }));

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
      queryXY,
      chunksXY,
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
      const { results, metrics } = await query(data.payload, data.topK ?? TOP_K);
      self.postMessage({ type: 'results', payload: results, queryTerms: metrics.queryTerms });
      self.postMessage({ type: 'metrics', payload: metrics });
    }
  } catch (err) {
    self.postMessage({ type: 'error', payload: err.message });
  }
});
