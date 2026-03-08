/**
 * First-class /v1/crawl endpoint
 *
 * Native WebPeel crawl API — returns our standard {success, data, requestId} format.
 * Distinct from the Firecrawl-compatible compat.ts routes which return Firecrawl's format.
 *
 * POST /v1/crawl  — Start an async crawl job
 * GET  /v1/crawl/:id — Poll crawl job status
 */

import { Router, Request, Response } from 'express';
import '../types.js'; // Augments Express.Request with requestId
import { crawl } from '../../core/crawler.js';
import type { IJobQueue } from '../job-queue.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';
import crypto from 'crypto';

export function createCrawlRouter(jobQueue: IJobQueue): Router {
  const router = Router();

  /**
   * POST /v1/crawl
   *
   * Start an async crawl job. Returns a job ID immediately; poll GET /v1/crawl/:id for status.
   * With stream:true, keeps the connection open and sends SSE events per page.
   *
   * Body:
   *   url            {string}   Required. Starting URL.
   *   maxPages       {number}   Max pages to crawl (default: 10).
   *   maxDepth       {number}   Max link depth (default: 2).
   *   includePatterns {string[]} Regex patterns — only crawl matching URLs.
   *   excludePatterns {string[]} Regex patterns — skip matching URLs.
   *   formats        {string[]} Content formats: 'markdown' | 'text' (default: ['markdown']).
   *   webhook        {object}   Optional webhook to POST results to when done.
   *   stream         {boolean}  If true, respond with SSE events (start → progress → done).
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const {
        url,
        maxPages = 10,
        maxDepth = 2,
        includePatterns = [],
        excludePatterns = [],
        webhook,
        stream,
      } = req.body ?? {};

      // Validate URL
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Missing or invalid "url" parameter.',
            docs: 'https://webpeel.dev/docs/api-reference#crawl',
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
            docs: 'https://webpeel.dev/docs/api-reference#crawl',
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
              message: 'Cannot crawl localhost, private networks, or non-HTTP URLs.',
              docs: 'https://webpeel.dev/docs/api-reference#crawl',
            },
            requestId: req.requestId,
          });
          return;
        }
        throw error;
      }

      const ownerId = req.auth?.keyInfo?.accountId;

      // ── Streaming mode (SSE) — keep connection open ──────────────────────
      if (stream === true) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const jobId = crypto.randomUUID();
        // Send start event (total unknown until crawl runs)
        res.write(`event: start\ndata: ${JSON.stringify({ id: jobId, url, maxPages, requestId: req.requestId })}\n\n`);

        let crawledCount = 0;
        const crawlOptions: any = {
          maxPages,
          maxDepth,
          tier: req.auth?.tier,
          onProgress: (progress: any) => {
            const total = progress.crawled + progress.queued;
            crawledCount = progress.crawled;
            res.write(`event: progress\ndata: ${JSON.stringify({
              id: jobId,
              completed: progress.crawled,
              total,
              queued: progress.queued,
              currentUrl: progress.currentUrl,
            })}\n\n`);
          },
        };

        if (Array.isArray(includePatterns) && includePatterns.length > 0) {
          crawlOptions.includePatterns = includePatterns;
        }
        if (Array.isArray(excludePatterns) && excludePatterns.length > 0) {
          crawlOptions.excludePatterns = excludePatterns;
        }

        try {
          const results = await crawl(url, crawlOptions);
          const data = results.map(r => ({
            url: r.url,
            title: r.title,
            content: r.markdown,
            links: r.links,
            elapsed: r.elapsed,
          }));

          res.write(`event: done\ndata: ${JSON.stringify({
            id: jobId,
            total: results.length,
            completed: results.length,
            results: data,
            requestId: req.requestId,
          })}\n\n`);

          // Fire webhook if configured
          if (webhook) {
            jobQueue.createJob('crawl', webhook, ownerId).then(job => {
              jobQueue.updateJob(job.id, {
                status: 'completed',
                data,
                total: results.length,
                completed: results.length,
                creditsUsed: results.length,
              });
            }).catch(() => {});
          }
        } catch (error: any) {
          res.write(`event: error\ndata: ${JSON.stringify({
            id: jobId,
            message: error.message || 'Crawl failed',
            requestId: req.requestId,
          })}\n\n`);
        }

        res.end();
        return;
      }

      const job = await jobQueue.createJob('crawl', webhook, ownerId);

      // Start crawl in background
      setImmediate(async () => {
        try {
          jobQueue.updateJob(job.id, { status: 'processing' });

          const crawlOptions: any = {
            maxPages,
            maxDepth,
            tier: req.auth?.tier,
            onProgress: (progress: any) => {
              const total = progress.crawled + progress.queued;
              jobQueue.updateJob(job.id, {
                total,
                completed: progress.crawled,
                creditsUsed: progress.crawled,
              });
            },
          };

          if (Array.isArray(includePatterns) && includePatterns.length > 0) {
            crawlOptions.includePatterns = includePatterns;
          }
          if (Array.isArray(excludePatterns) && excludePatterns.length > 0) {
            crawlOptions.excludePatterns = excludePatterns;
          }

          const results = await crawl(url, crawlOptions);

          // Native format: our standard CrawlResult shape
          const data = results.map(r => ({
            url: r.url,
            title: r.title,
            content: r.markdown,
            links: r.links,
            elapsed: r.elapsed,
          }));

          jobQueue.updateJob(job.id, {
            status: 'completed',
            data,
            total: results.length,
            completed: results.length,
            creditsUsed: results.length,
          });
        } catch (error: any) {
          jobQueue.updateJob(job.id, {
            status: 'failed',
            error: error.message || 'Unknown error',
          });
        }
      });

      res.status(202).json({
        success: true,
        data: {
          jobId: job.id,
          status: 'queued',
        },
        requestId: req.requestId,
      });
    } catch (error: any) {
      console.error('POST /v1/crawl error:', error);
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

  /**
   * GET /v1/crawl/:id
   *
   * Poll crawl job status. Returns job progress and results when complete.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const job = await jobQueue.getJob(id);

      if (!job) {
        res.status(404).json({
          success: false,
          error: {
            type: 'not_found',
            message: `Crawl job '${id}' not found or expired.`,
            docs: 'https://webpeel.dev/docs/api-reference#crawl',
          },
          requestId: req.requestId,
        });
        return;
      }

      // SECURITY: Only the job owner can read results
      const requestOwnerId = req.auth?.keyInfo?.accountId;
      if (job.ownerId && requestOwnerId && job.ownerId !== requestOwnerId) {
        res.status(404).json({
          success: false,
          error: {
            type: 'not_found',
            message: `Crawl job '${id}' not found or expired.`,
          },
          requestId: req.requestId,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          completed: job.completed || 0,
          total: job.total || 0,
          creditsUsed: job.creditsUsed || 0,
          expiresAt: job.expiresAt,
          results: job.status === 'completed' ? (job.data || []) : undefined,
          error: job.status === 'failed' ? (job as any).error : undefined,
        },
        requestId: req.requestId,
      });
    } catch (error: any) {
      console.error('GET /v1/crawl/:id error:', error);
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
