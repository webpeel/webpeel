/**
 * Tests for document parsing (PDF and DOCX)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  isPdfContentType,
  isDocxContentType,
  normalizeContentType,
  extractDocumentToFormat,
} from '../core/documents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Content-type detection helpers
// ---------------------------------------------------------------------------

describe('normalizeContentType', () => {
  it('strips charset and whitespace', () => {
    expect(normalizeContentType('application/pdf; charset=utf-8')).toBe('application/pdf');
    expect(normalizeContentType('  TEXT/HTML ; charset=utf-8 ')).toBe('text/html');
  });

  it('returns empty string for falsy input', () => {
    expect(normalizeContentType(null)).toBe('');
    expect(normalizeContentType(undefined)).toBe('');
    expect(normalizeContentType('')).toBe('');
  });
});

describe('isPdfContentType', () => {
  it('detects application/pdf', () => {
    expect(isPdfContentType('application/pdf')).toBe(true);
    expect(isPdfContentType('application/pdf; charset=binary')).toBe(true);
    expect(isPdfContentType('Application/PDF')).toBe(true);
  });

  it('rejects non-PDF types', () => {
    expect(isPdfContentType('text/html')).toBe(false);
    expect(isPdfContentType('application/json')).toBe(false);
    expect(isPdfContentType(null)).toBe(false);
  });
});

describe('isDocxContentType', () => {
  it('detects DOCX content type', () => {
    expect(isDocxContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(isDocxContentType('Application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8')).toBe(true);
  });

  it('rejects non-DOCX types', () => {
    expect(isDocxContentType('application/pdf')).toBe(false);
    expect(isDocxContentType('application/msword')).toBe(false);
    expect(isDocxContentType(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

describe('extractDocumentToFormat — PDF', () => {
  let pdfBuffer: Buffer;

  beforeEach(() => {
    pdfBuffer = readFileSync(join(FIXTURES, 'test.pdf'));
  });

  it('extracts text from PDF as markdown (default)', async () => {
    const result = await extractDocumentToFormat(pdfBuffer, {
      url: 'https://example.com/report.pdf',
      contentType: 'application/pdf',
    });

    expect(result.content).toContain('Hello PDF World');
    expect(result.metadata.contentType).toBe('application/pdf');
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.metadata.pages).toBe(1);
  });

  it('uses PDF metadata title when available', async () => {
    const result = await extractDocumentToFormat(pdfBuffer, {
      url: 'https://example.com/my-report.pdf',
      contentType: 'application/pdf',
    });

    // Our test.pdf has Title="Test PDF" in metadata, so that takes precedence over URL
    expect(result.metadata.title).toBe('Test PDF');
  });

  it('returns HTML format when requested', async () => {
    const result = await extractDocumentToFormat(pdfBuffer, {
      url: 'https://example.com/doc.pdf',
      contentType: 'application/pdf',
      format: 'html',
    });

    expect(result.content).toContain('<pre>');
    expect(result.content).toContain('Hello PDF World');
  });

  it('detects PDF from URL extension when content-type is missing', async () => {
    const result = await extractDocumentToFormat(pdfBuffer, {
      url: 'https://example.com/report.pdf',
      contentType: 'application/octet-stream',
    });

    expect(result.content).toContain('Hello PDF World');
    expect(result.metadata.contentType).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// DOCX extraction
// ---------------------------------------------------------------------------

describe('extractDocumentToFormat — DOCX', () => {
  let docxBuffer: Buffer;

  beforeEach(() => {
    docxBuffer = readFileSync(join(FIXTURES, 'test.docx'));
  });

  it('extracts text from DOCX as markdown (default)', async () => {
    const result = await extractDocumentToFormat(docxBuffer, {
      url: 'https://example.com/report.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.content).toContain('Hello DOCX World');
    expect(result.content).toContain('bold text');
    expect(result.metadata.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });

  it('converts bold text to markdown', async () => {
    const result = await extractDocumentToFormat(docxBuffer, {
      url: 'https://example.com/report.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      format: 'markdown',
    });

    // Mammoth converts <strong> to bold, and turndown converts to **
    expect(result.content).toContain('**');
  });

  it('returns plain text format when requested', async () => {
    const result = await extractDocumentToFormat(docxBuffer, {
      url: 'https://example.com/report.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      format: 'text',
    });

    expect(result.content).toContain('Hello DOCX World');
    expect(result.content).not.toContain('<');
    expect(result.content).not.toContain('**');
  });

  it('returns HTML format when requested', async () => {
    const result = await extractDocumentToFormat(docxBuffer, {
      url: 'https://example.com/report.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      format: 'html',
    });

    expect(result.content).toContain('<p>');
    expect(result.content).toContain('<strong>');
  });

  it('derives title from URL filename', async () => {
    const result = await extractDocumentToFormat(docxBuffer, {
      url: 'https://example.com/quarterly-report.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.metadata.title).toBe('quarterly-report');
  });

  it('detects DOCX from URL extension when content-type is generic', async () => {
    const result = await extractDocumentToFormat(docxBuffer, {
      url: 'https://example.com/report.docx',
      contentType: 'application/octet-stream',
    });

    expect(result.content).toContain('Hello DOCX World');
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('extractDocumentToFormat — errors', () => {
  it('throws for unsupported content types', async () => {
    const buf = Buffer.from('not a document');
    await expect(
      extractDocumentToFormat(buf, {
        url: 'https://example.com/file.txt',
        contentType: 'text/plain',
      })
    ).rejects.toThrow('Unsupported document type');
  });
});

// ---------------------------------------------------------------------------
// Integration: extractDocumentToFormat end-to-end with real fixtures
// ---------------------------------------------------------------------------

describe('extractDocumentToFormat — end-to-end with real fixtures', () => {
  it('round-trips PDF through extraction pipeline', async () => {
    const pdfBuffer = readFileSync(join(FIXTURES, 'test.pdf'));

    const result = await extractDocumentToFormat(pdfBuffer, {
      url: 'https://example.com/report.pdf',
      contentType: 'application/pdf',
      format: 'markdown',
    });

    expect(result.content).toContain('Hello PDF World');
    expect(result.metadata.title).toBeTruthy();
    expect(result.metadata.contentType).toBe('application/pdf');
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.metadata.pages).toBe(1);
  });

  it('round-trips DOCX through extraction pipeline', async () => {
    const docxBuffer = readFileSync(join(FIXTURES, 'test.docx'));

    const result = await extractDocumentToFormat(docxBuffer, {
      url: 'https://example.com/report.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      format: 'markdown',
    });

    expect(result.content).toContain('Hello DOCX World');
    expect(result.metadata.title).toBeTruthy();
    expect(result.metadata.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.metadata.wordCount).toBeGreaterThan(0);
  });
});
