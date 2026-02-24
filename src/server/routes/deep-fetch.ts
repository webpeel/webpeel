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
    // AUTH: require authentication (global middleware sets req.auth)
    if (!req.auth?.keyInfo) {
      res.status(401).json({ error: 'authentication_required', message: 'API key required. Get one at https://app.webpeel.dev/keys' });
      return;    }
    try {
      const body = req.body as Partial<DeepFetchOptions> & { query?: string };

      const query = body.query;
      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'bad_request', message: 'Missing required field: query' });
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

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[deep-fetch] error:', message);
      res.status(500).json({ error: 'internal_error', message });
    }
  });

  return router;
}
