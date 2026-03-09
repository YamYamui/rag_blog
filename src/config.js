// src/config.js
// Centralised configuration for the RAG pipeline.
// Shared across build-time indexing (Node) and runtime retrieval (browser/worker).

// ─── Embedding model ────────────────────────────────────────────────────────
export const MODEL = 'Xenova/bge-small-en-v1.5';

// ─── Chunking ────────────────────────────────────────────────────────────────
export const CHUNK_SIZE     = 220;
export const CHUNK_OVERLAP  = 24;
export const MIN_CHUNK_SIZE = 50;

// ─── BM25 scoring ────────────────────────────────────────────────────────────
export const BM25_K1    = 1.5;
export const BM25_B     = 0.75;
export const BM25_DELTA = 0.5;

// ─── Retrieval / RRF ────────────────────────────────────────────────────────
export const RRF_K             = 60;
export const OVERLAP_THRESHOLD = 0.60;
export const CANDIDATE_POOL    = 20;
export const TOP_K             = 5;

// ─── Worker ──────────────────────────────────────────────────────────────────
export const CACHE_MAX = 20;

// ─── Build ───────────────────────────────────────────────────────────────────
export const MAX_INDEX_SIZE_MB = 90;

// ─── Answer synthesis ────────────────────────────────────────────────────────
export const LOW_CONFIDENCE_THRESHOLD  = 0.25;
export const HIGH_CONFIDENCE_THRESHOLD = 0.50;

// ─── Stop words ──────────────────────────────────────────────────────────────
export const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'this','that','these','those','it','its','i','you','he','she','we',
  'they','what','which','who','when','where','how','all','as','up','out',
  'if','about','into','than','then','so','no','not','also','can',
]);

// ─── Stemmer & Tokeniser ────────────────────────────────────────────────────
// IMPORTANT: stem() and tokenize() must always be imported from this file.
// Never duplicate them — both build-time and runtime must produce identical tokens.

export function stem(word) {
  if (word.length < 4) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if ((word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') || word.endsWith('ches') || word.endsWith('shes')) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('tion') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ment') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ness') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('able') && word.length > 5) return word.slice(0, -4);
  if (word.endsWith('ful') && word.length > 4) return word.slice(0, -3);
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
  return word;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
    .map(stem);
}
