/**
 * YouTube transcript extraction — no API key required.
 *
 * YouTube embeds caption/transcript data directly in the page HTML as JSON
 * (inside ytInitialPlayerResponse). We parse that JSON, extract caption
 * track URLs, fetch the timedtext XML, and return structured transcript data.
 */

import { simpleFetch } from './fetcher.js';
import { getBrowser, getRandomUserAgent, applyStealthScripts } from './browser-pool.js';

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
  /** Video description text */
  description?: string;
  /** Video publish date (ISO or human-readable) */
  publishDate?: string;
  /** Chapters parsed from description timestamp markers */
  chapters?: { time: string; title: string }[];
  /** Key points: first substantive sentence from each chapter / 2-min block */
  keyPoints?: string[];
  /** First ~200 words of transcript as a quick summary */
  summary?: string;
  /** Total word count of transcript */
  wordCount?: number;
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
// Structured content helpers
// ---------------------------------------------------------------------------

/**
 * Parse chapter markers from a YouTube video description.
 * Looks for lines like "0:00 Intro\n2:34 Main topic\n5:12 Conclusion"
 */
export function parseChaptersFromDescription(description: string): { time: string; title: string }[] {
  if (!description) return [];
  // Match lines that start with a timestamp: "0:00", "1:23", "1:23:45"
  const chapterRegex = /^(\d+:\d{2}(?::\d{2})?)\s+(.+)$/gm;
  const chapters: { time: string; title: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = chapterRegex.exec(description)) !== null) {
    const time = match[1].trim();
    const title = match[2].trim();
    if (title) chapters.push({ time, title });
  }
  // Only treat as chapters if there are at least 2 (otherwise it's probably not a chapter list)
  return chapters.length >= 2 ? chapters : [];
}

/**
 * Convert a time string "1:23" or "1:23:45" to seconds.
 */
function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Split a text into sentences (basic, good enough for transcript sentences).
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space/end
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Extract key points from transcript segments.
 * Uses chapter timestamps when available; otherwise segments every 2 minutes.
 * Returns the first substantive sentence (≥5 words) from each time block.
 */
export function extractKeyPoints(
  segments: TranscriptSegment[],
  chapters: { time: string; title: string }[],
  durationSeconds: number,
): string[] {
  if (segments.length === 0) return [];

  const totalDuration =
    durationSeconds ||
    (segments.length > 0
      ? segments[segments.length - 1].start + segments[segments.length - 1].duration
      : 0);

  // Build time blocks
  let blocks: { start: number; end: number }[];
  if (chapters.length >= 2) {
    blocks = chapters.map((ch, i) => ({
      start: timeStringToSeconds(ch.time),
      end: i + 1 < chapters.length
        ? timeStringToSeconds(chapters[i + 1].time)
        : totalDuration || Infinity,
    }));
  } else {
    // Auto-segment every 2 minutes
    const blockDuration = 120;
    blocks = [];
    for (let t = 0; t < (totalDuration || 600); t += blockDuration) {
      blocks.push({ start: t, end: t + blockDuration });
    }
    if (blocks.length === 0) blocks = [{ start: 0, end: Infinity }];
  }

  const keyPoints: string[] = [];
  for (const block of blocks) {
    const blockSegments = segments.filter(s => s.start >= block.start && s.start < block.end);
    if (blockSegments.length === 0) continue;
    const blockText = blockSegments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    const sentences = splitSentences(blockText);
    // Find first sentence with at least 5 words
    const point = sentences.find(s => s.split(/\s+/).length >= 5);
    if (point) keyPoints.push(point.trim());
  }

  return keyPoints.slice(0, 12);
}

/**
 * Extract a summary as the first ~200 words of the full transcript text.
 */
