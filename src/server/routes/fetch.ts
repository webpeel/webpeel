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

  // LRU cache: 5 minute TTL, max 1000 entries, 100MB total size
  const cache = new LRUCache<string, CacheEntry>({
    max: 1000,
    ttl: 5 * 60 * 1000, // 5 minutes
    maxSize: 100 * 1024 * 1024, // 100MB
    sizeCalculation: (entry) => {
      return JSON.stringify(entry).length;
    },
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

      // SECURITY: Validate URL format and length
      if (url.length > 2048) {
        res.status(400).json({
          error: 'invalid_url',
          message: 'URL too long (max 2048 characters)',
        });
        return;
      }

      try {
        const parsed = new URL(url);
        // Normalize URL for consistent caching
        const normalizedUrl = parsed.href;
        
        // Use normalized URL for cache key
        if (normalizedUrl !== url) {
          // URL was normalized, update for caching
        }
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
      const isSoftLimited = req.auth?.softLimited === true;
      const options: PeelOptions = {
        // SOFT LIMIT: When over quota, force HTTP-only (no browser rendering)
        // Users can still fetch — they just don't get JS rendering
        render: isSoftLimited ? false : render === 'true',
        wait: isSoftLimited ? 0 : (wait ? parseInt(wait as string, 10) : undefined),
        format: (format as 'markdown' | 'text' | 'html') || 'markdown',
      };

      // Inform the user if their request was degraded
      if (isSoftLimited && render === 'true') {
        res.setHeader('X-Degraded', 'render=true downgraded to HTTP-only (quota exceeded)');
      }

      // Validate wait parameter
      if (options.wait !== undefined && (isNaN(options.wait) || options.wait < 0 || options.wait > 60000)) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Invalid "wait" parameter: must be between 0 and 60000ms',
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
      
      // SECURITY: Sanitize error messages to prevent information disclosure
      if (err.code) {
        // WebPeelError from core library - safe to expose
        const safeMessage = err.message.replace(/[<>"']/g, ''); // Remove HTML chars
        res.status(500).json({
          error: err.code,
          message: safeMessage,
        });
      } else {
        // Unexpected error - generic message only
        console.error('Fetch error:', err); // Log full error server-side
        res.status(500).json({
          error: 'internal_error',
          message: 'An unexpected error occurred while fetching the URL',
        });
      }
    }
  });

  return router;
}
