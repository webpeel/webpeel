import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { stripHtml } from './shared.js';

// ---------------------------------------------------------------------------
// 7. ArXiv extractor (ArXiv API)
// ---------------------------------------------------------------------------

export async function arxivExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // --- Search page: /search/?query=... or /search/?searchtype=all&query=... ---
  if (path.startsWith('/search')) {
    const rawQuery = urlObj.searchParams.get('query') || '';
    if (!rawQuery) return null;
    try {
      const searchQuery = encodeURIComponent(`all:${rawQuery}`);
      const apiUrl = `https://export.arxiv.org/api/query?search_query=${searchQuery}&max_results=10&sortBy=relevance`;
      const result = await simpleFetch(apiUrl, 'WebPeel/0.21', 20000, { Accept: 'application/xml' });
      if (!result?.html) return null;
      const xml = result.html;

      // Parse total results count from opensearch:totalResults
      const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
      const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

      // Parse all entries
      const entries = [...xml.matchAll(/<entry[\s\S]*?<\/entry>/g)].map(m => m[0]);

      const papers = entries.map(entryXml => {
        const getTag = (tag: string): string => {
          const match = entryXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
          return match ? stripHtml(match[1]).trim() : '';
        };
        const getAllTags = (tag: string): string[] => {
          const matches = [...entryXml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))];
          return matches.map(m => stripHtml(m[1]).trim()).filter(Boolean);
        };
        const title = getTag('title');
        const published = getTag('published');
        const authors = getAllTags('name');
        const summary = getTag('summary');
        // Extract arXiv ID from <id> tag
        const idTag = getTag('id');
        const idMatch2 = idTag.match(/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
        const paperId2 = idMatch2 ? idMatch2[1] : '';
        // Categories
        const cats = [...entryXml.matchAll(/category[^>]*term="([^"]+)"/g)].map(m => m[1]);
        return { title, published: published?.split('T')[0], authors, summary, paperId: paperId2, categories: cats };
      }).filter(p => p.title);

      if (papers.length === 0) return null;

      const rows = papers.map((p, i) => {
        const authorLine = p.authors.length === 0 ? '—'
          : p.authors.length === 1 ? p.authors[0]
          : `${p.authors[0]} et al.`;
        const pdfLink = p.paperId ? ` [[PDF](https://arxiv.org/pdf/${p.paperId})]` : '';
        return `| ${i + 1} | [${p.title}](https://arxiv.org/abs/${p.paperId}) | ${p.published || '?'} | ${authorLine} |${pdfLink}`;
      }).join('\n');

      const cleanContent = `# 🔍 arXiv Search — "${rawQuery}"\n\n| # | Paper | Published | Authors |\n|---|-------|-----------|--------|\n${rows}\n\n*Source: arXiv API · Total results: ${total.toLocaleString()}*`;

      return {
        domain: 'arxiv.org',
        type: 'search',
        structured: { query: rawQuery, total, papers },
        cleanContent,
      };
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'ArXiv search failed:', e instanceof Error ? e.message : e);
      return null;
    }
  }

  // Extract paper ID from URL patterns:
  // /abs/2501.12948, /pdf/2501.12948, /abs/2501.12948v2
  const idMatch = path.match(/\/(abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (!idMatch) return null;

  const paperId = idMatch[2];

  try {
    // Use ArXiv API
    const apiUrl = `https://export.arxiv.org/api/query?id_list=${paperId}`;
    const result = await simpleFetch(apiUrl, 'WebPeel/0.17.1', 15000, { Accept: 'application/xml' });

    if (!result?.html) return null;
    const xml = result.html;

    // Parse XML (simple regex-based for these known fields)
    const getTag = (tag: string): string => {
      const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match ? stripHtml(match[1]).trim() : '';
    };
    // getAllTags removed — unused

    // ArXiv Atom feed: <feed><title>query URL</title> ... <entry><title>Paper Title</title>...
    // We must grab the entry title, not the feed title.
    const entryMatch = xml.match(/<entry[\s\S]*?<\/entry>/);
    const entryXml = entryMatch ? entryMatch[0] : xml;
    const getEntryTag = (tag: string): string => {
      const match = entryXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return match ? stripHtml(match[1]).trim() : '';
    };
    const getAllEntryTags = (tag: string): string[] => {
      const matches = [...entryXml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))];
      return matches.map(m => stripHtml(m[1]).trim()).filter(Boolean);
    };

    const title = getEntryTag('title') || getTag('title');
    const summary = getEntryTag('summary') || getTag('summary');
    const published = getEntryTag('published') || getTag('published');
    const updated = getEntryTag('updated') || getTag('updated');
    const authors = getAllEntryTags('name');

    // Extract categories
    const categories = [...xml.matchAll(/category[^>]*term="([^"]+)"/g)].map(m => m[1]);

    // Extract DOI and journal ref if available
    const doi = getTag('arxiv:doi');
    const journalRef = getTag('arxiv:journal_ref');

    if (!title) return null;

    const structured: Record<string, any> = {
      title,
      authors,
      abstract: summary,
      published: published || undefined,
      updated: updated || undefined,
      categories,
      doi: doi || undefined,
      journalRef: journalRef || undefined,
      paperId,
      pdfUrl: `https://arxiv.org/pdf/${paperId}`,
      absUrl: `https://arxiv.org/abs/${paperId}`,
    };

    const authorLine = authors.length <= 5
      ? authors.join(', ')
      : `${authors.slice(0, 5).join(', ')} et al. (${authors.length} authors)`;

    const cleanContent = `# 📄 arXiv: ${title} (${paperId})\n\n**Authors:** ${authorLine}\n**Submitted:** ${published?.split('T')[0] || 'N/A'}${categories.length ? `\n**Categories:** ${categories.join(', ')}` : ''}${doi ? `\n**DOI:** ${doi}` : ''}${journalRef ? `\n**Journal:** ${journalRef}` : ''}\n\n## Abstract\n\n${summary}\n\n**PDF:** [Download](${structured.pdfUrl}) | **HTML:** [View](https://arxiv.org/html/${paperId})`;

    return { domain: 'arxiv.org', type: 'paper', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'ArXiv API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

