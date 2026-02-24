/**
 * POST /v1/extract — Firecrawl-compatible JSON Schema extraction endpoint.
 *
 * Body: { url: string, schema?: object, prompt?: string, llmApiKey?: string, model?: string }
 * Returns: { success: true, data: <extracted data> }
 */

import { Router, Request, Response } from 'express';
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
          error: 'invalid_request',
          message: 'Missing or invalid "url" field in request body.',
          example: '{ "url": "https://example.com", "schema": { "type": "object", "properties": { "title": { "type": "string" } } } }',
        });
        return;
      }

      if (url.length > 2048) {
        res.status(400).json({
          success: false,
          error: 'invalid_url',
          message: 'URL too long (max 2048 characters)',
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
            error: 'invalid_url',
            message: 'Only HTTP and HTTPS URLs are supported',
          });
          return;
        }
      } catch {
        res.status(400).json({
          success: false,
          error: 'invalid_url',
          message: `Invalid URL format: ${url}`,
        });
        return;
      }

      // Require at least schema or prompt
      if (!schema && !prompt) {
        res.status(400).json({
          success: false,
          error: 'invalid_request',
          message: 'Either "schema" or "prompt" is required for structured extraction.',
        });
        return;
      }

      // Resolve API key from request body or environment
      const resolvedApiKey = llmApiKey || process.env.OPENAI_API_KEY;
      if (!resolvedApiKey) {
        res.status(400).json({
          success: false,
          error: 'missing_api_key',
          message: 'LLM API key required. Provide "llmApiKey" in the request body or set OPENAI_API_KEY on the server.',
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
        res.status(401).json({ success: false, error: 'llm_auth_failed', message: msg });
        return;
      }
      if (msg.includes('rate limit') || msg.includes('429')) {
        res.status(429).json({ success: false, error: 'llm_rate_limited', message: msg });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'extraction_failed',
        message: msg,
      });
    }
  });

  router.get('/v1/extract/auto', async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: 'Missing url parameter' });
      return;
    }
    const { autoExtract } = await import('../../core/auto-extract.js');
    const result = await peel(url, { format: 'html' });
    const extracted = autoExtract(result.content || '', url);
    res.json({ url, pageType: extracted.type, structured: extracted });
  });

  return router;
}
