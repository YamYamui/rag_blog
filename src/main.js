// src/main.js
import {
  setStatus, setProgress,
  appendUserMessage, appendAssistantMessage,
  appendThinkingBubble, renderSuggestedQuestions,
  hideWelcome, renderKBPage, navigateToPage, initSidebar,
  renderQualityPill,
} from './ui.js';
import { formatResults, bm25Fallback, synthesiseAnswer, validateQuery } from './search.js';
import { markdownToHtml } from './markdown.js';
import { buildMetrics } from './metrics.js';
import { createDebugPanel, renderMetrics } from './debug-panel.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const chatEl        = document.getElementById('chat');
const chatContainer = document.getElementById('chat-container');
const inputEl       = document.getElementById('query-input');
const sendBtn       = document.getElementById('send-btn');
const statusEl      = document.getElementById('status');
const progressEl    = document.getElementById('progress-bar');
const chipsEl       = document.getElementById('suggested-chips');
const welcomeEl     = document.getElementById('chat-welcome');
const kbContentEl   = document.getElementById('kb-content');

// ─── Debug panel ─────────────────────────────────────────────────────────────
const chatPageEl = document.getElementById('page-chat');
const { bodyEl: debugBodyEl } = createDebugPanel(chatPageEl);

// ─── State ────────────────────────────────────────────────────────────────────
let worker      = null;
let workerReady = false;
let fallbackIdx = null;
let fallbackBM25 = null;
let useFallback = false;
let thinkingEl  = null;
let hasMessages = false;
let pagesCache  = null;

const SUGGESTED = [
  'What programming languages do you know?',
  'What is your work experience?',
  'What languages and frameworks do you know?',
  'Which hackathons have you won?',
  'When do you graduate?',
  'What are your current interests and projects?',
];

// ─── Knowledge base pages ─────────────────────────────────────────────────────
const KB_PAGES = {
  about:           { file: 'about.md',           title: 'About Me' },
  education:       { file: 'education.md',       title: 'Education' },
  experience:      { file: 'experience.md',      title: 'Work & Hackathon Experience' },
  'work-experience': { file: 'work-experience.md', title: 'Work Experience' },
  hackathons:      { file: 'hackathons.md',      title: 'Hackathons' },
  'student-life':    { file: 'student-life.md',    title: 'Student Life & Leadership' },
  projects:        { file: 'projects.md',        title: 'Projects' },
  skills:          { file: 'skills.md',          title: 'Skills & Technologies' },
};

async function loadPages() {
  if (pagesCache) return pagesCache;
  try {
    const baseUrl = getSiteBaseUrl();
    const res = await fetchWithTimeout(baseUrl + 'pages.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pagesCache = await res.json();
    return pagesCache;
  } catch {
    return null;
  }
}

async function showKBPage(pageName) {
  const pageInfo = KB_PAGES[pageName];
  if (!pageInfo) return;

  navigateToPage(pageName);
  kbContentEl.innerHTML = '<p style="color: var(--text-dim)">Loading…</p>';

  const pages = await loadPages();
  if (!pages) {
    kbContentEl.innerHTML = '<p>Failed to load knowledge base.</p>';
    return;
  }

  const page = pages.find(p => p.id === pageName);
  if (!page) {
    kbContentEl.innerHTML = '<p>Page not found.</p>';
    return;
  }

  const htmlBody = markdownToHtml(page.body);
  renderKBPage(kbContentEl, page.title, page.tags, htmlBody);
}

// ─── Router ───────────────────────────────────────────────────────────────────
function handleRoute() {
  const hash = window.location.hash.replace('#/', '') || 'chat';

  if (hash === 'chat' || hash === '') {
    navigateToPage('chat');
  } else if (KB_PAGES[hash]) {
    showKBPage(hash);
  } else {
    navigateToPage('chat');
  }
}

// ─── Base URL ─────────────────────────────────────────────────────────────────
function getSiteBaseUrl() {
  const { origin, pathname } = window.location;
  const dir = pathname.endsWith('/') ? pathname : pathname.slice(0, pathname.lastIndexOf('/') + 1);
  return origin + dir;
}

// ─── Worker setup ─────────────────────────────────────────────────────────────
function initWorker() {
  if (typeof WebAssembly === 'undefined') {
    return activateFallback('WebAssembly is not available in this browser.');
  }

  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.postMessage({ type: 'init', baseUrl: getSiteBaseUrl() });
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', (e) => {
      console.error('[Worker uncaught error]', e.message, e);
      activateFallback(`Worker failed to start: ${e.message || 'unknown error'}`);
    });
  } catch (err) {
    console.error('[Worker init error]', err);
    activateFallback(`Could not create worker: ${err.message}`);
  }
}

