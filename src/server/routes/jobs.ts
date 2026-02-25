/**
 * Async jobs API - crawl endpoints with SSE support
 */

import { Router, Request, Response } from 'express';
import { crawl } from '../../index.js';
import type { CrawlOptions } from '../../index.js';
import { searchJobs } from '../../core/jobs.js';
import type { JobSearchOptions } from '../../core/jobs.js';
import type { AuthStore } from '../auth-store.js';
import type { IJobQueue } from '../job-queue.js';
import { sendWebhook } from './webhooks.js';
import { initSSE, sendSSE, endSSE, wantsSSE } from '../utils/sse.js';

export function createJobsRouter(jobQueue: IJobQueue, authStore: AuthStore): Router {
  const router = Router();

  /**
   * POST /v1/crawl - Start async crawl job (or stream via SSE)
   */
  router.post('/v1/crawl', async (req: Request, res: Response) => {
    try {
      const { url, limit, maxDepth, scrapeOptions, webhook, location, languages } = req.body;

      // Validate required parameters
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "url" parameter',
        });
        return;
      }

      // Validate URL
      try {
        new URL(url);
      } catch {
        res.status(400).json({
          error: 'invalid_url',
          message: 'Invalid URL format',
        });
        return;
      }

      const ownerId = req.auth?.keyInfo?.accountId;

      // ── SSE streaming path ────────────────────────────────────────────────
      if (wantsSSE(req)) {
        const job = await jobQueue.createJob('crawl', webhook, ownerId);

        // Set SSE headers (X-Request-Id is already set by global middleware)
        initSSE(res);

        // Send started event
        sendSSE(res, 'started', {
          jobId: job.id,
          url,
          depth: maxDepth || 3,
        });

        // Heartbeat every 15 seconds to keep connection alive
        let closed = false;
        const heartbeat = setInterval(() => {
          if (!closed) {
            res.write('event: ping\ndata: {}\n\n');
          }
        }, 15_000);

        req.on('close', () => {
          closed = true;
          clearInterval(heartbeat);
        });

        let completedCount = 0;
        let failedCount = 0;
        const startTime = Date.now();

        try {
          jobQueue.updateJob(job.id, { status: 'processing' });

          const resolvedLocation = location || languages ? {
            country: location,
            languages: Array.isArray(languages) ? languages : (languages ? [languages] : undefined),
          } : undefined;

          const crawlOptions: CrawlOptions = {
            maxPages: limit || 100,
            maxDepth: maxDepth || 3,
            onProgress: (progress) => {
              const total = progress.crawled + progress.queued;
              jobQueue.updateJob(job.id, {
                total,
                completed: progress.crawled,
                creditsUsed: progress.crawled,
              });
            },
            onPage: (pageResult) => {
              if (closed) return;
              const total = completedCount + failedCount + 1;
              if (pageResult.error) {
                failedCount++;
                sendSSE(res, 'error', {
                  url: pageResult.url,
                  error: 'FETCH_ERROR',
                  message: pageResult.error,
                });
              } else {
                completedCount++;
                sendSSE(res, 'page', {
                  url: pageResult.url,
                  content: pageResult.markdown,
                  metadata: {
                    title: pageResult.title,
                    depth: pageResult.depth,
                    parent: pageResult.parent,
                    elapsed: pageResult.elapsed,
                  },
                  progress: {
                    completed: completedCount,
                    total,
                  },
                });
              }
            },
            ...scrapeOptions,
            location: resolvedLocation,
          };

          const results = await crawl(url, crawlOptions);

          jobQueue.updateJob(job.id, {
            status: 'completed',
            data: results,
            total: results.length,
            completed: results.length,
            creditsUsed: results.length,
          });

          if (!closed) {
            sendSSE(res, 'done', {
              jobId: job.id,
              completed: completedCount,
              failed: failedCount,
              duration: Date.now() - startTime,
            });
          }
        } catch (error: any) {
          jobQueue.updateJob(job.id, {
            status: 'failed',
            error: error.message || 'Unknown error',
          });
          if (!closed) {
            sendSSE(res, 'error', {
              error: 'CRAWL_FAILED',
              message: error.message || 'Unknown error',
            });
          }
        } finally {
          clearInterval(heartbeat);
          if (!closed) {
            endSSE(res);
          }
        }

        return;
      }

      // ── Regular async job path (backward compat) ─────────────────────────
      const job = await jobQueue.createJob('crawl', webhook, ownerId);

      // Start crawl in background
      setImmediate(async () => {
        try {
          // Update job to processing
          jobQueue.updateJob(job.id, { status: 'processing' });

          // Send started webhook
          if (webhook) {
            await sendWebhook(webhook, 'started', {
              jobId: job.id,
              url,
            });
          }

          // Build crawl options
          const crawlOptions: CrawlOptions = {
            maxPages: limit || 100,
            maxDepth: maxDepth || 3,
            onProgress: (progress) => {
              // Update job progress
              const total = progress.crawled + progress.queued;
              jobQueue.updateJob(job.id, {
                total,
                completed: progress.crawled,
                creditsUsed: progress.crawled,
              });

              // Send page webhook
              if (webhook && progress.currentUrl) {
                sendWebhook(webhook, 'page', {
                  jobId: job.id,
                  url: progress.currentUrl,
                  completed: progress.crawled,
                  total,
                }).catch(() => {}); // Fire and forget
              }
            },
            // Spread existing scrapeOptions
            ...scrapeOptions,
            // Add location support if provided (CrawlOptions extends PeelOptions)
            location: location || languages ? {
              country: location,
              languages: Array.isArray(languages) ? languages : (languages ? [languages] : undefined),
            } : undefined,
          };

          // Run crawl
          const results = await crawl(url, crawlOptions);

          // Update job with results
          jobQueue.updateJob(job.id, {
            status: 'completed',
            data: results,
            total: results.length,
            completed: results.length,
            creditsUsed: results.length,
          });

          // Send completed webhook
          if (webhook) {
            await sendWebhook(webhook, 'completed', {
              jobId: job.id,
              total: results.length,
            });
          }
        } catch (error: any) {
          // Update job with error
          jobQueue.updateJob(job.id, {
            status: 'failed',
            error: error.message || 'Unknown error',
          });

          // Send failed webhook
          if (webhook) {
            await sendWebhook(webhook, 'failed', {
              jobId: job.id,
              error: error.message || 'Unknown error',
            });
          }
        }
      });

      // Return job ID immediately
      res.status(202).json({
        success: true,
        id: job.id,
        url: `/v1/crawl/${job.id}`,
      });
    } catch (error: any) {
      console.error('Crawl job creation error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to create crawl job',
      });
    }
  });

  /**
   * GET /v1/crawl/:id - Get crawl job status + results (with SSE support)
   */
  router.get('/v1/crawl/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const job = await jobQueue.getJob(id);

      if (!job) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found',
        });
        return;
      }

      // SECURITY: Verify the requester owns this job
      const requestOwnerId = req.auth?.keyInfo?.accountId;
      if (job.ownerId && requestOwnerId && job.ownerId !== requestOwnerId) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found',
        });
        return;
      }

      // Check for SSE request
      const acceptHeader = req.get('Accept');
      const isSSE = acceptHeader?.includes('text/event-stream');

      if (isSSE) {
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Send initial event
        const sendEvent = (data: any) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        sendEvent({
          event: 'status',
          ...job,
        });

        // Poll for updates every second
        const interval = setInterval(async () => {
          const updatedJob = await jobQueue.getJob(id);
          if (!updatedJob) {
            clearInterval(interval);
            res.end();
            return;
          }

          sendEvent({
            event: 'status',
            ...updatedJob,
          });

          // End stream if job is complete
          if (updatedJob.status === 'completed' || updatedJob.status === 'failed' || updatedJob.status === 'cancelled') {
            clearInterval(interval);
            res.end();
          }
        }, 1000);

        // Clean up on client disconnect
        req.on('close', () => {
          clearInterval(interval);
        });
      } else {
        // Return JSON response
        res.json({
          success: true,
          status: job.status,
          progress: job.progress,
          total: job.total,
          completed: job.completed,
          creditsUsed: job.creditsUsed,
          data: job.data,
          error: job.error,
          expiresAt: job.expiresAt,
        });
      }
    } catch (error: any) {
      console.error('Get crawl job error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to retrieve job',
      });
    }
  });

  /**
   * DELETE /v1/crawl/:id - Cancel crawl job
   */
  router.delete('/v1/crawl/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      // SECURITY: Verify the requester owns this job before cancelling
      const job = await jobQueue.getJob(id);
      const requestOwnerId = req.auth?.keyInfo?.accountId;
      if (job?.ownerId && requestOwnerId && job.ownerId !== requestOwnerId) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found or cannot be cancelled',
        });
        return;
      }

      const cancelled = await jobQueue.cancelJob(id);

      if (!cancelled) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found or cannot be cancelled',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Job cancelled',
      });
    } catch (error: any) {
      console.error('Cancel crawl job error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to cancel job',
      });
    }
  });

  /**
   * GET /v1/jobs - List all jobs
   */
  router.get('/v1/jobs', async (req: Request, res: Response) => {
    try {
      const { type, status, limit } = req.query;

      // SECURITY: Filter jobs by the authenticated user's ownership
      const ownerId = req.auth?.keyInfo?.accountId;

      const jobs = await jobQueue.listJobs({
        type: type as string | undefined,
        status: status as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        ownerId,
      });

      res.json({
        success: true,
        count: jobs.length,
        jobs,
      });
    } catch (error: any) {
      console.error('List jobs error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to list jobs',
      });
    }
  });

  /**
   * POST /v1/jobs — Search job boards (LinkedIn, Indeed, Glassdoor)
   *
   * Credits: 1 for the search + 1 per detail page fetched.
   */
  router.post('/v1/jobs', async (req: Request, res: Response) => {
    try {
      const {
        url,
        keywords,
        location,
        source,
        limit,
        fetchDetails,
        timeout,
      } = req.body as {
        url?: string;
        keywords?: string;
        location?: string;
        source?: 'glassdoor' | 'indeed' | 'linkedin';
        limit?: number;
        fetchDetails?: number;
        timeout?: number;
      };

      // Must provide either url or keywords
      if (!url && !keywords) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Provide either "url" or "keywords" in the request body.',
          docs: 'https://webpeel.dev/docs/api-reference#jobs',
        });
        return;
      }

      // Validate source
      const validSources = ['glassdoor', 'indeed', 'linkedin'];
      if (source && !validSources.includes(source)) {
        res.status(400).json({
          error: 'invalid_request',
          message: `Invalid "source": must be one of ${validSources.join(', ')}`,
        });
        return;
      }

      // Validate numeric params
      const resolvedLimit = typeof limit === 'number' ? Math.min(Math.max(limit, 1), 100) : 25;
      const resolvedDetails = typeof fetchDetails === 'number' ? Math.min(Math.max(fetchDetails, 0), resolvedLimit) : 0;
      const resolvedTimeout = typeof timeout === 'number' ? Math.min(Math.max(timeout, 5000), 120000) : 30000;

      const searchOpts: JobSearchOptions = {
        url: url || undefined,
        keywords: keywords || undefined,
        location: location || undefined,
        source: source || undefined,
        limit: resolvedLimit,
        fetchDetails: resolvedDetails,
        timeout: resolvedTimeout,
      };

      const startTime = Date.now();
      const result = await searchJobs(searchOpts);
      const elapsed = Date.now() - startTime;

      // Credits: 1 for the search + 1 per detail page fetched
      const creditsUsed = 1 + result.detailsFetched;

      // Track usage
      const isSoftLimited = req.auth?.softLimited === true;
      const hasExtraUsage = req.auth?.extraUsageAvailable === true;
      const pgStore = authStore as any;

      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'jobs',
            result.searchUrl || keywords || url || '',
            'basic',
            elapsed,
            200,
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((err: any) => {
          console.error('Failed to log jobs request to usage_logs:', err);
        });
      }

      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);

        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(
            req.auth.keyInfo.key,
            'search',
            result.searchUrl || keywords || url || '',
            elapsed,
            200
          );
          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          }
        } else if (!isSoftLimited) {
          await pgStore.trackUsage(req.auth.keyInfo.key, 'search');
        }
      }

      res.setHeader('X-Credits-Used', creditsUsed.toString());
      res.setHeader('X-Processing-Time', elapsed.toString());

      res.json({
        success: true,
        data: result,
        creditsUsed,
      });
    } catch (error: any) {
      console.error('POST /v1/jobs error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Job search failed. Please try again.',
        docs: 'https://webpeel.dev/docs/api-reference#jobs',
      });
    }
  });

  return router;
}
