/**
 * GET /v1/answer/quick?url=<url>&question=<question>
 *
 * LLM-free question answering using BM25 relevance scoring.
 * No API key required — uses heuristic sentence ranking.
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { quickAnswer } from '../../core/quick-answer.js';

export function createQuickAnswerRouter(): Router {
  const router = Router();

  router.get('/v1/answer/quick', async (req: Request, res: Response) => {
    // AUTH: require authentication (global middleware sets req.auth)
    if (!req.auth?.keyInfo) {
      res.status(401).json({ error: 'authentication_required', message: 'API key required. Get one at https://app.webpeel.dev/keys' });
      return;    }
    try {
      const { url, question, render, maxPassages } = req.query as Record<string, string>;

      // --- Validation ---
      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "url" parameter',
        });
        return;
      }

      if (url.length > 2048) {
        res.status(400).json({
          error: 'invalid_request',
          message: '"url" too long (max 2048 characters)',
        });
        return;
      }

      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "question" parameter',
        });
        return;
      }

      if (question.length > 1000) {
        res.status(400).json({
          error: 'invalid_request',
          message: '"question" too long (max 1000 characters)',
        });
        return;
      }

      const useRender = render === 'true' || render === '1';
      const maxPassagesNum = maxPassages
        ? Math.min(Math.max(parseInt(maxPassages, 10) || 3, 1), 10)
        : 3;

      // Fetch the page
      const peelResult = await peel(url.trim(), {
        render: useRender,
        format: 'markdown',
        budget: 8000,
        timeout: 30000,
      });

      // Run quick answer
      const result = quickAnswer({
        question: question.trim(),
        content: peelResult.content,
        url: peelResult.url,
        maxPassages: maxPassagesNum,
      });

      res.json({
        url: peelResult.url,
        title: peelResult.title,
        question: result.question,
        answer: result.answer,
        confidence: result.confidence,
        passages: result.passages,
        source: result.source,
        method: result.method,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Quick answer error:', err);
      res.status(500).json({
        error: 'quick_answer_failed',
        message: err.message || 'Failed to generate answer. Please try again.',
      });
    }
  });

  return router;
}
