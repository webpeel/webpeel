/**
 * Document (PDF/DOCX) parsing utilities.
 *
 * Keeps binary/document parsing separate from the HTML scraping pipeline.
 */

import { htmlToMarkdown, htmlToText } from './markdown.js';
import { extractPdf } from './pdf.js';

export type DocumentFormat = 'markdown' | 'text' | 'html';

export interface DocumentExtractionResult {
  content: string;
  metadata: {
    title: string;
    contentType: string;
    wordCount: number;
    [key: string]: any;
  };
}

export function normalizeContentType(contentTypeHeader: string | undefined | null): string {
  if (!contentTypeHeader) return '';
  return contentTypeHeader.split(';')[0]?.trim().toLowerCase() || '';
}

export function isPdfContentType(contentTypeHeader: string | undefined | null): boolean {
  const ct = normalizeContentType(contentTypeHeader);
  return ct === 'application/pdf' || ct.endsWith('+pdf');
}

export function isDocxContentType(contentTypeHeader: string | undefined | null): boolean {
  const ct = normalizeContentType(contentTypeHeader);
  return ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function basenameFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

function stripExtension(name: string): string {
  return name.replace(/\.(pdf|docx)$/i, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function countWords(text: string): number {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words.length;
}

function normalizePlainText(text: string): string {
  // pdf-parse returns lots of line breaks; keep paragraphs but reduce noise.
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export async function extractDocumentToFormat(
  buffer: Buffer,
  options: {
    url?: string;
    contentType?: string;
    format?: DocumentFormat;
  } = {}
): Promise<DocumentExtractionResult> {
  const { url, contentType, format = 'markdown' } = options;

  const normalized = normalizeContentType(contentType);
  const urlLower = (url || '').toLowerCase();

  const isPdf = isPdfContentType(normalized) || urlLower.endsWith('.pdf');
  const isDocx = isDocxContentType(normalized) || urlLower.endsWith('.docx');

  if (isPdf) {
    const pdf = await extractPdf(buffer);
    const text = normalizePlainText(pdf.text || '');

    const fallbackTitle = stripExtension(basenameFromUrl(url)) || 'PDF Document';
    const title = (pdf.metadata?.title as string) || fallbackTitle;

    const wordCount = countWords(text);

    let content: string;
    if (format === 'html') {
      content = `<pre>${escapeHtml(text)}</pre>`;
    } else {
      // markdown + text: return readable plain text.
      content = text;
    }

    return {
      content,
      metadata: {
        title,
        contentType: normalized || 'application/pdf',
        wordCount,
        pages: pdf.pages,
        ...pdf.metadata,
      },
    };
  }

  if (isDocx) {
    // Mammoth returns clean semantic HTML.
    const mammothMod = await import('mammoth');
    const mammoth: any = (mammothMod as any).default || mammothMod;

    const result = await mammoth.convertToHtml({ buffer });
    const html = (result?.value || '').trim();

    const fallbackTitle = stripExtension(basenameFromUrl(url)) || 'Word Document';
    const title = fallbackTitle;

    // Word count should be based on plain text, not markdown formatting.
    const plainText = htmlToText(html);
    const wordCount = countWords(plainText);

    let content: string;
    if (format === 'html') {
      content = html;
    } else if (format === 'text') {
      content = plainText;
    } else {
      content = htmlToMarkdown(html);
    }

    return {
      content,
      metadata: {
        title,
        contentType: normalized || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        wordCount,
        messages: result?.messages || [],
      },
    };
  }

  throw new Error(`Unsupported document type: ${normalized || contentType || 'unknown'}`);
}
