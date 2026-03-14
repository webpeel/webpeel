/**
 * POST /v1/extract — Structured JSON Schema extraction endpoint.
 *
 * Firecrawl-compatible: pass a URL + JSON schema, get structured data back.
 *
 * Auth: API key required (full or read scope)
 * Body: { url, schema, prompt?, llm?, render? }
 *
 * Also exposes:
 *   GET  /v1/extract/auto  — Auto-extract known structured types from a URL
 *   POST /v1/extract/auto  — Same but via POST body
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { peel } from '../../index.js';
import {
  extractStructured,
  type ExtractionSchema,
} from '../../core/structured-extract.js';
import {
  type LLMConfig,
  type DeepResearchLLMProvider,
  getDefaultLLMConfig,
  isFreeTierLimitError,
} from '../../core/llm-provider.js';

const VALID_PROVIDERS: DeepResearchLLMProvider[] = [
  'cloudflare',
  'openai',
  'anthropic',
  'google',
  'ollama',
  'cerebras',
];

function reqId(req: Request): string {
  return (req as any).requestId || crypto.randomUUID();
}

export function createExtractRouter(): Router {
  const router = Router();

  // ── POST /v1/extract ─────────────────────────────────────────────────────

  router.post('/v1/extract', async (req: Request, res: Response) => {
    try {
      const {
        url,
        schema: schemaRaw,
        prompt,
        llm: llmRaw,
        render,
        // Legacy fields for backward compat
        llmApiKey,
        llmProvider,
        model: legacyModel,
      } = req.body as {
        url?: unknown;
        schema?: unknown;
        prompt?: unknown;
        llm?: unknown;
        render?: unknown;
        llmApiKey?: unknown;
        llmProvider?: unknown;
        model?: unknown;
      };

      // ── Validate URL ────────────────────────────────────────────────────

      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Missing or invalid "url" field in request body.',
            hint: 'Pass a URL: { "url": "https://example.com", "schema": { ... } }',
            docs: 'https://webpeel.dev/docs/errors#invalid-request',
          },
          requestId: reqId(req),
        });
        return;
      }

      if (url.length > 2048) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_url',
            message: 'URL too long (max 2048 characters)',
            docs: 'https://webpeel.dev/docs/errors#invalid-url',
          },
          requestId: reqId(req),
        });
        return;
      }

      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_url',
              message: 'Only HTTP and HTTPS URLs are supported',
              docs: 'https://webpeel.dev/docs/errors#invalid-url',
            },
            requestId: reqId(req),
          });
          return;
        }
      } catch {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_url',
            message: `Invalid URL format: ${url}`,
            hint: 'Ensure the URL is well-formed: https://example.com',
            docs: 'https://webpeel.dev/docs/errors#invalid-url',
          },
          requestId: reqId(req),
        });
        return;
      }

      // ── Validate schema ─────────────────────────────────────────────────

      if (!schemaRaw && !prompt) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Either "schema" or "prompt" is required for structured extraction.',
            hint: 'Include a JSON schema in the request body: { "schema": { "type": "object", "properties": { ... } } }',
            docs: 'https://webpeel.dev/docs/errors#invalid-request',
          },
          requestId: reqId(req),
        });
        return;
      }

      // Build or validate schema
      let schema: ExtractionSchema;

      if (schemaRaw) {
        if (typeof schemaRaw !== 'object' || schemaRaw === null || Array.isArray(schemaRaw)) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_request',
              message: '"schema" must be a JSON object',
              hint: '{ "type": "object", "properties": { "field": { "type": "string" } } }',
              docs: 'https://webpeel.dev/docs/errors#invalid-request',
            },
            requestId: reqId(req),
          });
          return;
        }

        const schemaObj = schemaRaw as Record<string, unknown>;

        // Accept both full JSON Schema and shorthand { field: "type" }
        if (schemaObj.type === 'object' && schemaObj.properties) {
          schema = schemaObj as unknown as ExtractionSchema;
        } else {
          // Shorthand: { "company_mission": "string", "is_open_source": "boolean" }
          const props: Record<string, { type: string }> = {};
          for (const [k, v] of Object.entries(schemaObj)) {
            props[k] = { type: typeof v === 'string' ? v : 'string' };
          }
          schema = { type: 'object', properties: props };
        }
      } else {
        // No schema provided but prompt is — create a minimal schema
        schema = { type: 'object', properties: { result: { type: 'string', description: prompt as string } } };
      }

      // ── Resolve LLM config ──────────────────────────────────────────────

      let llmConfig: LLMConfig | undefined;

      if (llmRaw && typeof llmRaw === 'object' && !Array.isArray(llmRaw)) {
        // New format: { "provider": "openai", "apiKey": "sk-...", "model": "..." }
        const llmObj = llmRaw as Record<string, unknown>;
        const provider = typeof llmObj.provider === 'string' ? llmObj.provider : 'openai';

        if (!VALID_PROVIDERS.includes(provider as DeepResearchLLMProvider)) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_request',
              message: `Invalid "llm.provider". Must be one of: ${VALID_PROVIDERS.join(', ')}`,
              docs: 'https://webpeel.dev/docs/errors#invalid-request',
            },
            requestId: reqId(req),
          });
          return;
        }

        llmConfig = {
          provider: provider as DeepResearchLLMProvider,
          apiKey: typeof llmObj.apiKey === 'string' ? llmObj.apiKey : undefined,
          model: typeof llmObj.model === 'string' ? llmObj.model : undefined,
          endpoint: typeof llmObj.endpoint === 'string' ? llmObj.endpoint : undefined,
        };
      } else if (typeof llmApiKey === 'string' && llmApiKey) {
        // Legacy format: llmApiKey + llmProvider at top level
        const provider = (typeof llmProvider === 'string' && VALID_PROVIDERS.includes(llmProvider as DeepResearchLLMProvider))
          ? (llmProvider as DeepResearchLLMProvider)
          : 'openai';

        llmConfig = {
          provider,
          apiKey: llmApiKey,
          model: typeof legacyModel === 'string' ? legacyModel : undefined,
        };
      } else {
        // Try server-side default (env vars)
        const defaultCfg = getDefaultLLMConfig();
        // Only use server default if it has a real key (not bare cloudflare)
        if (defaultCfg.provider !== 'cloudflare' || (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)) {
          llmConfig = defaultCfg;
        }
        // If still no config, we'll use heuristic extraction
      }

      // ── Fetch page content ──────────────────────────────────────────────

      const useRender = render === true || render === 'true';

      const peelResult = await peel(url, {
        format: 'markdown',
        render: useRender,
        timeout: 30000,
        readable: true,
      });

      const content = peelResult.content || '';

      // ── Extract structured data ─────────────────────────────────────────

      const extractResult = await extractStructured(
        content,
        schema,
        llmConfig,
        typeof prompt === 'string' ? prompt : undefined,
      );

      const method: 'llm' | 'heuristic' = llmConfig ? 'llm' : 'heuristic';

      res.json({
        success: true,
        data: {
          url: peelResult.url || url,
          extracted: extractResult.data,
          confidence: extractResult.confidence,
          tokensUsed: extractResult.tokensUsed,
          method,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[/v1/extract] Error:', msg);

      if (isFreeTierLimitError(error)) {
        res.status(429).json({
          success: false,
          error: {
            type: 'free_tier_limit',
            message: (error as { message: string }).message,
            hint: 'Provide your own API key in the "llm" config object for unlimited use.',
            docs: 'https://webpeel.dev/docs/extract#free-tier',
          },
          requestId: reqId(req),
        });
        return;
      }

      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('authentication failed')) {
        res.status(401).json({
          success: false,
          error: { type: 'llm_auth_failed', message: msg },
          requestId: reqId(req),
        });
        return;
      }

      if (msg.includes('429') || msg.includes('rate limit')) {
        res.status(429).json({
          success: false,
          error: {
            type: 'llm_rate_limited',
            message: msg,
            hint: 'Try again in a moment or use a different LLM provider.',
            docs: 'https://webpeel.dev/docs/errors#llm-rate-limited',
          },
          requestId: reqId(req),
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: {
          type: 'extraction_failed',
          message: msg,
          docs: 'https://webpeel.dev/docs/errors#extraction-failed',
        },
        requestId: reqId(req),
      });
    }
  });

  // ── GET /v1/extract/auto ─────────────────────────────────────────────────

  router.get('/v1/extract/auto', async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({
        success: false,
        error: {
          type: 'missing_url',
          message: 'Missing url parameter',
          hint: 'Pass a URL: GET /v1/extract/auto?url=https://example.com',
          docs: 'https://webpeel.dev/docs/errors#missing-url',
        },
        requestId: reqId(req),
      });
      return;
    }
    const { autoExtract } = await import('../../core/auto-extract.js');
    const result = await peel(url, { format: 'html' });
    const extracted = autoExtract(result.content || '', url);
    res.json({ url, pageType: extracted.type, structured: extracted });
  });

  // ── POST /v1/extract/auto ────────────────────────────────────────────────

  router.post('/v1/extract/auto', async (req: Request, res: Response) => {
    const { url, ...rest } = req.body as { url?: string; [key: string]: unknown };
    if (!url || typeof url !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          type: 'missing_url',
          message: 'Missing or invalid url field in request body',
          hint: 'Pass a URL in the request body: { "url": "https://example.com" }',
          docs: 'https://webpeel.dev/docs/errors#missing-url',
        },
        requestId: reqId(req),
      });
      return;
    }
    try {
      const { autoExtract } = await import('../../core/auto-extract.js');
      const result = await peel(url, { format: 'html', ...rest });
      const extracted = autoExtract(result.content || '', url);
      res.json({ url, pageType: extracted.type, structured: extracted });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[/v1/extract/auto POST] Error:', msg);
      res.status(500).json({
        success: false,
        error: {
          type: 'extraction_failed',
          message: msg,
          docs: 'https://webpeel.dev/docs/errors#extraction-failed',
        },
        requestId: reqId(req),
      });
    }
  });

  return router;
}
