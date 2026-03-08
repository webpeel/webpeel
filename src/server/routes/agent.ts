/**
 * POST /v1/agent           — single autonomous agent query
 * POST /v1/agent/batch     — parallel batch of agent queries (max 50)
 * GET  /v1/agent/batch/:id — poll batch job status
 *
 * Autonomous web agent — search → fetch → extract (LLM or BM25)
 *
 * User provides a natural language prompt. The agent:
 * 1. Searches the web for relevant URLs (or uses caller-provided URLs)
 * 2. Fetches the top pages in parallel (no browser escalation, 5s timeout)
 * 3a. If schema + llmApiKey provided: extracts structured data via LLM
 * 3b. Otherwise: uses BM25 sentence scoring for a free, LLM-free answer
 *
 * Returns: { success, data|answer, sources, method, elapsed, tokensUsed }
 *
 * Webhook support: pass `webhook` URL to get async delivery with HMAC-SHA256 signing.
 *
 * 5-minute in-memory cache. Max 10 sources per request.
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { extractWithLLM, type LLMProvider } from '../../core/llm-extract.js';
import { getBestSearchProvider } from '../../core/search-provider.js';
import { quickAnswer } from '../../core/quick-answer.js';
import { sendWebhook } from './webhooks.js';
import { createLogger } from '../../core/logger.js';
import crypto from 'crypto';

const log = createLogger('agent');

// ---------------------------------------------------------------------------
// Batch job store — in-memory with 1-hour TTL
// ---------------------------------------------------------------------------

interface BatchJob {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  results: Array<{ prompt: string; success: boolean; answer?: string; data?: unknown; sources?: unknown[]; error?: string; method?: string; elapsed?: number }>;
  webhook?: string;
  createdAt: number;
}

const batchJobs = new Map<string, BatchJob>();
const BATCH_TTL = 60 * 60 * 1000; // 1 hour

// GC stale batch jobs every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of batchJobs) {
    if (now - job.createdAt > BATCH_TTL) batchJobs.delete(id);
  }
}, 10 * 60 * 1000).unref();

// Simple concurrency limiter
class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.running < this.max) { this.running++; return; }
    return new Promise<void>((resolve) => this.queue.push(() => { this.running++; resolve(); }));
  }
  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// In-memory result cache — 5-minute TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: Record<string, unknown>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): Record<string, unknown> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: Record<string, unknown>): void {
  // GC: evict expired entries when over 100
  if (cache.size >= 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k);
    }
  }
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL });
}

// ---------------------------------------------------------------------------
// Core agent logic — shared by single and batch endpoints
// ---------------------------------------------------------------------------

interface AgentQueryParams {
  prompt: string;
  schema?: Record<string, unknown>;
  llmApiKey?: string;
  llmProvider?: string;
  llmModel?: string;
  urls?: string[];
  sources?: number;
}

async function runAgentQuery(params: AgentQueryParams): Promise<Record<string, unknown>> {
  const { prompt, schema, llmApiKey, llmProvider, llmModel, urls, sources: maxSources } = params;
  const startMs = Date.now();
  const numSources = Math.min(maxSources || 5, 10);

  // Cache check
  const cacheKey = `${prompt.trim()}:${JSON.stringify(schema || {})}`;
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  // Step 1: Resolve source URLs
  let sourceUrls: Array<{ url: string; title?: string; snippet?: string }> = [];

  if (Array.isArray(urls) && urls.length > 0) {
    sourceUrls = urls.map((u) => ({ url: u }));
  } else {
    log.info(`Searching web for: "${prompt}"`);
    const { provider, apiKey: searchApiKey } = getBestSearchProvider();
    try {
      const searchResults = await provider.searchWeb(prompt.trim(), { count: numSources, apiKey: searchApiKey });
      sourceUrls = searchResults.slice(0, numSources).map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
    } catch (err: any) {
      log.warn('Search failed:', err.message);
    }
  }

  if (sourceUrls.length === 0) {
    return { success: false, error: { type: 'no_sources', message: 'Could not find relevant pages for this query' }, prompt, elapsed: Date.now() - startMs };
  }

  // Step 2: Fetch pages in parallel
  log.info(`Fetching ${sourceUrls.length} sources in parallel`);
  const PER_SOURCE_TIMEOUT_MS = 5000;

  const fetchPromises = sourceUrls.map(async (source) => {
    try {
      const result = await Promise.race([
        peel(source.url, { render: false, noEscalate: true, format: 'markdown', timeout: PER_SOURCE_TIMEOUT_MS, budget: 3000 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('per-source timeout')), PER_SOURCE_TIMEOUT_MS)),
      ]);
      return { url: source.url, title: (result as any).title || source.title || '', content: ((result as any).content || '').slice(0, 15000), tokens: (result as any).tokens || 0 };
    } catch { return null; }
  });

  const fetchResults = (await Promise.allSettled(fetchPromises))
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean) as Array<{ url: string; title: string; content: string; tokens: number }>;

  if (fetchResults.length === 0) {
    return { success: false, error: { type: 'fetch_failed', message: 'Could not fetch any of the found pages' }, prompt, sources: sourceUrls.map((s) => ({ url: s.url })), elapsed: Date.now() - startMs };
  }

  // Step 3: Extract or answer
  const combinedContent = fetchResults.map((r) => `### ${r.title || r.url}\nURL: ${r.url}\n\n${r.content}`).join('\n\n---\n\n');
  const totalTokens = fetchResults.reduce((sum, r) => sum + r.tokens, 0);
  let result: Record<string, unknown>;

  if (schema && llmApiKey) {
    log.info('Using LLM extraction');
    const extracted = await extractWithLLM({
      content: combinedContent.slice(0, 30000), schema, llmApiKey, llmProvider: (llmProvider || 'openai') as LLMProvider, llmModel,
      prompt: `Based on these web pages, ${prompt}`, url: fetchResults[0].url,
    });
    const llmTokensUsed = (extracted.tokensUsed?.input ?? 0) + (extracted.tokensUsed?.output ?? 0);
    result = { success: true, data: extracted.items, sources: fetchResults.map((r) => ({ url: r.url, title: r.title })), method: 'agent-llm',
      llm: { provider: extracted.provider || llmProvider || 'openai', model: extracted.model || llmModel || 'default' }, tokensUsed: totalTokens + llmTokensUsed, elapsed: Date.now() - startMs };
  } else {
    log.info('Using BM25 text extraction');
    const qa = quickAnswer({ question: prompt, content: combinedContent, maxPassages: 3, maxChars: 2000 });
    result = { success: true, answer: qa.answer || combinedContent.slice(0, 2000), confidence: qa.confidence ?? 0,
      sources: fetchResults.map((r) => ({ url: r.url, title: r.title })), method: 'agent-bm25', tokensUsed: totalTokens, elapsed: Date.now() - startMs };
  }

  setCache(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createAgentRouter(): Router {
  const router = Router();

  // ── POST /v1/agent — single query (with optional webhook) ──────────────
  router.post('/', async (req: Request, res: Response) => {
    const { prompt, schema, llmApiKey, llmProvider, llmModel, urls, sources: maxSources, webhook } = req.body || {};
    const requestId = (req as any).requestId || crypto.randomUUID();

    if (!prompt?.trim()) {
      return res.status(400).json({
        success: false,
        error: { type: 'missing_prompt', message: 'Provide a prompt describing what you want to find',
          hint: 'POST /v1/agent { "prompt": "Find Stripe pricing plans" }', docs: 'https://webpeel.dev/docs/api-reference' },
        requestId,
      });
    }

    // Async mode: webhook provided → return immediately, deliver result later
    if (webhook) {
      const jobId = crypto.randomUUID();
      res.json({ success: true, id: jobId, status: 'processing', requestId });

      // Fire-and-forget agent query + webhook delivery
      runAgentQuery({ prompt, schema, llmApiKey, llmProvider, llmModel, urls, sources: maxSources })
        .then((result) => sendWebhook(webhook, 'agent.completed', { id: jobId, ...result, requestId }))
        .catch((err) => {
          log.error('Async agent error:', err.message);
          sendWebhook(webhook, 'agent.failed', { id: jobId, error: err.message, requestId }).catch(() => {});
        });
      return;
    }

    // Synchronous mode: wait for result
    try {
      const result = await runAgentQuery({ prompt, schema, llmApiKey, llmProvider, llmModel, urls, sources: maxSources });
      return res.json({ ...result, requestId });
    } catch (err: any) {
      log.error('Agent error:', err.message);
      return res.status(500).json({
        success: false, error: { type: 'agent_error', message: err.message || 'An unexpected error occurred' },
        prompt, elapsed: 0, requestId,
      });
    }
  });

  // ── POST /v1/agent/batch — parallel batch queries ─────────────────────
  router.post('/batch', async (req: Request, res: Response) => {
    const { prompts, schema, llmApiKey, llmProvider, llmModel, sources, webhook } = req.body || {};
    const requestId = (req as any).requestId || crypto.randomUUID();

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({
        success: false, error: { type: 'missing_prompts', message: 'Provide an array of prompts',
          hint: 'POST /v1/agent/batch { "prompts": ["Find X", "Find Y"] }' }, requestId,
      });
    }

    if (prompts.length > 50) {
      return res.status(400).json({
        success: false, error: { type: 'too_many_prompts', message: `Max 50 prompts per batch (got ${prompts.length})` }, requestId,
      });
    }

    const jobId = crypto.randomUUID();
    const job: BatchJob = { id: jobId, status: 'processing', total: prompts.length, completed: 0, results: [], webhook, createdAt: Date.now() };
    batchJobs.set(jobId, job);

    // Return immediately, then process in background
    res.json({ success: true, id: jobId, status: 'processing', total: prompts.length, requestId });

    // Process in background with concurrency limit of 5
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    const sem = new Semaphore(5);
    const tasks = prompts.map(async (prompt: string) => {
      await sem.acquire();
      try {
        const result = await runAgentQuery({ prompt, schema, llmApiKey, llmProvider, llmModel, sources });
        job.results.push({ prompt, success: !!result.success, answer: result.answer as string | undefined,
          data: result.data, sources: result.sources as unknown[] | undefined, method: result.method as string | undefined, elapsed: result.elapsed as number | undefined });
      } catch (err: any) {
        job.results.push({ prompt, success: false, error: err.message });
      } finally {
        job.completed++;
        sem.release();
      }
    });

    Promise.allSettled(tasks).then(() => {
      job.status = job.results.every((r) => r.success) ? 'completed' : 'completed';
      if (webhook) {
        sendWebhook(webhook, 'agent.batch.completed', { id: jobId, total: job.total, completed: job.completed, results: job.results })
          .catch((err: any) => log.error('Batch webhook failed:', err.message));
      }
    });
    return;
  });

  // ── GET /v1/agent/batch/:id — poll batch status ───────────────────────
  router.get('/batch/:id', async (req: Request, res: Response) => {
    const job = batchJobs.get(req.params.id as string);
    if (!job) {
      return res.status(404).json({ success: false, error: { type: 'not_found', message: 'Batch job not found or expired' } });
    }
    return res.json({ success: true, id: job.id, status: job.status, total: job.total, completed: job.completed, results: job.results });
  });

  return router;
}
