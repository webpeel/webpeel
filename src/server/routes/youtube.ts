/**
 * YouTube transcript endpoint
 * GET /v1/youtube?url=<youtube_url>&language=en
 */

import { Router, Request, Response } from 'express';
import { getYouTubeTranscript, parseYouTubeUrl } from '../../core/youtube.js';

export function createYouTubeRouter(): Router {
  const router = Router();

  /**
   * GET /v1/youtube
   * Extract transcript and metadata from a YouTube video.
   *
   * Query params:
   *   url      - YouTube video URL (required)
   *   language - Preferred language code, default "en" (optional)
   *
   * Example:
   *   curl "https://api.webpeel.dev/v1/youtube?url=https://youtu.be/dQw4w9WgXcQ"
   */
  router.get('/v1/youtube', async (req: Request, res: Response) => {
    // AUTH: require authentication (global middleware sets req.auth)
    if (!req.auth?.keyInfo) {
      res.status(401).json({ error: 'authentication_required', message: 'API key required. Get one at https://app.webpeel.dev/keys' });
      return;    }
    const { url, language } = req.query;

    if (!url || typeof url !== 'string') {
      res.status(400).json({
        error: 'invalid_request',
        message: 'Missing or invalid "url" parameter. Pass a YouTube URL: GET /v1/youtube?url=https://youtu.be/VIDEO_ID',
        example: 'curl "https://api.webpeel.dev/v1/youtube?url=https://youtu.be/dQw4w9WgXcQ"',
      });
      return;
    }

    const videoId = parseYouTubeUrl(url);
    if (!videoId) {
      res.status(400).json({
        error: 'invalid_youtube_url',
        message: 'The provided URL is not a valid YouTube video URL.',
        supported: [
          'https://www.youtube.com/watch?v=VIDEO_ID',
          'https://youtu.be/VIDEO_ID',
          'https://www.youtube.com/embed/VIDEO_ID',
          'https://m.youtube.com/watch?v=VIDEO_ID',
        ],
      });
      return;
    }

    try {
      const lang = typeof language === 'string' ? language : 'en';

      const transcript = await getYouTubeTranscript(url, { language: lang });

      res.json({
        success: true,
        videoId: transcript.videoId,
        title: transcript.title,
        channel: transcript.channel,
        duration: transcript.duration,
        language: transcript.language,
        availableLanguages: transcript.availableLanguages,
        fullText: transcript.fullText,
        segments: transcript.segments,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    } catch (error: any) {
      const message = error?.message ?? 'Failed to extract YouTube transcript';

      if (message.includes('No captions available')) {
        res.status(404).json({
          error: 'no_captions',
          message: `No captions are available for this video. The video may not have subtitles.`,
          videoId,
        });
        return;
      }

      if (message.includes('Not a valid YouTube URL')) {
        res.status(400).json({
          error: 'invalid_youtube_url',
          message,
        });
        return;
      }

      console.error('[youtube route] Error:', error);
      res.status(500).json({
        error: 'extraction_failed',
        message: 'Failed to extract YouTube transcript. The video page may have changed or the video is unavailable.',
        detail: process.env.NODE_ENV !== 'production' ? message : undefined,
      });
    }
  });

  return router;
}
