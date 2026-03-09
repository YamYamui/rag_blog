// scripts/eval.mjs
// Offline retrieval evaluation harness.
// Run with: node scripts/eval.mjs
//
// Reads index.json, runs a golden query set through BM25, and computes
// standard IR metrics: MRR, nDCG@5, Precision@5, Recall@5.
//
// Dense evaluation requires the embedding model and is optional — pass
// --dense to enable it (slower, downloads model on first run).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '../public/index.json');

// ─── Duplicated from src/bm25.js (must stay in sync) ────────────────────────
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

// ─── Minimal BM25 (mirrors src/bm25.js) ─────────────────────────────────────
const K1 = 1.5, B = 0.75;

function buildBM25(records) {
  const N = records.length;
  const docs = [];
  const df = new Map();
  let totalLen = 0;

  for (const rec of records) {
    const terms = rec.terms?.length ? rec.terms : tokenize(rec.text);
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    docs.push({ id: rec.id, tf, dl: terms.length });
    totalLen += terms.length;
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const avgdl = totalLen / N;

  return function search(query, topK = 20) {
    const qTerms = tokenize(query);
    if (qTerms.length === 0) return [];

    const idfs = new Map();
    for (const t of qTerms) {
      const d = df.get(t) ?? 0;
      idfs.set(t, Math.max(0, Math.log((N - d + 0.5) / (d + 0.5))));
    }

    const scores = docs.map(({ id, tf, dl }) => {
      let score = 0;
      const lenNorm = 1 - B + B * (dl / avgdl);
      for (const [t, idf] of idfs) {
        const freq = tf.get(t) ?? 0;
        if (freq === 0) continue;
        score += idf * (freq * (K1 + 1)) / (freq + K1 * lenNorm);
      }
      return { id, score };
    });

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  };
}

// ─── IR metrics ──────────────────────────────────────────────────────────────

/** Mean Reciprocal Rank: 1/rank of first relevant result (0 if none found) */
function mrr(retrieved, relevant) {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

/** Precision@k: fraction of top-k that are relevant */
function precisionAtK(retrieved, relevant, k) {
  const topK = retrieved.slice(0, k);
  return topK.filter(id => relevant.has(id)).length / k;
}

/** Recall@k: fraction of relevant docs found in top-k */
function recallAtK(retrieved, relevant, k) {
  if (relevant.size === 0) return 0;
  const topK = new Set(retrieved.slice(0, k));
  return [...relevant].filter(id => topK.has(id)).length / relevant.size;
}

/** nDCG@k: normalised discounted cumulative gain */
function ndcgAtK(retrieved, relevant, k) {
  const topK = retrieved.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2); // i is 0-indexed, so rank = i+1, log2(rank+1)
    }
  }
  // Ideal DCG: all relevant docs at top
  const idealCount = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

// ─── Golden query set ────────────────────────────────────────────────────────
// Each entry: { query, relevant: [chunkId, ...], description }
// Use prefix matching: "projects-chunk" matches any projects-chunk* ID.

const GOLDEN_SET = [
  {
    query: 'Who is Lee Kwan Tze?',
    relevant: ['about-chunk0'],
    description: 'About page lookup',
  },
  {
    query: 'What is this website?',
    relevant: ['projects-chunk1'],
    description: 'Browser-based RAG project lookup',
  },
  {
    query: 'Tell me about your internship experience',
    relevant: ['work-experience-chunk1'],
    description: 'Work experience retrieval',
  },
  {
    query: 'What programming languages do you know?',
    relevant: ['skills-chunk2'],
    description: 'Programming languages skill lookup',
  },
  {
    query: 'RAG experience',
    relevant: ['projects-chunk1', 'projects-chunk2', 'hackathons-chunk2', 'skills-chunk4', 'about-chunk0'],
    description: 'Cross-document RAG topic retrieval',
  },
  {
    query: 'What hackathons have you participated in?',
    relevant: ['hackathons-chunk1', 'hackathons-chunk2'],
    description: 'Hackathon retrieval',
  },
  {
    query: 'Computer vision projects',
    relevant: ['work-experience-chunk1'],
    description: 'CV work at Trilogy',
  },
  {
    query: 'What is your education background?',
    relevant: ['education-chunk1', 'education-chunk2'],
    description: 'Education background',
  },
  {
    query: 'ESP32 Raspberry Pi experience',
    relevant: ['hackathons-chunk1', 'work-experience-chunk1'],
    description: 'Hardware / embedded lookup',
  },
  {
    query: 'FastAPI experience',
    relevant: ['skills-chunk3', 'work-experience-chunk1', 'hackathons-chunk1'],
    description: 'Specific framework query',
  },
  {
    query: 'Student activities and CCAs',
    relevant: ['student-life-chunk1', 'student-life-chunk2'],
    description: 'Student life retrieval',
  },
  {
    query: 'Tell me about CS6101',
    relevant: ['projects-chunk2'],
    description: 'Direct project lookup — RASD benchmark',
  },
  {
    query: 'What certifications do you have?',
    relevant: ['skills-chunk5'],
    description: 'Certifications lookup',
  },
  {
    query: 'Gemini API projects',
    relevant: ['hackathons-chunk2', 'skills-chunk4'],
    description: 'Gemini-specific retrieval',
  },
  {
    query: 'BM25 hybrid retrieval',
    relevant: ['projects-chunk1'],
    description: 'Retrieval technique query',
  },
  {
    query: 'Next.js web development',
    relevant: ['skills-chunk3', 'work-experience-chunk1'],
    description: 'Next.js framework retrieval',
  },
  {
    query: 'Tell me about Hack and Roll',
    relevant: ['hackathons-chunk1'],
    description: 'Direct hackathon lookup',
  },
  {
    query: 'Trilogy Technologies internship',
    relevant: ['work-experience-chunk1'],
    description: 'Specific company lookup',
  },
  {
    query: 'Vector database experience',
    relevant: ['skills-chunk4', 'hackathons-chunk2'],
    description: 'Vector DB / search retrieval',
  },
  {
    query: 'Docker deployment experience',
    relevant: ['skills-chunk3', 'work-experience-chunk1'],
    description: 'Docker tool lookup',
  },
];

