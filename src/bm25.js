// src/bm25.js
// Pure JavaScript BM25 implementation. No dependencies.

import { BM25_K1 as K1, BM25_B as B, BM25_DELTA as DELTA, tokenize } from './config.js';

export { tokenize };

export class BM25Index {
  constructor() {
    this.documents  = [];   // { id, terms: string[], termFreqs: Map<string,number> }
    this.df         = new Map();  // term → document frequency
    this.avgdl      = 0;
    this.N          = 0;
    this.vocabSize  = 0;
    this._built     = false;
  }

  /**
   * Build the index from pre-tokenised records.
   * Expects each record to have a `terms` array (pre-computed at build time).
   * Falls back to tokenising `text` if `terms` is absent.
   *
   * @param {Array} records  — raw records from index.json
   */
  build(records) {
    const t0 = performance.now();
    this.N = records.length;
    let totalLen = 0;

    for (const rec of records) {
      const terms = rec.terms?.length ? rec.terms : tokenize(rec.text);
      const termFreqs = new Map();
      for (const t of terms) {
        termFreqs.set(t, (termFreqs.get(t) ?? 0) + 1);
      }
      this.documents.push({ id: rec.id, terms, termFreqs, dl: terms.length });
      totalLen += terms.length;

      // Update document frequencies
      for (const t of termFreqs.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
      }
    }

    this.avgdl   = totalLen / this.N;
    this.vocabSize = this.df.size;
    this._built  = true;

    return { buildMs: Math.round(performance.now() - t0), vocabSize: this.vocabSize };
  }

  /**
   * Score all documents for a query string.
   * Returns array of { id, score } sorted descending.
   *
   * @param {string} query
   * @param {number} topK
   * @returns {{ results: Array<{id:string, score:number}>, queryTerms: string[], bm25Ms: number }}
   */
  search(query, topK = 20) {
    if (!this._built) throw new Error('BM25Index not built — call build() first');
    const t0 = performance.now();
    const queryTerms = tokenize(query);

    if (queryTerms.length === 0) {
      return { results: [], queryTerms: [], bm25Ms: 0 };
    }

    // Pre-compute IDF for each query term
    const idfs = new Map();
    for (const t of queryTerms) {
      const df = this.df.get(t) ?? 0;
      // Standard Robertson-Sparck Jones IDF (non-negative variant)
      idfs.set(t, Math.max(0, Math.log((this.N - df + 0.5) / (df + 0.5))));
    }

    const scores = new Array(this.N);
    for (let i = 0; i < this.N; i++) {
      const { id, termFreqs, dl } = this.documents[i];
      let score = 0;
      const lenNorm = 1 - B + B * (dl / this.avgdl);

      for (const [t, idf] of idfs) {
        const tf = termFreqs.get(t) ?? 0;
        if (tf === 0) continue;
        score += idf * ((tf * (K1 + 1)) / (tf + K1 * lenNorm) + DELTA);
      }
      scores[i] = { id, score };
    }

    scores.sort((a, b) => b.score - a.score);
    const bm25Ms = Math.round(performance.now() - t0);

    return {
      results:    scores.slice(0, topK),
      queryTerms,
      bm25Ms,
    };
  }

  getStats() {
    return {
      documents: this.N,
      vocabSize: this.vocabSize,
      avgDocLength: Math.round(this.avgdl),
    };
  }
}
