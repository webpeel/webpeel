/**
 * Agent API - autonomous web research endpoint
 *
 * Supports:
 * - POST /v1/agent           — synchronous (default) or SSE streaming (stream: true)
 * - POST /v1/agent/async     — async with job queue
 * - GET  /v1/agent/:id       — job status
 * - DELETE /v1/agent/:id     — cancel job
 *
 * Two modes:
 *   With llmApiKey    → full runAgent() with LLM synthesis (BYOK)
 *   Without llmApiKey → LLM-free: search + fetch + BM25 quickAnswer extraction
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { runAgent } from '../../core/agent.js';
import type { AgentOptions, AgentProgress, AgentStreamEvent, AgentDepth, AgentTopic } from '../../core/agent.js';
import { peel } from '../../index.js';
import { quickAnswer } from '../../core/quick-answer.js';
import { getBestSearchProvider } from '../../core/search-provider.js';
import { jobQueue } from '../job-queue.js';
import { sendWebhook } from './webhooks.js';

const VALID_DEPTHS: AgentDepth[] = ['basic', 'thorough'];
const VALID_TOPICS: AgentTopic[] = ['general', 'news', 'technical', 'academic'];

// ---------------------------------------------------------------------------
// LLM-free agent result type
// ---------------------------------------------------------------------------
interface AgentPageResult {
  url: string;
  title: string;
  extracted: Record<string, string> | null;
  content: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// runLLMFreeAgent — search + fetch + BM25 quickAnswer extraction (no LLM key)
// ---------------------------------------------------------------------------
async function runLLMFreeAgent(opts: {
  prompt?: string;
  urls?: string[];
  search?: string;
  schema?: Record<string, string>;
  budget: number;
  maxResults: number;
  onResult?: (result: AgentPageResult) => void;
}): Promise<AgentPageResult[]> {
  const { prompt, urls = [], search, schema, budget, maxResults, onResult } = opts;

  // 1. Collect all URLs to process
  const targetUrls: string[] = [...urls];

  // 2. If search query provided, use best available search provider
  if (search && typeof search === 'string') {
    try {
      const { provider, apiKey } = getBestSearchProvider();
      const searchResults = await provider.searchWeb(search, {
        count: Math.max(maxResults, 5),
        apiKey,
      });
      for (const r of searchResults) {
        if (!targetUrls.includes(r.url)) {
          targetUrls.push(r.url);
        }
      }
    } catch (_searchErr) {
      // Search failed — continue with provided URLs only
    }
  }

  // 3. Limit total URLs
  const urlsToFetch = targetUrls.slice(0, maxResults);
  if (urlsToFetch.length === 0) {
    return [];
  }

  // 4. Fetch each URL and extract with quickAnswer
  const results: AgentPageResult[] = [];

  await Promise.all(urlsToFetch.map(async (url) => {
    try {
      const page = await peel(url, { budget, format: 'markdown' });
      const content = page.content || '';
      const title = page.title || url;

      let extracted: Record<string, string> | null = null;
      let confidence = 0;

      if (schema && typeof schema === 'object' && Object.keys(schema).length > 0) {
        // Extract each schema field using quickAnswer (BM25)
        extracted = {};
        let totalScore = 0;
        let fieldCount = 0;

        for (const [field] of Object.entries(schema)) {
          const question = prompt
            ? `${prompt} — specifically: what is the ${field}?`
            : `What is the ${field}?`;

          const qa = quickAnswer({
            question,
            content,
            maxPassages: 1,
            url,
          });

          extracted[field] = qa.answer || '';
          totalScore += qa.confidence;
          fieldCount++;
        }

        // Auto-populate source URL if schema has a 'source' field
        if ('source' in schema) {
          extracted['source'] = url;
        }

        confidence = fieldCount > 0 ? totalScore / fieldCount : 0;
      } else if (prompt) {
        // No schema — answer the prompt directly against each page
        const qa = quickAnswer({
          question: prompt,
          content,
          maxPassages: 3,
          url,
        });
        confidence = qa.confidence;
      }

      const result: AgentPageResult = {
        url,
        title,
        extracted,
        content: content.slice(0, 500) + (content.length > 500 ? '…' : ''),
        confidence,
      };

      results.push(result);
      onResult?.(result);
    } catch (_fetchErr) {
      // Skip failed URLs silently
    }
  }));

  return results;
}

export function createAgentRouter(): Router {
  const router = Router();

  /**
   * POST /v1/agent - Run autonomous web research (synchronous or SSE streaming)
   *
   * Two modes:
   *  - llmApiKey provided  → full LLM research via runAgent()
   *  - no llmApiKey        → LLM-free fetch + BM25 extraction (requires urls or search)
   */
  router.post('/v1/agent', async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        urls,
        search,
        schema,
        outputSchema,
        llmApiKey,
        llmApiBase,
        llmModel,
        maxPages,
        maxResults,
        maxSources,
        maxCredits,
        depth,
        topic,
        budget,
        stream,
      } = req.body;

      // -----------------------------------------------------------------------
      // LLM-FREE MODE: no llmApiKey → use quickAnswer (BM25)
      // -----------------------------------------------------------------------
      if (!llmApiKey) {
        // Require at least urls or search
        if ((!urls || !Array.isArray(urls) || urls.length === 0) && !search) {
          res.status(400).json({
            error: 'invalid_request',
            message:
              'Provide at least "urls" (array) or "search" (query string). ' +
              'For LLM-powered research, also pass "llmApiKey".',
          });
          return;
        }

        const requestId = randomUUID();
        const startTime = Date.now();
        const effectiveBudget: number = typeof budget === 'number' ? budget : 4000;
        const effectiveMaxResults: number =
          typeof maxResults === 'number' ? Math.min(maxResults, 20) :
          typeof maxSources === 'number' ? Math.min(maxSources, 20) : 5;

        // -----------------------------------------------------------------------
        // SSE Streaming (LLM-free)
        // -----------------------------------------------------------------------
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();

          const sendSSE = (data: Record<string, unknown>) => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
          };

          let closed = false;
          req.on('close', () => { closed = true; });

          try {
            const allResults = await runLLMFreeAgent({
              prompt,
              urls,
              search,
              schema,
              budget: effectiveBudget,
              maxResults: effectiveMaxResults,
              onResult: (result) => {
                if (!closed) sendSSE({ type: 'result', data: result });
              },
            });

            if (!closed) {
              sendSSE({
                type: 'done',
                data: {
                  results: allResults,
                  totalSources: allResults.length,
                  processingTimeMs: Date.now() - startTime,
                },
                metadata: { requestId },
              });
            }
          } catch (err: any) {
            if (!closed) sendSSE({ type: 'error', message: err.message || 'Agent failed' });
          }

          if (!res.writableEnded) res.end();
          return;
        }

        // -----------------------------------------------------------------------
        // Synchronous (LLM-free)
        // -----------------------------------------------------------------------
        const results = await runLLMFreeAgent({
          prompt,
          urls,
          search,
          schema,
          budget: effectiveBudget,
          maxResults: effectiveMaxResults,
        });

        res.json({
          success: true,
          data: {
            results,
            totalSources: results.length,
            processingTimeMs: Date.now() - startTime,
          },
          metadata: { requestId },
        });
        return;
      }

      // -----------------------------------------------------------------------
      // LLM MODE: llmApiKey provided → existing runAgent path
      // -----------------------------------------------------------------------

      // Validate required parameters for LLM mode
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "prompt" parameter',
        });
        return;
      }

      // Validate optional parameters
      if (urls && !Array.isArray(urls)) {
        res.status(400).json({ error: 'invalid_request', message: '"urls" must be an array' });
        return;
      }

      if (depth && !VALID_DEPTHS.includes(depth)) {
        res.status(400).json({
          error: 'invalid_request',
          message: `"depth" must be one of: ${VALID_DEPTHS.join(', ')}`,
        });
        return;
      }

      if (topic && !VALID_TOPICS.includes(topic)) {
        res.status(400).json({
          error: 'invalid_request',
          message: `"topic" must be one of: ${VALID_TOPICS.join(', ')}`,
        });
        return;
      }

      if (maxSources !== undefined) {
        if (typeof maxSources !== 'number' || maxSources < 1 || maxSources > 20) {
          res.status(400).json({
            error: 'invalid_request',
            message: '"maxSources" must be a number between 1 and 20',
          });
          return;
        }
      }

      if (outputSchema !== undefined && (typeof outputSchema !== 'object' || outputSchema === null)) {
        res.status(400).json({
          error: 'invalid_request',
          message: '"outputSchema" must be a JSON Schema object',
        });
        return;
      }

      // Build agent options
      const agentOptions: AgentOptions = {
        prompt,
        urls,
        schema,
        outputSchema,
        llmApiKey,
        llmApiBase,
        llmModel,
        maxPages,
        maxSources,
        maxCredits,
        depth,
        topic,
      };

      // -----------------------------------------------------------------------
      // SSE Streaming mode (LLM)
      // -----------------------------------------------------------------------
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        res.flushHeaders();

        const sendSSE = (data: AgentStreamEvent | { type: 'error'; message: string }) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        };

        let closed = false;
        req.on('close', () => { closed = true; });

        agentOptions.onEvent = (event: AgentStreamEvent) => {
          if (closed) return;
          sendSSE(event);
        };

        try {
          await runAgent(agentOptions);

          // The 'done' event is already emitted by runAgent via onEvent
          // End the stream
          if (!res.writableEnded) {
            res.end();
          }
        } catch (error: any) {
          sendSSE({ type: 'error', message: error.message || 'Agent failed' });
          if (!res.writableEnded) {
            res.end();
          }
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Normal synchronous mode (backward compatible)
      // -----------------------------------------------------------------------
      const result = await runAgent(agentOptions);
      res.json(result);
    } catch (error: any) {
      console.error('Agent error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'An unexpected error occurred. Please try again.',
      });
    }
  });

  /**
   * POST /v1/agent/async - Run autonomous web research (async with job queue)
   */
  router.post('/v1/agent/async', async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        urls,
        schema,
        outputSchema,
        llmApiKey,
        llmApiBase,
        llmModel,
        maxPages,
        maxSources,
        maxCredits,
        depth,
        topic,
        webhook,
      } = req.body;

      // Validate required parameters
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "prompt" parameter',
        });
        return;
      }

      if (!llmApiKey || typeof llmApiKey !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "llmApiKey" parameter (BYOK required)',
        });
        return;
      }

      // Create job (use 'extract' type since agent extracts data, with owner for authorization)
      const ownerId = req.auth?.keyInfo?.accountId;
      const job = jobQueue.createJob('extract', webhook, ownerId);

      // Start agent in background
      setImmediate(async () => {
        try {
          // Update job to processing
          jobQueue.updateJob(job.id, { status: 'processing' });

          // Send started webhook
          if (webhook) {
            await sendWebhook(webhook, 'started', {
              jobId: job.id,
              prompt,
            });
          }

          // Build agent options with progress callback
          const agentOptions: AgentOptions = {
            prompt,
            urls,
            schema,
            outputSchema,
            llmApiKey,
            llmApiBase,
            llmModel,
            maxPages,
            maxSources,
            maxCredits,
            depth,
            topic,
            onProgress: (progress: AgentProgress) => {
              // Update job progress
              jobQueue.updateJob(job.id, {
                completed: progress.pagesVisited,
                creditsUsed: progress.pagesVisited,
              });

              // Send progress webhook
              if (webhook && progress.currentUrl) {
                sendWebhook(webhook, 'progress', {
                  jobId: job.id,
                  status: progress.status,
                  currentUrl: progress.currentUrl,
                  pagesVisited: progress.pagesVisited,
                  message: progress.message,
                }).catch(() => {}); // Fire and forget
              }
            },
          };

          // Run agent
          const result = await runAgent(agentOptions);

          // Update job with results
          if (result.success) {
            jobQueue.updateJob(job.id, {
              status: 'completed',
              data: [result],  // Wrap in array to match Job type
              completed: result.pagesVisited,
              creditsUsed: result.creditsUsed,
            });

            // Send completed webhook
            if (webhook) {
              await sendWebhook(webhook, 'completed', {
                jobId: job.id,
                pagesVisited: result.pagesVisited,
                creditsUsed: result.creditsUsed,
              });
            }
          } else {
            // Agent returned failure
            jobQueue.updateJob(job.id, {
              status: 'failed',
              error: result.data?.error || 'Agent failed',
              data: [result],  // Wrap in array to match Job type
              completed: result.pagesVisited,
              creditsUsed: result.creditsUsed,
            });

            // Send failed webhook
            if (webhook) {
              await sendWebhook(webhook, 'failed', {
                jobId: job.id,
                error: result.data?.error || 'Agent failed',
              });
            }
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
        url: `/v1/agent/${job.id}`,
      });
    } catch (error: any) {
      console.error('Agent job creation error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to create agent job',
      });
    }
  });

  /**
   * GET /v1/agent/:id - Get agent job status + results
   */
  router.get('/v1/agent/:id', (req: Request, res: Response) => {
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

      // SECURITY: Verify the requester owns this job
      const requestOwnerId = req.auth?.keyInfo?.accountId;
      if (job.ownerId && requestOwnerId && job.ownerId !== requestOwnerId) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found',
        });
        return;
      }

      // Return JSON response
      res.json({
        success: true,
        status: job.status,
        completed: job.completed,
        creditsUsed: job.creditsUsed,
        data: job.data,
        error: job.error,
        expiresAt: job.expiresAt,
      });
    } catch (error: any) {
      console.error('Get agent job error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to retrieve job',
      });
    }
  });

  /**
   * DELETE /v1/agent/:id - Cancel agent job
   */
  router.delete('/v1/agent/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      // SECURITY: Verify the requester owns this job before cancelling
      const job = jobQueue.getJob(id);
      const requestOwnerId = req.auth?.keyInfo?.accountId;
      if (job?.ownerId && requestOwnerId && job.ownerId !== requestOwnerId) {
        res.status(404).json({
          error: 'not_found',
          message: 'Job not found or cannot be cancelled',
        });
        return;
      }

      const cancelled = jobQueue.cancelJob(id);

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
      console.error('Cancel agent job error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to cancel job',
      });
    }
  });

  return router;
}
