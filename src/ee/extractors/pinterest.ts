import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 23. Pinterest extractor (oEmbed)
// ---------------------------------------------------------------------------

export async function pinterestExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const oembedUrl = `https://www.pinterest.com/oembed/?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    // Detect content type from URL
    const isPinPage = /\/pin\//.test(url);
    const isBoardPage = /\/[^/]+\/[^/]+\/?$/.test(new URL(url).pathname) && !isPinPage;
    const contentType = isPinPage ? 'pin' : isBoardPage ? 'board' : 'profile';

    const structured: Record<string, any> = {
      title: data.title,
      description: data.description || '',
      type: contentType,
      thumbnailUrl: data.thumbnail_url || '',
      authorName: data.author_name || '',
      authorUrl: data.author_url || '',
      provider: 'Pinterest',
    };

    const typeEmoji = contentType === 'pin' ? '📌' : contentType === 'board' ? '📋' : '👤';
    const descLine = structured.description ? `\n\n${structured.description}` : '';
    const cleanContent = `## ${typeEmoji} Pinterest ${contentType}: ${structured.title}${descLine}\n\n**By:** [${structured.authorName}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'pinterest.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Pinterest oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

