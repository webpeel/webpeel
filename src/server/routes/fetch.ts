/**
 * Fetch endpoint with caching
 */

import { Router, Request, Response } from 'express';
import '../types.js'; // Augments Express.Request with requestId
import { peel } from '../../index.js';
import type { PeelOptions, PageAction, InlineExtractParam, InlineLLMProvider } from '../../types.js';
import { normalizeActions } from '../../core/actions.js';
import { extractInlineJson } from '../../core/extract-inline.js';
import { LRUCache } from 'lru-cache';
import { AuthStore } from '../auth-store.js';
import { validateUrlForSSRF, SSRFError } from '../middleware/url-validator.js';
import { wantsEnvelope, successResponse } from '../utils/response.js';
import { getSchemaTemplate } from '../../core/schema-templates.js';

const VALID_LLM_PROVIDERS: InlineLLMProvider[] = ['openai', 'anthropic', 'google'];

interface CacheEntry {
  result: any;
  timestamp: number;
}

export function createFetchRouter(authStore: AuthStore): Router {
  const router = Router();

  // LRU cache: 5 minute TTL, max 500 entries, 100MB total size
  const cache = new LRUCache<string, CacheEntry>({
    max: 500,
    ttl: 5 * 60 * 1000, // 5 minutes default
    maxSize: 100 * 1024 * 1024, // 100MB
    sizeCalculation: (entry) => {
      return JSON.stringify(entry).length;
    },
  });

  router.get('/v1/fetch', async (req: Request, res: Response) => {
    try {
      const { 
        url, 
        render, 
        wait, 
        format, 
        includeTags, 
        excludeTags, 
        images, 
        location, 
        languages,
        onlyMainContent,
        actions,
        maxAge,
        storeInCache,
        stream,
        noCache,
        cacheTtl,
        budget,
        question,
        readable,
        stealth,
        screenshot,
        maxTokens,
        selector,
        exclude,
        fullPage,
        raw,
        lite,
        timeout,
        schema,
      } = req.query;

      // Validate URL parameter
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Missing or invalid "url" parameter.',
            hint: 'Pass a URL as a query parameter: GET /v1/fetch?url=https://example.com',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      // SECURITY: Validate URL format and length
      if (url.length > 2048) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_url',
            message: 'URL too long (max 2048 characters)',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      try {
        const parsed = new URL(url);
        // Normalize URL for consistent caching
        const normalizedUrl = parsed.href;
        
        // Use normalized URL for cache key
        if (normalizedUrl !== url) {
          // URL was normalized, update for caching
        }
      } catch {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_url',
            message: 'Invalid URL format',
            hint: 'Ensure the URL includes a scheme (https://) and a valid hostname',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      // SECURITY: Validate URL to prevent SSRF attacks
      try {
        validateUrlForSSRF(url);
      } catch (error) {
        if (error instanceof SSRFError) {
          res.status(400).json({
            success: false,
            error: {
              type: 'forbidden_url',
              message: 'Cannot fetch localhost, private networks, or non-HTTP URLs',
              docs: 'https://webpeel.dev/docs/api-reference#fetch',
            },
            requestId: req.requestId,
          });
          return;
        }
        throw error;
      }

      // Parse actions query param (JSON-encoded array)
      let parsedActions: PageAction[] | undefined;
      if (actions && typeof actions === 'string') {
        try {
          const raw = JSON.parse(actions);
          parsedActions = normalizeActions(raw);
        } catch (e) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_request',
              message: 'Invalid "actions" parameter: must be a valid JSON array',
              docs: 'https://webpeel.dev/docs/api-reference#fetch',
            },
            requestId: req.requestId,
          });
          return;
        }
      }

      // Build cache key (include new parameters)
      const actionsKey = parsedActions ? JSON.stringify(parsedActions) : '';
      const cacheKey = `fetch:${url}:${render}:${wait}:${format}:${includeTags}:${excludeTags}:${images}:${location}:${languages}:${onlyMainContent}:${stream}:${actionsKey}:${budget}:${question}:${readable}:${stealth}:${screenshot}:${maxTokens}:${selector}:${exclude}:${fullPage}:${raw}`;

      // Cache bypass: ?noCache=true or Cache-Control: no-cache header
      const bypassCache = noCache === 'true' || req.headers['cache-control'] === 'no-cache';

      // Per-request TTL (cacheTtl in seconds, default 300s = 5 min)
      const cacheTtlMs = cacheTtl !== undefined
        ? parseInt(cacheTtl as string, 10) * 1000
        : 5 * 60 * 1000;

      // Check cache (with maxAge support)
      const maxAgeMs = maxAge !== undefined ? parseInt(maxAge as string, 10) : 172800000; // Default 2 days
      if (!bypassCache) {
        const cached = cache.get(cacheKey);
        if (cached && maxAgeMs > 0) {
          const cacheAge = Date.now() - cached.timestamp;
          if (cacheAge < maxAgeMs && cacheAge < cacheTtlMs) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('X-Cache-Age', Math.floor(cacheAge / 1000).toString());
            if (wantsEnvelope(req)) {
              successResponse(res, cached.result, {
                requestId: req.requestId,
                cached: true,
              });
            } else {
              res.json(cached.result);
            }
            return;
          }
        }
      }

      // Parse options
      const isSoftLimited = req.auth?.softLimited === true;
      const hasExtraUsage = req.auth?.extraUsageAvailable === true;
      
      // Parse tag arrays from comma-separated strings
      const includeTagsArray = includeTags 
        ? (includeTags as string).split(',').map(t => t.trim()).filter(Boolean)
        : undefined;
      const excludeTagsArray = excludeTags 
        ? (excludeTags as string).split(',').map(t => t.trim()).filter(Boolean)
        : undefined;
      const languagesArray = languages 
        ? (languages as string).split(',').map(l => l.trim()).filter(Boolean)
        : undefined;
      
      // onlyMainContent is a shortcut for common include tags
      const finalIncludeTags = onlyMainContent === 'true' 
        ? ['main', 'article', '.content', '#content']
        : includeTagsArray;

      // When actions are present, force browser mode (skip HTTP fast path)
      const hasActions = parsedActions && parsedActions.length > 0;
      const shouldRender = hasActions || render === 'true';

      const options: PeelOptions = {
        // SOFT LIMIT: When over quota AND no extra usage, force HTTP-only
        // If extra usage is available, allow full functionality
        // Exception: actions always require render
        render: (isSoftLimited && !hasExtraUsage && !hasActions) ? false : shouldRender,
        wait: (isSoftLimited && !hasExtraUsage) ? 0 : (wait ? parseInt(wait as string, 10) : undefined),
        format: (format as 'markdown' | 'text' | 'html' | 'clean') || 'markdown',
        stream: stream === 'true',
        includeTags: finalIncludeTags,
        excludeTags: excludeTagsArray,
        images: images === 'true',
        actions: parsedActions,
        location: location || languagesArray ? {
          country: location as string | undefined,
          languages: languagesArray,
        } : undefined,
        budget: budget ? parseInt(budget as string, 10) : undefined,
        question: question as string | undefined,
        readable: readable === 'true',
        stealth: (isSoftLimited && !hasExtraUsage) ? false : stealth === 'true',
        screenshot: (isSoftLimited && !hasExtraUsage) ? false : screenshot === 'true',
        maxTokens: maxTokens ? parseInt(maxTokens as string, 10) : undefined,
        selector: selector as string | undefined,
        exclude: exclude ? (exclude as string).split(',').map(s => s.trim()).filter(Boolean) : undefined,
        fullPage: fullPage === 'true',
        raw: raw === 'true',
        lite: lite === 'true',
        timeout: timeout ? parseInt(timeout as string, 10) : undefined,
      };

      // Auto-budget: default to 4000 tokens for API requests when no budget specified
      // Opt-out: budget=0 explicitly disables. Lite mode disables auto-budget.
      if (options.budget === undefined && !options.lite) {
        options.budget = 4000;
        res.setHeader('X-Auto-Budget', '4000');
      }

      // Inform the user if their request was degraded
      if (isSoftLimited && !hasExtraUsage && render === 'true' && !hasActions) {
        res.setHeader('X-Degraded', 'render=true downgraded to HTTP-only (quota exceeded)');
      }
      if (isSoftLimited && !hasExtraUsage && stealth === 'true') {
        res.setHeader('X-Degraded', 'stealth=true downgraded (quota exceeded)');
      }
      if (isSoftLimited && !hasExtraUsage && screenshot === 'true') {
        res.setHeader('X-Degraded', 'screenshot=true downgraded (quota exceeded)');
      }

      // Validate wait parameter
      if (options.wait !== undefined && (isNaN(options.wait) || options.wait < 0 || options.wait > 60000)) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Invalid "wait" parameter: must be between 0 and 60000ms',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      // Validate format parameter
      if (!['markdown', 'text', 'html', 'clean'].includes(options.format || '')) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Invalid "format" parameter: must be "markdown", "text", "html", or "clean"',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      const shouldStream = options.stream === true;
      if (shouldStream) {
        res.setHeader('X-Stream', 'true');
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }
      }

      // Fetch content
      const startTime = Date.now();
      const result = await peel(url, options);
      const elapsed = Date.now() - startTime;

      // --- BM25 Schema Template Extraction (GET, no LLM needed) ---
      if (schema && typeof schema === 'string' && result.content) {
        const template = getSchemaTemplate(schema);
        if (template) {
          const { quickAnswer } = await import('../../core/quick-answer.js');
          const { smartExtractSchemaFields } = await import('../../core/schema-postprocess.js');
          const extracted = smartExtractSchemaFields(
            result.content,
            template.fields,
            quickAnswer,
            {
              pageTitle: result.title,
              pageUrl: result.url,
              metadata: result.metadata as Record<string, any>,
            },
          );
          (result as any).extracted = extracted;
        }
      }

      // Determine fetch type from the result method
      const fetchType: 'basic' | 'stealth' | 'captcha' | 'search' = 
        result.method === 'stealth' ? 'stealth' : 
        result.method === 'browser' ? 'stealth' : 'basic';

      // Log request to database (PostgreSQL only)
      const pgStore = authStore as any;
      // Log usage for BOTH API key auth AND JWT session auth
      const logUserId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
      if (logUserId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs 
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            logUserId,
            'fetch',
            url,
            fetchType,
            elapsed,
            200,
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((err: any) => {
          console.error('Failed to log request to usage_logs:', err);
        });
      }

      // Track usage (check for trackBurstUsage method to detect PostgresAuthStore)
      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        
        // Track burst usage (always)
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);

        // If soft-limited with extra usage available, charge to extra usage
        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(
            req.auth.keyInfo.key,
            fetchType,
            url,
            elapsed,
            200 // PeelResult doesn't include statusCode, assume success
          );

          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          } else {
            // Extra usage failed - fall back to soft limit
            res.setHeader('X-Degraded', 'Extra usage insufficient, degraded to soft limit');
          }
        } else if (!isSoftLimited) {
          // Normal weekly usage tracking
          await pgStore.trackUsage(req.auth.keyInfo.key, fetchType);
        }
        // If soft-limited WITHOUT extra usage, don't track (already over quota)
      }

      // Cache result (unless storeInCache is explicitly false or cache bypass requested)
      if (storeInCache !== 'false' && !bypassCache) {
        cache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        }, { ttl: cacheTtlMs });
      }

      // Add usage headers (kept for backward compat; also surfaced in envelope metadata)
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', fetchType);

      if (wantsEnvelope(req)) {
        successResponse(res, result, {
          requestId: req.requestId,
          processingTimeMs: elapsed,
          creditsUsed: 1,
          cached: false,
          fetchType,
        });
      } else {
        res.json(result);
      }
    } catch (error: any) {
      const err = error as any;
      
      // Log error to database (PostgreSQL only)
      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        const url = req.query.url as string;
        const render = req.query.render === 'true';
        const fetchType = render ? 'stealth' : 'basic';
        
        pgStore.pool.query(
          `INSERT INTO usage_logs 
            (user_id, endpoint, url, method, status_code, error, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'fetch',
            url,
            fetchType,
            500,
            err.message || 'Unknown error',
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((logErr: any) => {
          console.error('Failed to log error to usage_logs:', logErr);
        });
      }
      
      // SECURITY: Sanitize error messages to prevent information disclosure
      if (err.code) {
        // WebPeelError from core library - safe to expose with helpful context
        const safeMessage = err.message.replace(/[<>"']/g, ''); // Remove HTML chars
        const statusCode = err.code === 'TIMEOUT' ? 504 
          : err.code === 'BLOCKED' ? 403 
          : err.code === 'NETWORK' ? 502 
          : 500;
        
        const hints: Record<string, string> = {
          TIMEOUT: 'Try increasing timeout with ?wait=10000, or use render=true for JS-heavy sites.',
          BLOCKED: 'This site blocks automated requests. Try adding render=true or use stealth mode (costs 5 credits).',
          NETWORK: 'Could not reach the target URL. Verify the URL is correct and the site is online.',
        };

        res.status(statusCode).json({
          success: false,
          error: {
            type: err.code,
            message: safeMessage,
            hint: hints[err.code] || undefined,
            docs: 'https://webpeel.dev/docs/api-reference#errors',
          },
          requestId: req.requestId,
        });
      } else {
        // Unexpected error - generic message only
        console.error('Fetch error:', err); // Log full error server-side
        res.status(500).json({
          success: false,
          error: {
            type: 'internal_error',
            message: 'An unexpected error occurred while fetching the URL. If this persists, check https://webpeel.dev/status',
            docs: 'https://webpeel.dev/docs/api-reference#errors',
          },
          requestId: req.requestId,
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // POST /v1/fetch — same as GET but accepts JSON body with extract param
  // POST /v2/scrape — alias with identical behaviour
  // -----------------------------------------------------------------------

  async function handlePostFetch(req: Request, res: Response): Promise<void> {
    try {
      const {
        url,
        render,
        wait,
        format,
        includeTags,
        excludeTags,
        images,
        location,
        languages,
        onlyMainContent,
        actions: rawActions,
        storeInCache: storeFlag,
        // Cache control
        noCache: noCacheBody,
        cacheTtl: cacheTtlBody,
        // Inline extraction (BYOK)
        extract,
        llmProvider,
        llmApiKey,
        llmModel,
        // Firecrawl-compatible formats array
        formats,
        stream,
        // Extended peel options
        budget,
        question,
        readable,
        stealth,
        screenshot,
        maxTokens,
        selector,
        exclude,
        fullPage,
        raw,
        lite,
        timeout,
        proxies,
        chunk,
        device,
        viewportWidth,
        viewportHeight,
        waitUntil,
        waitSelector,
        blockResources,
        cloaked,
        schema: bodySchema,
      } = req.body as {
        url?: string;
        render?: boolean;
        wait?: number;
        format?: string;
        includeTags?: string[];
        excludeTags?: string[];
        images?: boolean;
        location?: string;
        languages?: string[];
        onlyMainContent?: boolean;
        actions?: any[];
        storeInCache?: boolean;
        noCache?: boolean;
        cacheTtl?: number;
        extract?: InlineExtractParam;
        llmProvider?: string;
        llmApiKey?: string;
        llmModel?: string;
        formats?: any[];
        stream?: boolean;
        budget?: number;
        question?: string;
        readable?: boolean;
        stealth?: boolean;
        screenshot?: boolean;
        maxTokens?: number;
        selector?: string;
        exclude?: string | string[];
        fullPage?: boolean;
        raw?: boolean;
        lite?: boolean;
        timeout?: number;
        proxies?: string[];
        chunk?: boolean | { maxTokens?: number; overlap?: number; strategy?: 'section' | 'paragraph' | 'fixed' };
        device?: 'desktop' | 'mobile' | 'tablet';
        viewportWidth?: number;
        viewportHeight?: number;
        waitUntil?: 'domcontentloaded' | 'networkidle' | 'load' | 'commit';
        waitSelector?: string;
        blockResources?: string[];
        cloaked?: boolean;
        schema?: string;
      };

      // --- Validate URL -------------------------------------------------------
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Missing or invalid "url" in request body.',
            hint: 'Send JSON: { "url": "https://example.com" }',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      if (url.length > 2048) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_url',
            message: 'URL too long (max 2048 characters)',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      try {
        new URL(url);
      } catch {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_url',
            message: 'Invalid URL format',
            hint: 'Ensure the URL includes a scheme (https://) and a valid hostname',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      try {
        validateUrlForSSRF(url);
      } catch (error) {
        if (error instanceof SSRFError) {
          res.status(400).json({
            success: false,
            error: {
              type: 'forbidden_url',
              message: 'Cannot fetch localhost, private networks, or non-HTTP URLs',
              docs: 'https://webpeel.dev/docs/api-reference#fetch',
            },
            requestId: req.requestId,
          });
          return;
        }
        throw error;
      }

      // --- Parse and normalize actions -----------------------------------------
      let postActions: PageAction[] | undefined;
      if (rawActions !== undefined) {
        try {
          postActions = normalizeActions(rawActions);
        } catch (e) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_request',
              message: `Invalid "actions" parameter: ${(e as Error).message}`,
              docs: 'https://webpeel.dev/docs/api-reference#fetch',
            },
            requestId: req.requestId,
          });
          return;
        }
      }

      // --- Cache bypass and lookup -------------------------------------------
      const postBypassCache = noCacheBody === true || req.headers['cache-control'] === 'no-cache';
      const postCacheTtlMs = typeof cacheTtlBody === 'number' ? cacheTtlBody * 1000 : 5 * 60 * 1000;
      const postActionsKey = postActions ? JSON.stringify(postActions) : '';
      const postCacheKey = `fetch:${url}:${render}:${wait}:${format}:${JSON.stringify(includeTags)}:${JSON.stringify(excludeTags)}:${images}:${location}:${JSON.stringify(languages)}:${onlyMainContent}:${stream}:${postActionsKey}:${budget}:${question}:${readable}:${stealth}:${screenshot}:${maxTokens}:${selector}:${JSON.stringify(exclude)}:${fullPage}:${raw}`;

      if (!postBypassCache && !extract) {
        const cached = cache.get(postCacheKey);
        if (cached) {
          const cacheAge = Date.now() - cached.timestamp;
          if (cacheAge < postCacheTtlMs) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('X-Cache-Age', Math.floor(cacheAge / 1000).toString());
            if (wantsEnvelope(req)) {
              successResponse(res, cached.result, {
                requestId: req.requestId,
                cached: true,
              });
            } else {
              res.json(cached.result);
            }
            return;
          }
        }
      }

      // --- Resolve inline extract from body or Firecrawl-compatible formats ---
      let resolvedExtract: InlineExtractParam | undefined = extract;

      if (!resolvedExtract && Array.isArray(formats)) {
        const jsonFormat = formats.find(
          (f: any) => (typeof f === 'object' && f !== null && f.type === 'json') ||
                      (typeof f === 'string' && f === 'json'),
        );
        if (jsonFormat && typeof jsonFormat === 'object' && (jsonFormat.schema || jsonFormat.prompt)) {
          resolvedExtract = {
            schema: jsonFormat.schema,
            prompt: jsonFormat.prompt,
          };
        }
      }

      // Resolve schema template names (e.g. "product", "article") to field objects
      if (resolvedExtract && typeof resolvedExtract.schema === 'string') {
        const tmpl = getSchemaTemplate(resolvedExtract.schema);
        if (tmpl) {
          resolvedExtract = { ...resolvedExtract, schema: tmpl.fields };
        } else {
          // Try parsing as JSON string
          try {
            resolvedExtract = { ...resolvedExtract, schema: JSON.parse(resolvedExtract.schema) };
          } catch { /* leave as-is */ }
        }
      }

      // Validate LLM params if extraction is requested
      if (resolvedExtract && (resolvedExtract.schema || resolvedExtract.prompt)) {
        if (!llmProvider || !VALID_LLM_PROVIDERS.includes(llmProvider as InlineLLMProvider)) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_request',
              message: `"llmProvider" is required for inline extraction and must be one of: ${VALID_LLM_PROVIDERS.join(', ')}`,
              docs: 'https://webpeel.dev/docs/api-reference#fetch',
            },
            requestId: req.requestId,
          });
          return;
        }
        if (!llmApiKey || typeof llmApiKey !== 'string' || llmApiKey.trim().length === 0) {
          res.status(400).json({
            success: false,
            error: {
              type: 'invalid_request',
              message: 'Missing or invalid "llmApiKey" (BYOK required for inline extraction)',
              hint: 'Pass your LLM provider API key in the "llmApiKey" field',
              docs: 'https://webpeel.dev/docs/api-reference#fetch',
            },
            requestId: req.requestId,
          });
          return;
        }
      }

      // --- Build PeelOptions ---------------------------------------------------
      const isSoftLimited = req.auth?.softLimited === true;
      const hasExtraUsage = req.auth?.extraUsageAvailable === true;

      const includeTagsArray = Array.isArray(includeTags) ? includeTags : undefined;
      const excludeTagsArray = Array.isArray(excludeTags) ? excludeTags : undefined;
      const languagesArray = Array.isArray(languages) ? languages : undefined;

      const finalIncludeTags = onlyMainContent === true
        ? ['main', 'article', '.content', '#content']
        : includeTagsArray;

      const resolvedFormat = (format as 'markdown' | 'text' | 'html' | 'clean') || 'markdown';
      if (!['markdown', 'text', 'html', 'clean'].includes(resolvedFormat)) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Invalid "format" parameter: must be "markdown", "text", "html", or "clean"',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      const resolvedWait = typeof wait === 'number' ? wait : undefined;
      if (resolvedWait !== undefined && (isNaN(resolvedWait) || resolvedWait < 0 || resolvedWait > 60000)) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_request',
            message: 'Invalid "wait" parameter: must be between 0 and 60000ms',
            docs: 'https://webpeel.dev/docs/api-reference#fetch',
          },
          requestId: req.requestId,
        });
        return;
      }

      // When actions are present, force browser mode
      const postHasActions = postActions && postActions.length > 0;
      const postShouldRender = postHasActions || render === true;

      // Normalize exclude: accept string (comma-separated) or string array
      const excludeArray = exclude
        ? (Array.isArray(exclude) ? exclude : (exclude as string).split(',').map(s => s.trim()).filter(Boolean))
        : undefined;

      const options: PeelOptions = {
        render: (isSoftLimited && !hasExtraUsage && !postHasActions) ? false : postShouldRender,
        wait: (isSoftLimited && !hasExtraUsage) ? 0 : resolvedWait,
        format: resolvedFormat,
        stream: stream === true,
        includeTags: finalIncludeTags,
        excludeTags: excludeTagsArray,
        images: images === true,
        actions: postActions,
        location: location || languagesArray ? {
          country: location,
          languages: languagesArray,
        } : undefined,
        budget: typeof budget === 'number' ? budget : undefined,
        question: question,
        readable: readable === true,
        stealth: (isSoftLimited && !hasExtraUsage) ? false : stealth === true,
        screenshot: (isSoftLimited && !hasExtraUsage) ? false : screenshot === true,
        maxTokens: typeof maxTokens === 'number' ? maxTokens : undefined,
        selector: selector,
        exclude: excludeArray,
        fullPage: fullPage === true,
        raw: raw === true,
        lite: lite === true,
        timeout: typeof timeout === 'number' ? timeout : undefined,
        proxies: Array.isArray(proxies) ? proxies : undefined,
        device: device,
        viewportWidth: typeof viewportWidth === 'number' ? viewportWidth : undefined,
        viewportHeight: typeof viewportHeight === 'number' ? viewportHeight : undefined,
        waitUntil: waitUntil,
        waitSelector: waitSelector,
        blockResources: Array.isArray(blockResources) ? blockResources : undefined,
      };

      if (cloaked) options.cloaked = cloaked;
      if (chunk) options.chunk = chunk === true ? true : chunk;

      // Auto-budget: default to 4000 tokens for API requests when no budget specified
      // Opt-out: budget=0 explicitly disables. Lite mode disables auto-budget.
      if (options.budget === undefined && !options.lite) {
        options.budget = 4000;
        res.setHeader('X-Auto-Budget', '4000');
      }

      if (isSoftLimited && !hasExtraUsage && render === true && !postHasActions) {
        res.setHeader('X-Degraded', 'render=true downgraded to HTTP-only (quota exceeded)');
      }
      if (isSoftLimited && !hasExtraUsage && stealth === true) {
        res.setHeader('X-Degraded', 'stealth=true downgraded (quota exceeded)');
      }
      if (isSoftLimited && !hasExtraUsage && screenshot === true) {
        res.setHeader('X-Degraded', 'screenshot=true downgraded (quota exceeded)');
      }

      const shouldStream = options.stream === true;
      if (shouldStream) {
        res.setHeader('X-Stream', 'true');
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }
      }

      // --- Fetch content -------------------------------------------------------
      const startTime = Date.now();
      const result = await peel(url, options);
      const elapsed = Date.now() - startTime;

      // --- BM25 Schema Template Extraction (POST, no LLM needed) ---
      if (bodySchema && typeof bodySchema === 'string' && result.content) {
        const template = getSchemaTemplate(bodySchema);
        if (template) {
          const { quickAnswer } = await import('../../core/quick-answer.js');
          const { smartExtractSchemaFields } = await import('../../core/schema-postprocess.js');
          const extracted = smartExtractSchemaFields(
            result.content,
            template.fields,
            quickAnswer,
            {
              pageTitle: result.title,
              pageUrl: result.url,
              metadata: result.metadata as Record<string, any>,
            },
          );
          (result as any).extracted = extracted;
        }
      }

      // --- Inline extraction (post-fetch) -------------------------------------
      let jsonData: Record<string, any> | undefined;
      let extractTokensUsed: { input: number; output: number } | undefined;

      if (resolvedExtract && (resolvedExtract.schema || resolvedExtract.prompt) && llmApiKey) {
        const extractResult = await extractInlineJson(result.content, {
          schema: resolvedExtract.schema,
          prompt: resolvedExtract.prompt,
          llmProvider: llmProvider as InlineLLMProvider,
          llmApiKey: llmApiKey.trim(),
          llmModel,
        });
        jsonData = extractResult.data;
        extractTokensUsed = extractResult.tokensUsed;
      }

      // --- Usage tracking (same as GET) ----------------------------------------
      const fetchType: 'basic' | 'stealth' | 'captcha' | 'search' =
        result.method === 'stealth' ? 'stealth' :
        result.method === 'browser' ? 'stealth' : 'basic';

      const pgStore = authStore as any;
      if (req.auth?.keyInfo?.accountId && typeof pgStore.pool !== 'undefined') {
        pgStore.pool.query(
          `INSERT INTO usage_logs
            (user_id, endpoint, url, method, processing_time_ms, status_code, ip_address, user_agent)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.auth.keyInfo.accountId,
            'fetch',
            url,
            fetchType,
            elapsed,
            200,
            req.ip || req.socket.remoteAddress,
            req.get('user-agent'),
          ]
        ).catch((err: any) => {
          console.error('Failed to log request to usage_logs:', err);
        });
      }

      if (req.auth?.keyInfo?.key && typeof pgStore.trackBurstUsage === 'function') {
        await pgStore.trackBurstUsage(req.auth.keyInfo.key);

        if (isSoftLimited && hasExtraUsage) {
          const extraResult = await pgStore.trackExtraUsage(
            req.auth.keyInfo.key,
            fetchType,
            url,
            elapsed,
            200
          );
          if (extraResult.success) {
            res.setHeader('X-Extra-Usage-Charged', `$${extraResult.cost.toFixed(4)}`);
            res.setHeader('X-Extra-Usage-New-Balance', extraResult.newBalance.toFixed(2));
          } else {
            res.setHeader('X-Degraded', 'Extra usage insufficient, degraded to soft limit');
          }
        } else if (!isSoftLimited) {
          await pgStore.trackUsage(req.auth.keyInfo.key, fetchType);
        }
      }

      // Cache result (skip extraction results — they depend on user's LLM keys)
      if (storeFlag !== false && !postBypassCache && !resolvedExtract) {
        cache.set(postCacheKey, { result, timestamp: Date.now() }, { ttl: postCacheTtlMs });
      }

      // --- Build response ------------------------------------------------------
      // Headers kept for backward compat; also surfaced in envelope metadata.
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Credits-Used', '1');
      res.setHeader('X-Processing-Time', elapsed.toString());
      res.setHeader('X-Fetch-Type', fetchType);

      const responseBody: any = { ...result };
      if (jsonData !== undefined) {
        responseBody.json = jsonData;
      }
      if (extractTokensUsed) {
        responseBody.extractTokensUsed = extractTokensUsed;
      }

      if (wantsEnvelope(req)) {
        successResponse(res, responseBody, {
          requestId: req.requestId,
          processingTimeMs: elapsed,
          creditsUsed: 1,
          cached: false,
          fetchType,
        });
      } else {
        res.json(responseBody);
      }
    } catch (error: any) {
      const err = error as any;
      console.error('POST fetch/scrape error:', err);

      if (err.code) {
        const safeMessage = err.message.replace(/[<>"']/g, '');
        const statusCode = err.code === 'TIMEOUT' ? 504 
          : err.code === 'BLOCKED' ? 403 
          : err.code === 'NETWORK' ? 502 
          : 500;
        
        const hints: Record<string, string> = {
          TIMEOUT: 'Try increasing timeout, or set render:true for JS-heavy sites.',
          BLOCKED: 'Site blocks automated requests. Try render:true or stealth mode.',
          NETWORK: 'Could not reach the target URL. Verify it is correct and online.',
        };

        res.status(statusCode).json({
          success: false,
          error: {
            type: err.code,
            message: safeMessage,
            hint: hints[err.code] || undefined,
            docs: 'https://webpeel.dev/docs/api-reference#errors',
          },
          requestId: req.requestId,
        });
      } else {
        res.status(500).json({
          success: false,
          error: {
            type: 'internal_error',
            message: 'An unexpected error occurred. If this persists, check https://webpeel.dev/status',
            docs: 'https://webpeel.dev/docs/api-reference#errors',
          },
          requestId: req.requestId,
        });
      }
    }
  }

  router.post('/v1/fetch', handlePostFetch);
  router.post('/v2/scrape', handlePostFetch);

  return router;
}
