// Everything that turns untrusted input into the HTML we store.
//
// Documents are stored as sanitized HTML. The editor (TipTap) reads and writes HTML,
// imports are converted to HTML, and every write path goes through sanitizeContent(),
// so nothing a client sends can smuggle a <script> into another user's browser.

import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import mammoth from 'mammoth';

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_BYTES = 1_000_000; // 1 MB of HTML
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx'];

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'a',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], ol: ['start'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
};

export function sanitizeContent(html) {
  if (typeof html !== 'string') throw new HttpError(400, 'Content must be a string.');
  if (Buffer.byteLength(html, 'utf8') > MAX_CONTENT_BYTES) {
    throw new HttpError(413, 'This document is too large to save (limit is 1 MB).');
  }
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

export function cleanTitle(title) {
  if (typeof title !== 'string') throw new HttpError(400, 'Title must be a string.');
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new HttpError(400, 'Title cannot be empty.');
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Plain text: blank lines separate paragraphs, single newlines become line breaks.
function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Convert an uploaded file into { title, content } for a new document.
 * Supported: .txt, .md, .docx. Anything else is rejected with a clear message.
 */
export async function importFile({ originalname, buffer }) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new HttpError(
      415,
      `Unsupported file type "${ext || 'unknown'}". Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}.`
    );
  }
  if (!buffer || buffer.length === 0) throw new HttpError(400, 'That file is empty.');

  let html;
  if (ext === '.docx') {
    try {
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
    } catch {
      throw new HttpError(400, 'Could not read that .docx file. It may be corrupted or not a real Word document.');
    }
  } else {
    const text = buffer.toString('utf8');
    if (text.includes('\u0000')) throw new HttpError(400, 'That file does not look like a text file.');
    html = ext === '.md' ? marked.parse(text, { async: false }) : textToHtml(text);
  }

  const content = sanitizeContent(html);
  if (!content.trim()) throw new HttpError(400, 'No readable text was found in that file.');

  const base = path.basename(originalname, path.extname(originalname)).replace(/[_-]+/g, ' ');
  const title = cleanTitle(base || 'Imported document').slice(0, MAX_TITLE_LENGTH);
  return { title, content };
}