export function extractSummary(fullText: string): string {
  if (!fullText) return '';
  const words = fullText.split(/\s+/);
  if (words.length <= 200) return fullText;
  return words.slice(0, 200).join(' ') + '...';
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
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // --- Path 1: Try simpleFetch (fast, no browser overhead) ---
  try {
    const fetchResult = await simpleFetch(videoUrl, undefined, 15000);
    const html = fetchResult.html;
    if (!html.includes('ytInitialPlayerResponse') && !html.includes('ytInitialData')) {
      throw new Error('YouTube served non-video page (likely challenge/consent)');
    }

    const playerResponse = extractPlayerResponse(html);
    if (!playerResponse) throw new Error('Could not parse player response');

    const videoDetails = playerResponse.videoDetails ?? {};
    const microformat = playerResponse.microformat?.playerMicroformatRenderer ?? {};
    const title = videoDetails.title ?? '';
    const channel = videoDetails.author ?? '';
    const lengthSeconds = parseInt(videoDetails.lengthSeconds ?? microformat.lengthSeconds ?? '0', 10);
    const description = (videoDetails.shortDescription ?? microformat.description?.simpleText ?? '').trim();
    const publishDate = microformat.publishDate ?? microformat.uploadDate ?? '';
    const captionTracks: CaptionTrack[] = extractCaptionTracks(playerResponse);
    if (captionTracks.length === 0) throw new Error('No captions available');

    const availableLanguages = captionTracks.map(t => t.languageCode);
    const selectedTrack = selectBestTrack(captionTracks, preferredLang);
    const captionXml = await fetchCaptionXml(selectedTrack.baseUrl);
    const segments = parseCaptionXml(captionXml);
    const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const chapters = parseChaptersFromDescription(description);
    const keyPoints = extractKeyPoints(segments, chapters, lengthSeconds);
    const summary = extractSummary(fullText);

    return {
      videoId,
      title,
      channel,
      duration: formatDuration(lengthSeconds),
      language: selectedTrack.languageCode,
      segments,
      fullText,
      availableLanguages,
      description,
      publishDate,
      chapters: chapters.length > 0 ? chapters : undefined,
      keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
      summary,
      wordCount,
    };
  } catch {
    // simpleFetch path failed — fall through to browser intercept approach
  }

  // --- Path 2: Browser intercept approach ---
  // YouTube's caption URLs are session-specific (they return empty when fetched
  // from a different HTTP client). We intercept the timedtext network request
  // that the YouTube player makes automatically when loading the page.
  return getTranscriptViaBrowserIntercept(videoId, videoUrl, preferredLang);
}

/**
 * Use a real browser with network route interception to capture the
 * YouTube caption JSON that the player fetches automatically on page load.
 * This preserves the session context needed for timedtext API requests.
 */
