// src/search.js
import { BM25Index } from './bm25.js';
import { tokenize, LOW_CONFIDENCE_THRESHOLD, HIGH_CONFIDENCE_THRESHOLD } from './config.js';
import { reciprocalRankFusion, hydrateResults } from './retrieval.js';

function escapeForHighlight(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlightExcerpt(text, queryTerms) {
  const safe = escapeForHighlight(text);
  if (!queryTerms?.length) return safe;
  const patterns = queryTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b(${patterns.join('|')})[a-z]*\\b`, 'gi');
  return safe.replace(re, '<mark>$&</mark>');
}

/**
 * Format hydrated fused results into display-ready objects.
 *
 * @param {Array}  results      — output of hydrateResults()
 * @param {number} excerptLen
 * @param {Array}  queryTerms   — stemmed query terms for highlighting
 * @returns {Array}
 */
export function formatResults(results, excerptLen = 300, queryTerms = []) {
  return results
    .filter(r => r.rrfScore > 0)
    .map(r => {
      const excerpt = r.text.length > excerptLen
        ? r.text.slice(0, excerptLen).trimEnd() + '…'
        : r.text;
      return {
        id:          r.id,
        title:       r.title,
        url:         r.url,
        tags:        r.tags,
        rrfScore:    r.rrfScore,
        cosineScore: r.cosineScore,
        bm25Score:   r.bm25Score,
        bm25Rank:    r.bm25Rank,
        denseRank:   r.denseRank,
        excerpt,
        highlightedExcerpt: highlightExcerpt(excerpt, queryTerms),
      };
    });
}

/**
 * Pure BM25 fallback — used only when the Web Worker is unavailable.
 * Accepts raw indexData or a pre-built BM25Index. Returns hydrated results synchronously.
 *
 * @param {string}          query
 * @param {Array}           indexData
 * @param {BM25Index|null}  cachedIndex  — optional pre-built index to avoid rebuilding
 * @param {number}          topK
 * @returns {{ results: Array, index: BM25Index }}
 */
export function bm25Fallback(query, indexData, cachedIndex = null, topK = 5) {
  const idx = cachedIndex ?? new BM25Index();
  if (!cachedIndex) idx.build(indexData);
  const { results: bm25Raw, queryTerms } = idx.search(query, topK * 4);
  // Fallback: no dense vector, so just return BM25 as a single-list RRF
  const fused = reciprocalRankFusion([bm25Raw]);
  const results = hydrateResults(fused, indexData, bm25Raw, [], topK);
  return { results, index: idx, queryTerms };
}

/**
 * Check if a query has meaningful content after tokenisation.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateQuery(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 'Please enter a question.';
  if (trimmed.length > 500) return 'Query is too long — please keep it under 500 characters.';
  const terms = tokenize(trimmed);
  if (terms.length === 0) {
    return "Your query didn't contain searchable keywords. Try using more specific terms (e.g., \"Python\", \"embedded systems\").";
  }
  return null;
}

/**
 * Synthesise a brief answer intro from the top results.
 * Uses the top cosine score (when available) to express confidence.
 */
export function synthesiseAnswer(results) {
  if (!results.length) {
    return "I couldn't find anything relevant. Try rephrasing or using more specific terms.";
  }

  const topCosine = Number(results[0].cosineScore ?? 0);
  const topTitle  = results[0].title ?? 'my knowledge base';
  const count     = results.length;
  const sources   = [...new Set(results.map(r => r.title))].slice(0, 3);
  const sourceStr = sources.join(', ');

  // Low confidence — warn user
  if (topCosine > 0 && topCosine < LOW_CONFIDENCE_THRESHOLD) {
    return `I found ${count} section${count > 1 ? 's' : ''} that may be loosely related, but confidence is low. ` +
      `Try rephrasing with more specific keywords.`;
  }

  // High confidence — reference the top source
  if (topCosine >= HIGH_CONFIDENCE_THRESHOLD) {
    return `Here’s what I found — the best match is from **${topTitle}** (${sourceStr}).`;
  }

  // Medium / fallback (no cosine score available in BM25-only mode)
  return `I found ${count} relevant section${count > 1 ? 's' : ''} across ${sourceStr}. ` +
    `Click the source links for full context.`;
}
