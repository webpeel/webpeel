import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 22. TikTok extractor (oEmbed)
// ---------------------------------------------------------------------------

export async function tiktokExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    // TikTok official oEmbed endpoint
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    const structured: Record<string, any> = {
      title: data.title,
      author: data.author_name || '',
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || '',
      thumbnailWidth: data.thumbnail_width || 0,
      thumbnailHeight: data.thumbnail_height || 0,
      provider: 'TikTok',
    };

    const cleanContent = `## 🎵 TikTok: ${structured.title}\n\n**Creator:** [${structured.author}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'tiktok.com', type: 'video', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'TikTok oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

