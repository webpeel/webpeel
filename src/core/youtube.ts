/**
 * YouTube transcript extraction — no API key required.
 *
 * YouTube embeds caption/transcript data directly in the page HTML as JSON
 * (inside ytInitialPlayerResponse). We parse that JSON, extract caption
 * track URLs, fetch the timedtext XML, and return structured transcript data.
 */

import { execFile } from 'node:child_process';
import * as http from 'node:http';
import * as https from 'node:https';
import * as tls from 'node:tls';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchTranscript as ytpFetchTranscript } from 'youtube-transcript-plus';
import { simpleFetch } from './fetcher.js';
import { getBrowser, getRandomUserAgent, applyStealthScripts } from './browser-pool.js';

// ---------------------------------------------------------------------------
// yt-dlp startup diagnostics
// ---------------------------------------------------------------------------

// Check yt-dlp availability on startup.
// Skipped in test environments (VITEST) to avoid interfering with mocked paths.
let ytdlpAvailable = false;
(async () => {
  if (process.env.VITEST) return;
  try {
    const { execFileSync } = await import('node:child_process');
    const version = execFileSync('yt-dlp', ['--version'], {
      timeout: 5000,
      env: { ...process.env, PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}` },
    }).toString().trim();
    ytdlpAvailable = true;
    console.log(`[webpeel] [youtube] yt-dlp available: v${version}`);
  } catch {
    console.log('[webpeel] [youtube] yt-dlp NOT available — falling back to HTTP extraction');
  }
})();

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
  /** View count (numeric string) */
  viewCount?: string;
  /** Like count (numeric string, may be empty) */
  likeCount?: string;
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
// Proxy-based InnerTube transcript extraction
// ---------------------------------------------------------------------------

// Webshare residential proxy config — reads from env vars on Render.
// Locally, falls back to direct fetch (residential IP already works).
const PROXY_HOST = process.env.WEBSHARE_PROXY_HOST || 'p.webshare.io';
const PROXY_BASE_PORT = parseInt(process.env.WEBSHARE_PROXY_PORT || '10000', 10);
const PROXY_USER = process.env.WEBSHARE_PROXY_USER || '';
const PROXY_PASS = process.env.WEBSHARE_PROXY_PASS || '';
// With paid Webshare backbone plan, each US slot has its own port:
// slot N → port (PROXY_BASE_PORT + N - 1), username: USER-US-N
const PROXY_MAX_US_SLOTS = parseInt(process.env.WEBSHARE_PROXY_SLOTS || '44744', 10);

function isProxyConfigured(): boolean {
  return !!(PROXY_USER && PROXY_PASS);
}

/**
 * Make an HTTP(S) request through the Webshare CONNECT proxy with a specific
 * slotted username (e.g. "argtnlhz-5"). This ensures both the /player call
 * and the caption XML fetch go through the same residential IP.
 */
function proxyRequestSlotted(
  slottedUser: string,
  proxyPort: number,
  targetUrl: string,
  opts: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ status: number; body: string }> {
  const url = new URL(targetUrl);
  const timeout = opts.timeoutMs ?? 20000;

  return new Promise((resolve, reject) => {
    const proxyAuth = Buffer.from(`${slottedUser}:${PROXY_PASS}`).toString('base64');
    const proxyReq = http.request({
      host: PROXY_HOST,
      port: proxyPort,
      method: 'CONNECT',
      path: `${url.hostname}:443`,
      headers: { 'Proxy-Authorization': `Basic ${proxyAuth}` },
    });

    const timer = setTimeout(() => {
      proxyReq.destroy();
      reject(new Error('Proxy request timed out'));
    }, timeout);

    proxyReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }

      const tlsSocket = tls.connect(
        { host: url.hostname, socket, servername: url.hostname },
        () => {
          const reqHeaders: Record<string, string> = {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'CONSENT=YES+; SOCS=CAI',
            ...(opts.headers ?? {}),
          };

          const req = https.request(
            {
              hostname: url.hostname,
              path: url.pathname + url.search,
              method: opts.method ?? 'GET',
              createConnection: () => tlsSocket as any,
              headers: reqHeaders,
            } as https.RequestOptions,
            (response) => {
              let data = '';
              response.on('data', (chunk: Buffer | string) => {
                data += chunk;
              });
              response.on('end', () => {
                clearTimeout(timer);
                resolve({ status: response.statusCode ?? 0, body: data });
              });
            },
          );

          req.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
          if (opts.body) req.write(opts.body);
          req.end();
        },
      );

      tlsSocket.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    proxyReq.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proxyReq.end();
  });
}

/**
 * Fetch YouTube transcript via InnerTube /player API through Webshare proxy.
 *
 * This replicates the approach used by the Python `youtube-transcript-api` library:
 * 1. POST to /youtubei/v1/player with ANDROID client context
 * 2. Get caption track URLs WITHOUT the `exp=xpe` parameter
 * 3. Fetch caption XML from those clean URLs (returns actual data, not 0 bytes)
 *
 * All requests go through the residential proxy to bypass YouTube's cloud IP blocking.
 */
async function getTranscriptViaProxy(
  videoId: string,
  preferredLang: string,
): Promise<YouTubeTranscript | null> {
  // Try multiple proxy slots from the 44K+ US residential pool.
  // Pick random slots across the pool for even distribution and to avoid
  // rate-limited IPs. Try up to MAX_RETRIES different slots.
  const MAX_RETRIES = 5;
  const usedSlots = new Set<number>();

  const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Pick a random US slot we haven't tried yet
    let slot: number;
    do {
      slot = Math.floor(Math.random() * PROXY_MAX_US_SLOTS) + 1;
    } while (usedSlots.has(slot) && usedSlots.size < PROXY_MAX_US_SLOTS);
    usedSlots.add(slot);

    const proxyUser = `${PROXY_USER}-US-${slot}`;
    const proxyPort = PROXY_BASE_PORT + slot - 1;
    const doProxyRequest = (
      url: string,
      opts: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
    ) => proxyRequestSlotted(proxyUser, proxyPort, url, opts);

    try {
      // Step 1: Call InnerTube /player with ANDROID client
      // ANDROID client returns caption URLs WITHOUT exp=xpe (avoids 0-byte responses).
      const playerResp = await doProxyRequest(
        `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
        {
          method: 'POST',
          body: JSON.stringify({
            context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
            videoId,
          }),
          headers: { 'Content-Type': 'application/json' },
        },
      );

      if (playerResp.status !== 200) {
        console.log(`[webpeel] [youtube] Proxy US-${slot} (port ${proxyPort}): /player returned ${playerResp.status}`);
        continue;
      }

      const playerData = JSON.parse(playerResp.body);
      const captionTracks =
        playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (!captionTracks || captionTracks.length === 0) {
        console.log(`[webpeel] [youtube] Proxy US-${slot} (port ${proxyPort}): no caption tracks`);
        continue;
      }

      // Pick best matching language track
      let track = captionTracks.find((t: any) => t.languageCode === preferredLang);
      if (!track) {
        track = captionTracks.find((t: any) => t.languageCode === 'en') ?? captionTracks[0];
      }

      const captionUrl: string = track.baseUrl;
      if (captionUrl.includes('exp=xpe')) {
        console.log(`[webpeel] [youtube] Proxy US-${slot} (port ${proxyPort}): caption URL has exp=xpe, skipping`);
        continue;
      }

      // Step 2: Fetch caption XML through the SAME proxy slot (same residential IP)
      const capResp = await doProxyRequest(captionUrl);

      if (
        !capResp.body ||
        capResp.body.length === 0 ||
        capResp.status === 429 ||
        capResp.body.includes('<title>Sorry...</title>')
      ) {
        console.log(
          `[webpeel] [youtube] Proxy US-${slot} (port ${proxyPort}): caption XML failed (status=${capResp.status}, bytes=${capResp.body?.length ?? 0})`,
        );
        continue; // Try next slot
      }

      // Parse XML segments — handles both <text start="" dur=""> and <p t="" d=""> formats
      const xmlSegments = [
        ...capResp.body.matchAll(
          /<(?:text|p)\s[^>]*?(?:start|t)="([^"]*)"[^>]*?(?:dur|d)="([^"]*)"[^>]*>([\s\S]*?)<\/(?:text|p)>/g,
        ),
      ];

      if (xmlSegments.length === 0) {
        console.log(`[webpeel] [youtube] Proxy US-${slot} (port ${proxyPort}): no segments parsed from XML`);
        continue;
      }

      const segments: TranscriptSegment[] = xmlSegments
        .map((m) => ({
          text: decodeHtmlEntities(m[3].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()),
          start: parseFloat(m[1]) / (m[1].includes('.') ? 1 : 1000),
          duration: parseFloat(m[2]) / (m[2].includes('.') ? 1 : 1000),
        }))
        .filter((s) => s.text.length > 0);

      if (segments.length === 0) continue;

      // Extract metadata from player response
      const vd = playerData.videoDetails ?? {};
      const mf = playerData.microformat?.playerMicroformatRenderer ?? {};
      const title = vd.title ?? '';
      const channel = vd.author ?? '';
      const lengthSeconds = parseInt(vd.lengthSeconds ?? mf.lengthSeconds ?? '0', 10);
      const description = (vd.shortDescription ?? mf.description?.simpleText ?? '').trim();
      const publishDate = mf.publishDate ?? mf.uploadDate ?? '';
      const availableLanguages = captionTracks.map((t: any) => t.languageCode);

      const fullText = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
      const wordCount = fullText.split(/\s+/).filter(Boolean).length;
      const chapters = parseChaptersFromDescription(description);
      const keyPoints = extractKeyPoints(segments, chapters, lengthSeconds);
      const summary = extractSummary(fullText);

      const viewCount = vd.viewCount ?? mf.viewCount ?? '';
      const likeCount = vd.likeCount ?? '';

      console.log(`[webpeel] [youtube] Proxy slot ${slot} success: ${segments.length} segments, ${wordCount} words`);

      return {
        videoId,
        title,
        channel,
        duration: formatDuration(lengthSeconds),
        language: track.languageCode ?? preferredLang,
        segments,
        fullText,
        availableLanguages,
        description,
        publishDate,
        chapters: chapters.length > 0 ? chapters : undefined,
        keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
        summary,
        wordCount,
        viewCount: viewCount || undefined,
        likeCount: likeCount || undefined,
      };
    } catch (err: any) {
      console.log(`[webpeel] [youtube] Proxy slot ${slot} error:`, err?.message);
      continue;
    }
  }

  // All slots exhausted
  console.log('[webpeel] [youtube] All proxy slots exhausted');
  return null;
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

  // --- Path P: Proxy-based InnerTube (primary for cloud servers) ---
  // Uses Webshare residential proxy + ANDROID InnerTube /player API.
  // This is the approach used by every major YouTube transcript service
  // (youtubetotranscript.com, youtube-transcript.io, etc.)
  if (!process.env.VITEST && isProxyConfigured()) {
    console.log('[webpeel] [youtube] Trying path P: proxy-based InnerTube (residential proxy)');
    try {
      const proxyResult = await getTranscriptViaProxy(videoId, preferredLang);
      if (proxyResult && proxyResult.segments.length > 0) {
        console.log(
          `[webpeel] [youtube] Path P success: ${proxyResult.segments.length} segments, ${proxyResult.wordCount} words`,
        );
        return proxyResult;
      }
      console.log('[webpeel] [youtube] Path P returned empty/null, falling through');
    } catch (err: any) {
      console.log('[webpeel] [youtube] Path P failed:', err?.message);
    }
  }

  // --- Path 0: youtube-transcript-plus (fastest — uses InnerTube API, ~1s) ---
  // This library calls YouTube's internal InnerTube API directly via POST request,
  // bypassing the IP-locked timedtext XML URLs. Works reliably from cloud servers.
  // Skip in test mode — tests use mocked HTTP, but this path makes real InnerTube calls.
  if (!process.env.VITEST) {
  console.log('[webpeel] [youtube] Trying path 0: youtube-transcript-plus (InnerTube API)');
  try {
    const ytpSegments = await ytpFetchTranscript(videoId, { lang: preferredLang });
    if (ytpSegments && ytpSegments.length > 0) {
      // We have transcript segments — now fetch page metadata (title, channel, etc.)
      let title = '', channel = '', lengthSeconds = 0, description = '', publishDate = '';
      let availableLanguages = [preferredLang];
      try {
        const metaResp = await fetch(videoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
          },
          signal: AbortSignal.timeout(8000),
        });
        const html = await metaResp.text();
        const pr = extractPlayerResponse(html);
        if (pr) {
          const vd = pr.videoDetails ?? {};
          const mf = pr.microformat?.playerMicroformatRenderer ?? {};
          title = vd.title ?? '';
          channel = vd.author ?? '';
          lengthSeconds = parseInt(vd.lengthSeconds ?? mf.lengthSeconds ?? '0', 10);
          description = (vd.shortDescription ?? mf.description?.simpleText ?? '').trim();
          publishDate = mf.publishDate ?? mf.uploadDate ?? '';
          const tracks = extractCaptionTracks(pr);
          if (tracks.length > 0) availableLanguages = tracks.map(t => t.languageCode);
        }
      } catch { /* metadata fetch failed — segments are enough */ }

      // Convert youtube-transcript-plus format to our format
      const segments: TranscriptSegment[] = ytpSegments.map(s => ({
        text: decodeHtmlEntities((s.text ?? '').replace(/\n/g, ' ').trim()),
        start: (s.offset ?? 0) / 1000, // offset is in ms
        duration: (s.duration ?? 0) / 1000,
      })).filter(s => s.text.length > 0);

      const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
      const wordCount = fullText.split(/\s+/).filter(Boolean).length;
      const chapters = parseChaptersFromDescription(description);
      const keyPoints = extractKeyPoints(segments, chapters, lengthSeconds);
      const summary = extractSummary(fullText);

      console.log(`[webpeel] [youtube] Path 0 success: ${segments.length} segments, ${wordCount} words`);
      return {
        videoId,
        title,
        channel,
        duration: formatDuration(lengthSeconds),
        language: ytpSegments[0]?.lang ?? preferredLang,
        segments,
        fullText,
        availableLanguages,
        description,
        publishDate,
        chapters: chapters.length > 0 ? chapters : undefined,
        keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
        summary,
        wordCount,
        viewCount: undefined, // not available in this path without extra fetch
        likeCount: undefined,
      };
    }
    console.log('[webpeel] [youtube] Path 0 returned empty segments');
  } catch (err: any) {
    console.log('[webpeel] [youtube] Path 0 failed:', err?.message);
  }
  } // end VITEST guard

  const ytUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const ytHeaders = {
    'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // --- Path 1: yt-dlp approach (most reliable on cloud servers — handles signature challenges internally) ---
  if (ytdlpAvailable) {
    console.log('[webpeel] [youtube] Trying path 1: yt-dlp');
    try {
      const ytdlpResult = await getTranscriptViaYtDlp(videoId, preferredLang);
      if (ytdlpResult && ytdlpResult.segments.length > 0) {
        return ytdlpResult;
      }
      console.log('[webpeel] [youtube] Path 1 failed: yt-dlp returned no segments');
    } catch (err: any) {
      console.log('[webpeel] [youtube] Path 1 failed:', err?.message);
    }
  } else {
    console.log('[webpeel] [youtube] Skipping path 1: yt-dlp not available');
  }

  // --- Path 2: HTTP fetch (simpleFetch first; if our challenge detection fires, fall back to native fetch) ---
  // YouTube serves consent/challenge pages to server IPs without cookies.
  // Setting SOCS consent cookie bypasses this — same approach as youtube-transcript npm.
  // On cloud servers, simpleFetch may throw BlockedError due to our own challenge detection;
  // in that case we retry with native fetch() which bypasses that guard.
  console.log('[webpeel] [youtube] Trying path 2: native fetch');
  try {
    let html: string;
    try {
      const fetchResult = await simpleFetch(videoUrl, ytUserAgent, 15000, ytHeaders);
      html = fetchResult.html;
    } catch (simpleFetchErr: any) {
      // If our own challenge detection threw BlockedError, retry with raw native fetch
      const errMsg = (simpleFetchErr?.message ?? '').toLowerCase();
      const isBlocked =
        simpleFetchErr?.constructor?.name === 'BlockedError' ||
        errMsg.includes('blocked') ||
        errMsg.includes('challenge') ||
        errMsg.includes('cloudflare');
      if (!isBlocked) throw simpleFetchErr;
      console.log('[webpeel] [youtube] simpleFetch BlockedError — retrying with native fetch');
      const fetchResponse = await fetch(videoUrl, {
        headers: {
          'User-Agent': ytUserAgent,
          ...ytHeaders,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      html = await fetchResponse.text();
    }

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
    // Pass same cookies + user-agent to caption fetch — URL is session-locked
    const captionXml = await fetchCaptionXml(selectedTrack.baseUrl, ytUserAgent, ytHeaders);
    const segments = parseCaptionXml(captionXml);
    if (segments.length === 0) {
      // Caption URL returned empty content (common when ip=0.0.0.0 in signature)
      // Fall through to browser intercept path
      throw new Error('Caption XML returned empty — session-locked URL');
    }
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
      viewCount: (videoDetails.viewCount ?? microformat.viewCount ?? '') || undefined,
      likeCount: (videoDetails.likeCount ?? '') || undefined,
    };
  } catch (err: any) {
    // Re-throw definitive failures (browser path won't help)
    const msg = err?.message ?? '';
    if (msg.includes('No captions available') || msg.includes('Not a valid YouTube URL')) {
      throw err;
    }
    console.log('[webpeel] [youtube] Path 2 failed:', msg);
    // Network/parsing failures — fall through to browser intercept approach
  }

  // --- Path 3: Browser intercept approach ---
  // YouTube's caption URLs are session-specific (they return empty when fetched
  // from a different HTTP client). We intercept the timedtext network request
  // that the YouTube player makes automatically when loading the page.
  console.log('[webpeel] [youtube] Trying path 3: browser intercept');
  return getTranscriptViaBrowserIntercept(videoId, videoUrl, preferredLang);
}

/**
 * Use yt-dlp to extract YouTube transcripts. yt-dlp handles all the
 * signature challenges (player JS deciphering, multiple API endpoints)
 * that defeat server-side HTTP fetch approaches.
 */
async function getTranscriptViaYtDlp(
  videoId: string,
  preferredLang: string,
): Promise<YouTubeTranscript | null> {
  const outPath = join(tmpdir(), `webpeel_yt_${videoId}_${Date.now()}`);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return new Promise<YouTubeTranscript | null>((resolve) => {
    const args = [
      '--skip-download',
      '--write-auto-sub',
      '--sub-lang', preferredLang,
      '--sub-format', 'json3',
      '--write-info-json',
      '--output', outPath,
      '--no-warnings',
      '--quiet',
      videoUrl,
    ];

    // Pass explicit PATH so yt-dlp is found in Docker containers
    // pip3 installs to /usr/local/bin which may not be in Node's process.env.PATH
    const execEnv = {
      ...process.env,
      PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}`,
    };

    const proc = execFile('yt-dlp', args, { timeout: 60000, env: execEnv }, async (err) => {
      try {
        if (err) {
          // yt-dlp not installed, timed out, or failed
          console.error('[webpeel] yt-dlp error:', err.message);
          resolve(null);
          return;
        }

        // Read subtitle file
        const subFiles = [`${outPath}.${preferredLang}.json3`, `${outPath}.en.json3`];
        let subData: any = null;
        for (const sf of subFiles) {
          try {
            const raw = await readFile(sf, 'utf-8');
            subData = JSON.parse(raw);
            await unlink(sf).catch(() => {});
            break;
          } catch { /* try next */ }
        }

        // Read info JSON for metadata
        let infoData: any = null;
        try {
          const infoRaw = await readFile(`${outPath}.info.json`, 'utf-8');
          infoData = JSON.parse(infoRaw);
          await unlink(`${outPath}.info.json`).catch(() => {});
        } catch { /* metadata is optional */ }

        if (!subData || !subData.events) {
          resolve(null);
          return;
        }

        const events = subData.events || [];
        const segments: TranscriptSegment[] = events
          .filter((e: any) => e.segs)
          .map((e: any) => ({
            text: (e.segs as any[]).map((s) => s.utf8 || '').join('').trim(),
            start: (e.tStartMs || 0) / 1000,
            duration: (e.dDurationMs || 0) / 1000,
          }))
          .filter((s: TranscriptSegment) => s.text.length > 0);

        const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
        const wordCount = fullText.split(/\s+/).filter(Boolean).length;

        const title = infoData?.title || '';
        const channel = infoData?.uploader || infoData?.channel || '';
        const lengthSeconds = infoData?.duration || 0;
        const description = infoData?.description || '';
        const publishDate = infoData?.upload_date
          ? `${infoData.upload_date.slice(0, 4)}-${infoData.upload_date.slice(4, 6)}-${infoData.upload_date.slice(6, 8)}`
          : '';

        const chapters = parseChaptersFromDescription(description);
        const keyPoints = extractKeyPoints(segments, chapters, lengthSeconds);
        const summary = extractSummary(fullText);

        resolve({
          videoId,
          title,
          channel,
          duration: formatDuration(lengthSeconds),
          language: preferredLang,
          segments,
          fullText,
          availableLanguages: [preferredLang],
          description,
          publishDate,
          chapters: chapters.length > 0 ? chapters : undefined,
          keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
          summary,
          wordCount,
          viewCount: (infoData.view_count?.toString() ?? '') || undefined,
          likeCount: (infoData.like_count?.toString() ?? '') || undefined,
        });
      } catch {
        resolve(null);
      }
    });

    // Safety: if process hangs, resolve null
    proc.on('error', () => resolve(null));
  });
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
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Wait for timedtext request to be intercepted (player auto-fetches captions)
    const startWait = Date.now();
    while (!capturedJson && Date.now() - startWait < 12000) {
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
      viewCount: undefined, // browser path doesn't reliably get this
      likeCount: undefined,
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
 * Must use same cookies/UA as the page fetch — URLs are session-locked.
 * Tries simpleFetch first; falls back to native fetch() if BlockedError is thrown
 * (our own challenge detection fires on cloud server IPs).
 */
async function fetchCaptionXml(
  baseUrl: string,
  userAgent?: string,
  headers?: Record<string, string>,
): Promise<string> {
  try {
    const result = await simpleFetch(baseUrl, userAgent, 10000, headers);
    return result.html;
  } catch (simpleFetchErr: any) {
    const errMsg = (simpleFetchErr?.message ?? '').toLowerCase();
    const isBlocked =
      simpleFetchErr?.constructor?.name === 'BlockedError' ||
      errMsg.includes('blocked') ||
      errMsg.includes('challenge') ||
      errMsg.includes('cloudflare');
    if (!isBlocked) throw simpleFetchErr;
    // BlockedError: retry with native fetch
    const fetchHeaders: Record<string, string> = {};
    if (userAgent) fetchHeaders['User-Agent'] = userAgent;
    if (headers) Object.assign(fetchHeaders, headers);
    const response = await fetch(baseUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    return response.text();
  }
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
