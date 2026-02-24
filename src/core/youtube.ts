/**
 * YouTube transcript extraction — no API key required.
 *
 * YouTube embeds caption/transcript data directly in the page HTML as JSON
 * (inside ytInitialPlayerResponse). We parse that JSON, extract caption
 * track URLs, fetch the timedtext XML, and return structured transcript data.
 */

import { simpleFetch } from './fetcher.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  /** Caption text (HTML entities decoded) */
  text: string;
  /** Start time in seconds */
  start: number;
  /** Duration in seconds */
  duration: number;
}

export interface YouTubeTranscript {
  videoId: string;
  title: string;
  channel: string;
  /** Duration formatted as "MM:SS" or "HH:MM:SS" */
  duration: string;
  /** BCP-47 language code, e.g. "en" */
  language: string;
  /** Timestamped caption segments */
  segments: TranscriptSegment[];
  /** All segments joined as plain text */
  fullText: string;
  /** Language codes available for this video */
  availableLanguages: string[];
}

export interface YouTubeVideoInfo {
  videoId: string;
  title: string;
  channel: string;
  description: string;
  /** Duration formatted as "MM:SS" or "HH:MM:SS" */
  duration: string;
  publishDate: string;
  viewCount: string;
  likeCount: string;
  thumbnail: string;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Extract the video ID from any common YouTube URL format.
 * Returns null if the URL is not a recognisable YouTube URL.
 *
 * Supported formats:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID
 *   https://m.youtube.com/watch?v=VIDEO_ID
 *   URLs with extra params (&t=120, &list=PLxxx, etc.)
 */
export function parseYouTubeUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtu.be') {
    // https://youtu.be/VIDEO_ID
    const id = parsed.pathname.slice(1).split('/')[0];
    return isValidVideoId(id) ? id : null;
  }

  if (host === 'youtube.com') {
    // /watch?v=VIDEO_ID
    if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
      const id = parsed.searchParams.get('v');
      return id && isValidVideoId(id) ? id : null;
    }

    // /embed/VIDEO_ID
    if (parsed.pathname.startsWith('/embed/')) {
      const id = parsed.pathname.split('/')[2];
      return id && isValidVideoId(id) ? id : null;
    }

    // /shorts/VIDEO_ID
    if (parsed.pathname.startsWith('/shorts/')) {
      const id = parsed.pathname.split('/')[2];
      return id && isValidVideoId(id) ? id : null;
    }

    // /v/VIDEO_ID (old embed format)
    if (parsed.pathname.startsWith('/v/')) {
      const id = parsed.pathname.split('/')[2];
      return id && isValidVideoId(id) ? id : null;
    }
  }

  return null;
}

function isValidVideoId(id: string): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

// ---------------------------------------------------------------------------
// Video info extraction
// ---------------------------------------------------------------------------

/**
 * Extract video metadata from YouTube page HTML.
 * Parses ytInitialPlayerResponse JSON embedded in the page.
 */
export function extractVideoInfo(html: string): YouTubeVideoInfo {
  const playerResponse = extractPlayerResponse(html);

  const videoDetails = playerResponse?.videoDetails ?? {};
  const microformat = playerResponse?.microformat?.playerMicroformatRenderer ?? {};

  const videoId = videoDetails.videoId ?? '';
  const title =
    videoDetails.title ??
    microformat.title?.simpleText ??
    extractMetaTag(html, 'og:title') ??
    '';
  const channel = videoDetails.author ?? microformat.ownerChannelName ?? '';
  const lengthSeconds = parseInt(videoDetails.lengthSeconds ?? microformat.lengthSeconds ?? '0', 10);
  const viewCount = videoDetails.viewCount ?? microformat.viewCount ?? '';
  const publishDate = microformat.publishDate ?? microformat.uploadDate ?? '';
  const description =
    videoDetails.shortDescription ??
    microformat.description?.simpleText ??
    extractMetaTag(html, 'og:description') ??
    '';
  const thumbnail =
    videoDetails.thumbnail?.thumbnails?.slice(-1)[0]?.url ??
    microformat.thumbnail?.thumbnails?.slice(-1)[0]?.url ??
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  // likeCount is often not available without auth
  const likeCount = videoDetails.likeCount ?? '';

  return {
    videoId,
    title,
    channel,
    description,
    duration: formatDuration(lengthSeconds),
    publishDate,
    viewCount,
    likeCount,
    thumbnail,
  };
}