function onWorkerMessage({ data }) {
  switch (data.type) {
    case 'status':
      setStatus(statusEl, data.payload);
      break;
    case 'progress':
      setProgress(progressEl, data.payload);
      break;
    case 'ready':
      workerReady = true;
      setStatus(statusEl, 'ready');
      setProgress(progressEl, 100);
      enableInput();
      break;
    case 'results':
      showResults(data.payload);
      break;
    case 'metrics':
      handleMetrics(data.payload);
      break;
    case 'error':
      console.error('[Worker reported error]', data.payload);
      clearThinking();
      if (!workerReady) {
        activateFallback(data.payload);
      } else {
        appendAssistantMessage(chatEl, `Search error: ${data.payload}`, []);
        enableInput();
      }
      break;
  }
}

async function activateFallback(reason) {
  console.warn('[Fallback]', reason);
  useFallback = true;
  setStatus(statusEl, 'fallback');
  setProgress(progressEl, 100);

  if (!fallbackIdx) {
    try {
      const res = await fetchWithTimeout(getSiteBaseUrl() + 'index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fallbackIdx = await res.json();
      enableInput();
    } catch (err) {
      console.error('[Fallback] Could not load index.json:', err);
      setStatus(statusEl, 'error');
    }
  } else {
    enableInput();
  }
}

// ─── Query flow ───────────────────────────────────────────────────────────────
function submitQuery(text) {
  text = (text ?? inputEl.value).trim();
  if (!text) return;

  // Validate query before sending
  const validationError = validateQuery(text);
  if (validationError) {
    if (!hasMessages) { hideWelcome(welcomeEl); hasMessages = true; }
    appendUserMessage(chatEl, text);
    appendAssistantMessage(chatEl, validationError, []);
    inputEl.value = '';
    return;
  }

  // Switch to chat page if on KB page
  if (!document.getElementById('page-chat').classList.contains('page--active')) {
    window.location.hash = '#/chat';
    navigateToPage('chat');
  }

  inputEl.value = '';
  disableInput();

  if (!hasMessages) {
    hideWelcome(welcomeEl);
    hasMessages = true;
  }

  appendUserMessage(chatEl, text);
  thinkingEl = appendThinkingBubble(chatEl);

  if (useFallback && fallbackIdx) {
    const { results: raw, index } = bm25Fallback(text, fallbackIdx, fallbackBM25);
    fallbackBM25 = index;  // cache for next query
    showResults(raw);
  } else if (workerReady) {
    worker.postMessage({ type: 'query', payload: text });
  }
}

function showResults(rawResults) {
  clearThinking();
  const formatted = formatResults(rawResults);
  const summary   = synthesiseAnswer(formatted);
  const msgEl     = appendAssistantMessage(chatEl, summary, formatted);
  if (formatted.length > 0) renderQualityPill(msgEl, formatted[0]);
  enableInput();
}

function handleMetrics(rawMetrics) {
  const metrics = buildMetrics({
    query:        rawMetrics.query,
    queryTerms:   rawMetrics.queryTerms,
    bm25Results:  rawMetrics.bm25Top20,
    denseResults: rawMetrics.denseTop20,
    fusedResults: rawMetrics.fusedTop5,
    timing:       rawMetrics.timing,
    indexStats:   rawMetrics.indexStats,
  });
  renderMetrics(debugBodyEl, metrics);
}

function clearThinking() {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
}

// ─── Input state ──────────────────────────────────────────────────────────────
function enableInput()  { inputEl.disabled = false; sendBtn.disabled = false; inputEl.focus(); }
function disableInput() { inputEl.disabled = true;  sendBtn.disabled = true; }
/**
 * Fetch with a timeout (default 15 s). Prevents hanging on dead networks.
 */
function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}
// ─── Event wiring ─────────────────────────────────────────────────────────────
const queryForm = document.getElementById('query-form');
queryForm.addEventListener('submit', (e) => { e.preventDefault(); submitQuery(); });
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuery(); }
});

window.addEventListener('hashchange', handleRoute);

// ─── Boot ─────────────────────────────────────────────────────────────────────
disableInput();
setStatus(statusEl, 'loading_model');
renderSuggestedQuestions(chipsEl, SUGGESTED, submitQuery);
initSidebar();
initWorker();
handleRoute();
