/**
 * Queue-backed /v1/fetch and /v1/render endpoints.
 *
 * Used when API_MODE=queue (microservices mode).
 * Instead of calling peel() directly, jobs are enqueued in Bull
 * and results are polled from Redis via GET /v1/jobs/:id.
 *
 * POST /v1/fetch  → enqueue in webpeel:fetch queue  → return { jobId, status }
 * POST /v1/render → enqueue in webpeel:render queue → return { jobId, status }
 * GET  /v1/jobs/:id → return job status + result from Redis
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';
import {
  getFetchQueue,
  getRenderQueue,
  RESULT_KEY_PREFIX,
  type FetchJobPayload,
  type JobResult,
} from '../bull-queues.js';
import type { Redis as RedisType } from "ioredis";
// @ts-ignore — ioredis CJS/ESM interop
import IoRedisModule from "ioredis";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IoRedis: any = (IoRedisModule as any).default ?? IoRedisModule;

// ─── Redis client for result reads ──────────────────────────────────────────

function buildRedisClient(): RedisType {
  const url = process.env.REDIS_URL || 'redis://redis:6379';
  const password = process.env.REDIS_PASSWORD || undefined;
  try {
    const parsed = new URL(url);
    return new IoRedis({
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password,
      db: parseInt(parsed.pathname?.slice(1) || '0', 10) || 0,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  } catch {
    return new IoRedis({ host: 'redis', port: 6379, password, lazyConnect: true, maxRetriesPerRequest: 3 });
  }
}

let _redis: RedisType | null = null;
function getRedis(): RedisType {
  if (!_redis) _redis = buildRedisClient();
  return _redis;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJobResult(jobId: string): Promise<JobResult | null> {
  const raw = await getRedis().get(`${RESULT_KEY_PREFIX}${jobId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobResult;
  } catch {
    return null;
  }
}

function validateUrl(url: unknown, res: Response, requestId: string): string | null {
  if (!url || typeof url !== 'string') {
    res.status(400).json({
      success: false,
      error: {
        type: 'invalid_request',
        message: 'Missing or invalid "url" parameter.',
        hint: 'Send JSON: { "url": "https://example.com" }',
        docs: 'https://webpeel.dev/docs/api-reference#fetch',
      },
      requestId,
    });
    return null;
  }

  if (url.length > 2048) {
    res.status(400).json({
      success: false,
      error: { type: 'invalid_url', message: 'URL too long (max 2048 characters)' },
      requestId,
    });
    return null;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({
      success: false,
      error: {
        type: 'invalid_url',
        message: 'Invalid URL format',
        hint: 'Ensure the URL includes a scheme (https://) and a valid hostname',
        docs: 'https://webpeel.dev/docs/api-reference#fetch',
      },
      requestId,
    });
    return null;
  }

  try {
    validateUrlForSSRF(url);
  } catch (e) {
    if (e instanceof SSRFError) {
      res.status(400).json({
        success: false,
        error: {
          type: 'forbidden_url',
          message: 'Cannot fetch localhost, private networks, or non-HTTP URLs',
        },
        requestId,
      });
      return null;
    }
    throw e;
  }

  return url;
}

// ─── Router factory ──────────────────────────────────────────────────────────

export function createQueueFetchRouter(): Router {
  const router = Router();

  /**
   * POST /v1/fetch  — enqueue HTTP fetch job
   * POST /v1/render — enqueue browser render job
   * These are the queue-mode replacements for the direct peel() calls.
   */
  async function handleEnqueue(req: Request, res: Response, renderMode: boolean): Promise<void> {
    const requestId = req.requestId || randomUUID();

    const url = validateUrl(req.body?.url, res, requestId);
    if (!url) return;

    const userId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          type: 'unauthorized',
          message: 'API key required. Get one free at https://app.webpeel.dev/keys',
          docs: 'https://webpeel.dev/docs/errors#unauthorized',
        },
        requestId,
      });
      return;
    }

    const jobId = randomUUID();

    const payload: FetchJobPayload = {
      jobId,
      url,
      render: renderMode,
      format: req.body.format || 'markdown',
      wait: req.body.wait,
      maxTokens: req.body.maxTokens,
      budget: req.body.budget,
      stealth: req.body.stealth,
      screenshot: req.body.screenshot,
      fullPage: req.body.fullPage,
      selector: req.body.selector,
      exclude: req.body.exclude,
      includeTags: req.body.includeTags,
      excludeTags: req.body.excludeTags,
      images: req.body.images,
      actions: req.body.actions,
      timeout: req.body.timeout,
      lite: req.body.lite,
      raw: req.body.raw,
      noDomainApi: req.body.noDomainApi,
      readable: req.body.readable,
      question: req.body.question,
      userId,
    };

    // Write initial queued status to Redis immediately so polling works right away
    await getRedis().set(
      `${RESULT_KEY_PREFIX}${jobId}`,
      JSON.stringify({ status: 'queued' } satisfies JobResult),
      'EX',
      86_400,
    );

    // Enqueue in the appropriate Bull queue
    const queue = renderMode ? getRenderQueue() : getFetchQueue();
    await queue.add(payload, {
      jobId, // use our own UUID as Bull job id for easy lookup
    });

    res.status(202).json({
      success: true,
      jobId,
      status: 'queued',
      pollUrl: `/v1/jobs/${jobId}`,
    });
  }

  /**
   * GET/POST /v1/fetch/sync — Synchronous fetch, no queue
   * Returns content inline (no jobId/polling). Much faster for simple pages.
   * Timeout: 25s max. No fallback to queue — fails fast if timeout exceeded.
   */
  async function handleSyncFetch(req: Request, res: Response): Promise<void> {
    const requestId = req.requestId || randomUUID();

    const url = validateUrl(req.body?.url || req.query?.url, res, requestId);
    if (!url) return;

    const userId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: { type: 'unauthorized', message: 'API key required.' },
        requestId,
      });
      return;
    }

    try {
      // Import peel dynamically to avoid circular deps
      const { peel } = await import('../../index.js');

      const options: any = {
        format: req.body?.format || req.query?.format || 'markdown',
        render: req.body?.render === true || req.query?.render === 'true',
        stealth: req.body?.stealth === true || req.query?.stealth === 'true',
        budget: req.body?.budget ? Number(req.body.budget) : (req.query?.budget ? Number(req.query.budget) : undefined),
        selector: req.body?.selector || req.query?.selector,
        readable: req.body?.readable === true || req.query?.readable === 'true',
        wait: req.body?.wait ? Number(req.body.wait) : (req.query?.wait ? Number(req.query.wait) : undefined),
        question: req.body?.question || req.query?.question,
        timeout: 25000, // 25s max (leave 5s buffer for response)
      };

      const result = await peel(url, options);

      res.json({
        success: true,
        ...result,
        requestId,
        mode: 'sync',
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
        success: false,
        error: {
          type: err.errorType || 'fetch_error',
          message: err.message || 'Fetch failed',
        },
        requestId,
      });
    }
  }

  router.get('/v1/fetch/sync', (req, res) => {
    // Map query params to body
    req.body = req.body || {};
    if (req.query.url) req.body.url = req.query.url;
    if (req.query.format) req.body.format = req.query.format;
    if (req.query.render) req.body.render = req.query.render === 'true';
    if (req.query.stealth) req.body.stealth = req.query.stealth === 'true';
    if (req.query.budget) req.body.budget = Number(req.query.budget);
    if (req.query.selector) req.body.selector = req.query.selector;
    if (req.query.readable) req.body.readable = req.query.readable === 'true';
    if (req.query.question) req.body.question = req.query.question;
    void handleSyncFetch(req, res);
  });
  router.post('/v1/fetch/sync', (req, res) => void handleSyncFetch(req, res));

  // GET /v1/fetch?url=...  — CLI and backward-compatible GET requests
  // Maps query params into req.body so handleEnqueue works uniformly
  router.get('/v1/fetch', (req, res) => {
    // Map query string to body for uniform handling
    req.body = {
      url: req.query.url,
      format: req.query.format || 'markdown',
      render: req.query.render === 'true',
      stealth: req.query.stealth === 'true',
      wait: req.query.wait ? Number(req.query.wait) : undefined,
      selector: req.query.selector,
      readable: req.query.readable === 'true',
      budget: req.query.budget ? Number(req.query.budget) : undefined,
      question: req.query.question,
      screenshot: req.query.screenshot === 'true',
      fullPage: req.query.fullPage === 'true' || req.query['full-page'] === 'true',
      maxTokens: req.query.maxTokens ? Number(req.query.maxTokens) : undefined,
      lite: req.query.lite === 'true',
      raw: req.query.raw === 'true',
      images: req.query.images === 'true',
    };
    void handleEnqueue(req, res, false);
  });
  router.get('/v1/render', (req, res) => {
    req.body = { url: req.query.url, format: req.query.format || 'markdown' };
    void handleEnqueue(req, res, true);
  });

  router.post('/v1/fetch', (req, res) => void handleEnqueue(req, res, false));
  router.post('/v1/render', (req, res) => void handleEnqueue(req, res, true));

  /**
   * GET /v1/jobs/:id — return job status + result (or error)
   * This endpoint is used regardless of whether queue mode is enabled.
   * When a job is complete, `result` contains the full peel() output.
   */
  router.get('/v1/jobs/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const requestId = req.requestId || randomUUID();

    // Auth required — prevent IDOR (unauthenticated access to job results)
    if (!req.auth?.keyInfo) {
      res.status(401).json({
        success: false,
        error: {
          type: 'unauthorized',
          message: 'API key required to poll job results.',
          docs: 'https://webpeel.dev/docs/errors#unauthorized',
        },
        requestId,
      });
      return;
    }

    if (!id || typeof id !== 'string') {
      res.status(400).json({
        success: false,
        error: { type: 'invalid_request', message: 'Missing job id' },
        requestId,
      });
      return;
    }

    try {
      const job = await getJobResult(id);

      if (!job) {
        res.status(404).json({
          success: false,
          error: {
            type: 'not_found',
            message: 'Job not found or expired',
            hint: 'Jobs expire after 24h. Check the jobId.',
          },
          requestId,
        });
        return;
      }

      const statusCode = job.status === 'failed' ? 200 : 200; // always 200 for polling
      res.status(statusCode).json({
        success: true,
        jobId: id,
        status: job.status,
        result: job.result,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { type: 'internal_error', message: 'Failed to retrieve job result' },
        requestId,
      });
    }
  });

  return router;
}
