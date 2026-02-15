/**
 * Firecrawl API Compatibility Layer
 * 
 * Drop-in replacement for Firecrawl's API - users can switch by ONLY changing the base URL.
 * This is our killer acquisition feature.
 * 
 * Implements Firecrawl endpoints:
 * - POST /v1/scrape
 * - POST /v2/scrape  (v2 with formats: ["screenshot"] support)
 * - POST /v1/crawl
 * - GET /v1/crawl/:id
 * - POST /v1/search
 * - POST /v1/map
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { crawl } from '../../core/crawler.js';
import { mapDomain } from '../../core/map.js';
import { takeScreenshot } from '../../core/screenshot.js';
import type { IJobQueue } from '../job-queue.js';
import type { PeelOptions, PageAction, InlineLLMProvider } from '../../types.js';
import { normalizeActions } from '../../core/actions.js';
import { extractInlineJson } from '../../core/extract-inline.js';

const VALID_LLM_PROVIDERS: InlineLLMProvider[] = ['openai', 'anthropic', 'google'];

/**
 * Map Firecrawl's action format to our PageAction format.
 * Delegates to the shared normalizeActions helper so behaviour stays
 * consistent across all API surfaces.
 */
function mapFirecrawlActions(actions?: any[]): PageAction[] | undefined {
  if (!actions || !Array.isArray(actions)) return undefined;
  return normalizeActions(actions);
}

