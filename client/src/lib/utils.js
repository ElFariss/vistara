/**
 * Pure utility functions — no state or DOM side-effects.
 */

import { refs } from './state.js';
import {
  UPLOAD_ALLOWED_EXTENSIONS,
  UPLOAD_BLOCKED_EXTENSIONS,
  UPLOAD_ALLOWED_LABEL,
} from './constants.js';

// ── HTML / Attributes ──────────────────────────────────────────────────────

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeAttribute(value) {
  return escapeHtml(String(value || '')).replace(/"/g, '&quot;');
}

// ── ID generators ──────────────────────────────────────────────────────────

export function generateWidgetId() {
  return `widget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── File validation ────────────────────────────────────────────────────────

export function normalizeFileExtension(filename = '') {
  const trimmed = String(filename || '').trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return trimmed.slice(dotIndex).toLowerCase();
}

export function validateUploadFile(file) {
  if (!file) {
    throw new Error('Pilih file dulu.');
  }
  const ext = normalizeFileExtension(file.name);
  if (!ext) {
    throw new Error(`Format file tidak didukung. Gunakan ${UPLOAD_ALLOWED_LABEL}.`);
  }
  if (UPLOAD_BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Format ${ext} tidak didukung. Gunakan ${UPLOAD_ALLOWED_LABEL}.`);
  }
  if (!UPLOAD_ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Format file tidak didukung. Gunakan ${UPLOAD_ALLOWED_LABEL}.`);
  }
  return true;
}

// ── Toast ──────────────────────────────────────────────────────────────────

export function showToast(message, timeout = 3000) {
  if (!refs.toast) {
    return;
  }

  refs.toast.textContent = message;
  refs.toast.classList.remove('hidden');

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    if (refs.toast) {
      refs.toast.classList.add('hidden');
    }
  }, timeout);
}

// ── Confirm Modal ──────────────────────────────────────────────────────────

export function showConfirmModal(message) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';

    const modal = document.createElement('aside');
    modal.className = 'confirm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const body = document.createElement('div');
    body.className = 'confirm-modal-body';

    const textGroup = document.createElement('div');
    const title = document.createElement('strong');
    title.className = 'confirm-title';
    title.textContent = 'Konfirmasi';
    const text = document.createElement('p');
    text.className = 'confirm-message';
    text.textContent = message;
    textGroup.append(title, text);

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ghost confirm-cancel';
    cancelBtn.textContent = 'Batal';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'confirm-ok';
    okBtn.textContent = 'Ya, Hapus';
    actions.append(cancelBtn, okBtn);

    body.append(textGroup, actions);
    modal.append(body);
    document.body.append(backdrop, modal);

    const cleanup = () => {
      backdrop.remove();
      modal.remove();
    };

    cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
    okBtn.addEventListener('click', () => { cleanup(); resolve(true); });
  });
}

// ── Misc helpers ───────────────────────────────────────────────────────────

export function isMobileViewport() {
  return window.innerWidth < 768;
}

export function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function isNetworkLikeError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('networkerror')
    || message.includes('failed to fetch')
    || message.includes('fetch resource')
    || message.includes('network request failed')
  );
}

export function createAppError(message, options = {}) {
  const error = new Error(message || 'Request gagal');
  if (options.code) {
    error.code = options.code;
  }
  if (options.statusCode || options.status) {
    error.statusCode = Number(options.statusCode || options.status);
  }
  if (options.details !== undefined) {
    error.details = options.details;
  }
  if (options.conversationId) {
    error.conversationId = options.conversationId;
  }
  if (options.persistedInConversation !== undefined) {
    error.persistedInConversation = Boolean(options.persistedInConversation);
  }
  return error;
}

// ── Markdown parsing ───────────────────────────────────────────────────────

export function plainTextFromMarkdown(content = '') {
  return String(content || '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMarkdownBlocks(content = '') {
  const lines = String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      blocks.push({ type: 'paragraph', text });
    }
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);

    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const type = unorderedMatch ? 'ul' : 'ol';
      const items = [];
      let cursor = index;
      while (cursor < lines.length) {
        const nextLine = lines[cursor].trim();
        const nextMatch = type === 'ul'
          ? nextLine.match(/^[-*+]\s+(.+)$/)
          : nextLine.match(/^\d+\.\s+(.+)$/);
        if (!nextMatch) {
          break;
        }
        items.push(nextMatch[1].trim());
        cursor += 1;
      }
      blocks.push({ type, items });
      index = cursor - 1;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

export function appendInlineMarkdown(parent, content = '') {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  const text = String(content || '');

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, start)));
    }

    let node = null;
    if (token.startsWith('**') && token.endsWith('**')) {
      node = document.createElement('strong');
      node.textContent = token.slice(2, -2);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      node = document.createElement('em');
      node.textContent = token.slice(1, -1);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      node = document.createElement('code');
      node.textContent = token.slice(1, -1);
    }

    if (node) {
      parent.append(node);
    } else {
      parent.append(document.createTextNode(token));
    }
    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

export function renderMarkdownContent(container, content = '', options = {}) {
  const blocks = parseMarkdownBlocks(content);
  const className = options.className || '';
  if (className) {
    container.classList.add(className);
  }

  if (blocks.length === 0) {
    const fallback = document.createElement('p');
    fallback.textContent = String(content || '').trim();
    container.append(fallback);
    return;
  }

  blocks.forEach((block, index) => {
    if (block.type === 'paragraph') {
      const paragraph = document.createElement(index === 0 && options.firstParagraphAsSpan ? 'span' : 'p');
      appendInlineMarkdown(paragraph, block.text);
      container.append(paragraph);
      return;
    }

    const list = document.createElement(block.type === 'ol' ? 'ol' : 'ul');
    block.items.forEach((item) => {
      const li = document.createElement('li');
      appendInlineMarkdown(li, item);
      list.append(li);
    });
    container.append(list);
  });
}

export function normalizeTimelineTitle(title = '') {
  const value = String(title || '').trim();
  if (!value || /^agentic thinking$/i.test(value)) {
    return 'Proses analisis';
  }
  return value;
}

export function summarizeDashboardText(content = '') {
  const value = plainTextFromMarkdown(content || '');
  if (!value) {
    return 'Ringkasan dashboard siap dibuka di panel kanan.';
  }

  const firstSentence = value.match(/.+?[.!?](?:\s|$)/)?.[0]?.trim() || value;
  if (firstSentence.length <= 148) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 145).trimEnd()}...`;
}

export function dashboardSummaryParagraphs(message = {}) {
  return String(message.content || '')
    .split(/\n{2,}/)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function isContextComplete(profile) {
  return Boolean(profile?.name && profile?.industry && profile?.city);
}
