/**
 * Transcript export endpoint
 *
 * GET /v1/transcript/export?url=<youtube_url>&format=srt|txt|md|json
 *
 * Downloads a YouTube transcript in the requested format with appropriate
 * Content-Type and Content-Disposition headers.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { getYouTubeTranscript, parseYouTubeUrl } from '../../core/youtube.js';
import { toSRT, toTXT, toMarkdownDoc, toJSON } from '../../core/transcript-export.js';

// Valid export format values
const VALID_FORMATS = ['srt', 'txt', 'md', 'json'] as const;
type ExportFormat = (typeof VALID_FORMATS)[number];

// Content-Type and file extension per format
const FORMAT_META: Record<ExportFormat, { contentType: string; ext: string }> = {
  srt:  { contentType: 'text/plain; charset=utf-8',    ext: 'srt' },
  txt:  { contentType: 'text/plain; charset=utf-8',    ext: 'txt' },
  md:   { contentType: 'text/markdown; charset=utf-8', ext: 'md'  },
  json: { contentType: 'application/json; charset=utf-8', ext: 'json' },
};

/**
 * Sanitise a video title so it is safe to use as a filename.
 * Strips special characters, collapses spaces to underscores, truncates to 80 chars.
 */
function safeFilename(title: string, fallback: string): string {
  const base = (title || fallback)
    .replace(/[^\w\s\-._]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
    .replace(/^_+|_+$/g, '');
  return base || fallback;
}

export function createTranscriptExportRouter(): Router {
  const router = Router();

  /**
   * GET /v1/transcript/export
   *
   * Query params:
   *   url      - YouTube video URL (required)
   *   format   - Output format: srt | txt | md | json  (default: txt)
   *   language - Preferred transcript language code, e.g. "en" (default: "en")
   *
   * Response:
   *   - 200  file download with appropriate Content-Type / Content-Disposition
   *   - 400  invalid URL or format
   *   - 401  missing API key
   *   - 404  video has no captions
   *   - 500  extraction failure
   */
  router.get('/v1/transcript/export', async (req: Request, res: Response) => {
    // ── Auth ───────────────────────────────────────────────────────────────
    const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({
        success: false,
        error: {
          type: 'authentication_required',
          message: 'API key required. Get one at https://app.webpeel.dev/keys',
          hint: 'Pass your API key in the Authorization header: Bearer <key>',
          docs: 'https://webpeel.dev/docs/errors#authentication-required',
        },
        requestId: req.requestId || crypto.randomUUID(),
      });
      return;
    }

    const { url, format, language } = req.query;

    // ── URL validation ─────────────────────────────────────────────────────
    if (!url || typeof url !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_request',
          message:
            'Missing or invalid "url" parameter. Pass a YouTube URL: GET /v1/transcript/export?url=https://youtu.be/VIDEO_ID&format=srt',
          docs: 'https://webpeel.dev/docs/errors#invalid-request',
        },
        requestId: req.requestId || crypto.randomUUID(),
      });
      return;
    }

    const videoId = parseYouTubeUrl(url);
    if (!videoId) {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_youtube_url',
          message: 'The provided URL is not a valid YouTube video URL.',
          hint: 'Supported formats: https://www.youtube.com/watch?v=VIDEO_ID, https://youtu.be/VIDEO_ID',
          docs: 'https://webpeel.dev/docs/errors#invalid-youtube-url',
        },
        requestId: req.requestId || crypto.randomUUID(),
      });
      return;
    }

    // ── Format validation ──────────────────────────────────────────────────
    const rawFormat = (typeof format === 'string' ? format : 'txt').toLowerCase();
    if (!(VALID_FORMATS as readonly string[]).includes(rawFormat)) {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_format',
          message: `Invalid format "${format}". Supported formats: ${VALID_FORMATS.join(', ')}`,
          docs: 'https://webpeel.dev/docs/errors#invalid-format',
        },
        requestId: req.requestId || crypto.randomUUID(),
      });
      return;
    }
    const fmt = rawFormat as ExportFormat;

    // ── Extract transcript ─────────────────────────────────────────────────
    try {
      const lang = typeof language === 'string' ? language : 'en';
      const transcript = await getYouTubeTranscript(url, { language: lang });

      // ── Convert to requested format ──────────────────────────────────────
      let content: string;
      switch (fmt) {
        case 'srt':
          content = toSRT(transcript.segments);
          break;
        case 'txt':
          content = toTXT(transcript.segments);
          break;
        case 'md':
          content = toMarkdownDoc(transcript.title, transcript.channel, transcript.segments);
          break;
        case 'json':
          content = toJSON(transcript);
          break;
      }

      const { contentType, ext } = FORMAT_META[fmt];
      const filename = safeFilename(transcript.title, videoId);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.${ext}"`);
      res.send(content);
    } catch (error: any) {
      const message: string = error?.message ?? 'Failed to extract YouTube transcript';

      if (message.includes('No captions available')) {
        res.status(404).json({
          success: false,
          error: {
            type: 'no_captions',
            message: 'No captions are available for this video. The video may not have subtitles enabled.',
            hint: 'Try a different video or check if captions are enabled on YouTube.',
            docs: 'https://webpeel.dev/docs/errors#no-captions',
          },
          videoId,
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      if (message.includes('Not a valid YouTube URL')) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_youtube_url',
            message,
            docs: 'https://webpeel.dev/docs/errors#invalid-youtube-url',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: {
          type: 'extraction_failed',
          message:
            'Failed to extract YouTube transcript. The video page may have changed or the video is unavailable.',
          hint: process.env.NODE_ENV !== 'production' ? message : undefined,
          docs: 'https://webpeel.dev/docs/errors#extraction-failed',
        },
        requestId: req.requestId || crypto.randomUUID(),
      });
    }
  });

  return router;
}
