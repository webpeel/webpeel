import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 28. SoundCloud extractor (oEmbed)
// ---------------------------------------------------------------------------

export async function soundcloudExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const oembedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const isPlaylist = pathParts.includes('sets');
    const contentType = isPlaylist ? 'playlist' : pathParts.length >= 2 ? 'track' : 'profile';

    const structured: Record<string, any> = {
      title: data.title,
      author: data.author_name || '',
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || '',
      description: data.description || '',
      contentType,
      provider: 'SoundCloud',
    };

    const typeEmoji = contentType === 'track' ? '🎵' : contentType === 'playlist' ? '📋' : '🎤';
    const descLine = structured.description ? `\n\n${structured.description.substring(0, 500)}` : '';
    const cleanContent = `## ${typeEmoji} SoundCloud ${contentType}: ${structured.title}${descLine}\n\n**Artist:** [${structured.author}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'soundcloud.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'SoundCloud oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

