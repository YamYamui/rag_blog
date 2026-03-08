// src/markdown.js
// Lightweight markdown-to-HTML converter. Handles the subset used in the knowledge base.

export function markdownToHtml(md) {
  // Remove frontmatter
  md = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

  let html = '';
  const lines = md.split(/\r?\n/);
  let i = 0;
  let inList = false;
  let listType = '';
  let inCodeBlock = false;
  let codeContent = '';

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html += `<pre><code>${escapeHtml(codeContent.trimEnd())}</code></pre>\n`;
        codeContent = '';
        inCodeBlock = false;
        i++;
        continue;
      } else {
        closeList();
        inCodeBlock = true;
        i++;
        continue;
      }
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      closeList();
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      closeList();
      html += '<hr>\n';
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const text = inline(headingMatch[2]);
      html += `<h${level}>${text}</h${level}>\n`;
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList || listType !== 'ul') {
        closeList();
        html += '<ul>\n';
        inList = true;
        listType = 'ul';
      }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>\n`;
      i++;
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inList || listType !== 'ol') {
        closeList();
        html += '<ol>\n';
        inList = true;
        listType = 'ol';
      }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>\n`;
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      closeList();
      html += `<blockquote>${inline(line.replace(/^>\s*/, ''))}</blockquote>\n`;
      i++;
      continue;
    }

    // Paragraph
    closeList();
    html += `<p>${inline(line)}</p>\n`;
    i++;
  }

  closeList();
  return html;

  function closeList() {
    if (inList) {
      html += listType === 'ul' ? '</ul>\n' : '</ol>\n';
      inList = false;
      listType = '';
    }
  }
}

// Inline formatting
function inline(text) {
  // Escape HTML first
  text = escapeHtml(text);
  // Bold + italic
  text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = sanitizeUrl(url);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  // Line breaks (two trailing spaces)
  text = text.replace(/ {2,}$/, '<br>');
  return text;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url, 'https://placeholder.invalid');
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return '#';
    return url;
  } catch {
    if (url.startsWith('/') || url.startsWith('#')) return url;
    return '#';
  }
}
