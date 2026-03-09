// src/metrics.js
// Assembles per-query metrics for the debug panel.
// Pure functions — no DOM, no side effects.

/**
 * Build a complete metrics snapshot for one query execution.
 *
 * @param {object} p
 * @param {string}   p.query
 * @param {string[]} p.queryTerms     — tokenised query terms from BM25
 * @param {Array}    p.bm25Results    — raw BM25 scored list (before fusion), top-20
 * @param {Array}    p.denseResults   — raw cosine scored list (before fusion), top-20
 * @param {Array}    p.fusedResults   — hydrated fused results (top-5)
 * @param {object}   p.timing         — { bm25Ms, denseMs, fusionMs, totalMs }
 * @param {object}   p.indexStats     — { documents, vocabSize, avgDocLength }
 * @returns {object} metrics
 */
export function buildMetrics({ query, queryTerms, bm25Results, denseResults, fusedResults, timing, indexStats, queryXY, chunksXY }) {
  return {
    query,
    queryTerms,
    timing,
    indexStats,
    bm25Top5: bm25Results.slice(0, 5).map((r, i) => ({
      rank:  i + 1,
      id:    r.id,
      score: r.score.toFixed(4),
    })),
    denseTop5: denseResults.slice(0, 5).map((r, i) => ({
      rank:  i + 1,
      id:    r.id,
      score: r.score.toFixed(4),
    })),
    fusedTop5: fusedResults.slice(0, 5).map(r => ({
      rank:       r.rank,
      title:      r.title,
      rrfScore:   r.rrfScore.toFixed(5),
      bm25Score:  r.bm25Score.toFixed(4),
      cosine:     r.cosineScore.toFixed(4),
      bm25Rank:   r.bm25Rank,
      denseRank:  r.denseRank,
    })),
    // Signal quality heuristics
    topCosineSimilarity:    denseResults[0]?.score ?? 0,
    topBM25Score:           bm25Results[0]?.score ?? 0,
    queryTermsMatched:      queryTerms.length,
    resultOverlap:          computeOverlap(bm25Results.slice(0,5), denseResults.slice(0,5)),
    // Embedding map data
    queryXY:   queryXY  ?? null,
    chunksXY:  chunksXY ?? [],
    fusedIds:  new Set(fusedResults.map(r => r.id)),
  };
}

/**
 * Fraction of documents that appear in both top-5 lists.
 * High overlap = both retrievers agree → higher confidence.
 */
function computeOverlap(list1, list2) {
  const ids1 = new Set(list1.map(r => r.id));
  const shared = list2.filter(r => ids1.has(r.id)).length;
  return (shared / Math.max(list1.length, list2.length, 1)).toFixed(2);
}
