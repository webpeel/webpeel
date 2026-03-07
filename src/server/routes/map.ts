/**
 * First-class /v1/map endpoint
 *
 * Native WebPeel URL discovery API — returns our standard {success, links, count} format.
 * Distinct from the Firecrawl-compatible compat.ts /v1/map route.
 *
 * POST /v1/map — Discover all URLs on a domain
 */

import { Router, Request, Response } from 'express';
import '../types.js'; // Augments Express.Request with requestId
import { mapDomain } from '../../core/map.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';

export function createMapRouter(): Router {
  const router = Router();

  /**
   * POST /v1/map
   *
   * Discover all URLs on a domain by combining sitemap discovery and link crawling.
   *
   * Body:
   *   url             {string}   Required. Starting URL / domain root.
   *   search          {string}   Optional. Filter URLs by relevance to this query.
   *   maxUrls         {number}   Max URLs to return (default: 5000).
   *   includePatterns {string[]} Regex patterns — only include matching URLs.
   *   excludePatterns {string[]} Regex patterns — exclude matching URLs.
   *
   * Response:
   *   { success: true, links: [{url, title?, description?}], count: number }
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const {
        url,
        search,
        maxUrls = 5000,
        includePatterns,
        excludePatterns,
      } = req.body ?? {};

      // Validate URL
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Missing or invalid "url" parameter.',
            docs: 'https://webpeel.dev/docs/api-reference#map',
          },
          requestId: req.requestId,
        });
        return;
      }

      try {
        new URL(url);
      } catch {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Invalid URL format.',
            docs: 'https://webpeel.dev/docs/api-reference#map',
          },
          requestId: req.requestId,
        });
        return;
      }

      // SECURITY: Validate URL to prevent SSRF
      try {
        validateUrlForSSRF(url);
      } catch (error) {
        if (error instanceof SSRFError) {
          res.status(400).json({
            success: false,
            error: {
              type: 'blocked_url',
              message: 'Cannot map localhost, private networks, or non-HTTP URLs.',
              docs: 'https://webpeel.dev/docs/api-reference#map',
            },
            requestId: req.requestId,
          });
          return;
        }
        throw error;
      }

      const mapOptions: any = {
        maxUrls,
        search: typeof search === 'string' ? search : undefined,
      };

      if (Array.isArray(includePatterns) && includePatterns.length > 0) {
        mapOptions.includePatterns = includePatterns;
      }
      if (Array.isArray(excludePatterns) && excludePatterns.length > 0) {
        mapOptions.excludePatterns = excludePatterns;
      }

      const result = await mapDomain(url, mapOptions);

      // Return native format: { url, title?, description? }
      // mapDomain returns urls as string[], so wrap each in an object.
      const links = result.urls.map((u: string) => ({ url: u }));

      res.json({
        success: true,
        links,
        count: links.length,
        elapsed: result.elapsed,
        requestId: req.requestId,
      });
    } catch (error: any) {
      console.error('POST /v1/map error:', error);
      res.status(500).json({
        success: false,
        error: {
          type: 'internal_error',
          message: 'An unexpected error occurred.',
          docs: 'https://webpeel.dev/docs/api-reference#errors',
        },
        requestId: req.requestId,
      });
    }
  });

  return router;
}
