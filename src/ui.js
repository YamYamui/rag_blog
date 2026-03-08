// src/ui.js
// All DOM manipulation is isolated here. No business logic.

const STATUS_MESSAGES = {
  idle:          '',
  loading_model: 'Downloading AI model (~23 MB) — this is cached after the first visit.',
  loading_index: 'Loading knowledge base…',
  building_bm25: 'Building search index…',
  ready:         'Ready',
  searching:     'Searching…',
  error:         'AI model unavailable. BM25 search is active.',
  fallback:      'Running in BM25-only mode (WebAssembly not supported).',
};

/**
 * Update the status bar text and data-state attribute.
 */
export function setStatus(statusEl, state) {
  statusEl.textContent = STATUS_MESSAGES[state] ?? state;
  statusEl.dataset.state = state;
}

/**
 * Update the progress bar fill.
 */
export function setProgress(fillEl, pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  fillEl.style.width = `${clamped}%`;
  fillEl.setAttribute('aria-valuenow', clamped);
  fillEl.parentElement.style.opacity = clamped >= 100 ? '0' : '1';
}

/**
 * Append a user message row (ChatGPT/Claude style — avatar + text).
 */
export function appendUserMessage(chatEl, text) {
  const el = document.createElement('div');
  el.className = 'msg msg--user';
  el.innerHTML = `
    <div class="msg__avatar">Y</div>
    <div class="msg__body">
      <div class="msg__content">${escapeHtml(text)}</div>
    </div>`;
  chatEl.appendChild(el);
  scrollParentToBottom(chatEl);
  return el;
}

/**
 * Append an assistant message row with optional source citations.
 */
export function appendAssistantMessage(chatEl, summary, sources) {
  const el = document.createElement('div');
  el.className = 'msg msg--assistant';

  let sourcesHtml = '';
  if (sources.length > 0) {
    sourcesHtml = '<div class="msg__sources">';
    for (const s of sources) {
      // Determine if the link is an internal route
      const isInternal = s.url.startsWith('/');

      // Map the root path `/` to the `/about` route 
      const routePath = s.url === '/' ? '/about' : s.url;

      const href = isInternal ? `#${routePath}` : s.url;
      const linkAttributes = isInternal 
        ? '' // Keep internal navigation in the same tab
        : 'target="_blank" rel="noopener noreferrer"';

      sourcesHtml += `
        <div class="source-card">
          <div class="source-card__header">
            <a class="source-card__title" href="${escapeAttr(href)}" ${linkAttributes}>
              ${escapeHtml(s.title)}
            </a>
            <span class="source-card__score">${s.rrfScore != null ? `RRF ${Number(s.rrfScore).toFixed(4)}` : ''}</span>
          </div>
          <blockquote class="source-card__excerpt">${escapeHtml(s.excerpt)}</blockquote>
        </div>`;
    }
    sourcesHtml += '</div>';
  }

  el.innerHTML = `
    <div class="msg__avatar">AC</div>
    <div class="msg__body">
      <div class="msg__bubble">
        <div class="msg__content">${inlineMarkdown(summary)}</div>
        ${sourcesHtml}
      </div>
    </div>`;
  chatEl.appendChild(el);
  scrollParentToBottom(chatEl);
  return el;
}

/**
 * Show a skeleton "thinking" bubble.
 */
export function appendThinkingBubble(chatEl) {
  const el = document.createElement('div');
  el.className = 'msg msg--assistant msg--thinking';
  el.setAttribute('aria-busy', 'true');
  el.setAttribute('aria-label', 'Searching for an answer…');
  el.innerHTML = `
    <div class="msg__avatar">AC</div>
    <div class="msg__body">
      <div class="thinking-dots" role="status" aria-label="Searching">
        <span></span><span></span><span></span>
      </div>
    </div>`;
  chatEl.appendChild(el);
  scrollParentToBottom(chatEl);
  return el;
}

/**
 * Show suggested question chips.
 */
export function renderSuggestedQuestions(containerEl, questions, onClick) {
  containerEl.innerHTML = '';
  for (const q of questions) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = q;
    btn.setAttribute('aria-label', `Ask: ${q}`);
    btn.addEventListener('click', () => onClick(q));
    containerEl.appendChild(btn);
  }
}

/**
 * Hide the welcome screen when the first message is sent.
 */
export function hideWelcome(welcomeEl) {
  welcomeEl.classList.add('chat-welcome--hidden');
}

/**
 * Render a markdown knowledge base page into the content element.
 */
export function renderKBPage(contentEl, title, tags, htmlBody) {
  let tagsHtml = '';
  if (tags && tags.length > 0) {
    const tagList = typeof tags === 'string'
      ? tags.split(',').map(t => t.trim()).filter(Boolean)
      : tags;
    tagsHtml = '<div class="tags">' +
      tagList.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('') +
      '</div>';
  }
  contentEl.innerHTML = tagsHtml + htmlBody;
}

/**
 * Navigate to a page — handles showing/hiding pages and sidebar active state.
 */
export function navigateToPage(pageName) {
  // Update sidebar active state
  document.querySelectorAll('.sidebar__link').forEach(link => {
    link.classList.toggle('sidebar__link--active', link.dataset.page === pageName);
  });

  // Show/hide pages
  const chatPage = document.getElementById('page-chat');
  const kbPage = document.getElementById('page-kb');

  if (pageName === 'chat') {
    chatPage.classList.add('page--active');
    kbPage.classList.remove('page--active');
  } else {
    chatPage.classList.remove('page--active');
    kbPage.classList.add('page--active');
  }

  // Close mobile sidebar
  closeSidebar();
}

/**
 * Setup sidebar toggle for mobile.
 */
export function initSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const overlay = document.getElementById('sidebar-overlay');
  const sidebar = document.getElementById('sidebar');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar--open');
    overlay.classList.toggle('sidebar-overlay--visible');
  });

  overlay.addEventListener('click', closeSidebar);
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.remove('sidebar--open');
  overlay.classList.remove('sidebar-overlay--visible');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scrollParentToBottom(el) {
  const container = el.closest('.chat-container');
  if (container) container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape HTML then apply **bold** inline markdown only. */
function inlineMarkdown(str) {
  return escapeHtml(str).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Render a match quality pill on an assistant message bubble.
 * Shows the cosine similarity and BM25 rank of the top result.
 *
 * @param {HTMLElement} msgEl   — the .msg element returned by appendAssistantMessage
 * @param {object}      topResult — first item from formatResults()
 */
export function renderQualityPill(msgEl, topResult) {
  const existing = msgEl.querySelector('.quality-pill');
  if (existing) existing.remove();

  const pill = document.createElement('div');
  pill.className = 'quality-pill';
  const cosine = Number(topResult.cosineScore ?? 0);
  const level  = cosine > 0.55 ? 'high' : cosine > 0.35 ? 'mid' : 'low';
  pill.dataset.level = level;
  pill.innerHTML = `
    <span title="Cosine similarity of top result">cos ${cosine.toFixed(2)}</span>
    <span class="qp-sep">\u00B7</span>
    <span title="BM25 rank of top result in sparse list">${
      topResult.bm25Rank ? `BM25 #${topResult.bm25Rank}` : 'BM25 \u2014'
    }</span>
  `;
  msgEl.querySelector('.msg__bubble')?.insertAdjacentElement('afterend', pill);
}
