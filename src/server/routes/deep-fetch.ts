/**
 * POST /v1/deep-fetch
 *
 * Deep web intelligence endpoint: search + fetch + synthesize + structure.
 * Body: { query, count?, format?, maxChars? }
 */

import { Router, Request, Response } from 'express';
import { deepFetch } from '../../core/deep-fetch.js';
import type { DeepFetchOptions } from '../../core/deep-fetch.js';

export function createDeepFetchRouter(): Router {
  const router = Router();

  router.post('/v1/deep-fetch', async (req: Request, res: Response) => {
    // Deprecation notice — prefer /v1/search?depth=deep
    res.setHeader('X-Deprecated', 'true');
    res.setHeader('X-Deprecated-Use', '/v1/search?depth=deep');

    // AUTH: require authentication (global middleware sets req.auth)
    const dfAuthId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!dfAuthId) {
      res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required. Get one at https://app.webpeel.dev/keys', hint: 'Get a free API key at https://app.webpeel.dev/keys', docs: 'https://webpeel.dev/docs/errors#authentication_required' }, requestId: req.requestId });
      return;
    }
    try {
      const body = req.body as Partial<DeepFetchOptions> & { query?: string };

      const query = body.query;
      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ success: false, error: { type: 'bad_request', message: 'Missing required field: query', hint: 'Include a "query" string in the request body', docs: 'https://webpeel.dev/docs/errors#bad_request' }, requestId: req.requestId });
        return;
      }

      const options: DeepFetchOptions = {
        query: query.trim(),
        count: typeof body.count === 'number' ? Math.min(Math.max(body.count, 1), 10) : 5,
        format: (['merged', 'structured', 'comparison'] as const).includes(body.format as any)
          ? (body.format as 'merged' | 'structured' | 'comparison')
          : 'merged',
        maxChars: typeof body.maxChars === 'number' ? body.maxChars : 32000,
      };

      const result = await deepFetch(options);

      res.json({
        ...result,
        content: result.merged || '',   // expose as `content` for consistency
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[deep-fetch] error:', message);
      res.status(500).json({
        success: false,
        error: {
          type: 'internal_error',
          message,
          docs: 'https://webpeel.dev/docs/errors#internal_error',
        },
        requestId: req.requestId,
      });
    }
  });

  return router;
}
