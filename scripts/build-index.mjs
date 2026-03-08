// scripts/build-index.mjs
// Run with: node scripts/build-index.mjs
// Requires: @xenova/transformers installed as a dev dependency

import { pipeline } from '@xenova/transformers';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(__dirname, '../knowledge');
const OUTPUT_DIR    = join(__dirname, '../public');
const OUTPUT_PATH   = join(OUTPUT_DIR, 'index.json');
const PAGES_PATH    = join(OUTPUT_DIR, 'pages.json');
const CHUNK_SIZE    = 250;   // words per chunk
const CHUNK_OVERLAP = 40;    // overlapping words between chunks
const MODEL         = 'Xenova/all-MiniLM-L6-v2';
const MAX_SIZE_MB   = 90;

// Minimal tokeniser for BM25 index pre-computation.
// Keep in sync with src/bm25.js tokenize() — both must produce identical tokens.
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'this','that','these','those','it','its','i','you','he','she','we',
  'they','what','which','who','when','where','how','all','as','up','out',
  'if','about','into','than','then','so','no','not','also','can',
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  // Split on markdown headings (## or ###) to respect section boundaries
  const sections = text.split(/(?=^#{2,3}\s)/m).filter(s => s.trim());

  const chunks = [];
  for (const section of sections) {
    const words = section.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // If section fits in one chunk, keep it as-is
    if (words.length <= size) {
      chunks.push(words.join(' '));
    } else {
      // Slide a window within the section (don't cross section boundaries)
      let i = 0;
      while (i < words.length) {
        const chunk = words.slice(i, i + size).join(' ');
        if (chunk.trim()) chunks.push(chunk);
        i += size - overlap;
      }
    }
  }
  return chunks;
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔨 RAG Index Builder\n' + '─'.repeat(40));

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Knowledge directory: ${KNOWLEDGE_DIR}`);
  console.log(`Output path:         ${OUTPUT_PATH}`);
  console.log(`Model:               ${MODEL}`);
  console.log(`Chunk size:          ${CHUNK_SIZE} words (${CHUNK_OVERLAP} overlap)\n`);

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

    console.log(`  Processing: ${file}`);
    console.log(`    Title:  ${meta.title ?? '(no title)'}`);
    console.log(`    URL:    ${meta.url ?? '/'}`);
    console.log(`    Chunks: ${chunks.length}`);

    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];

      // Generate embedding
      const output = await embedder(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data);

      records.push({
        id:          `${file.replace('.md', '')}-chunk${i}`,
        source_file: file,
        title:       meta.title  ?? file.replace('.md', ''),
        url:         meta.url    ?? '/',
        tags:        meta.tags   ?? '',
        text,
        terms:       tokenize(text),
        vector,
      });

      process.stdout.write(`    Embedding chunk ${i + 1}/${chunks.length}…\r`);
    }
    console.log(`    ✓ Done (${chunks.length} chunks embedded)         `);
  }

  // Serialise and write
  const json = JSON.stringify(records);
  const sizeBytes = Buffer.byteLength(json, 'utf8');
  const sizeMB = sizeBytes / 1024 / 1024;

  if (sizeMB > MAX_SIZE_MB) {
    throw new Error(
      `ABORT: index.json is ${formatBytes(sizeBytes)}, exceeding the ${MAX_SIZE_MB}MB limit.\n` +
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
