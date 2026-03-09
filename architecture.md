# Architecture: Client-Side RAG Pipeline

This project uses a fully client-side Retrieval-Augmented Generation (RAG) architecture.
There is no backend vector database or API service; indexing happens at build time, and retrieval happens in the browser.

## 1. High-Level Flow

```text
Knowledge Markdown (knowledge/*.md)
  -> Build Script (scripts/build-index.mjs)
    -> Chunking (section → paragraph → sentence packing)
    -> Heading propagation + contextual enrichment
    -> Stemmed term pre-computation (for BM25)
    -> Embedding generation (bge-small-en-v1.5, quantized)
    -> index.json (chunks + vectors + sparse terms)
    -> pages.json (full page content)

Browser Runtime
  -> Web Worker init
    -> load embedding model (same bge-small-en-v1.5)
    -> fetch index.json
    -> build in-memory BM25+ index

User Query
  -> Adaptive weight detection (question vs keyword)
  -> BM25+ sparse retrieval (top 20)
  -> Dense cosine retrieval (top 20, with query cache)
  -> Weighted Reciprocal Rank Fusion (RRF)
  -> Near-duplicate chunk dedupe (Jaccard)
  -> Top-k results with highlighted excerpts
```

## 2. Data Sources and Ingestion

- Source documents live in `knowledge/*.md`.
- Each file can include frontmatter fields such as:
  - `title`
  - `url`
  - `tags`
- Build script reads all markdown files, parses frontmatter, and processes body content.

Key files:
- `scripts/build-index.mjs`
- `knowledge/*.md`

## 3. Chunking Strategy

Chunking is done at build time in `scripts/build-index.mjs`.

Current settings (defined in `src/config.js`):
- `CHUNK_SIZE = 220` words
- `CHUNK_OVERLAP = 24` words
- `MIN_CHUNK_SIZE = 50` words (tail merge threshold)

Multi-level splitting pipeline:
1. **Sections** — split on heading boundaries (`#` through `####`).
2. **Paragraphs** — split on blank lines within each section.
3. **Sentences** — split oversized paragraphs at sentence boundaries.
4. **Word-window** — hard-split any remaining oversized sentences.
5. **Packing** — small units are packed together up to `CHUNK_SIZE`.
6. **Tail merge** — chunks smaller than `MIN_CHUNK_SIZE` merge into the previous chunk.
7. **Overlap** — trailing words from the previous chunk are prepended.

Contextual enrichment:
- Each chunk's heading is tracked. Embedded text is prefixed with `"<title> — <heading>: <text>"` for better semantic grounding.

Tuning guidance:
- Smaller chunks improve precision but can lose context.
- Larger chunks improve context but can reduce retrieval granularity.
- Higher overlap improves continuity but increases index size and redundancy.

## 4. Embedding Model

Embeddings are generated at build time and query time with the same model:
- `Xenova/bge-small-en-v1.5` (defined once in `src/config.js`)
- Task: `feature-extraction`
- Options: `pooling: 'mean'`, `normalize: true`, `quantized: true`

Why bge-small-en-v1.5:
- Higher quality embeddings than MiniLM-L6-v2 for retrieval tasks.
- Same model in both stages ensures vector space compatibility.
- Quantized ONNX format keeps download ~25 MB and runs via WASM in the browser.

Key files:
- `src/config.js` (model name — single source of truth)
- `scripts/build-index.mjs` (document embeddings)
- `src/worker.js` (query embeddings)

## 5. Sparse Retrieval (BM25+)

Sparse retrieval complements dense embeddings with lexical matching.

Implementation details:
- Tokenization, stop-word filtering, and stemming are applied at build and runtime.
- The stemmer is a lightweight English suffix stripper handling `-s`, `-ed`, `-ing`, `-tion`, `-ment`, `-ness`, `-able`, `-ful`, `-ly`, `-er`, `-ies`, and sibilant `-es` forms.
- Tokenized & stemmed terms are stored in each record as `terms`.
- Browser builds an in-memory BM25+ index on worker initialization.
- Query BM25+ returns top 20 candidates.

BM25+ parameters (defined in `src/config.js`):
- `BM25_K1 = 1.5`
- `BM25_B = 0.75`
- `BM25_DELTA = 0.5` (lower-bound boost — prevents zero scores for long documents)