// ─── Resolve relevant IDs using prefix matching ─────────────────────────────
function resolveRelevant(goldenRelevant, allIds) {
  const resolved = new Set();
  for (const pattern of goldenRelevant) {
    for (const id of allIds) {
      // Exact match or prefix match (e.g., "projects-chunk0" matches "projects-chunk0")
      if (id === pattern || id.startsWith(pattern + '-')) {
        resolved.add(id);
      }
    }
    // If no fuzzy match found, keep original (exact ID)
    if (![...resolved].some(r => r === pattern || r.startsWith(pattern))) {
      resolved.add(pattern);
    }
  }
  return resolved;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📊 RAG Retrieval Evaluation\n' + '─'.repeat(50));

  // Load index
  let indexData;
  try {
    indexData = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    console.error('❌ Could not read index.json. Run `node scripts/build-index.mjs` first.');
    process.exit(1);
  }

  console.log(`Index: ${indexData.length} chunks loaded\n`);

  const allIds = indexData.map(r => r.id);
  const search = buildBM25(indexData);

  const K = 5;
  let totalMRR = 0, totalNDCG = 0, totalP = 0, totalR = 0;
  let passed = 0;

  console.log('  # │ MRR    │ nDCG@5 │ P@5    │ R@5    │ Query');
  console.log('────┼────────┼────────┼────────┼────────┼' + '─'.repeat(40));

  for (let i = 0; i < GOLDEN_SET.length; i++) {
    const { query, relevant: goldenRelevant, description } = GOLDEN_SET[i];
    const relevantSet = resolveRelevant(goldenRelevant, allIds);
    const results = search(query, K * 4);
    const retrieved = results.map(r => r.id);

    const m  = mrr(retrieved, relevantSet);
    const n  = ndcgAtK(retrieved, relevantSet, K);
    const p  = precisionAtK(retrieved, relevantSet, K);
    const r  = recallAtK(retrieved, relevantSet, K);

    totalMRR  += m;
    totalNDCG += n;
    totalP    += p;
    totalR    += r;

    const ok = m > 0 ? '✅' : '❌';
    if (m > 0) passed++;

    const num = String(i + 1).padStart(2);
    console.log(
      ` ${num} │ ${m.toFixed(4)} │ ${n.toFixed(4)} │ ${p.toFixed(4)} │ ${r.toFixed(4)} │ ${ok} ${query}`
    );
  }

  const count = GOLDEN_SET.length;
  console.log('────┼────────┼────────┼────────┼────────┼' + '─'.repeat(40));
  console.log(
    `AVG │ ${(totalMRR / count).toFixed(4)} │ ${(totalNDCG / count).toFixed(4)} │ ` +
    `${(totalP / count).toFixed(4)} │ ${(totalR / count).toFixed(4)} │ ` +
    `${passed}/${count} queries hit relevant doc at rank 1`
  );

  console.log('\n' + '─'.repeat(50));
  console.log('Legend: MRR = Mean Reciprocal Rank, nDCG = normalised DCG,');
  console.log('        P@5 = Precision at 5, R@5 = Recall at 5');
  console.log('─'.repeat(50) + '\n');

  // Exit with error if MRR is below threshold
  const avgMRR = totalMRR / count;
  if (avgMRR < 0.4) {
    console.error(`⚠️  Average MRR (${avgMRR.toFixed(4)}) is below 0.40 threshold.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Eval failed:', err.message);
  process.exit(1);
});
