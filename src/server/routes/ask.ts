/**
 * GET /v1/ask?q=<question>&sources=3
 * POST /v1/ask { "question": "...", "sources": 3 }
 *
 * LLM-free web Q&A: search → fetch top pages → BM25 → best answer
 *
 * Returns:
 * {
 *   question: string,
 *   answer: string,           // best passage from top sources
 *   confidence: number,       // 0-1
 *   sources: [{url, title, snippet, confidence}],
 *   method: "bm25",
 *   elapsed: number           // ms
 * }
 *
 * No LLM key required — 100% deterministic BM25 ranking.
 * Competitors: Tavily charges $50/mo and requires an API key.
 * We do this with zero LLM cost, included in every plan.
 *
 * Performance targets:
 * - Source pages fetched in parallel with 5s timeout (no browser escalation)
 * - Early termination when high-confidence answer found (>=0.85)
 * - 10s hard timeout on the entire flow
 * - 5-minute in-memory cache for repeated questions
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { quickAnswer } from '../../core/quick-answer.js';
import { getBestSearchProvider } from '../../core/search-provider.js';
import {
  rankSearchResults,
  scoreFetchedSources,
  type ScoredSource,
} from '../../core/source-scoring.js';

// ---------------------------------------------------------------------------
// In-memory result cache — 5-minute TTL for repeated identical questions
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: Record<string, unknown>;
  expiresAt: number;
}

const resultCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(question: string, numSources: number): string {
  return `${question.trim().toLowerCase()}|${numSources}`;
}

function getFromCache(key: string): Record<string, unknown> | null {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resultCache.delete(key);
    return null;
  }
  return entry.result;
}

function setInCache(key: string, result: Record<string, unknown>): void {
  // Evict stale entries periodically (simple GC — keep max 500 entries)
  if (resultCache.size >= 500) {
    const now = Date.now();
    for (const [k, v] of resultCache) {
      if (v.expiresAt < now) resultCache.delete(k);
    }
  }
  resultCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createAskRouter(): Router {
  const router = Router();

  async function handleAsk(question: string, numSources: number, req: Request, res: Response): Promise<void> {
    const startMs = Date.now();
    const elapsed = () => Date.now() - startMs;

    if (!question?.trim()) {
      res.status(400).json({ success: false, error: { type: 'missing_question', message: 'Provide q= or question= parameter', hint: 'GET /v1/ask?q=your+question or POST {"question": "your question"}', docs: 'https://webpeel.dev/docs/errors#missing_question' }, requestId: req.requestId });
      return;
    }

    // Auth check — global middleware sets req.auth
    const authId = (req as any).auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({ success: false, error: { type: 'authentication_required', message: 'API key required. Get one at https://app.webpeel.dev/keys', hint: 'Get a free API key at https://app.webpeel.dev/keys', docs: 'https://webpeel.dev/docs/errors#authentication_required' }, requestId: req.requestId });
      return;
    }

    const clampedSources = Math.min(Math.max(numSources, 1), 5);

    // Cache check — return cached result immediately for repeated questions
    const cacheKey = getCacheKey(question, clampedSources);
    const cached = getFromCache(cacheKey);
    if (cached) {
      if (process.env.DEBUG) console.debug('[ask] cache hit in', elapsed(), 'ms');
      res.json({ ...cached, elapsed: elapsed() });
      return;
    }

    // -----------------------------------------------------------------------
    // Total flow timeout — 10s hard cap.
    // -----------------------------------------------------------------------
    const TOTAL_TIMEOUT_MS = 10000;
    let timedOut = false;
    const totalTimer = setTimeout(() => { timedOut = true; }, TOTAL_TIMEOUT_MS);

    try {
      // Step 1: Search — fetch more results so we can intelligently rank/dedup
      const searchStart = Date.now();
      const { provider, apiKey } = getBestSearchProvider();
      let rawSearchResults: Array<{ url: string; title: string; snippet: string }>;
      try {
        // Fetch up to 2x more results than needed so ranking has candidates to work with
        rawSearchResults = await provider.searchWeb(question.trim(), {
          count: Math.min(clampedSources * 2, 10),
          apiKey,
        });
      } catch {
        rawSearchResults = [];
      }
      if (process.env.DEBUG) console.debug(`[ask] search ${Date.now() - searchStart}ms, ${rawSearchResults.length} results`);

      if (!rawSearchResults.length) {
        clearTimeout(totalTimer);
        res.json({
          question,
          answer: null,
          confidence: 0,
          sources: [],
          method: 'bm25',
          elapsed: elapsed(),
        });
        return;
      }

      // -----------------------------------------------------------------------
      // Step 2: Rank search results by authority + primary source (pre-fetch)
      // This prioritizes official/high-authority sources and deduplicates domains
      // before we spend time fetching pages.
      // -----------------------------------------------------------------------
      const rankedResults = rankSearchResults(rawSearchResults, question.trim(), {
        maxPerDomain: 2,
      });

      // Take top N candidates after ranking
      const sourceUrls = rankedResults.slice(0, clampedSources);

      // -----------------------------------------------------------------------
      // Step 3: Fetch top sources in parallel
      // - noEscalate: true → skip browser escalation (simple HTTP only)
      // - render: false    → don't start headless browser
      // - timeout: 5000    → 5s per source max
      // - budget: 3000     → keep content manageable
      // -----------------------------------------------------------------------
      const PER_SOURCE_TIMEOUT_MS = 5000;
      const fetchStart = Date.now();

      const fetchPromises = sourceUrls.map((r) =>
        Promise.race([
          peel(r.url, {
            render: false,
            noEscalate: true,
            format: 'markdown',
            timeout: PER_SOURCE_TIMEOUT_MS,
            budget: 3000,
          }).then((result) => ({ result, searchResult: r })),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('per-source timeout')), PER_SOURCE_TIMEOUT_MS),
          ),
        ]),
      );

      const fetched = await Promise.allSettled(fetchPromises);
      if (process.env.DEBUG) {
        const ok = fetched.filter(f => f.status === 'fulfilled').length;
        console.debug(`[ask] fetch ${Date.now() - fetchStart}ms, ${ok}/${sourceUrls.length} ok`);
      }

      // -----------------------------------------------------------------------
      // Step 4: BM25 score each fetched page with quickAnswer
      // Early termination: if any source yields >=0.85 confidence, use it now
      // -----------------------------------------------------------------------
      const HIGH_CONFIDENCE_THRESHOLD = 0.85;

      const answers: Array<{
        answer: string;
        bm25Score: number;
        searchResult: { url: string; title: string; snippet: string };
        fetchedUrl: string;
        fetchedTitle: string;
        metadata?: Record<string, unknown>;
        freshnessData?: { lastModified?: string; fetchedAt?: string };
      }> = [];

      for (const f of fetched) {
        if (timedOut) break;
        if (f.status !== 'fulfilled') continue;

        const { result, searchResult } = f.value as {
          result: {
            content: string;
            url: string;
            title?: string;
            metadata?: Record<string, unknown>;
            freshness?: { lastModified?: string; fetchedAt?: string };
          };
          searchResult: { url: string; title: string; snippet: string };
        };

        const qa = quickAnswer({
          question,
          content: result.content,
          url: result.url,
          maxPassages: 2,
        });

        answers.push({
          answer: qa.answer,
          bm25Score: qa.confidence,
          searchResult,
          fetchedUrl: result.url,
          fetchedTitle: result.title || searchResult.title,
          metadata: result.metadata as Record<string, unknown> | undefined,
          freshnessData: result.freshness,
        });

        // Early termination on high confidence
        if (qa.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
          if (process.env.DEBUG) console.debug(`[ask] early exit confidence=${qa.confidence.toFixed(2)} at ${elapsed()}ms`);
          break;
        }
      }

      // -----------------------------------------------------------------------
      // Step 5: Final combined scoring — BM25 + authority + freshness + primary
      // -----------------------------------------------------------------------
      const scoredSources = scoreFetchedSources(
        answers.map(a => ({
          searchResult: {
            url: a.fetchedUrl,
            title: a.fetchedTitle,
            snippet: a.searchResult.snippet,
          },
          bm25Score: a.bm25Score,
          metadata: a.metadata as import('../../core/source-scoring.js').PageMetadataForScoring | undefined,
          freshnessData: a.freshnessData,
        })),
        question.trim(),
        { maxPerDomain: 2 },
      );

      // Sort by final score — best answer is the highest-scored source
      scoredSources.sort((a, b) => b.finalScore - a.finalScore);

      // Map back to answer text — use BM25 answer from the corresponding fetch
      const answerMap = new Map(answers.map(a => [a.fetchedUrl, a.answer]));
      const bestSource = scoredSources[0];
      const bestAnswer = bestSource ? answerMap.get(bestSource.url) : undefined;

      clearTimeout(totalTimer);

      // Build enriched sources array for the response
      const enrichedSources: ScoredSource[] = scoredSources.map(s => ({
        url: s.url,
        title: s.title,
        snippet: s.snippet,
        confidence: s.confidence,
        authority: s.authority,
        freshness: s.freshness,
        isPrimarySource: s.isPrimarySource,
      }));

      const response: Record<string, unknown> = {
        question,
        answer: bestAnswer || null,
        confidence: bestSource?.confidence || 0,
        sources: enrichedSources,
        method: 'bm25',
        elapsed: elapsed(),
      };

      if (timedOut) {
        response.warning = 'Partial result — 10s timeout reached';
      }

      // Cache successful results (only when we have an answer)
      if (bestAnswer && !timedOut) {
        setInCache(cacheKey, response);
      }

      if (process.env.DEBUG) console.debug(`[ask] done ${elapsed()}ms confidence=${bestSource?.confidence?.toFixed(2) ?? 0}`);
      res.json(response);
    } catch (err) {
      clearTimeout(totalTimer);
      if (process.env.DEBUG) console.debug('[ask] error:', err);
      res.json({
        question,
        answer: null,
        confidence: 0,
        sources: [],
        method: 'bm25',
        elapsed: elapsed(),
        ...(timedOut ? { warning: 'Request timed out after 10s' } : {}),
      });
    }
  }

  router.get('/v1/ask', async (req: Request, res: Response) => {
    const question = (req.query.q as string) || (req.query.question as string) || '';
    const sources = Math.min(parseInt((req.query.sources as string) || '3', 10) || 3, 5);
    await handleAsk(question, sources, req, res);
  });

  router.post('/v1/ask', async (req: Request, res: Response) => {
    const question = (req.body?.question as string) || (req.body?.q as string) || '';
    const sources = Math.min(parseInt(req.body?.sources ?? 3, 10) || 3, 5);
    await handleAsk(question, sources, req, res);
  });

  return router;
}
