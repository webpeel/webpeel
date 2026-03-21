import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 27. Twitch extractor (noembed / Twitch API)
// ---------------------------------------------------------------------------

export async function twitchExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    // Use noembed.com for Twitch clips and channel pages
    const noembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(noembedUrl);
    if (!data || data.error) return null;

    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const isClip = pathParts[1] === 'clip' || pathParts[0] === 'clip' || url.includes('clips.twitch.tv');
    const channelName = !isClip ? pathParts[0] : '';
    const contentType = isClip ? 'clip' : 'channel';

    const structured: Record<string, any> = {
      title: data.title || '',
      author: data.author_name || channelName,
      authorUrl: data.author_url || '',
      thumbnailUrl: data.thumbnail_url || '',
      provider: 'Twitch',
      contentType,
      channelName: channelName || data.author_name || '',
    };

    const typeEmoji = isClip ? '🎬' : '🎮';
    const titleText = structured.title || structured.channelName;
    const cleanContent = `## ${typeEmoji} Twitch ${contentType}: ${titleText}\n\n**Channel:** [${structured.author}](${structured.authorUrl})\n**URL:** ${url}`;

    return { domain: 'twitch.tv', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Twitch oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

