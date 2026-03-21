import type { DomainExtractResult } from './types.js';

// ---------------------------------------------------------------------------
// 30. PDF extractor (URL-based detection) — downloads and extracts real text
// ---------------------------------------------------------------------------

const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const PDF_TRUNCATE_CHARS = 100_000;

export async function pdfExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const urlObj = new URL(url);
    const filename = urlObj.pathname.split('/').pop() || 'document.pdf';
    const hostname = urlObj.hostname;

    // Download the PDF
    let buffer: Buffer;
    let finalContentType = 'application/pdf';
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebPeel/1.0)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        if (process.env.DEBUG) console.debug('[webpeel]', `PDF download failed: HTTP ${response.status}`);
        return null; // Let the normal pipeline handle it
      }
      finalContentType = response.headers.get('content-type') || 'application/pdf';
      // Verify it's actually a PDF (content-type or URL)
      const isPdf = finalContentType.toLowerCase().includes('pdf') || /\.pdf(\?|$|#)/i.test(url);
      if (!isPdf) return null;

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (downloadErr) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'PDF download error:', downloadErr instanceof Error ? downloadErr.message : downloadErr);
      return null; // Let the normal pipeline handle it
    }

    // Size guard
    if (buffer.length > PDF_MAX_BYTES) {
      if (process.env.DEBUG) console.debug('[webpeel]', `PDF too large (${buffer.length} bytes), falling back to stub`);
      return null;
    }

    // Extract text via pdf-parse
    const { extractPdf } = await import('../../core/pdf.js');
    let pdf: Awaited<ReturnType<typeof extractPdf>>;
    try {
      pdf = await extractPdf(buffer);
    } catch (parseErr) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'PDF parse failed:', parseErr instanceof Error ? parseErr.message : parseErr);
      return null; // Let the normal pipeline handle it
    }

    // Normalize whitespace (pdf-parse emits lots of blank lines)
    let text = (pdf.text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Truncate very large documents
    let truncated = false;
    if (text.length > PDF_TRUNCATE_CHARS) {
      text = text.slice(0, PDF_TRUNCATE_CHARS);
      truncated = true;
    }

    if (!text) {
      // Scanned/image-only PDF — return a clear message rather than empty content
      const emptyNote = `## 📄 ${filename}\n\n*This PDF appears to be a scanned document (image-only). No extractable text was found.*\n\n**Source:** ${url}`;
      return {
        domain: hostname,
        type: 'pdf',
        structured: { title: filename, url, pages: pdf.pages, contentType: finalContentType },
        cleanContent: emptyNote,
      };
    }

    // Build markdown output
    const titleRaw = (pdf.metadata?.title as string) || '';
    const title = titleRaw || filename.replace(/\.pdf$/i, '') || 'PDF Document';

    const metaParts: string[] = [];
    if (pdf.metadata?.author) metaParts.push(`**Author:** ${pdf.metadata.author}`);
    if (pdf.pages) metaParts.push(`**Pages:** ${pdf.pages}`);
    metaParts.push(`**Source:** ${url}`);

    const header = titleRaw ? `# ${titleRaw}\n\n` : '';
    const metaBlock = metaParts.join(' | ') + '\n\n';
    const truncNote = truncated ? '\n\n*[Content truncated — document exceeds 100,000 characters]*' : '';
    const cleanContent = header + metaBlock + text + truncNote;

    return {
      domain: hostname,
      type: 'pdf',
      structured: {
        title,
        filename,
        url,
        pages: pdf.pages,
        contentType: finalContentType,
        ...pdf.metadata,
      },
      cleanContent,
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'PDF extractor failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

