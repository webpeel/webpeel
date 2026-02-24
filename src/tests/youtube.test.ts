/**
 * Tests for YouTube transcript extraction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseYouTubeUrl,
  extractVideoInfo,
  extractPlayerResponse,
  parseCaptionXml,
  decodeHtmlEntities,
  formatDuration,
  getYouTubeTranscript,
} from '../core/youtube.js';

// ---------------------------------------------------------------------------
// Mock simpleFetch so tests never hit the network
// ---------------------------------------------------------------------------

vi.mock('../core/fetcher.js', () => ({
  simpleFetch: vi.fn(),
}));

import { simpleFetch } from '../core/fetcher.js';
const mockSimpleFetch = vi.mocked(simpleFetch);

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_PLAYER_RESPONSE = {
  videoDetails: {
    videoId: 'dQw4w9WgXcQ',
    title: 'Test Video Title',
    author: 'Test Channel',
    lengthSeconds: '754',
    viewCount: '1000000',
    shortDescription: 'A great test video description.',
    thumbnail: {
      thumbnails: [
        { url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/default.jpg', width: 120, height: 90 },
        { url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', width: 1280, height: 720 },
      ],
    },
  },
  microformat: {
    playerMicroformatRenderer: {
      publishDate: '2024-01-15',
      uploadDate: '2024-01-15',
      viewCount: '1000000',
      lengthSeconds: '754',
      ownerChannelName: 'Test Channel',
      title: { simpleText: 'Test Video Title' },
      description: { simpleText: 'A great test video description.' },
      thumbnail: { thumbnails: [{ url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg' }] },
    },
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en',
          languageCode: 'en',
          name: { simpleText: 'English' },
          kind: '',
          vssId: '.en',
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=es',
          languageCode: 'es',
          name: { simpleText: 'Spanish' },
          kind: '',
          vssId: '.es',
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&kind=asr',
          languageCode: 'en',
          name: { simpleText: 'English (auto-generated)' },
          kind: 'asr',
          vssId: 'a.en',
        },
      ],
    },
  },
};

const SAMPLE_HTML = `<html><head><title>Test Video Title - YouTube</title>
<meta property="og:title" content="Test Video Title">
<meta property="og:description" content="A great test video description.">
</head><body><script>var ytInitialPlayerResponse = ${JSON.stringify(SAMPLE_PLAYER_RESPONSE)};</script></body></html>`;

const SAMPLE_CAPTION_XML = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
<text start="0.5" dur="2.1">Hello &amp; welcome</text>
<text start="2.8" dur="3.2">This is a test video</text>
<text start="6.2" dur="2.0">It&#39;s got great content</text>
<text start="8.5" dur="4.0">With &lt;special&gt; characters &amp; more</text>
<text start="12.7" dur="1.5">Thanks for watching!</text>
</transcript>`;

// ---------------------------------------------------------------------------
// parseYouTubeUrl
// ---------------------------------------------------------------------------

describe('parseYouTubeUrl', () => {
  it('parses standard watch URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses short youtu.be URL', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses embed URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses mobile URL', () => {
    expect(parseYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses URL with extra params', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLxxx')).toBe('dQw4w9WgXcQ');
  });

  it('parses YouTube Shorts URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URL', () => {
    expect(parseYouTubeUrl('https://vimeo.com/12345')).toBeNull();
  });

  it('returns null for invalid video ID (too short)', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeNull();
  });

  it('returns null for missing v param', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseYouTubeUrl('')).toBeNull();
  });

  it('returns null for invalid URL string', () => {
    expect(parseYouTubeUrl('not-a-url')).toBeNull();
  });

  it('handles youtu.be with trailing params', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ');
  });
});

// ---------------------------------------------------------------------------
// extractPlayerResponse
// ---------------------------------------------------------------------------

describe('extractPlayerResponse', () => {
  it('extracts player response from page HTML', () => {
    const result = extractPlayerResponse(SAMPLE_HTML);
    expect(result).not.toBeNull();
    expect(result!.videoDetails.videoId).toBe('dQw4w9WgXcQ');
    expect(result!.videoDetails.title).toBe('Test Video Title');
  });

  it('returns null for HTML without ytInitialPlayerResponse', () => {
    const result = extractPlayerResponse('<html><body>No data here</body></html>');
    expect(result).toBeNull();
  });

  it('extracts caption tracks array', () => {
    const result = extractPlayerResponse(SAMPLE_HTML);
    const tracks = result!.captions.playerCaptionsTracklistRenderer.captionTracks;
    expect(tracks).toHaveLength(3);
    expect(tracks[0].languageCode).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// extractVideoInfo
// ---------------------------------------------------------------------------

describe('extractVideoInfo', () => {
  it('extracts all video metadata fields', () => {
    const info = extractVideoInfo(SAMPLE_HTML);
    expect(info.videoId).toBe('dQw4w9WgXcQ');
    expect(info.title).toBe('Test Video Title');
    expect(info.channel).toBe('Test Channel');
    expect(info.duration).toBe('12:34'); // 754 seconds = 12:34
    expect(info.viewCount).toBe('1000000');
    expect(info.description).toBe('A great test video description.');
    expect(info.publishDate).toBe('2024-01-15');
  });

  it('includes thumbnail URL', () => {
    const info = extractVideoInfo(SAMPLE_HTML);
    expect(info.thumbnail).toContain('youtube.com');
    expect(info.thumbnail).toContain('dQw4w9WgXcQ');
  });

  it('returns empty strings for missing fields on empty HTML', () => {
    const info = extractVideoInfo('<html><body></body></html>');
    expect(info.videoId).toBe('');
    expect(info.title).toBe('');
    expect(info.channel).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseCaptionXml
// ---------------------------------------------------------------------------

describe('parseCaptionXml', () => {
  it('parses all segments from caption XML', () => {
    const segments = parseCaptionXml(SAMPLE_CAPTION_XML);
    expect(segments).toHaveLength(5);
  });

  it('correctly extracts start time and duration', () => {
    const segments = parseCaptionXml(SAMPLE_CAPTION_XML);
    expect(segments[0].start).toBe(0.5);
    expect(segments[0].duration).toBe(2.1);
    expect(segments[1].start).toBe(2.8);
    expect(segments[1].duration).toBe(3.2);
  });

  it('decodes HTML entities in text', () => {
    const segments = parseCaptionXml(SAMPLE_CAPTION_XML);
    expect(segments[0].text).toBe('Hello & welcome');
    expect(segments[2].text).toBe("It's got great content");
    expect(segments[3].text).toBe('With <special> characters & more');
  });

  it('returns empty array for empty XML', () => {
    const segments = parseCaptionXml('<transcript></transcript>');
    expect(segments).toHaveLength(0);
  });

  it('handles non-XML input gracefully', () => {
    const segments = parseCaptionXml('not xml at all');
    expect(segments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// decodeHtmlEntities
// ---------------------------------------------------------------------------

describe('decodeHtmlEntities', () => {
  it('decodes &amp;', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
  });

  it('decodes &quot;', () => {
    expect(decodeHtmlEntities('say &quot;hello&quot;')).toBe('say "hello"');
  });

  it("decodes &#39; and &apos;", () => {
    expect(decodeHtmlEntities("it&#39;s")).toBe("it's");
    expect(decodeHtmlEntities("it&apos;s")).toBe("it's");
  });

  it('decodes numeric entities', () => {
    expect(decodeHtmlEntities('&#65;')).toBe('A');
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
  });

  it('strips inline HTML tags', () => {
    expect(decodeHtmlEntities('<font color="red">hello</font>')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('formats 754 seconds to 12:34', () => {
    expect(formatDuration(754)).toBe('12:34');
  });

  it('formats 65 seconds to 1:05', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('formats 59 seconds to 0:59', () => {
    expect(formatDuration(59)).toBe('0:59');
  });

  it('formats long videos to HH:MM:SS', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(7200)).toBe('2:00:00');
  });

  it('handles 0', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('handles NaN gracefully', () => {
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

// ---------------------------------------------------------------------------
// getYouTubeTranscript — mocked network calls
// ---------------------------------------------------------------------------

describe('getYouTubeTranscript', () => {
  beforeEach(() => {
    mockSimpleFetch.mockReset();
  });

  it('fetches and parses a full transcript', async () => {
    mockSimpleFetch
      .mockResolvedValueOnce({
        html: SAMPLE_HTML,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        method: 'simple',
        contentType: 'text/html',
        elapsed: 100,
      } as any)
      .mockResolvedValueOnce({
        html: SAMPLE_CAPTION_XML,
        url: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en',
        method: 'simple',
        contentType: 'text/xml',
        elapsed: 50,
      } as any);

    const transcript = await getYouTubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(transcript.videoId).toBe('dQw4w9WgXcQ');
    expect(transcript.title).toBe('Test Video Title');
    expect(transcript.channel).toBe('Test Channel');
    expect(transcript.duration).toBe('12:34');
    expect(transcript.language).toBe('en');
    expect(transcript.segments.length).toBeGreaterThan(0);
    expect(transcript.fullText).toContain('Hello & welcome');
    expect(transcript.availableLanguages).toContain('en');
    expect(transcript.availableLanguages).toContain('es');
  });

  it('throws for invalid YouTube URL', async () => {
    await expect(
      getYouTubeTranscript('https://example.com/not-youtube'),
    ).rejects.toThrow('Not a valid YouTube URL');
  });

  it('throws when no captions are available', async () => {
    const noCapHtml = `<html><body><script>var ytInitialPlayerResponse = ${JSON.stringify({
      videoDetails: {
        videoId: 'dQw4w9WgXcQ',
        title: 'No Captions',
        author: 'Channel',
        lengthSeconds: '60',
        viewCount: '100',
      },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
    })};</script></body></html>`;

    mockSimpleFetch.mockResolvedValueOnce({
      html: noCapHtml,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      method: 'simple',
      contentType: 'text/html',
      elapsed: 100,
    } as any);

    await expect(
      getYouTubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).rejects.toThrow('No captions available');
  });

  it('prefers manual captions over auto-generated for same language', async () => {
    mockSimpleFetch
      .mockResolvedValueOnce({
        html: SAMPLE_HTML,
        url: '',
        method: 'simple',
        contentType: 'text/html',
        elapsed: 100,
      } as any)
      .mockResolvedValueOnce({
        html: SAMPLE_CAPTION_XML,
        url: '',
        method: 'simple',
        contentType: 'text/xml',
        elapsed: 50,
      } as any);

    const transcript = await getYouTubeTranscript(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      { language: 'en' },
    );

    // Should use the manual en track, not the asr one
    expect(transcript.language).toBe('en');
    const captionFetchUrl = mockSimpleFetch.mock.calls[1][0] as string;
    expect(captionFetchUrl).not.toContain('kind=asr');
  });

  it('falls back to first available language when preferred not found', async () => {
    mockSimpleFetch
      .mockResolvedValueOnce({
        html: SAMPLE_HTML,
        url: '',
        method: 'simple',
        contentType: 'text/html',
        elapsed: 100,
      } as any)
      .mockResolvedValueOnce({
        html: SAMPLE_CAPTION_XML,
        url: '',
        method: 'simple',
        contentType: 'text/xml',
        elapsed: 50,
      } as any);

    // Request Japanese — not available, should fall back to en or es
    const transcript = await getYouTubeTranscript(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      { language: 'ja' },
    );
    expect(['en', 'es']).toContain(transcript.language);
  });

  it('works with youtu.be short URLs', async () => {
    mockSimpleFetch
      .mockResolvedValueOnce({
        html: SAMPLE_HTML,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        method: 'simple',
        contentType: 'text/html',
        elapsed: 100,
      } as any)
      .mockResolvedValueOnce({
        html: SAMPLE_CAPTION_XML,
        url: '',
        method: 'simple',
        contentType: 'text/xml',
        elapsed: 50,
      } as any);

    const transcript = await getYouTubeTranscript('https://youtu.be/dQw4w9WgXcQ');
    expect(transcript.videoId).toBe('dQw4w9WgXcQ');
  });
});