Single source of truth:
- `stem()`, `tokenize()`, and `STOP_WORDS` are defined once in `src/config.js` and imported by both `scripts/build-index.mjs` and `src/bm25.js`. No manual sync required.

## 6. Dense Retrieval (Cosine Similarity)

Dense retrieval is run in `src/worker.js`:
- Embed user query.
- Compute cosine similarity against every chunk vector in `index.json`.
- Sort descending and keep top 20.

Because vectors are normalized, cosine similarity behaves stably for semantic search.

## 7. Hybrid Fusion and Ranking

The system uses Weighted Reciprocal Rank Fusion (RRF) in `src/retrieval.js`:
- Input lists: BM25+ top 20 + dense top 20
- Fused score contribution per list: `weight / (k + rank + 1)`
- Default fusion constant: `RRF_K = 60`
- Weights are determined per-query by `detectWeights()` in `src/worker.js`:
  - Questions / long queries → `[0.35, 0.65]` (favour dense)
  - Short keyword queries (≤ 2 words) → `[0.6, 0.4]` (favour BM25)
  - Default → `[0.45, 0.55]`

After fusion:
- Results are hydrated with chunk metadata (`title`, `url`, `text`, scores).
- Near duplicates are removed using Jaccard overlap on tokens.
- Duplicate threshold: `OVERLAP_THRESHOLD = 0.60`
- Final top-k (default 5) is returned.

## 8. Runtime Architecture

Main thread (`src/main.js`):
- Handles UI, user input, status, and rendering.
- Sends query messages to worker.
- Formats and displays ranked results.

Web Worker (`src/worker.js`):
- Loads embedding model (`MODEL` from config).
- Fetches `index.json`.
- Builds BM25+ index.
- Maintains an LRU query embedding cache (`CACHE_MAX = 20`) to skip re-embedding repeated queries.
- Detects adaptive retriever weights per-query.
- Executes hybrid retrieval and returns results + metrics.

Fallback mode:
- If worker/model is unavailable, app falls back to BM25-only retrieval in main thread.

Result presentation:
- Excerpts are highlighted with `<mark>` tags around stemmed query term matches.
- Answer synthesis expresses confidence based on top cosine score thresholds.

## 9. Artifacts and Storage

Generated outputs in `public/`:
- `index.json`: chunk-level retrieval records
  - `id`, `source_file`, `title`, `url`, `tags`, `text`, `terms`, `vector`, `xy`
- `pages.json`: full markdown pages for KB page rendering
- `pca.json`: PCA metadata for browser-side query projection (see §12)

Size safety:
- Build script aborts if `index.json` exceeds 90 MB.

## 10. Performance Characteristics

- First run downloads model assets (~25 MB, cached in browser thereafter).
- Query embedding cache (LRU, size 20) eliminates re-embedding for repeated/recent queries.
- Adaptive weights shift fusion toward BM25 for keyword queries and toward dense for natural language questions.
- Query latency includes BM25+ scoring, embedding inference (or cache hit), dense scoring, and weighted fusion.
- Worker offloads heavy computation to keep UI responsive.
- Quantized model and top-N truncation (`CANDIDATE_POOL = 20` per retriever) control runtime costs.

## 11. Centralised Configuration

All shared constants live in `src/config.js` — a single source of truth imported by both build-time (Node) and runtime (browser/worker) code.

| Constant | Default | Used by |
|---|---|---|
| `MODEL` | `Xenova/bge-small-en-v1.5` | build-index.mjs, worker.js |
| `CHUNK_SIZE` | 220 | build-index.mjs |
| `CHUNK_OVERLAP` | 24 | build-index.mjs |
| `MIN_CHUNK_SIZE` | 50 | build-index.mjs |
| `MAX_INDEX_SIZE_MB` | 90 | build-index.mjs |
| `BM25_K1` | 1.5 | bm25.js |
| `BM25_B` | 0.75 | bm25.js |
| `BM25_DELTA` | 0.5 | bm25.js |
| `RRF_K` | 60 | retrieval.js |
| `OVERLAP_THRESHOLD` | 0.60 | retrieval.js |
| `CANDIDATE_POOL` | 20 | worker.js |
| `TOP_K` | 5 | worker.js |
| `CACHE_MAX` | 20 | worker.js |
| `LOW_CONFIDENCE_THRESHOLD` | 0.25 | search.js |
| `HIGH_CONFIDENCE_THRESHOLD` | 0.50 | search.js |
| `STOP_WORDS` | (set) | config.js (shared) |
| `stem()` / `tokenize()` | — | config.js (shared) |

