/**
 * Fetch endpoint with caching
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import type { PeelOptions } from '../../types.js';
import { LRUCache } from 'lru-cache';
import { AuthStore } from '../auth-store.js';

interface CacheEntry {
  result: any;
  timestamp: number;
}

export function createFetchRouter(authStore: AuthStore): Router {
  const router = Router();

  // LRU cache: 5 minute TTL, max 1000 entries
  const cache = new LRUCache<string, CacheEntry>({
    max: 1000,
    ttl: 5 * 60 * 1000, // 5 minutes
  });

  router.get('/v1/fetch', async (req: Request, res: Response) => {
    try {
      const { url, render, wait, format } = req.query;

      // Validate URL parameter
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "url" parameter',
        });
        return;
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        res.status(400).json({
          error: 'invalid_url',
          message: 'Invalid URL format',
        });
        return;
      }

      // Build cache key
      const cacheKey = `fetch:${url}:${render}:${wait}:${format}`;

      // Check cache
      const cached = cache.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000).toString());
        res.json(cached.result);
        return;
      }

      // Parse options
      const options: PeelOptions = {
        render: render === 'true',
        wait: wait ? parseInt(wait as string, 10) : undefined,
        format: (format as 'markdown' | 'text' | 'html') || 'markdown',
      };

      // Validate wait parameter
      if (options.wait !== undefined && (isNaN(options.wait) || options.wait < 0)) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid "wait" parameter: must be a positive number',
        });
        return;
      }

      // Validate format parameter
      if (!['markdown', 'text', 'html'].includes(options.format || '')) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid "format" parameter: must be "markdown", "text", or "html"',
        });
        return;
      }

      // Fetch content
      const startTime = Date.now();
      const result = await peel(url, options);
      const elapsed = Date.now() - startTime;

      // Track usage (1 credit per fetch)
      if (req.auth?.keyInfo?.key) {
        await authStore.trackUsage(req.auth.keyInfo.key, 1);
      }

      // Cache result
      cache.set(cacheKey, {
        result,
        timestamp: Date.now(),
      });

      // Add usage headers
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());

      res.json(result);
    } catch (error: any) {
      const err = error as any;
      
      if (err.code) {
        // WebPeelError from core library
        res.status(500).json({
          error: err.code,
          message: err.message,
        });
      } else {
        // Unexpected error
        res.status(500).json({
          error: 'internal_error',
          message: err.message || 'An unexpected error occurred',
        });
      }
    }
  });

  return router;
}
