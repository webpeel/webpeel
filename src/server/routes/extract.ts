/**
 * POST /v1/extract — Firecrawl-compatible JSON Schema extraction endpoint.
 *
 * Body: { url: string, schema?: object, prompt?: string, llmApiKey?: string, model?: string }
 * Returns: { success: true, data: <extracted data> }
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { peel } from '../../index.js';
import { extractWithLLM } from '../../core/llm-extract.js';

export function createExtractRouter(): Router {
  const router = Router();

  router.post('/v1/extract', async (req: Request, res: Response) => {
    try {
      const {
        url,
        schema,
        prompt,
        llmApiKey,
        model,
        baseUrl,
      } = req.body as {
        url?: string;
        schema?: object;
        prompt?: string;
        llmApiKey?: string;
        model?: string;
        baseUrl?: string;
      };

      // Validate URL
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Missing or invalid "url" field in request body.',
            hint: 'Pass a URL in the request body: { "url": "https://example.com", "schema": { ... } }',
            docs: 'https://webpeel.dev/docs/errors#invalid-request',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      if (url.length > 2048) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_url',
            message: 'URL too long (max 2048 characters)',
            hint: 'Shorten the URL to under 2048 characters.',
            docs: 'https://webpeel.dev/docs/errors#invalid-url',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      // Validate URL format
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_url',
              message: 'Only HTTP and HTTPS URLs are supported',
              hint: 'Ensure the URL starts with http:// or https://',
              docs: 'https://webpeel.dev/docs/errors#invalid-url',
            },
            requestId: req.requestId || crypto.randomUUID(),
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
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      // Require at least schema or prompt
      if (!schema && !prompt) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Either "schema" or "prompt" is required for structured extraction.',
            hint: 'Include a JSON schema or a natural language prompt in the request body.',
            docs: 'https://webpeel.dev/docs/errors#invalid-request',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      // Resolve API key from request body or environment
      const resolvedApiKey = llmApiKey || process.env.OPENAI_API_KEY;
      if (!resolvedApiKey) {
        res.status(400).json({
          success: false,
          error: {
            type: 'missing_api_key',
            message: 'LLM API key required. Provide "llmApiKey" in the request body or set OPENAI_API_KEY on the server.',
            hint: 'Pass your OpenAI API key: { "llmApiKey": "sk-..." }',
            docs: 'https://webpeel.dev/docs/errors#missing-api-key',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      // Fetch the page content
      const peelResult = await peel(url, {
        format: 'markdown',
        timeout: 30000,
      });

      // Extract structured data with LLM
      const extractResult = await extractWithLLM({
        content: peelResult.content,
        instruction: prompt,
        schema,
        apiKey: resolvedApiKey,
        model: model || process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini',
        baseUrl: baseUrl || process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1',
      });

      // Return in Firecrawl-compatible format
      res.json({
        success: true,
        data: extractResult.items.length === 1 ? extractResult.items[0] : extractResult.items,
        metadata: {
          url: peelResult.url,
          title: peelResult.title,
          tokensUsed: extractResult.tokensUsed,
          model: extractResult.model,
          cost: extractResult.cost,
          elapsed: peelResult.elapsed,
        },
      });
    } catch (error) {
      console.error('[/v1/extract] Error:', error instanceof Error ? error.message : String(error));

      const msg = error instanceof Error ? error.message : 'Unknown error';

      if (msg.includes('authentication failed') || msg.includes('401')) {
        res.status(401).json({ success: false, error: { type: 'llm_auth_failed', message: msg }, requestId: req.requestId });
        return;
      }
      if (msg.includes('rate limit') || msg.includes('429')) {
        res.status(429).json({
          success: false,
          error: {
            type: 'llm_rate_limited',
            message: msg,
            hint: 'You have hit the LLM provider rate limit. Try again in a moment.',
            docs: 'https://webpeel.dev/docs/errors#llm-rate-limited',
          },
          requestId: req.requestId || crypto.randomUUID(),
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
        requestId: req.requestId || crypto.randomUUID(),
      });
    }
  });

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
        requestId: req.requestId || crypto.randomUUID(),
      });
      return;
    }
    const { autoExtract } = await import('../../core/auto-extract.js');
    const result = await peel(url, { format: 'html' });
    const extracted = autoExtract(result.content || '', url);
    res.json({ url, pageType: extracted.type, structured: extracted });
  });

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
        requestId: req.requestId || crypto.randomUUID(),
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
        requestId: req.requestId || crypto.randomUUID(),
      });
    }
  });

  return router;
}
