/**
 * POST /v1/deep-research
 *
 * Multi-step search agent that turns one question into a comprehensive,
 * cited research report. Supports SSE streaming.
 *
 * Auth: API key required (full or read scope)
 * Body: DeepResearchRequest
 */

import { Router, Request, Response } from 'express';
import {
  runDeepResearch,
  type DeepResearchRequest,
  type DeepResearchProgressEvent,
} from '../../core/deep-research.js';
import {
  type LLMConfig,
  type DeepResearchLLMProvider,
  isFreeTierLimitError,
  getDefaultLLMConfig,
} from '../../core/llm-provider.js';

const VALID_PROVIDERS: DeepResearchLLMProvider[] = [
  'cloudflare',
  'openai',
  'anthropic',
  'google',
  'ollama',
  'cerebras',
];

function parseIntOrUndefined(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  return undefined;
}

export function createDeepResearchRouter(): Router {
  const router = Router();

  router.post('/v1/deep-research', async (req: Request, res: Response) => {
    // AUTH: require authentication
    const authId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
    if (!authId) {
      res.status(401).json({
        success: false,
        error: {
          type: 'authentication_required',
          message: 'API key required. Get one at https://app.webpeel.dev/keys',
          hint: 'Get a free API key at https://app.webpeel.dev/keys',
          docs: 'https://webpeel.dev/docs/errors#authentication_required',
        },
        requestId: req.requestId,
      });
      return;
    }

    const {
      question,
      llm: llmRaw,
      maxRounds,
      maxSources,
      stream,
    } = req.body as {
      question?: unknown;
      llm?: unknown;
      maxRounds?: unknown;
      maxSources?: unknown;
      stream?: unknown;
    };

    // ── Validation ──────────────────────────────────────────────────────────

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_request',
          message: 'Missing or invalid "question" parameter',
          hint: 'Include a non-empty "question" string in the request body',
          docs: 'https://webpeel.dev/docs/errors#invalid_request',
        },
        requestId: req.requestId,
      });
      return;
    }

    if (question.length > 5000) {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_request',
          message: '"question" too long (max 5000 characters)',
          hint: 'Keep the question under 5000 characters',
          docs: 'https://webpeel.dev/docs/errors#invalid_request',
        },
        requestId: req.requestId,
      });
      return;
    }

    // ── LLM config ──────────────────────────────────────────────────────────

    let llmConfig: LLMConfig | undefined;

    if (llmRaw && typeof llmRaw === 'object') {
      const llmObj = llmRaw as Record<string, unknown>;
      const provider = llmObj.provider as string | undefined;

      if (provider && !VALID_PROVIDERS.includes(provider as DeepResearchLLMProvider)) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: `Invalid "llm.provider". Must be one of: ${VALID_PROVIDERS.join(', ')}`,
            hint: `Supported providers: ${VALID_PROVIDERS.join(', ')}`,
            docs: 'https://webpeel.dev/docs/errors#invalid_request',
          },
          requestId: req.requestId,
        });
        return;
      }

      llmConfig = {
        provider: (provider || 'openai') as DeepResearchLLMProvider,
        apiKey: typeof llmObj.apiKey === 'string' ? llmObj.apiKey : undefined,
        model: typeof llmObj.model === 'string' ? llmObj.model : undefined,
        endpoint: typeof llmObj.endpoint === 'string' ? llmObj.endpoint : undefined,
      };
    }

    // BYOK-only: require user to provide LLM config with an API key (or use Ollama)
    if (!llmConfig) {
      // Check for server-side fallback keys
      const fallback = getDefaultLLMConfig();
      if (fallback.provider === 'cloudflare') {
        // No server-side keys configured and user didn't provide one
        res.status(400).json({
          success: false,
          error: {
            type: 'llm_required',
            message: 'Deep research requires an LLM provider. Pass your API key in the "llm" field.',
            hint: 'Example: { "llm": { "provider": "openai", "apiKey": "sk-..." } }. Supported: openai, anthropic, google, ollama.',
            docs: 'https://webpeel.dev/docs/deep-research',
          },
          requestId: req.requestId,
        });
        return;
      }
      llmConfig = fallback;
    }

    const resolvedMaxRounds = Math.min(Math.max(parseIntOrUndefined(maxRounds) ?? 3, 1), 5);
    const resolvedMaxSources = Math.min(Math.max(parseIntOrUndefined(maxSources) ?? 20, 5), 30);
    const shouldStream = stream === true;

    // ── Abort signal from request close ─────────────────────────────────────

    const ac = new AbortController();
    res.on('close', () => ac.abort());

    // ── Streaming ───────────────────────────────────────────────────────────

    if (shouldStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const sendEvent = (data: Record<string, unknown>) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      const deepReq: DeepResearchRequest = {
        question: question.trim(),
        llm: llmConfig,
        maxRounds: resolvedMaxRounds,
        maxSources: resolvedMaxSources,
        stream: true,
        onChunk: (text: string) => {
          sendEvent({ type: 'chunk', text });
        },
        onProgress: (event: DeepResearchProgressEvent) => {
          sendEvent({ eventType: 'progress', ...event });
        },
        signal: ac.signal,
      };

      try {
        const result = await runDeepResearch(deepReq);
        sendEvent({
          type: 'done',
          citations: result.citations,
          sourcesUsed: result.sourcesUsed,
          roundsCompleted: result.roundsCompleted,
          totalSearchQueries: result.totalSearchQueries,
          llmProvider: result.llmProvider,
          tokensUsed: result.tokensUsed,
          elapsed: result.elapsed,
        });
      } catch (err: unknown) {
        if (isFreeTierLimitError(err)) {
          sendEvent({
            type: 'error',
            error: err.error,
            message: err.message,
          });
        } else {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          sendEvent({ type: 'error', message: errMsg });
        }
      }

      res.end();
      return;
    }

    // ── Non-streaming ───────────────────────────────────────────────────────

    const deepReq: DeepResearchRequest = {
      question: question.trim(),
      llm: llmConfig,
      maxRounds: resolvedMaxRounds,
      maxSources: resolvedMaxSources,
      stream: false,
      signal: ac.signal,
    };

    try {
      const result = await runDeepResearch(deepReq);

      res.json({
        success: true,
        report: result.report,
        citations: result.citations,
        sourcesUsed: result.sourcesUsed,
        roundsCompleted: result.roundsCompleted,
        totalSearchQueries: result.totalSearchQueries,
        llmProvider: result.llmProvider,
        tokensUsed: result.tokensUsed,
        elapsed: result.elapsed,
      });
    } catch (err: unknown) {
      if (isFreeTierLimitError(err)) {
        res.status(429).json({
          success: false,
          error: {
            type: err.error,
            message: err.message,
            hint: 'Provide your own API key in the "llm" config object for unlimited use.',
            docs: 'https://webpeel.dev/docs/deep-research#free-tier',
          },
          requestId: req.requestId,
        });
        return;
      }

      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[deep-research] Error:', errMsg);

      res.status(500).json({
        success: false,
        error: {
          type: 'deep_research_failed',
          message: 'Deep research failed. Please try again.',
          hint: errMsg,
          docs: 'https://webpeel.dev/docs/errors#deep_research_failed',
        },
        requestId: req.requestId,
      });
    }
  });

  return router;
}
