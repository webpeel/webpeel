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
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { quickAnswer } from '../../core/quick-answer.js';
import { getBestSearchProvider } from '../../core/search-provider.js';

export function createAskRouter(): Router {
  const router = Router();

  async function handleAsk(question: string, numSources: number, req: Request, res: Response): Promise<void> {
    const startMs = Date.now();

    if (!question?.trim()) {
      res.status(400).json({
        error: 'missing_question',
        message: 'Provide q= or question= parameter',
      });
      return;
    }

    // Auth check — global middleware sets req.auth
    const authId = (req as any).auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({
        error: 'authentication_required',
        message: 'API key required. Get one at https://app.webpeel.dev/keys',
      });
      return;
    }

    const clampedSources = Math.min(Math.max(numSources, 1), 5);

    // Step 1: search
    const { provider, apiKey } = getBestSearchProvider();
    let searchResults: Array<{ url: string; title: string; snippet: string }>;
    try {
      searchResults = await provider.searchWeb(question.trim(), {
        count: clampedSources,
        apiKey,
      });
    } catch {
      searchResults = [];
    }

    if (!searchResults.length) {
      res.json({
        question,
        answer: null,
        confidence: 0,
        sources: [],
        method: 'bm25',
        elapsed: Date.now() - startMs,
      });
      return;
    }

    // Step 2: fetch top sources in parallel (concurrency up to 5)
    const fetched = await Promise.allSettled(
      searchResults.slice(0, clampedSources).map((r) =>
        peel(r.url, { budget: 3000, format: 'markdown', timeout: 12000 })
          .then((result) => ({ result, searchResult: r })),
      ),
    );

    // Step 3: run quickAnswer on each, sort by confidence (desc)
    const answers = fetched
      .filter((f): f is PromiseFulfilledResult<any> => f.status === 'fulfilled')
      .map((f) => {
        const { result, searchResult } = f.value as {
          result: { content: string; url: string; title?: string };
          searchResult: { url: string; title: string; snippet: string };
        };
        const qa = quickAnswer({
          question,
          content: result.content,
          url: result.url,
          maxPassages: 2,
        });
        return {
          answer: qa.answer,
          confidence: qa.confidence,
          source: {
            url: result.url,
            title: result.title || searchResult.title,
            snippet: searchResult.snippet,
          },
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const best = answers[0];

    res.json({
      question,
      answer: best?.answer || null,
      confidence: best?.confidence || 0,
      sources: answers.map((a) => ({
        ...a.source,
        confidence: a.confidence,
      })),
      method: 'bm25',
      elapsed: Date.now() - startMs,
    });
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
