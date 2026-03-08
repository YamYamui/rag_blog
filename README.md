# RAG Portfolio

A zero-backend, client-side Retrieval-Augmented Generation (RAG) portfolio site. The AI model and all search computation runs entirely in the visitor's browser — no server, no API keys, no costs.

**GitHub Pages::** 

---

## How it works

```
Build time (Node.js):
  knowledge/*.md  →  build-index.mjs  →  public/index.json
                                          (text chunks + embeddings)

Run time (browser):
  User query
    ↓
  Web Worker (Transformers.js)
    → embeds query with all-MiniLM-L6-v2 (ONNX, runs in WASM)
    → cosine similarity against index.json
    → returns top-k chunks
    ↓
  Main thread renders results with source citations
```

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
```

On Windows PowerShell with restricted execution policy, use `npm.cmd` instead of `npm`:

```powershell
npm.cmd install
```

### 2. Edit the knowledge base

Add or edit Markdown files in `knowledge/`. Every file must start with frontmatter:

```markdown
---
title: My Projects
url: /projects
tags: [projects, engineering]
---

Your content here…
```

### 3. Generate the vector index

```bash
npm run build:index
```

Windows PowerShell alternative:

```powershell
npm.cmd run build:index
```

This downloads the embedding model (~25 MB on first run, then cached), chunks your markdown files, generates embeddings, and writes `public/index.json`.

### 4. Develop locally

```bash
npm run dev
# Visit http://localhost:5173
```

Windows PowerShell alternative:

```powershell
npm.cmd run dev
```

### 5. Production build

```bash
npm run build
# Output is in dist/
```

Windows PowerShell alternative:

```powershell
npm.cmd run build
```

### 6. Optional: Evaluate retrieval quality

```bash
npm run build:index
node scripts/eval.mjs
```

Windows PowerShell alternative:

```powershell
npm.cmd run build:index
node .\scripts\eval.mjs
```

---

## Deploy to GitHub Pages

1. Push to GitHub.
2. Go to **Settings → Pages → Source → GitHub Actions**.
3. The `deploy.yml` workflow runs automatically on every push to `main`.

> **Note on WASM / SharedArrayBuffer:** ONNX Runtime requires `SharedArrayBuffer`, which requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers. GitHub Pages cannot set custom headers. The workflow automatically injects [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) into the built HTML, which installs a service worker that sets these headers client-side. This happens transparently — no action needed.

---

## Customisation

### Change the embedding model

Edit the `MODEL` constant in both `scripts/build-index.mjs` and `src/worker.js`. Both must use the same model. Other good choices:

| Model | Size | Notes |
|-------|------|-------|
| `Xenova/all-MiniLM-L6-v2` | ~23 MB | Default. Fast, good quality. |
| `Xenova/all-MiniLM-L12-v2` | ~33 MB | Slightly better quality. |
| `Xenova/bge-small-en-v1.5` | ~33 MB | Good for technical content. |
| `Xenova/bge-base-en-v1.5` | ~109 MB | High quality, larger download. |

### Tune chunking

In `scripts/build-index.mjs`:

```js
const CHUNK_SIZE    = 250;  // words per chunk — reduce for denser content
const CHUNK_OVERLAP = 40;   // shared words between adjacent chunks
```

### Adjust retrieval

In `src/worker.js`, change `topK` in the `query()` call (default: 5).  
In `src/search.js`, adjust the `score > 0.15` threshold in `formatResults()`.

### Update suggested questions

In `src/main.js`, edit the `SUGGESTED` array.

---

## File size limits

GitHub has a hard 100 MB limit per file. The `build-index.mjs` script aborts if `index.json` exceeds 90 MB. For a typical personal portfolio (5–20 markdown files, ~50k words total), the index will be 2–8 MB.

---

## Project structure

```
├── .github/workflows/deploy.yml   # CI/CD — build + deploy to Pages
├── knowledge/                     # Source markdown files
│   ├── about.md
│   ├── education.md
│   ├── hackathons.md
│   ├── projects.md
│   ├── skills.md
│   ├── student-life.md
│   ├── work-experience.md
│   └── experience.md
├── public/
│   ├── coi-serviceworker.js
│   ├── index.json                 # Generated — do not edit manually
│   └── pages.json
├── scripts/
│   ├── build-index.mjs            # Build-time embedding generator
│   └── eval.mjs                   # Offline retrieval evaluation helper
├── src/
│   ├── bm25.js
│   ├── debug-panel.js
│   ├── main.js                    # App entry point
│   ├── markdown.js
│   ├── metrics.js
│   ├── retrieval.js
│   ├── search.js                  # Similarity + formatting
│   ├── ui.js                      # DOM manipulation
│   ├── worker.js                  # Web Worker (Transformers.js)
│   └── style.css
├── index.html
├── vite.config.js
└── package.json
```

---

## License

MIT
