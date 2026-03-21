import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { stripHtml, fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 5. Wikipedia extractor
// ---------------------------------------------------------------------------

/** Remove Wikipedia-specific noise from extracted content. */
function cleanWikipediaContent(content: string): string {
  return content
    // Remove [edit] links
    .replace(/\[edit\]/gi, '')
    // Remove citation brackets [1], [2], etc.
    .replace(/\[\d+\]/g, '')
    // Remove [citation needed], [verification], etc.
    .replace(/\[(citation needed|verification|improve this article|adding citations[^\]]*|when\?|where\?|who\?|clarification needed|dubious[^\]]*|failed verification[^\]]*|unreliable source[^\]]*)\]/gi, '')
    // Remove [Learn how and when to remove this message]
    .replace(/\[Learn how and when to remove this message\]/gi, '')
    // Clean up excess whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function wikipediaExtractor(_html: string, url: string, options?: { budget?: number }): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  // Only handle article pages: /wiki/Article_Title
  if (pathParts[0] !== 'wiki' || pathParts.length < 2) return null;

  const articleTitle = decodeURIComponent(pathParts[1]);
  // Skip special pages (contain a colon, e.g. Special:Random, Talk:Article)
  if (articleTitle.includes(':')) return null;

  const lang = urlObj.hostname.split('.')[0] || 'en';
  const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;

  // Wikipedia REST API requires a descriptive User-Agent (https://meta.wikimedia.org/wiki/User-Agent_policy)
  const wikiHeaders = { 'User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me) Node.js', 'Api-User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me)' };

  try {
    const data = await fetchJson(summaryUrl, wikiHeaders);
    if (!data || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') return null;

    const structured: Record<string, any> = {
      title: data.title || articleTitle.replace(/_/g, ' '),
      description: data.description || '',
      extract: data.extract || '',
      extractHtml: data.extract_html || '',
      thumbnail: data.thumbnail?.source || null,
      url: data.content_urls?.desktop?.page || url,
      lastModified: data.timestamp || null,
      coordinates: data.coordinates || null,
    };

    // Default: use summary API (200-400 tokens). Only fetch full article if budget > 5000.
    const budget = options?.budget ?? 0;
    const useFull = budget > 5000;

    let bodyContent = structured.extract;
    let mobileHtmlSize: number | undefined;

    if (useFull) {
      try {
        const fullUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(articleTitle)}`;
        const fullResult = await simpleFetch(fullUrl, undefined, 15000, {
          ...wikiHeaders,
          'Accept': 'text/html',
        });
        if (fullResult?.html) {
          mobileHtmlSize = fullResult.html.length;
          let fullContent = '';
          const sectionMatches = fullResult.html.match(/<section[^>]*>([\s\S]*?)<\/section>/gi) || [];
          for (const section of sectionMatches) {
            const headingMatch = section.match(/<h[2-6][^>]*id="([^"]*)"[^>]*class="[^"]*pcs-edit-section-title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/i);
            const heading = headingMatch ? stripHtml(headingMatch[2]).trim() : '';
            const paragraphs = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
            const sectionText = paragraphs.map((p: string) => stripHtml(p).trim()).filter((t: string) => t.length > 0).join('\n\n');
            if (sectionText) {
              const prefix = heading ? `## ${heading}\n\n` : '';
              fullContent += `\n\n${prefix}${sectionText}`;
            }
          }
          bodyContent = cleanWikipediaContent(fullContent) || structured.extract;
        }
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'Wikipedia mobile-html failed, using summary:', e instanceof Error ? e.message : e);
      }
    }

    const articleUrl = structured.url;
    const lines: string[] = [
      `# ${structured.title}`,
      '',
    ];
    if (structured.description) lines.push(`*${structured.description}*`, '');
    lines.push(bodyContent);
    if (structured.coordinates) {
      lines.push('', `📍 Coordinates: ${structured.coordinates.lat}, ${structured.coordinates.lon}`);
    }
    lines.push('', `📖 [Read full article on Wikipedia](${articleUrl})`);

    const cleanContent = lines.join('\n');
    return { domain: 'wikipedia.org', type: 'article', structured, cleanContent, rawHtmlSize: mobileHtmlSize };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Wikipedia API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

