// src/bm25.js
// Pure JavaScript BM25 implementation. No dependencies.
// Parameters k1=1.5, b=0.75 are standard Okapi BM25 defaults.
//
// IMPORTANT: tokenize() here must be byte-for-byte identical to the
// tokenize() function in scripts/build-index.mjs. Both must agree on
// what constitutes a token, or query terms won't match indexed terms.

const K1 = 1.5;
const B  = 0.75;

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'this','that','these','those','it','its','i','you','he','she','we',
  'they','what','which','who','when','where','how','all','as','up','out',
  'if','about','into','than','then','so','no','not','also','can',
]);

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

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
        score += idf * (tf * (K1 + 1)) / (tf + K1 * lenNorm);
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