Values left inline (implementation-specific):
- Adaptive weight rules in `detectWeights()` (worker.js)

## 12. Embedding Map (PCA Projection)

After every query the debug panel renders a live 2D scatter plot showing where each knowledge chunk and the current query sit in the embedding space. This makes the vector retrieval process tangible and visually verifiable.

### Why PCA, not UMAP

UMAP produces better-looking clusters for large corpora but has no closed-form for projecting new (unseen) points. Projecting a query would require shipping the full UMAP model state (~1 MB+) and running it in the browser per query. PCA projection of a new point is a pure linear transform — 2 dot products, so it runs in microseconds with no extra download.

### Build-time computation (`scripts/build-index.mjs`)

1. **Gram matrix** — the n×n matrix `X Xᵀ` is computed from the centred embedding matrix. With n ≈ 21 chunks this is cheap (n << dim=384).
2. **Power iteration** — the top two eigenvectors of the gram matrix are found iteratively (400 iterations each). The second eigenvector uses deflation to ensure orthogonality.
3. **Principal components** — eigenvectors in gram-matrix space are mapped back to the original 384-dim space via `Xᵀ u`, then unit-normalised. These are the two principal component direction vectors (each 384-dim).
4. **Projection** — every chunk embedding is projected to 2D: `[v · pc1, v · pc2]`. The resulting `xy` coordinate is stored on each chunk record in `index.json`.
5. **`pca.json`** — the mean vector (384 floats) and component matrix (2 × 384 floats) are written to `public/pca.json` (~20 KB). This is everything needed to project any new vector at runtime.

```text
index.json  +  each chunk gets xy: [x, y]   (~negligible size increase)
pca.json    →  { mean: float[384], components: float[2][384] }
```

### Runtime query projection (`src/worker.js`)

When `initialize()` fetches `index.json` it also fetches `pca.json` (failure is silently ignored — the map is simply hidden if missing). On each query, after the 384-dim query embedding is computed:

```js
function projectPCA(vec, pca) {
  const centered = vec.map((x, j) => x - pca.mean[j]);   // centre
  return [
    centered.reduce((s, x, j) => s + x * pca.components[0][j], 0),  // dot pc1
    centered.reduce((s, x, j) => s + x * pca.components[1][j], 0),  // dot pc2
  ];
}
```

The resulting `queryXY` and the pre-computed `chunksXY` are included in the metrics payload sent back to the main thread alongside retrieval results.

### Rendering (`src/debug-panel.js`)

The debug panel renders a `<canvas>` element after each query:

- **All 21 chunks** are drawn as dots, colour-coded by source page (about, education, hackathons, projects, skills, student-life, work-experience).
- **Top-5 retrieved chunks** are drawn larger with a border and a short label, making it immediately obvious which region of semantic space the query activated.
- **The query** is drawn as a red diamond (◆), showing where in the space the natural language question landed.
- The canvas uses `devicePixelRatio` scaling for crisp rendering on retina displays.
- Axis guidelines are drawn through the origin to give spatial reference.

### What the map reveals

Because PCA finds the two directions of maximum variance across all chunk embeddings, the axes carry real semantic meaning. In practice:
- Skills and technical-tool chunks cluster towards one region.
- Biographical/education chunks cluster in another.
- A keyword query (e.g. "FastAPI") will land close to the skills/work chunks; a conversational query (e.g. "tell me about yourself") will land near the about chunk.

This makes the adaptive weight heuristic and retrieval confidence score visually interpretable rather than just numeric.
- CSS breakpoints (style.css)
- Cache eviction policy (LRU in worker.js)

## 12. Design Tradeoffs

Pros:
- Zero backend infrastructure.
- Privacy-friendly (query processing in browser).
- Low operational complexity and cost.

Tradeoffs:
- Initial model download cost for users.
- Dense similarity is O(N) over chunks at query time.
- Limited by browser memory/CPU for very large corpora.

For a portfolio-sized knowledge base, this architecture is simple, fast enough, and easy to deploy on static hosting.
