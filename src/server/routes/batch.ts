/**
 * Batch scrape API - process multiple URLs concurrently
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import type { PeelOptions } from '../../index.js';
import { jobQueue } from '../job-queue.js';
import { sendWebhook } from './webhooks.js';

export function createBatchRouter(): Router {
  const router = Router();

  /**
   * POST /v1/batch/scrape - Submit batch of URLs
   */
  router.post('/v1/batch/scrape', async (req: Request, res: Response) => {
    try {
      const { urls, formats, extract, maxTokens, webhook } = req.body;

      // Validate required parameters
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "urls" parameter (must be non-empty array)',
        });
        return;
      }

      // Limit batch size
      if (urls.length > 100) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Batch size too large (max 100 URLs)',
        });
        return;
      }

      // Validate URLs
      for (const url of urls) {
        if (typeof url !== 'string') {
          res.status(400).json({
            error: 'invalid_request',
            message: 'All URLs must be strings',
          });
          return;
        }

        try {
          new URL(url);
        } catch {
          res.status(400).json({
            error: 'invalid_url',
            message: `Invalid URL format: ${url}`,
          });
          return;
        }
      }

      // Create job
      const job = jobQueue.createJob('batch', webhook);
      jobQueue.updateJob(job.id, {
        total: urls.length,
      });

      // Start batch processing in background
      setImmediate(async () => {
        try {
          // Update job to processing
          jobQueue.updateJob(job.id, { status: 'processing' });

          // Send started webhook
          if (webhook) {
            await sendWebhook(webhook, 'started', {
              jobId: job.id,
              total: urls.length,
            });
          }

          // Build peel options
          const peelOptions: PeelOptions = {
            format: formats?.[0] || 'markdown',
            extract,
            maxTokens,
          };

          // Process URLs with semaphore (max 5 concurrent)
          const results: any[] = [];
          const maxConcurrent = 5;
          let activeCount = 0;
          let urlIndex = 0;

          const processBatch = async () => {
            while (urlIndex < urls.length) {
              // Check if job was cancelled
              const currentJob = jobQueue.getJob(job.id);
              if (currentJob?.status === 'cancelled') {
                return;
              }

              // Wait for available slot
              while (activeCount >= maxConcurrent) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }

              const url = urls[urlIndex];
              const index = urlIndex;
              urlIndex++;
              activeCount++;

              // Process URL
              (async () => {
                try {
                  const result = await peel(url, peelOptions);
                  results[index] = result;

                  // Update progress
                  const completed = results.filter(r => r !== undefined).length;
                  jobQueue.updateJob(job.id, {
                    completed,
                    creditsUsed: completed,
                  });

                  // Send page webhook
                  if (webhook) {
                    sendWebhook(webhook, 'page', {
                      jobId: job.id,
                      url,
                      completed,
                      total: urls.length,
                    }).catch(() => {}); // Fire and forget
                  }
                } catch (error: any) {
                  // Store error as result
                  results[index] = {
                    url,
                    error: error.message || 'Unknown error',
                  };

                  // Update progress
                  const completed = results.filter(r => r !== undefined).length;
                  jobQueue.updateJob(job.id, {
                    completed,
                    creditsUsed: completed,
                  });
                } finally {
                  activeCount--;
                }
              })();
            }

            // Wait for all tasks to complete
            while (activeCount > 0) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          };

          await processBatch();

          // Update job with results
          jobQueue.updateJob(job.id, {
            status: 'completed',
            data: results,
          });

          // Send completed webhook
          if (webhook) {
            await sendWebhook(webhook, 'completed', {
              jobId: job.id,
              total: urls.length,
              completed: results.length,
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
        url: `/v1/batch/scrape/${job.id}`,
      });
    } catch (error: any) {
      console.error('Batch scrape creation error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to create batch scrape job',
      });
    }
  });

  /**
   * GET /v1/batch/scrape/:id - Get batch scrape status + results
   */
  router.get('/v1/batch/scrape/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const job = jobQueue.getJob(id);

      if (!job) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found',
        });
        return;
      }

      if (job.type !== 'batch') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Job is not a batch scrape job',
        });
        return;
      }

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
    } catch (error: any) {
      console.error('Get batch scrape error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to retrieve job',
      });
    }
  });

  /**
   * DELETE /v1/batch/scrape/:id - Cancel batch scrape job
   */
  router.delete('/v1/batch/scrape/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const job = jobQueue.getJob(id);

      if (!job) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found',
        });
        return;
      }

      if (job.type !== 'batch') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Job is not a batch scrape job',
        });
        return;
      }

      const cancelled = jobQueue.cancelJob(id);

      if (!cancelled) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Job cannot be cancelled (already completed or failed)',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Job cancelled',
      });
    } catch (error: any) {
      console.error('Cancel batch scrape error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to cancel job',
      });
    }
  });

  return router;
}
