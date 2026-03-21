import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// Semantic Scholar extractor (Semantic Scholar API — free, no key needed)
// ---------------------------------------------------------------------------

export async function semanticScholarExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'semanticscholar.org';

  // --- Paper page: /paper/<title-slug>/<paperId> ---
  const paperMatch = path.match(/^\/paper\/(?:[^/]+\/)?([a-f0-9]{40})/i);
  if (paperMatch) {
    const paperId = paperMatch[1];
    try {
      const fields = 'title,abstract,authors,year,citationCount,referenceCount,url,openAccessPdf,venue,publicationDate,tldr';
      const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=${fields}`;
      const data = await fetchJson(apiUrl);
      if (!data) return null;
      // Rate limited — return null so pipeline falls back to browser rendering
      if (data.code === '429' || (data.message && String(data.message).includes('Too Many Requests'))) {
        return null;
      }
      if (!data.title) return null;

      const authors: Array<{ name: string }> = data.authors || [];
      const authorNames = authors.map((a) => a.name);
      const authorLine = authorNames.length <= 5
        ? authorNames.join(', ')
        : `${authorNames.slice(0, 5).join(', ')} (+${authorNames.length - 5} more)`;

      const pdfObj = data.openAccessPdf as { url?: string } | null;
      const pdfUrl = pdfObj?.url || null;
      const tldrText = (data.tldr as { text?: string } | null)?.text || null;
      const citations = (data.citationCount as number | null);
      const citStr = citations != null ? citations.toLocaleString() : '?';

      const structured: Record<string, any> = {
        paperId,
        title: data.title,
        authors: authorNames,
        year: data.year,
        venue: data.venue,
        citationCount: data.citationCount,
        referenceCount: data.referenceCount,
        abstract: data.abstract,
        tldr: tldrText,
        pdfUrl,
        url: data.url,
        publicationDate: data.publicationDate,
      };

      const lines: string[] = [
        `# 📄 ${data.title}`,
        '',
        `**Authors:** ${authorLine}`,
        `**Year:** ${data.year || '?'} | **Venue:** ${data.venue || 'N/A'} | **Citations:** ${citStr}`,
      ];
      if (data.referenceCount != null) lines.push(`**References:** ${(data.referenceCount as number).toLocaleString()}`);
      if (tldrText) {
        lines.push('', '## TL;DR', '', tldrText);
      }
      if (data.abstract) {
        lines.push('', '## Abstract', '', data.abstract as string);
      }
      lines.push('');
      if (pdfUrl) lines.push(`**PDF:** [Open Access](${pdfUrl})`);
      lines.push(`**Link:** [Semantic Scholar](${data.url || `https://www.semanticscholar.org/paper/${paperId}`})`);

      return {
        domain,
        type: 'paper',
        structured,
        cleanContent: lines.join('\n'),
      };
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'Semantic Scholar paper API failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  // --- Search page: /search?q=... ---
  const query = urlObj.searchParams.get('q') || urlObj.searchParams.get('query');
  if (path === '/search' || path.startsWith('/search/')) {
    if (!query) return null;
    try {
      const fields = 'title,authors,year,citationCount,url,openAccessPdf';
      const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=10&fields=${fields}`;
      const data = await fetchJson(apiUrl);

      // Rate limited or no data — return null so pipeline falls back to browser rendering
      if (!data) return null;
      if (data.code === '429' || (data.message && String(data.message).includes('Too Many Requests'))) {
        return null;
      }
      if (!Array.isArray(data.data)) return null;

      const papers = data.data as Array<Record<string, any>>;
      const total: number = data.total || 0;

      const rows = papers.map((p, i) => {
        const authors: Array<{ name: string }> = p.authors || [];
        const authorLine = authors.length === 0 ? '—'
          : authors.length === 1 ? authors[0].name
          : `${authors[0].name} et al.`;
        const paperUrl = p.url || `https://www.semanticscholar.org/paper/${p.paperId}`;
        const cits = p.citationCount != null ? (p.citationCount as number).toLocaleString() : '?';
        return `| ${i + 1} | [${p.title}](${paperUrl}) | ${p.year || '?'} | ${cits} | ${authorLine} |`;
      }).join('\n');

      const cleanContent = [
        `# 🔍 Semantic Scholar — "${query}"`,
        '',
        '| # | Paper | Year | Citations | Authors |',
        '|---|-------|------|-----------|---------|',
        rows,
        '',
        `*Source: Semantic Scholar API · Total results: ${total.toLocaleString()}*`,
      ].join('\n');

      return {
        domain,
        type: 'search',
        structured: { query, total, papers },
        cleanContent,
      };
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'Semantic Scholar search API failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  return null;
}