async function getTranscriptViaBrowserIntercept(
  videoId: string,
  videoUrl: string,
  preferredLang: string,
): Promise<YouTubeTranscript> {
  const browser = await getBrowser();
  const ua = getRandomUserAgent();
  const context = await browser.newContext({ userAgent: ua });
  const page = await context.newPage();
  await applyStealthScripts(page);

  let capturedJson: Record<string, any> | null = null;
  let capturedLang = preferredLang;

  // Intercept YouTube's timedtext API requests (the player fetches these automatically)
  await page.route('**/api/timedtext**', async (route) => {
    try {
      const response = await route.fetch();
      const text = await response.text();
      if (text && text.length > 100 && (text.includes('events') || text.includes('segs'))) {
        try {
          capturedJson = JSON.parse(text);
          // Try to extract language from URL
          const urlObj = new URL(route.request().url());
          capturedLang = urlObj.searchParams.get('lang') || preferredLang;
        } catch { /* keep trying */ }
      }
      await route.fulfill({ response });
    } catch {
      await route.continue();
    }
  });

  try {
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Wait for timedtext request to be intercepted (player auto-fetches captions)
    const startWait = Date.now();
    while (!capturedJson && Date.now() - startWait < 8000) {
      await page.waitForTimeout(200);
    }

    // Also grab page HTML for video metadata
    const html = await page.content();
    const playerResponse = extractPlayerResponse(html);
    const videoDetails = playerResponse?.videoDetails ?? {};
    const microformat = playerResponse?.microformat?.playerMicroformatRenderer ?? {};
    const title = videoDetails.title ?? '';
    const channel = videoDetails.author ?? '';
    const lengthSeconds = parseInt(videoDetails.lengthSeconds ?? microformat.lengthSeconds ?? '0', 10);
    const description = (videoDetails.shortDescription ?? microformat.description?.simpleText ?? '').trim();
    const publishDate = microformat.publishDate ?? microformat.uploadDate ?? '';
    const captionTracks: CaptionTrack[] = playerResponse ? extractCaptionTracks(playerResponse) : [];
    const availableLanguages = captionTracks.map(t => t.languageCode);
    const descriptionChapters = parseChaptersFromDescription(description);

    // If no captions were intercepted, fall back to video description from player response
    if (!capturedJson) {
      if (description.length > 50) {
        // Return description as transcript content (better than nothing)
        return {
          videoId,
          title,
          channel,
          duration: formatDuration(lengthSeconds),
          language: 'en',
          segments: [],
          fullText: description,
          availableLanguages,
          description,
          publishDate: publishDate || undefined,
          chapters: descriptionChapters.length > 0 ? descriptionChapters : undefined,
          wordCount: description.split(/\s+/).filter(Boolean).length,
        };
      }
      throw new Error(`No captions available for video ${videoId} — captions may be disabled`);
    }

    // Parse the JSON3 format (YouTube's native caption format)
    const segments = parseJson3Events(capturedJson);
    if (segments.length === 0) {
      // Fallback to description if JSON3 parsing yields nothing
      if (description.length > 50) {
        return {
          videoId,
          title,
          channel,
          duration: formatDuration(lengthSeconds),
          language: 'en',
          segments: [],
          fullText: description,
          availableLanguages,
          description,
          publishDate: publishDate || undefined,
          chapters: descriptionChapters.length > 0 ? descriptionChapters : undefined,
          wordCount: description.split(/\s+/).filter(Boolean).length,
        };
      }
      throw new Error(`Captured caption response had no segments for video ${videoId}`);
    }

    const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const chapters = descriptionChapters;
    const keyPoints = extractKeyPoints(segments, chapters, lengthSeconds);
    const summary = extractSummary(fullText);

    return {
      videoId,
      title,
      channel,
      duration: formatDuration(lengthSeconds),
      language: capturedLang,
      segments,
      fullText,
      availableLanguages,
      description,
      publishDate: publishDate || undefined,
      chapters: chapters.length > 0 ? chapters : undefined,
      keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
      summary,
      wordCount,
    };
  } finally {
    await page.close().catch(() => { /* best effort */ });
    await context.close().catch(() => { /* best effort */ });
    // Note: browser itself is pooled — don't close it
  }
}

/**
 * Parse YouTube's JSON3 caption format (from intercepted timedtext requests).
 * Format: { events: [{ tStartMs, dDurationMs, segs: [{ utf8: "text" } or { u: "text" }] }] }
 */
function parseJson3Events(data: Record<string, any>): TranscriptSegment[] {
  const events: any[] = data.events || [];
  return events
    .filter(e => e.segs && e.segs.some((s: any) => s.utf8 || s.u))
    .map(e => ({
      // YouTube uses 'utf8' key in modern responses, 'u' in some older ones
      text: decodeHtmlEntities(
        e.segs.map((s: any) => (s.utf8 ?? s.u ?? '')).join('').replace(/\n/g, ' ').trim()
      ),
      start: (e.tStartMs || 0) / 1000,
      duration: (e.dDurationMs || 0) / 1000,
    }))
    .filter(s => s.text.length > 0);
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
          } catch (e) {
            if (process.env.DEBUG) console.debug('[webpeel]', 'player response parse failed:', e instanceof Error ? e.message : e);
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
 * Used only in the simpleFetch path (no bot detection).
 */
async function fetchCaptionXml(baseUrl: string): Promise<string> {
  const result = await simpleFetch(baseUrl, undefined, 15000);
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
