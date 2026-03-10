import { NextRequest, NextResponse } from 'next/server';

/**
 * YouTube transcript extraction via InnerTube API with ANDROID client context.
 * 
 * The key insight: YouTube blocks cloud IPs from fetching timedtext XML when
 * using the WEB client. But the ANDROID client context returns caption URLs
 * that may work from cloud servers.
 * 
 * Approach:
 * 1. Fetch video page HTML → extract INNERTUBE_API_KEY
 * 2. POST to /youtubei/v1/player with ANDROID client context
 * 3. Get captionTracks[].baseUrl from response
 * 4. Fetch caption XML
 * 5. Parse XML into segments
 * 
 * GET /api/youtube-transcript?url=https://youtube.com/watch?v=...
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
  }

  const start = Date.now();

  try {
    // Step 1: Fetch video page to get INNERTUBE_API_KEY + metadata
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await pageResp.text();

    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
    if (!apiKey) {
      return NextResponse.json({ error: 'Could not extract InnerTube API key' }, { status: 500 });
    }

    // Extract metadata from HTML
    const title = html.match(/"title":"([^"]+)"/)?.[1] ?? '';
    const channel = html.match(/"author":"([^"]+)"/)?.[1] ?? '';
    const lengthSec = parseInt(html.match(/"lengthSeconds":"(\d+)"/)?.[1] ?? '0', 10);
    let duration = '';
    if (lengthSec > 0) {
      const h = Math.floor(lengthSec / 3600);
      const m = Math.floor((lengthSec % 3600) / 60);
      const s = lengthSec % 60;
      duration = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
    }
    const description = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\n/g, '\n') ?? '';

    // Step 2: Call InnerTube player API with ANDROID client context
    const playerResp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
          }
        },
        videoId,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const player = await playerResp.json();

    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) {
      return NextResponse.json({
        error: 'No captions available for this video',
        method: 'android-innertube',
      }, { status: 404 });
    }

    // Prefer English, fall back to first track
    const track = tracks.find((t: any) => t.languageCode === 'en') || tracks[0];
    const lang = track.languageCode;

    // Step 3: Fetch the caption XML
    const baseUrl = track.baseUrl.replace(/&fmt=\w+$/, '');
    const captResp = await fetch(baseUrl, {
      headers: {
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      signal: AbortSignal.timeout(10000),
    });
    const xml = await captResp.text();

    if (!xml || xml.length < 50) {
      return NextResponse.json({
        error: 'Caption XML empty (YouTube IP block detected)',
        xmlLength: xml.length,
        method: 'android-innertube',
      }, { status: 502 });
    }

    // Step 4: Parse XML into segments
    const segments: Array<{ text: string; start: number; duration: number }> = [];
    const textRegex = /<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
      const text = decodeXmlEntities(match[3]!.replace(/\n/g, ' ').trim());
      segments.push({
        text,
        start: parseFloat(match[1]!),
        duration: parseFloat(match[2]!),
      });
    }

    const fullText = segments.map(s => s.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const elapsed = Date.now() - start;

    return NextResponse.json({
      success: true,
      videoId,
      title,
      channel,
      duration,
      language: lang,
      segments,
      fullText,
      wordCount,
      description: description.substring(0, 500),
      elapsed,
      method: 'android-innertube',
    });
  } catch (error: any) {
    const elapsed = Date.now() - start;
    return NextResponse.json({
      error: error.message ?? 'Failed to fetch transcript',
      elapsed,
      method: 'android-innertube',
    }, { status: 500 });
  }
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}
