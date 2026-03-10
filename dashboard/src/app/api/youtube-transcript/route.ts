import { NextRequest, NextResponse } from 'next/server';
import { fetchTranscript } from 'youtube-transcript-plus';

/**
 * YouTube transcript extraction via Vercel serverless.
 * Bypasses Render entirely — Vercel's AWS Lambda IPs are different
 * from Render's IPs and may not be blocked by YouTube.
 * 
 * GET /api/youtube-transcript?url=https://youtube.com/watch?v=...
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Extract video ID from URL
  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
  }

  const start = Date.now();

  try {
    // Use youtube-transcript-plus (InnerTube API approach)
    const segments = await fetchTranscript(videoId, { lang: 'en' });

    if (!segments || segments.length === 0) {
      return NextResponse.json({ error: 'No transcript available for this video' }, { status: 404 });
    }

    // Build response
    const fullText = segments
      .map(s => (s.text ?? '').replace(/\n/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    // Fetch video metadata from YouTube page
    let title = '', channel = '', duration = '', description = '';
    try {
      const metaResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
        },
        signal: AbortSignal.timeout(5000),
      });
      const html = await metaResp.text();

      // Extract metadata from HTML
      title = html.match(/"title":"([^"]+)"/)?.[1] ?? '';
      channel = html.match(/"author":"([^"]+)"/)?.[1] ?? '';
      const lengthSec = parseInt(html.match(/"lengthSeconds":"(\d+)"/)?.[1] ?? '0', 10);
      if (lengthSec > 0) {
        const h = Math.floor(lengthSec / 3600);
        const m = Math.floor((lengthSec % 3600) / 60);
        const s = lengthSec % 60;
        duration = h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${m}:${String(s).padStart(2, '0')}`;
      }
      description = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\n/g, '\n') ?? '';
    } catch { /* metadata is optional */ }

    const elapsed = Date.now() - start;

    return NextResponse.json({
      success: true,
      videoId,
      title,
      channel,
      duration,
      language: segments[0]?.lang ?? 'en',
      segments: segments.map(s => ({
        text: (s.text ?? '').replace(/\n/g, ' ').trim(),
        start: (s.offset ?? 0) / 1000,
        duration: (s.duration ?? 0) / 1000,
      })),
      fullText,
      wordCount,
      description: description.substring(0, 500),
      elapsed,
    });
  } catch (error: any) {
    const elapsed = Date.now() - start;
    return NextResponse.json({
      error: error.message ?? 'Failed to fetch transcript',
      elapsed,
    }, { status: 500 });
  }
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // bare video ID
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}
