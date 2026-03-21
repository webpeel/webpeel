import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 21. Spotify extractor (oEmbed)
// ---------------------------------------------------------------------------

export async function spotifyExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const data = await fetchJson(oembedUrl);
    if (!data || !data.title) return null;

    // Detect type from URL path: track, album, playlist, episode, show, artist
    const pathMatch = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
    const contentType = pathMatch?.[1] || 'track';
    const spotifyId = pathMatch?.[2] || '';

    const structured: Record<string, any> = {
      title: data.title,
      type: contentType,
      spotifyId,
      provider: 'Spotify',
      thumbnailUrl: data.thumbnail_url || '',
      thumbnailWidth: data.thumbnail_width || 0,
      thumbnailHeight: data.thumbnail_height || 0,
      embedHtml: data.html || '',
    };

    const typeEmoji = contentType === 'track' ? '🎵' : contentType === 'album' ? '💿' : contentType === 'playlist' ? '📋' : contentType === 'episode' ? '🎙️' : contentType === 'artist' ? '🎤' : '🎵';
    const cleanContent = `## ${typeEmoji} Spotify ${contentType.charAt(0).toUpperCase() + contentType.slice(1)}: ${data.title}\n\n**Platform:** Spotify\n**Type:** ${contentType}\n**URL:** ${url}`;

    return { domain: 'open.spotify.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Spotify oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

