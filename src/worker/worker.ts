/**
 * WebPeel Playwright Worker
 *
 * Polls Bull queues (webpeel:fetch, webpeel:render), executes peel() jobs,
 * and stores results back in Redis for the API to retrieve via GET /v1/jobs/:id.
 *
 * Env vars:
 *   REDIS_URL          — Redis connection URL (default: redis://redis:6379)
 *   REDIS_PASSWORD     — optional
 *   WORKER_CONCURRENCY — number of concurrent jobs per worker process (default: 3)
 */

// Force IPv4-first DNS (same as API server — avoids IPv6 failures in containers)
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import Bull from 'bull';
import type { Redis as RedisType } from 'ioredis';
// @ts-ignore — ioredis CJS/ESM interop
import IoRedisModule from 'ioredis';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IoRedis: any = (IoRedisModule as any).default ?? IoRedisModule;
import { peel } from '../index.js';
import type { PeelOptions } from '../types.js';
import {
  getFetchQueue,
  getRenderQueue,
  RESULT_KEY_PREFIX,
  RESULT_TTL_SECONDS,
  closeQueues,
  type FetchJobPayload,
  type JobResult,
} from '../server/bull-queues.js';

// ─── Redis client for result storage ────────────────────────────────────────

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
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    }) as RedisType;
  } catch {
    return new IoRedis({
      host: 'redis',
      port: 6379,
      password,
      maxRetriesPerRequest: 3,
    }) as RedisType;
  }
}

const redis = buildRedisClient();

redis.on('error', (err: Error) => {
  console.error('[worker] Redis error:', err.message);
});

// ─── Result storage ──────────────────────────────────────────────────────────

async function setResult(jobId: string, result: JobResult): Promise<void> {
  const key = `${RESULT_KEY_PREFIX}${jobId}`;
  await redis.set(key, JSON.stringify(result), 'EX', RESULT_TTL_SECONDS);
}

// ─── Job processor ───────────────────────────────────────────────────────────

async function processJob(job: Bull.Job<FetchJobPayload>): Promise<void> {
  const { jobId, url, render, ...rest } = job.data;

  console.log(`[worker] Processing job ${jobId} — ${url} (render=${render ?? false})`);

  // Mark as processing
  await setResult(jobId, {
    status: 'processing',
    startedAt: new Date().toISOString(),
  });

  await job.progress(0);

  try {
    const options: PeelOptions = {
      render: render ?? false,
      format: rest.format || 'markdown',
      wait: rest.wait,
      maxTokens: rest.maxTokens,
      budget: rest.budget ?? 4000,
      stealth: rest.stealth,
      screenshot: rest.screenshot,
      fullPage: rest.fullPage,
      selector: rest.selector,
      exclude: rest.exclude,
      includeTags: rest.includeTags,
      excludeTags: rest.excludeTags,
      images: rest.images,
      actions: rest.actions,
      timeout: rest.timeout,
      lite: rest.lite,
      raw: rest.raw,
      noDomainApi: rest.noDomainApi,
      readable: rest.readable,
      question: rest.question,
      noEscalate: !render, // prevent surprise escalation on HTTP-only jobs
    };

    const result = await peel(url, options);

    await job.progress(100);

    await setResult(jobId, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });

    console.log(`[worker] Completed job ${jobId} in ${result.timing?.fetch ?? 0}ms`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[worker] Failed job ${jobId}:`, message);

    await setResult(jobId, {
      status: 'failed',
      error: message,
      completedAt: new Date().toISOString(),
    });

    // Re-throw so Bull marks the job as failed and retries per defaultJobOptions
    throw err;
  }
}

// ─── Start workers ───────────────────────────────────────────────────────────

const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '3', 10);

const fetchQueue = getFetchQueue();
const renderQueue = getRenderQueue();

fetchQueue.process(concurrency, async (job: Bull.Job<FetchJobPayload>) => {
  await processJob(job);
});

renderQueue.process(concurrency, async (job: Bull.Job<FetchJobPayload>) => {
  await processJob(job);
});

// Log queue events
for (const [name, q] of [['fetch', fetchQueue], ['render', renderQueue]] as [string, Bull.Queue<FetchJobPayload>][]) {
  (q as Bull.Queue<FetchJobPayload>).on('completed', (job: Bull.Job<FetchJobPayload>) => {
    console.log(`[worker:${name}] job ${job.id} completed`);
  });
  (q as Bull.Queue<FetchJobPayload>).on('failed', (job: Bull.Job<FetchJobPayload>, err: Error) => {
    console.error(`[worker:${name}] job ${job.id} failed: ${err.message}`);
  });
  (q as Bull.Queue<FetchJobPayload>).on('stalled', (job: Bull.Job<FetchJobPayload>) => {
    console.warn(`[worker:${name}] job ${job.id} stalled`);
  });
}

console.log(`[worker] Started. Concurrency: ${concurrency}. Listening on webpeel:fetch + webpeel:render`);

// ─── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log('[worker] Shutting down gracefully...');
  try {
    await fetchQueue.pause(true);
    await renderQueue.pause(true);
    await closeQueues();
    await redis.quit();
  } catch {
    // Best effort
  }
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
