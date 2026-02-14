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
      const { 
        url, 
        render, 
        wait, 
        format, 
        includeTags, 
        excludeTags, 
        images, 
        location, 
        languages,
        onlyMainContent,
        maxAge,
        storeInCache,
      } = req.query;

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

      // Build cache key (include new parameters)
      const cacheKey = `fetch:${url}:${render}:${wait}:${format}:${includeTags}:${excludeTags}:${images}:${location}:${languages}:${onlyMainContent}`;

      // Check cache (with maxAge support)
      const maxAgeMs = maxAge !== undefined ? parseInt(maxAge as string, 10) : 172800000; // Default 2 days
      const cached = cache.get(cacheKey);
      if (cached && maxAgeMs > 0) {
        const cacheAge = Date.now() - cached.timestamp;
        if (cacheAge < maxAgeMs) {
          res.setHeader('X-Cache', 'HIT');
          res.setHeader('X-Cache-Age', Math.floor(cacheAge / 1000).toString());
          res.json(cached.result);
          return;
        }
      }

      // Parse options
      const isSoftLimited = req.auth?.softLimited === true;
      const hasExtraUsage = req.auth?.extraUsageAvailable === true;
      
      // Parse tag arrays from comma-separated strings
      const includeTagsArray = includeTags 
        ? (includeTags as string).split(',').map(t => t.trim()).filter(Boolean)
        : undefined;
      const excludeTagsArray = excludeTags 
        ? (excludeTags as string).split(',').map(t => t.trim()).filter(Boolean)
        : undefined;
      const languagesArray = languages 
        ? (languages as string).split(',').map(l => l.trim()).filter(Boolean)
        : undefined;
      
      // onlyMainContent is a shortcut for common include tags
      const finalIncludeTags = onlyMainContent === 'true' 
        ? ['main', 'article', '.content', '#content']
        : includeTagsArray;

      const options: PeelOptions = {
        // SOFT LIMIT: When over quota AND no extra usage, force HTTP-only
        // If extra usage is available, allow full functionality
        render: (isSoftLimited && !hasExtraUsage) ? false : render === 'true',
        wait: (isSoftLimited && !hasExtraUsage) ? 0 : (wait ? parseInt(wait as string, 10) : undefined),
        format: (format as 'markdown' | 'text' | 'html') || 'markdown',
        includeTags: finalIncludeTags,
        excludeTags: excludeTagsArray,
        images: images === 'true',
        location: location || languagesArray ? {
          country: location as string | undefined,
          languages: languagesArray,
        } : undefined,
      };

      // Inform the user if their request was degraded
      if (isSoftLimited && !hasExtraUsage && render === 'true') {
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

      // Determine fetch type from the result method
      const fetchType: 'basic' | 'stealth' | 'captcha' | 'search' = 
        result.method === 'stealth' ? 'stealth' : 
        result.method === 'browser' ? 'stealth' : 'basic';

      // Log request to database (PostgreSQL only)
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        // Log to usage_logs table (user_id = accountId from keyInfo)
        pgStore.pool.query(
          `INSERT INTO usage_logs 
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'fetch',
            url,
            fetchType,
            elapsed,
            200,
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((err: any) => {
          console.error('Failed to log request to usage_logs:', err);
        });
      }

      // Track usage (check for trackBurstUsage method to detect PostgresAuthStore)
      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        
        // Track burst usage (always)
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);

        // If soft-limited with extra usage available, charge to extra usage
        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(
            req.auth.keyInfo.key,
            fetchType,
            url,
            elapsed,
            200 // PeelResult doesn't include statusCode, assume success
          );

          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          } else {
            // Extra usage failed - fall back to soft limit
            res.setHeader('X-Degraded', 'Extra usage insufficient, degraded to soft limit');
          }
        } else if (!isSoftLimited) {
          // Normal weekly usage tracking
          await pgStore.trackUsage(req.auth.keyInfo.key, fetchType);
        }
        // If soft-limited WITHOUT extra usage, don't track (already over quota)
      }

      // Cache result (unless storeInCache is explicitly false)
      if (storeInCache !== 'false') {
        cache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });
      }

      // Add usage headers
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', fetchType);

      res.json(result);
    } catch (error: any) {
      const err = error as any;
      
      // Log error to database (PostgreSQL only)
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        const url = req.query.url as string;
        const render = req.query.render === 'true';
        const fetchType = render ? 'stealth' : 'basic';
        
        pgStore.pool.query(
          `INSERT INTO usage_logs 
            (user_id, endpoint, url, method, status_code, error, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'fetch',
            url,
            fetchType,
            500,
            err.message || 'Unknown error',
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((logErr: any) => {
          console.error('Failed to log error to usage_logs:', logErr);
        });
      }
      
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