// ---------------------------------------------------------------------------
// Transcript extraction
// ---------------------------------------------------------------------------

/**
 * Fetch and return the transcript for a YouTube video.
 *
 * @param url - Any YouTube URL format
 * @param options.language - Preferred language code (default: "en")
 */
export async function getYouTubeTranscript(
  url: string,
  options: { language?: string } = {},
): Promise<YouTubeTranscript> {
  const videoId = parseYouTubeUrl(url);
  if (!videoId) {
    throw new Error(`Not a valid YouTube URL: ${url}`);
  }

  const preferredLang = options.language ?? 'en';

  // Fetch the video page
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const fetchResult = await simpleFetch(videoUrl, undefined, 30000);
  const html = fetchResult.html;

  // Extract player response
  const playerResponse = extractPlayerResponse(html);
  if (!playerResponse) {
    throw new Error(`Could not parse YouTube page data for video ${videoId}`);
  }

  // Extract video info
  const videoDetails = playerResponse.videoDetails ?? {};
  const title = videoDetails.title ?? '';
  const channel = videoDetails.author ?? '';
  const lengthSeconds = parseInt(videoDetails.lengthSeconds ?? '0', 10);

  // Extract caption tracks
  const captionTracks: CaptionTrack[] = extractCaptionTracks(playerResponse);
  if (captionTracks.length === 0) {
    throw new Error(`No captions available for video ${videoId}`);
  }

  const availableLanguages = captionTracks.map(t => t.languageCode);

  // Select best track: prefer manual over auto-generated, prefer requested language
  const selectedTrack = selectBestTrack(captionTracks, preferredLang);

  // Fetch the caption XML
  const captionXml = await fetchCaptionXml(selectedTrack.baseUrl);

  // Parse segments
  const segments = parseCaptionXml(captionXml);

  const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();

  return {
    videoId,
    title,
    channel,
    duration: formatDuration(lengthSeconds),
    language: selectedTrack.languageCode,
    segments,
    fullText,
    availableLanguages,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  isAutoGenerated: boolean;
}

/**
 * Extract the ytInitialPlayerResponse JSON object from page HTML.
 */
export function extractPlayerResponse(html: string): Record<string, any> | null {
  // Try a few patterns YouTube uses to embed this data
  const patterns = [
    // Modern: var ytInitialPlayerResponse = {...};
    /var ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s,
    // Also try without trailing var (some pages end differently)
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})(?:;|\s*<\/script>)/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Try to find a valid JSON boundary by walking the string
        const start = html.indexOf('ytInitialPlayerResponse');
        if (start === -1) continue;
        const braceStart = html.indexOf('{', start);
        if (braceStart === -1) continue;
        const jsonStr = extractJsonObject(html, braceStart);
        if (jsonStr) {
          try {
            return JSON.parse(jsonStr);
          } catch {
            /* fall through to next pattern */
          }
        }
      }
    }
  }

  // Fallback: search for captionTracks directly
  const captionIdx = html.indexOf('"captionTracks"');
  if (captionIdx !== -1) {
    // Walk back to find the enclosing object
    const braceStart = html.lastIndexOf('{', captionIdx);
    if (braceStart !== -1) {
      const jsonStr = extractJsonObject(html, braceStart);
      if (jsonStr) {
        try {
          return JSON.parse(jsonStr);
        } catch { /* ignore */ }
      }
    }
  }

  return null;
}