export function createCompatRouter(jobQueue: IJobQueue): Router {
  const router = Router();

  /**
   * POST /v1/scrape - Firecrawl's main scrape endpoint
   * 
   * Maps to our peel() function
   */
  router.post('/v1/scrape', async (req: Request, res: Response) => {
    try {
      const {
        url,
        formats = ['markdown'],
        onlyMainContent = true, // Firecrawl defaults to true
        includeTags,
        excludeTags,
        waitFor,
        timeout,
        actions,
        headers,
        location,
        // Inline extraction (BYOK)
        extract: extractParam,
        llmProvider,
        llmApiKey,
        llmModel,
      } = req.body;

      // Validate URL
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid "url" parameter',
        });
        return;
      }

      // Determine if we need to render based on Firecrawl params
      const needsRender = waitFor !== undefined || actions !== undefined;

      // Map Firecrawl parameters to our PeelOptions
      // onlyMainContent=true (default) → raw=false (use smart extraction)
      // onlyMainContent=false → raw=true (return everything)
      const options: PeelOptions = {
        render: needsRender,
        wait: waitFor,
        timeout: timeout || 30000,
        includeTags: Array.isArray(includeTags) ? includeTags : undefined,
        excludeTags: Array.isArray(excludeTags) ? excludeTags : undefined,
        raw: onlyMainContent === false,
        actions: mapFirecrawlActions(actions),
        headers,
        screenshot: formats.includes('screenshot'),
        images: formats.includes('images'),
        format: 'markdown', // Always use markdown as base
      };

      // If location is provided, map it
      if (location) {
        options.location = {
          country: location.country,
          languages: location.languages,
        };
      }

      // Execute peel
      const result = await peel(url, options);

      // Build Firecrawl-compatible response
      const data: any = {
        markdown: result.content,
        metadata: {
          title: result.title,
          description: result.metadata.description || '',
          language: 'en', // WebPeel doesn't detect language yet
          sourceURL: result.url,
          statusCode: 200, // We don't track status codes in PeelResult
          ...result.metadata,
        },
      };

      // Add optional formats
      if (formats.includes('html')) {
        // Re-fetch with HTML format if requested
        const htmlResult = await peel(url, { ...options, format: 'html' });
        data.html = htmlResult.content;
      }

      if (formats.includes('rawHtml')) {
        const rawResult = await peel(url, { ...options, format: 'html', raw: true });
        data.rawHtml = rawResult.content;
      }

      if (formats.includes('links')) {
        data.links = result.links;
      }

      if (formats.includes('screenshot') && result.screenshot) {
        data.screenshot = `data:image/png;base64,${result.screenshot}`;
      }

      if (formats.includes('images') && result.images) {
        data.images = result.images;
      }

      // --- Inline JSON extraction via LLM (BYOK) ---
      // Resolve extract from: (1) top-level extract param, (2) formats array object
      let resolvedExtract: { schema?: Record<string, any>; prompt?: string } | undefined;

      if (extractParam && typeof extractParam === 'object' && (extractParam.schema || extractParam.prompt)) {
        resolvedExtract = extractParam;
      }

      if (!resolvedExtract) {
        const jsonFormatObj = formats.find(
          (f: any) => typeof f === 'object' && f !== null && f.type === 'json' && (f.schema || f.prompt),
        );
        if (jsonFormatObj) {
          resolvedExtract = { schema: jsonFormatObj.schema, prompt: jsonFormatObj.prompt };
        }
      }

      if (resolvedExtract && llmApiKey && llmProvider && VALID_LLM_PROVIDERS.includes(llmProvider as InlineLLMProvider)) {
        const extractResult = await extractInlineJson(result.content, {
          schema: resolvedExtract.schema,
          prompt: resolvedExtract.prompt,
          llmProvider: llmProvider as InlineLLMProvider,
          llmApiKey: llmApiKey.trim(),
          llmModel,
        });
        data.json = extractResult.data;
        data.extractTokensUsed = extractResult.tokensUsed;
      } else if (formats.includes('json')) {
        // Fallback: return structured metadata as JSON (no LLM)
        data.json = result.extracted || result.metadata;
      }

      if (formats.includes('branding')) {
        data.branding = result.branding;
      }

      if (formats.includes('summary')) {
        data.summary = result.summary;
      }

      res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error('Firecrawl /v1/scrape error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to scrape URL',
      });
    }
  });

  /**
   * POST /v1/crawl - Firecrawl's crawl endpoint (async)
   * 
   * Maps to our crawl() function with job queue
   */
  router.post('/v1/crawl', async (req: Request, res: Response) => {
    try {
      const {
        url,
        limit = 100,
        maxDepth = 3,
        includePaths = [],
        excludePaths = [],
        scrapeOptions = {},
        webhook,
      } = req.body;

      // Validate URL
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid "url" parameter',
        });
        return;
      }

      try {
        new URL(url);
      } catch {
        res.status(400).json({
          success: false,
          error: 'Invalid URL format',
        });
        return;
      }

      // Create job
      const job = await jobQueue.createJob('crawl', webhook);

      // Start crawl in background
      setImmediate(async () => {
        try {
          jobQueue.updateJob(job.id, { status: 'processing' });

          // Build crawl options
          const crawlOptions: any = {
            maxPages: limit,
            maxDepth,
            onProgress: (progress: any) => {
              const total = progress.crawled + progress.queued;
              jobQueue.updateJob(job.id, {
                total,
                completed: progress.crawled,
                creditsUsed: progress.crawled,
              });
            },
            // Map scrapeOptions to PeelOptions
            ...scrapeOptions,
          };

          // Add path filters if provided
          if (includePaths.length > 0) {
            crawlOptions.includePatterns = includePaths;
          }
          if (excludePaths.length > 0) {
            crawlOptions.excludePatterns = excludePaths;
          }

          // Run crawl
          const results = await crawl(url, crawlOptions);

          // Map results to Firecrawl format
          const firecrawlResults = results.map(r => ({
            url: r.url,
            markdown: r.markdown,
            metadata: {
              title: r.title,
              description: '',
              sourceURL: r.url,
              statusCode: 200,
            },
            links: r.links,
          }));

          // Update job with results
          jobQueue.updateJob(job.id, {
            status: 'completed',
            data: firecrawlResults,
            total: results.length,
            completed: results.length,
            creditsUsed: results.length,
          });
        } catch (error: any) {
          jobQueue.updateJob(job.id, {
            status: 'failed',
            error: error.message || 'Unknown error',
          });
        }
      });

      // Return job ID immediately (Firecrawl format)
      res.json({
        success: true,
        id: job.id,
      });
    } catch (error: any) {
      console.error('Firecrawl /v1/crawl error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create crawl job',
      });
    }
  });

  /**
   * GET /v1/crawl/:id - Get crawl job status (Firecrawl format)
   */
  router.get('/v1/crawl/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const job = await jobQueue.getJob(id);

      if (!job) {
        res.status(404).json({
          success: false,
          error: 'Job not found',
        });
        return;
      }

      // Map our job status to Firecrawl's status format
      const firecrawlStatus = job.status === 'processing' ? 'scraping' : job.status;

      res.json({
        success: true,
        status: firecrawlStatus,
        completed: job.completed || 0,
        total: job.total || 0,
        creditsUsed: job.creditsUsed || 0,
        expiresAt: job.expiresAt,
        data: job.data || [],
      });
    } catch (error: any) {
      console.error('Firecrawl GET /v1/crawl/:id error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve job',
      });
    }
  });

  /**
   * POST /v1/search - Firecrawl's search endpoint
   * 
   * Uses DuckDuckGo search with optional scraping
   */
  router.post('/v1/search', async (req: Request, res: Response) => {
    try {
      const {
        query,
        limit = 5,
        scrapeOptions = {},
      } = req.body;

      // Validate query
      if (!query || typeof query !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid "query" parameter',
        });
        return;
      }

      // Use our search route logic (DuckDuckGo HTML scraping)
      const { fetch: undiciFetch } = await import('undici');
      const { load } = await import('cheerio');

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query as string)}`;
      const response = await undiciFetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = load(html);
      const results: any[] = [];

      $('.result').each((_i: any, elem: any) => {
        if (results.length >= limit) return;

        const $result = $(elem);
        let title = $result.find('.result__title').text().trim();
        const rawUrl = $result.find('.result__a').attr('href') || '';
        let snippet = $result.find('.result__snippet').text().trim();

        if (!title || !rawUrl) return;

        // Extract actual URL from DuckDuckGo redirect
        let url = rawUrl;
        try {
          const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
          const uddg = ddgUrl.searchParams.get('uddg');
          if (uddg) {
            url = decodeURIComponent(uddg);
          }
        } catch {
          // Use raw URL if parsing fails
        }

        // Validate URL
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return;
          }
          url = parsed.href;
        } catch {
          return;
        }

        results.push({ title, url, snippet });
      });

      // If scraping is requested, fetch each result
      const firecrawlResults = await Promise.all(
        results.map(async (result) => {
          try {
            // Scrape the URL with provided options
            const peelResult = await peel(result.url, {
              format: 'markdown',
              timeout: 10000,
              ...scrapeOptions,
            });

            return {
              url: result.url,
              markdown: peelResult.content,
              metadata: {
                title: peelResult.title || result.title,
                description: result.snippet,
                sourceURL: result.url,
                statusCode: 200,
                ...peelResult.metadata,
              },
            };
          } catch (error) {
            // Return basic result if scraping fails
            return {
              url: result.url,
              markdown: '',
              metadata: {
                title: result.title,
                description: result.snippet,
                sourceURL: result.url,
                error: (error as Error).message,
              },
            };
          }
        })
      );

      res.json({
        success: true,
        data: firecrawlResults,
      });
    } catch (error: any) {
      console.error('Firecrawl /v1/search error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Search failed',
      });
    }
  });

  /**
   * POST /v1/map - Firecrawl's map endpoint
   * 
   * Maps to our mapDomain() function
   */
  router.post('/v1/map', async (req: Request, res: Response) => {
    try {
      const {
        url,
        limit = 5000,
        search,
      } = req.body;

      // Validate URL
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid "url" parameter',
        });
        return;
      }

      try {
        new URL(url);
      } catch {
        res.status(400).json({
          success: false,
          error: 'Invalid URL format',
        });
        return;
      }

      // Run mapDomain
      const result = await mapDomain(url, {
        maxUrls: limit,
        search,
      });

      res.json({
        success: true,
        links: result.urls,
      });
    } catch (error: any) {
      console.error('Firecrawl /v1/map error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to map domain',
      });
    }
  });

  /**
   * POST /v2/scrape - Firecrawl v2-compatible scrape with screenshot support
   *
   * Same as /v1/scrape but adds first-class screenshot support.
   * When formats includes "screenshot" (and nothing else), returns
   * a screenshot directly; otherwise falls through to peel() like v1.
   */
  router.post('/v2/scrape', async (req: Request, res: Response) => {
    try {
      const {
        url,
        formats = ['markdown'],
        onlyMainContent = true,
        includeTags,
        excludeTags,
        waitFor,
        timeout,
        actions,
        headers,
        location,
        // Screenshot-specific v2 options
        fullPage,
        width,
        height,
        screenshotFormat,
        quality,
      } = req.body;

      // Validate URL
      if (!url || typeof url !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid "url" parameter',
        });
        return;
      }

      const wantsScreenshot = formats.includes('screenshot') || formats.includes('screenshot@fullPage');

      // If screenshot-only request, use the dedicated screenshot function
      if (wantsScreenshot && formats.length === 1) {
        const result = await takeScreenshot(url, {
          fullPage: fullPage === true || formats[0] === 'screenshot@fullPage',
          width: typeof width === 'number' ? width : undefined,
          height: typeof height === 'number' ? height : undefined,
          format: screenshotFormat || 'png',
          quality: typeof quality === 'number' ? quality : undefined,
          waitFor: typeof waitFor === 'number' ? waitFor : undefined,
          timeout: typeof timeout === 'number' ? timeout : 30000,
          actions: mapFirecrawlActions(actions),
          headers,
        });

        res.json({
          success: true,
          data: {
            screenshot: `data:${result.contentType};base64,${result.screenshot}`,
            metadata: {
              sourceURL: result.url,
              statusCode: 200,
              format: result.format,
            },
          },
        });
        return;
      }

      // Otherwise, fall through to peel() like v1/scrape
      const needsRender = waitFor !== undefined || actions !== undefined || wantsScreenshot;

      const options: PeelOptions = {
        render: needsRender,
        wait: waitFor,
        timeout: timeout || 30000,
        includeTags: Array.isArray(includeTags) ? includeTags : undefined,
        excludeTags: Array.isArray(excludeTags) ? excludeTags : undefined,
        raw: onlyMainContent === false,
        actions: mapFirecrawlActions(actions),
        headers,
        screenshot: wantsScreenshot,
        screenshotFullPage: fullPage === true,
        images: formats.includes('images'),
        format: 'markdown',
      };

      if (location) {
        options.location = {
          country: location.country,
          languages: location.languages,
        };
      }

      const result = await peel(url, options);

      const data: any = {
        markdown: result.content,
        metadata: {
          title: result.title,
          description: result.metadata.description || '',
          language: 'en',
          sourceURL: result.url,
          statusCode: 200,
          ...result.metadata,
        },
      };

      if (formats.includes('html')) {
        const htmlResult = await peel(url, { ...options, format: 'html' });
        data.html = htmlResult.content;
      }

      if (formats.includes('rawHtml')) {
        const rawResult = await peel(url, { ...options, format: 'html', raw: true });
        data.rawHtml = rawResult.content;
      }

      if (formats.includes('links')) {
        data.links = result.links;
      }

      if (wantsScreenshot && result.screenshot) {
        data.screenshot = `data:image/png;base64,${result.screenshot}`;
      }

      if (formats.includes('images') && result.images) {
        data.images = result.images;
      }

      res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error('Firecrawl /v2/scrape error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to scrape URL',
      });
    }
  });

  return router;
}
