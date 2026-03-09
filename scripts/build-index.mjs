// scripts/build-index.mjs
// Run with: node scripts/build-index.mjs
// Requires: @xenova/transformers installed as a dev dependency

import { pipeline } from '@xenova/transformers';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MODEL, CHUNK_SIZE, CHUNK_OVERLAP, MIN_CHUNK_SIZE, MAX_INDEX_SIZE_MB, tokenize } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(__dirname, '../knowledge');
const OUTPUT_DIR    = join(__dirname, '../public');
const OUTPUT_PATH   = join(OUTPUT_DIR, 'index.json');
const PAGES_PATH    = join(OUTPUT_DIR, 'pages.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function toWords(text) {
  return text.split(/\s+/).filter(Boolean);
}

function normaliseForEmbedding(text) {
  return text
    // Drop fenced code blocks to reduce low-signal tokens in embeddings.
    .replace(/```[\s\S]*?```/g, ' ')
    // Convert markdown links/images to visible text only.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Remove markdown decorators while keeping semantic text.
    .replace(/(^|\s)[#>*`~_-]{1,6}(?=\s)/gm, ' ')
    .replace(/\r?\n+/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoSections(text) {
  // Respect all common heading levels so structure is less author-format dependent.
  const parts = text.split(/(?=^#{1,4}\s)/m).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

function splitIntoParagraphs(section) {
  return section
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(Boolean);
}

function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map(s => s.trim()).filter(Boolean);
}

function splitOversizedUnit(unit, size, overlap) {
  const words = toWords(unit);
  if (words.length <= size) return [unit];

  const step = Math.max(1, size - overlap);
  const out = [];
  for (let i = 0; i < words.length; i += step) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk) out.push(chunk);
  }
  return out;
}

function withOverlap(chunks, overlap) {
  if (chunks.length <= 1 || overlap <= 0) return chunks;

  const out = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const prevWords = toWords(out[i - 1]);
    const overlapText = prevWords.slice(Math.max(0, prevWords.length - overlap)).join(' ');
    out.push((overlapText ? `${overlapText} ` : '') + chunks[i]);
  }
  return out;
}

function mergeTinyTail(chunks, minSize = MIN_CHUNK_SIZE) {
  if (chunks.length < 2) return chunks;
  const tail = chunks[chunks.length - 1];
  if (wordCount(tail) >= minSize) return chunks;

  const merged = [...chunks];
  merged[merged.length - 2] = `${merged[merged.length - 2]} ${tail}`.trim();
  merged.pop();
  return merged;
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const sections = splitIntoSections(text);
  const allChunks = [];

  for (const section of sections) {
    const headingMatch = section.match(/^#{1,4}\s+(.+?)(?:\r?\n|$)/);
    const heading = headingMatch ? headingMatch[1].trim() : '';

    const paragraphs = splitIntoParagraphs(section);
    const units = [];

    for (const paragraph of paragraphs) {
      const cleaned = normaliseForEmbedding(paragraph);
      if (!cleaned) continue;

      if (wordCount(cleaned) <= size) {
        units.push(cleaned);
        continue;
      }

      // Large paragraphs are split by sentences first, then hard-windowed if needed.
      const sentences = splitIntoSentences(cleaned);
      for (const sentence of sentences) {
        const sentenceWords = wordCount(sentence);
        if (sentenceWords <= size) {
          units.push(sentence);
        } else {
          units.push(...splitOversizedUnit(sentence, size, overlap));
        }
      }
    }

    if (!units.length) continue;

    const sectionChunks = [];
    let current = [];
    let currentWords = 0;

    for (const unit of units) {
      const uWords = wordCount(unit);
      if (currentWords + uWords <= size) {
        current.push(unit);
        currentWords += uWords;
      } else {
        if (current.length) sectionChunks.push(current.join(' '));
        current = [unit];
        currentWords = uWords;
      }
    }
    if (current.length) sectionChunks.push(current.join(' '));

    const dedupedTail = mergeTinyTail(sectionChunks, MIN_CHUNK_SIZE);
    const overlapped = withOverlap(dedupedTail, overlap);
    for (const chunk of overlapped) {
      allChunks.push({ text: chunk, heading });
    }
  }

  return allChunks;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^\[|\]$/g, '');
    if (key) meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ─── PCA 2D projection (for embedding map) ──────────────────────────────────
// Computes the top-2 principal components from the embedding matrix and projects
// all vectors to 2D. The mean + component vectors are saved to pca.json so the
// browser can project new query vectors at query time with just 2 dot products.
function computePCA2D(vectors) {
  const n   = vectors.length;
  const dim = vectors[0].length;

  // 1. Mean vector
  const mean = new Array(dim).fill(0);
  for (const v of vectors) for (let j = 0; j < dim; j++) mean[j] += v[j];
  for (let j = 0; j < dim; j++) mean[j] /= n;

  // 2. Centre
  const centered = vectors.map(v => v.map((x, j) => x - mean[j]));

  // 3. Gram matrix X Xᵀ (n×n) — cheap because n << dim
  const gram = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let d = 0;
      for (let k = 0; k < dim; k++) d += centered[i][k] * centered[j][k];
      return d;
    })
  );

  // 4. Power iteration to find top eigenvectors of gram matrix
  function powerIter(mat, iters = 400) {
    let v = new Array(n).fill(1 / Math.sqrt(n));
    for (let it = 0; it < iters; it++) {
      const nxt = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nxt[i] += mat[i][j] * v[j];
      let norm = 0;
      for (const x of nxt) norm += x * x;
      norm = Math.sqrt(norm);
      v = nxt.map(x => x / (norm || 1));
    }
    const mv = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mv[i] += mat[i][j] * v[j];
    const eigenvalue = v.reduce((s, x, i) => s + x * mv[i], 0);
    return { v, eigenvalue };
  }

  const { v: u1, eigenvalue: e1 } = powerIter(gram);
  // Deflate and find second component
  const gram2 = gram.map((row, i) => row.map((val, j) => val - e1 * u1[i] * u1[j]));
  const { v: u2 } = powerIter(gram2);

  // 5. Recover principal directions in full dim-space via X^T u
  function toPC(u) {
    const pc = new Array(dim).fill(0);
    for (let j = 0; j < dim; j++) for (let i = 0; i < n; i++) pc[j] += centered[i][j] * u[i];
    let norm = 0;
    for (const x of pc) norm += x * x;
    norm = Math.sqrt(norm);
    return pc.map(x => x / (norm || 1));
  }

  const pc1 = toPC(u1);
  const pc2 = toPC(u2);

  // 6. Project all centred vectors
  const projections = centered.map(v => [
    v.reduce((s, x, j) => s + x * pc1[j], 0),
    v.reduce((s, x, j) => s + x * pc2[j], 0),
  ]);

  return { mean, components: [pc1, pc2], projections };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔨 RAG Index Builder\n' + '─'.repeat(40));

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Knowledge directory: ${KNOWLEDGE_DIR}`);
  console.log(`Output path:         ${OUTPUT_PATH}`);
  console.log(`Model:               ${MODEL}`);
  console.log(`Chunk size:          ${CHUNK_SIZE} words (${CHUNK_OVERLAP} overlap, min tail ${MIN_CHUNK_SIZE})\n`);

  // Load embedding model
  console.log('Loading embedding model (first run downloads ~25MB)…');
  const embedder = await pipeline('feature-extraction', MODEL, { quantized: true });
  console.log('Model loaded\n');

  // Discover markdown files
  const files = readdirSync(KNOWLEDGE_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .md files found in ${KNOWLEDGE_DIR}`);
  }

  console.log(`Found ${files.length} knowledge file(s): ${files.join(', ')}\n`);

  const records = [];

  for (const file of files) {
    const raw = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const chunks = chunkText(body);
    const docTitle = meta.title ?? file.replace('.md', '');

    console.log(`  Processing: ${file}`);
    console.log(`    Title:  ${docTitle}`);
    console.log(`    URL:    ${meta.url ?? '/'}`);
    console.log(`    Chunks: ${chunks.length}`);

    for (let i = 0; i < chunks.length; i++) {
      const { text, heading } = chunks[i];

      // Enriched text includes title/heading context for better embeddings and BM25
      const contextPrefix = [docTitle, heading].filter(Boolean).join(' — ');
      const enrichedText = contextPrefix ? `${contextPrefix}: ${text}` : text;

      // Generate embedding from enriched text
      const output = await embedder(enrichedText, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data);

      records.push({
        id:          `${file.replace('.md', '')}-chunk${i}`,
        source_file: file,
        title:       docTitle,
        url:         meta.url    ?? '/',
        tags:        meta.tags   ?? '',
        text,
        terms:       tokenize(enrichedText),
        vector,
      });

      process.stdout.write(`    Embedding chunk ${i + 1}/${chunks.length}…\r`);
    }
    console.log(`    ✓ Done (${chunks.length} chunks embedded)         `);
  }

  // ─── Compute PCA 2D projections ──────────────────────────────────────────
  process.stdout.write('Computing PCA 2D projections…\r');
  const { mean: pcaMean, components: pcaComponents, projections } = computePCA2D(records.map(r => r.vector));
  for (let i = 0; i < records.length; i++) records[i].xy = projections[i];

  const pcaPath = join(OUTPUT_DIR, 'pca.json');
  const pcaJson = JSON.stringify({ mean: pcaMean, components: pcaComponents });
  writeFileSync(pcaPath, pcaJson, 'utf8');
  console.log(`pca.json written     (${formatBytes(Buffer.byteLength(pcaJson, 'utf8'))})`);

  // Serialise and write
  const json = JSON.stringify(records);
  const sizeBytes = Buffer.byteLength(json, 'utf8');
  const sizeMB = sizeBytes / 1024 / 1024;

  if (sizeMB > MAX_INDEX_SIZE_MB) {
    throw new Error(
      `ABORT: index.json is ${formatBytes(sizeBytes)}, exceeding the ${MAX_INDEX_SIZE_MB}MB limit.\n` +
      `  → Reduce CHUNK_SIZE, remove large knowledge files, or split across multiple indexes.`
    );
  }

  writeFileSync(OUTPUT_PATH, json, 'utf8');

  console.log('\n' + '─'.repeat(40));
  console.log(`index.json written successfully`);
  console.log(`   Records:    ${records.length}`);
  console.log(`   File size:  ${formatBytes(sizeBytes)}`);
  console.log(`   Path:       ${OUTPUT_PATH}`);
  console.log('─'.repeat(40) + '\n');

  // ─── Build pages.json (full markdown content for KB pages) ─────────────
  console.log('Building pages.json for knowledge base pages…\n');

  const pages = [];
  for (const file of files) {
    const raw = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const id = file.replace('.md', '');

    pages.push({
      id,
      title:  meta.title ?? id,
      url:    meta.url   ?? '/',
      tags:   meta.tags  ?? '',
      body:   raw,
    });

    console.log(`  Added page: ${id} (${meta.title ?? '(no title)'})`);
  }

  const pagesJson = JSON.stringify(pages);
  writeFileSync(PAGES_PATH, pagesJson, 'utf8');

  const pagesSizeBytes = Buffer.byteLength(pagesJson, 'utf8');
  console.log('\n' + '─'.repeat(40));
  console.log(`pages.json written successfully`);
  console.log(`   Pages:      ${pages.length}`);
  console.log(`   File size:  ${formatBytes(pagesSizeBytes)}`);
  console.log(`   Path:       ${PAGES_PATH}`);
  console.log('─'.repeat(40) + '\n');
}

main().catch(err => {
  console.error('\n❌ Build failed:', err.message);
  process.exit(1);
});