/**
 * Extract a complete JSON object starting at position `start` in `str`.
 * Handles nested objects/arrays and string literals.
 */
function extractJsonObject(str: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return str.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extract caption tracks from the player response.
 */
function extractCaptionTracks(playerResponse: Record<string, any>): CaptionTrack[] {
  try {
    const tracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks)) return [];

    return tracks.map((t: any) => ({
      baseUrl: t.baseUrl ?? '',
      languageCode: (t.languageCode ?? 'unknown').toLowerCase(),
      name: t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? t.languageCode ?? '',
      isAutoGenerated:
        (t.kind === 'asr') ||
        (t.vssId?.startsWith('a.') ?? false) ||
        String(t.name?.simpleText ?? '').toLowerCase().includes('auto') ||
        false,
    })).filter(t => t.baseUrl);
  } catch {
    return [];
  }
}

/**
 * Pick the best caption track for the requested language.
 * Priority: manual track in preferred language > auto-generated in preferred language > any manual > any
 */
function selectBestTrack(tracks: CaptionTrack[], preferredLang: string): CaptionTrack {
  const lang = preferredLang.toLowerCase().split('-')[0]; // "en-US" → "en"

  // 1. Manual in preferred language
  const manualPref = tracks.find(t => !t.isAutoGenerated && t.languageCode.startsWith(lang));
  if (manualPref) return manualPref;

  // 2. Auto-generated in preferred language
  const autoPref = tracks.find(t => t.isAutoGenerated && t.languageCode.startsWith(lang));
  if (autoPref) return autoPref;

  // 3. Any manual track
  const anyManual = tracks.find(t => !t.isAutoGenerated);
  if (anyManual) return anyManual;

  // 4. Fall back to first available
  return tracks[0];
}

/**
 * Fetch the caption XML from YouTube's timedtext API.
 */
async function fetchCaptionXml(baseUrl: string): Promise<string> {
  // Ensure we request plain text (not ASS format)
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', 'srv3');  // srv3 is a clean XML format
  // Some older tracks need fmt=xml
  url.searchParams.delete('fmt');

  const result = await simpleFetch(url.toString(), undefined, 15000);
  return result.html;
}

/**
 * Parse YouTube caption XML into transcript segments.
 *
 * Format: <transcript><text start="0.5" dur="2.1">Hello &amp; world</text>...</transcript>
 */
export function parseCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  // Match all <text> elements with their attributes
  const textRegex = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;

  while ((match = textRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const rawText = match[2];

    const start = parseFloat(extractAttr(attrs, 'start') ?? '0');
    const duration = parseFloat(extractAttr(attrs, 'dur') ?? '0');
    const text = decodeHtmlEntities(rawText.trim());

    if (text) {
      segments.push({ text, start, duration });
    }
  }

  return segments;
}

/**
 * Extract an attribute value from an HTML/XML attribute string.
 */
function extractAttr(attrs: string, name: string): string | null {
  const regex = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = attrs.match(regex);
  return m ? m[1] : null;
}

/**
 * Decode common HTML entities found in YouTube caption XML.
 *
 * Order of operations:
 * 1. Strip real HTML tags (e.g. <font color="...">) — these appear literally in the XML
 * 2. Decode all HTML entities (including &lt; → < which represents literal angle brackets)
 */
export function decodeHtmlEntities(text: string): string {
  return text
    // Step 1: strip real inline HTML tags (literal <...> in the text, not entities)
    .replace(/<[^>]+>/g, '')
    // Step 2: decode HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

/**
 * Format seconds into MM:SS or HH:MM:SS.
 */
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Extract a meta tag value from HTML (og:title, og:description, etc.)
 */
function extractMetaTag(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property.replace(/:/g, '\\:')}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const m = html.match(regex) ?? html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property.replace(/:/g, '\\:')}["']`, 'i'),
  );
  return m ? decodeHtmlEntities(m[1]) : null;
}
