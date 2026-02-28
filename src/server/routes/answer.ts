/**
 * /v1/answer — search + fetch + LLM-generated answer with citations (BYOK)
 */

import { Router, Request, Response } from 'express';
import {
  answerQuestion,
  type AnswerRequest,
  type LLMProviderId,
} from '../../core/answer.js';
import type { SearchProviderId } from '../../core/search-provider.js';

const VALID_LLM_PROVIDERS: LLMProviderId[] = ['openai', 'anthropic', 'google'];
const VALID_SEARCH_PROVIDERS: SearchProviderId[] = ['duckduckgo', 'brave'];

export function createAnswerRouter(): Router {
  const router = Router();

  router.post('/v1/answer', async (req: Request, res: Response) => {
    // AUTH: require authentication (global middleware sets req.auth)
    const ansAuthId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!ansAuthId) {
      res.status(401).json({ error: 'authentication_required', message: 'API key required. Get one at https://app.webpeel.dev/keys' });
      return;    }
    try {
      const {
        question,
        searchProvider,
        searchApiKey,
        llmProvider,
        llmApiKey,
        llmModel,
        maxSources,
        stream,
      } = req.body as {
        question?: string;
        searchProvider?: string;
        searchApiKey?: string;
        llmProvider?: string;
        llmApiKey?: string;
        llmModel?: string;
        maxSources?: number;
        stream?: boolean;
      };

      // --- Validation -----------------------------------------------------------
      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "question" parameter',
        });
        return;
      }

      if (question.length > 2000) {
        res.status(400).json({
          error: 'invalid_request',
          message: '"question" too long (max 2000 characters)',
        });
        return;
      }

      if (!llmProvider || !VALID_LLM_PROVIDERS.includes(llmProvider as LLMProviderId)) {
        res.status(400).json({
          error: 'invalid_request',
          message: `"llmProvider" is required and must be one of: ${VALID_LLM_PROVIDERS.join(', ')}`,
        });
        return;
      }

      if (!llmApiKey || typeof llmApiKey !== 'string' || llmApiKey.trim().length === 0) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid "llmApiKey" (BYOK required)',
        });
        return;
      }

      const resolvedSearchProvider: SearchProviderId =
        searchProvider && VALID_SEARCH_PROVIDERS.includes(searchProvider as SearchProviderId)
          ? (searchProvider as SearchProviderId)
          : 'duckduckgo';

      // Accept search API key from body or header
      const resolvedSearchApiKey =
        searchApiKey || (req.headers['x-search-api-key'] as string) || undefined;

      const resolvedMaxSources =
        typeof maxSources === 'number'
          ? Math.min(Math.max(maxSources, 1), 10)
          : 5;

      const shouldStream = stream === true;

      // --- Streaming response (SSE) -------------------------------------------
      if (shouldStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // nginx
        res.flushHeaders();

        const answerReq: AnswerRequest = {
          question: question.trim(),
          searchProvider: resolvedSearchProvider,
          searchApiKey: resolvedSearchApiKey,
          llmProvider: llmProvider as LLMProviderId,
          llmApiKey: llmApiKey.trim(),
          llmModel,
          maxSources: resolvedMaxSources,
          stream: true,
          onChunk: (text: string) => {
            const payload = JSON.stringify({ type: 'chunk', text });
            res.write(`data: ${payload}\n\n`);
          },
        };

        try {
          const result = await answerQuestion(answerReq);
          const donePayload = JSON.stringify({
            type: 'done',
            citations: result.citations,
            searchProvider: result.searchProvider,
            llmProvider: result.llmProvider,
            llmModel: result.llmModel,
            tokensUsed: result.tokensUsed,
          });
          res.write(`data: ${donePayload}\n\n`);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          const errPayload = JSON.stringify({ type: 'error', message: errMsg });
          res.write(`data: ${errPayload}\n\n`);
        }
        res.end();
        return;
      }

      // --- Non-streaming response ---------------------------------------------
      const answerReq: AnswerRequest = {
        question: question.trim(),
        searchProvider: resolvedSearchProvider,
        searchApiKey: resolvedSearchApiKey,
        llmProvider: llmProvider as LLMProviderId,
        llmApiKey: llmApiKey.trim(),
        llmModel,
        maxSources: resolvedMaxSources,
        stream: false,
      };

      const result = await answerQuestion(answerReq);

      res.json({
        answer: result.answer,
        citations: result.citations,
        searchProvider: result.searchProvider,
        llmProvider: result.llmProvider,
        llmModel: result.llmModel,
        tokensUsed: result.tokensUsed,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Answer error:', err);
      res.status(500).json({
        error: 'answer_failed',
        message: 'Failed to generate answer. Please try again.',
      });
    }
  });

  return router;
}
