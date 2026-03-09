// src/retrieval.js
// Orchestrates hybrid retrieval: BM25 sparse + cosine dense → RRF fusion.

import { RRF_K, OVERLAP_THRESHOLD } from './config.js';

/**
 * Reciprocal Rank Fusion.
 *
 * Takes multiple ranked lists (each an array of { id, score }) and fuses
 * them into a single ranked list using RRF scoring.
 *
 * @param {Array<Array<{id:string, score:number}>>} rankedLists
 * @param {number} k  RRF constant (default 60)
 * @returns {Array<{id:string, rrfScore:number, sourceRanks: number[]}>}
 */
export function reciprocalRankFusion(rankedLists, k = RRF_K, weights = null) {
  const scores   = new Map(); // id → cumulative RRF score
  const srcRanks = new Map(); // id → array of per-list ranks (1-indexed)

  for (let li = 0; li < rankedLists.length; li++) {
    const list = rankedLists[li];
    const w = weights?.[li] ?? 1;
    for (let rank = 0; rank < list.length; rank++) {
      const { id } = list[rank];
      const contribution = w / (k + rank + 1);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
      if (!srcRanks.has(id)) srcRanks.set(id, new Array(rankedLists.length).fill(null));
      srcRanks.get(id)[li] = rank + 1; // 1-indexed
    }
  }

  const fused = [];
  for (const [id, rrfScore] of scores) {
    fused.push({ id, rrfScore, sourceRanks: srcRanks.get(id) });
  }
  fused.sort((a, b) => b.rrfScore - a.rrfScore);
  return fused;
}

/**
 * Attach full record data to fused results.
 * The fused list only has { id, rrfScore, sourceRanks } — this hydrates them
 * with the original text, title, url, etc. from the index.
 *
 * @param {Array}  fusedList       output of reciprocalRankFusion()
 * @param {Array}  indexData       raw records from index.json
 * @param {Array}  bm25Scored      BM25 results array (for attaching bm25Score)
 * @param {Array}  denseScored     Dense results array (for attaching cosineScore)
 * @param {number} topK
 * @returns {Array}
 */
export function hydrateResults(fusedList, indexData, bm25Scored, denseScored, topK = 5) {
  // Build lookup maps
  const byId      = new Map(indexData.map(r => [r.id, r]));
  const bm25Map   = new Map(bm25Scored.map(r => [r.id, r.score]));
  const denseMap  = new Map(denseScored.map(r => [r.id, r.score]));

  const candidates = [];
  for (const [idx, f] of fusedList.entries()) {
    const rec = byId.get(f.id) ?? {};
    candidates.push({
      id:           f.id,
      rank:         idx + 1,
      title:        rec.title  ?? f.id,
      url:          rec.url    ?? '/',
      tags:         rec.tags   ?? '',
      text:         rec.text   ?? '',
      terms:        rec.terms  ?? [],
      rrfScore:     f.rrfScore,
      bm25Score:    bm25Map.get(f.id) ?? 0,
      cosineScore:  denseMap.get(f.id) ?? 0,
      bm25Rank:     f.sourceRanks?.[0] ?? null,
      denseRank:    f.sourceRanks?.[1] ?? null,
    });
  }

  // Deduplicate near-identical chunks (from overlap regions)
  return deduplicateChunks(candidates, topK);
}

/**
 * Remove near-duplicate chunks using Jaccard token overlap.
 * Keeps the higher-ranked chunk when two chunks share > OVERLAP_THRESHOLD of tokens.
 */
function deduplicateChunks(candidates, topK) {
  const kept = [];
  for (const c of candidates) {
    if (kept.length >= topK) break;
    const tokens = new Set(c.terms?.length ? c.terms : c.text.toLowerCase().split(/\s+/));
    const isDuplicate = kept.some(k => {
      const kTokens = new Set(k.terms?.length ? k.terms : k.text.toLowerCase().split(/\s+/));
      const intersection = [...tokens].filter(t => kTokens.has(t)).length;
      const union = new Set([...tokens, ...kTokens]).size;
      return union > 0 && (intersection / union) > OVERLAP_THRESHOLD;
    });
    if (!isDuplicate) {
      c.rank = kept.length + 1;
      kept.push(c);
    }
  }
  return kept;
}
