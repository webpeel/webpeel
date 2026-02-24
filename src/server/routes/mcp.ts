/**
 * Hosted MCP endpoint — POST /mcp, POST /v2/mcp, POST /:apiKey/v2/mcp
 *
 * Accepts MCP Streamable HTTP transport (JSON-RPC over HTTP).
 * Users connect with:
 *   { "url": "https://api.webpeel.dev/mcp" }
 *   { "url": "https://api.webpeel.dev/v2/mcp" }
 *   { "url": "https://api.webpeel.dev/<API_KEY>/v2/mcp" }  ← key in URL (Firecrawl-style)
 *
 * Each request creates a stateless MCP server, processes the JSON-RPC
 * message(s), and returns the response.
 */

import { Router, Request, Response } from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthStore } from '../auth-store.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { LRUCache } from 'lru-cache';
import { peel, peelBatch } from '../../index.js';
import type { PeelOptions } from '../../types.js';
import { normalizeActions } from '../../core/actions.js';
import { runAgent } from '../../core/agent.js';
import type { AgentDepth, AgentTopic } from '../../core/agent.js';
import { extractInlineJson, type LLMProvider as InlineLLMProvider } from '../../core/extract-inline.js';
import { answerQuestion, type LLMProviderId } from '../../core/answer.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Read version from package.json
let pkgVersion = '0.7.0';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8'));
  pkgVersion = pkg.version;
} catch { /* fallback */ }

// ---------------------------------------------------------------------------
// MCP fetch cache — shared across all MCP requests (same node process)
// ---------------------------------------------------------------------------

interface McpCacheEntry {
  result: any;
  timestamp: number;
}

const mcpFetchCache = new LRUCache<string, McpCacheEntry>({
  max: 500,
  ttl: 5 * 60 * 1000, // 5 minutes default
  maxSize: 100 * 1024 * 1024, // 100MB
  sizeCalculation: (entry) => JSON.stringify(entry).length,
});

// ---------------------------------------------------------------------------
// Helper functions for brand extraction
// ---------------------------------------------------------------------------

function extractColorsFromContent(content: string): string[] {
  const colors: string[] = [];
  const hexRegex = /#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}/g;
  const matches = content.match(hexRegex);
  if (matches) {
    colors.push(...[...new Set(matches)].slice(0, 10));
  }
  return colors;
}

function extractFontsFromContent(content: string): string[] {
  const fonts: string[] = [];
  const fontRegex = /font-family:\s*([^;}"'\n]+)/gi;
  let match;
  while ((match = fontRegex.exec(content)) !== null) {
    fonts.push(match[1].trim());
  }
  return [...new Set(fonts)].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Tool definitions (subset of the full MCP server tools, used for hosted mode)
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: 'webpeel_fetch',
      description: 'Fetch a URL and return clean, AI-ready markdown content. Handles JavaScript rendering and anti-bot protections.',
      annotations: { title: 'Fetch Web Page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
          render: { type: 'boolean', description: 'Force browser rendering', default: false },
          stealth: { type: 'boolean', description: 'Stealth mode to bypass bot detection', default: false },
          wait: { type: 'number', description: 'Milliseconds to wait for dynamic content', default: 0 },
          format: { type: 'string', enum: ['markdown', 'text', 'html'], default: 'markdown' },
          selector: { type: 'string', description: 'CSS selector to extract specific content' },
          maxTokens: { type: 'number', description: 'Maximum token count for output' },
          images: { type: 'boolean', description: 'Extract image URLs', default: false },
          inlineExtract: {
            type: 'object',
            description: 'Inline LLM-powered JSON extraction (BYOK). Provide schema and/or prompt.',
            properties: {
              schema: { type: 'object', description: 'JSON Schema for desired output' },
              prompt: { type: 'string', description: 'Extraction prompt' },
            },
          },
          llmProvider: { type: 'string', enum: ['openai', 'anthropic', 'google'], description: 'LLM provider for inline extraction' },
          llmApiKey: { type: 'string', description: 'LLM API key (BYOK) for inline extraction' },
          llmModel: { type: 'string', description: 'LLM model name (optional)' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['click', 'type', 'fill', 'scroll', 'wait', 'press', 'hover', 'select', 'waitForSelector', 'screenshot'] },
                selector: { type: 'string' },
                value: { type: 'string' },
                text: { type: 'string' },
                key: { type: 'string' },
                milliseconds: { type: 'number' },
                ms: { type: 'number' },
                direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
                amount: { type: 'number' },
                timeout: { type: 'number' },
              },
              required: ['type'],
            },
            description: 'Page actions to execute before extraction (auto-enables browser rendering)',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_search',
      description: 'Search the web and return results with titles, URLs, and snippets.',
      annotations: { title: 'Search the Web', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results (1-10)', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'webpeel_crawl',
      description: 'Crawl a website following links and extracting content.',
      annotations: { title: 'Crawl Website', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Starting URL' },
          maxPages: { type: 'number', default: 10, minimum: 1, maximum: 100 },
          maxDepth: { type: 'number', default: 2, minimum: 1, maximum: 5 },
          render: { type: 'boolean', default: false },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_map',
      description: 'Discover all URLs on a domain using sitemap.xml and link crawling.',
      annotations: { title: 'Map Website URLs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Starting URL or domain' },
          maxUrls: { type: 'number', default: 5000, minimum: 1, maximum: 10000 },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_extract',
      description: 'Extract structured data from a webpage using CSS selectors or AI.',
      annotations: { title: 'Extract Structured Data', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to extract from' },
          selectors: { type: 'object', description: 'Map of field names to CSS selectors' },
          prompt: { type: 'string', description: 'Natural language prompt for AI extraction' },
          llmApiKey: { type: 'string', description: 'API key for LLM extraction' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_batch',
      description: 'Fetch multiple URLs in batch with concurrency control.',
      annotations: { title: 'Batch Fetch URLs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: 'URLs to fetch' },
          concurrency: { type: 'number', default: 3, minimum: 1, maximum: 10 },
          format: { type: 'string', enum: ['markdown', 'text', 'html'], default: 'markdown' },
        },
        required: ['urls'],
      },
    },
    {
      name: 'webpeel_research',
      description: 'Conduct autonomous multi-step web research on a topic. Searches the web, fetches top sources, extracts relevant content, and synthesizes a comprehensive report with citations. Returns a markdown report and structured source list. Requires LLM API key for synthesis; without one it returns raw extracted source content.',
      annotations: { title: 'Deep Research Agent', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Research question or topic to investigate' },
          maxSources: { type: 'number', description: 'Maximum number of sources to consult (default: 5)', default: 5, minimum: 1, maximum: 20 },
          maxDepth: { type: 'number', description: 'Link-following depth: 1 = search results only, 2+ = follow links within top sources (default: 1)', default: 1, minimum: 1, maximum: 3 },
          llmApiKey: { type: 'string', description: 'LLM API key for synthesis (falls back to OPENAI_API_KEY env var)' },
          llmModel: { type: 'string', description: 'LLM model to use for synthesis (default: gpt-4o-mini)' },
          llmBaseUrl: { type: 'string', description: 'LLM API base URL (default: https://api.openai.com/v1)' },
          outputFormat: { type: 'string', enum: ['report', 'sources'], description: 'Output format: "report" = synthesized markdown report (needs LLM key), "sources" = raw extracted source content', default: 'report' },
          timeout: { type: 'number', description: 'Maximum research time in milliseconds (default: 60000)', default: 60000 },
        },
        required: ['query'],
      },
    },
    {
      name: 'webpeel_screenshot',
      description: 'Take a screenshot of a URL and return a base64-encoded image. Supports full page or viewport capture, custom dimensions, PNG/JPEG format, and page actions before capture.',
      annotations: { title: 'Take Screenshot', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to screenshot' },
          fullPage: { type: 'boolean', description: 'Capture the full scrollable page (default: viewport only)', default: false },
          width: { type: 'number', description: 'Viewport width in pixels (default: 1280)', default: 1280, minimum: 100, maximum: 5000 },
          height: { type: 'number', description: 'Viewport height in pixels (default: 720)', default: 720, minimum: 100, maximum: 5000 },
          format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default: png)', default: 'png' },
          quality: { type: 'number', description: 'JPEG quality 1-100 (ignored for PNG)', minimum: 1, maximum: 100 },
          waitFor: { type: 'number', description: 'Milliseconds to wait after page load before screenshot', default: 0 },
          stealth: { type: 'boolean', description: 'Use stealth mode to bypass bot detection', default: false },
          actions: { type: 'array', items: { type: 'object' }, description: 'Page actions to execute before screenshot' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_summarize',
      description: 'Generate an AI-powered summary of a webpage using an LLM. Requires an OpenAI-compatible API key.',
      annotations: { title: 'Summarize Page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to summarize' },
          llmApiKey: { type: 'string', description: 'API key for LLM (OpenAI-compatible)' },
          prompt: { type: 'string', description: 'Custom summary prompt (default: "Summarize this webpage in 2-3 sentences.")', default: 'Summarize this webpage in 2-3 sentences.' },
          llmModel: { type: 'string', description: 'LLM model to use (default: gpt-4o-mini)', default: 'gpt-4o-mini' },
          llmBaseUrl: { type: 'string', description: 'LLM API base URL (default: https://api.openai.com/v1)', default: 'https://api.openai.com/v1' },
          render: { type: 'boolean', description: 'Use browser rendering', default: false },
        },
        required: ['url', 'llmApiKey'],
      },
    },
    {
      name: 'webpeel_answer',
      description: 'Ask a question, search the web, fetch top results, and generate a cited answer using an LLM (BYOK). Returns an answer with [1], [2] source citations. Supports OpenAI, Anthropic, and Google LLMs.',
      annotations: { title: 'Answer a Question', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to answer' },
          searchProvider: { type: 'string', enum: ['duckduckgo', 'brave'], description: 'Search provider (default: duckduckgo)', default: 'duckduckgo' },
          searchApiKey: { type: 'string', description: 'API key for Brave Search (required when searchProvider is "brave")' },
          llmProvider: { type: 'string', enum: ['openai', 'anthropic', 'google'], description: 'LLM provider to use for answer generation' },
          llmApiKey: { type: 'string', description: 'API key for the LLM provider (BYOK)' },
          llmModel: { type: 'string', description: 'LLM model name (optional, uses provider default)' },
          maxSources: { type: 'number', description: 'Maximum number of sources to fetch (1-10, default 5)', default: 5, minimum: 1, maximum: 10 },
        },
        required: ['question', 'llmProvider', 'llmApiKey'],
      },
    },
    {
      name: 'webpeel_brand',
      description: 'Extract branding and design system from a URL. Returns colors, fonts, typography, and visual identity elements.',
      annotations: { title: 'Extract Branding', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to extract branding from' },
          render: { type: 'boolean', description: 'Use browser rendering', default: false },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_change_track',
      description: 'Track changes on a URL by generating a content fingerprint. Use this to detect when a page has been updated.',
      annotations: { title: 'Track Page Changes', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to track for changes' },
          render: { type: 'boolean', description: 'Use browser rendering', default: false },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_deep_fetch',
      description: 'Search for a query and fetch the top N results in parallel, merging all content into one combined document with source attribution. No LLM API key required — pure web fetching + merging. Ideal for AI agents that need comprehensive research content on a topic.',
      annotations: { title: 'Deep Fetch Research', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to research' },
          count: { type: 'number', description: 'Number of top results to fetch (default: 5, max: 10)', default: 5, minimum: 1, maximum: 10 },
          format: { type: 'string', enum: ['markdown', 'text'], description: 'Content format for fetched pages (default: markdown)', default: 'markdown' },
        },
        required: ['query'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

function safeStringify(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return JSON.stringify({ error: 'serialization_error', message: 'Failed to serialize result' });
  }
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    // webpeel_fetch
    if (name === 'webpeel_fetch') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (url.length > 2048) throw new Error('URL too long');

      // Normalize actions (handles Firecrawl-style aliases)
      const parsedActions = args.actions ? normalizeActions(args.actions) : undefined;
      const hasActions = parsedActions && parsedActions.length > 0;

      const options: PeelOptions = {
        render: (args.render as boolean) || hasActions || false,
        stealth: (args.stealth as boolean) || false,
        wait: (args.wait as number) || 0,
        format: (args.format as 'markdown' | 'text' | 'html') || 'markdown',
        selector: args.selector as string | undefined,
        maxTokens: args.maxTokens as number | undefined,
        images: args.images as boolean | undefined,
        actions: parsedActions,
      };

      // Cache key and bypass logic
      const mcpNoCache = args.noCache === true;
      const mcpCacheTtlMs = typeof args.cacheTtl === 'number' ? (args.cacheTtl as number) * 1000 : 5 * 60 * 1000;
      const mcpActionsKey = parsedActions ? JSON.stringify(parsedActions) : '';
      const mcpCacheKey = `mcp:fetch:${url}:${options.render}:${options.wait}:${options.format}:${options.selector}:${options.images}:${mcpActionsKey}`;

      // Check cache (skip for noCache or inline extraction requests)
      const hasInlineExtract = args.inlineExtract && ((args.inlineExtract as any).schema || (args.inlineExtract as any).prompt);
      if (!mcpNoCache && !hasInlineExtract) {
        const cached = mcpFetchCache.get(mcpCacheKey);
        if (cached) {
          const cacheAge = Date.now() - cached.timestamp;
          if (cacheAge < mcpCacheTtlMs) {
            const cachedResult = { ...cached.result, _cache: 'HIT', _cacheAge: Math.floor(cacheAge / 1000) };
            return ok(safeStringify(cachedResult));
          }
        }
      }

      const result = await Promise.race([
        peel(url, options),
        timeout(60000, 'Fetch timed out'),
      ]) as any;

      // Inline LLM extraction (post-fetch, BYOK)
      const inlineExtract = args.inlineExtract as { schema?: Record<string, any>; prompt?: string } | undefined;
      const llmProvider = args.llmProvider as string | undefined;
      const llmApiKey = args.llmApiKey as string | undefined;
      const llmModel = args.llmModel as string | undefined;

      if (inlineExtract && (inlineExtract.schema || inlineExtract.prompt) && llmApiKey && llmProvider) {
        const validProviders: InlineLLMProvider[] = ['openai', 'anthropic', 'google'];
        if (validProviders.includes(llmProvider as InlineLLMProvider)) {
          const extractResult = await extractInlineJson(result.content, {
            schema: inlineExtract.schema,
            prompt: inlineExtract.prompt,
            llmProvider: llmProvider as InlineLLMProvider,
            llmApiKey,
            llmModel,
          });
          result.json = extractResult.data;
          result.extractTokensUsed = extractResult.tokensUsed;
        }
      }

      // Store in cache (skip for inline extraction results — they depend on user's LLM keys)
      if (!mcpNoCache && !hasInlineExtract) {
        mcpFetchCache.set(mcpCacheKey, { result, timestamp: Date.now() }, { ttl: mcpCacheTtlMs });
      }

      return ok(safeStringify(result));
    }

    // webpeel_search
    if (name === 'webpeel_search') {
      const query = args.query as string;
      if (!query || typeof query !== 'string') throw new Error('Invalid query');

      const { getBestSearchProvider } = await import('../../core/search-provider.js');
      const { provider, apiKey } = getBestSearchProvider();
      const count = Math.min(Math.max((args.count as number) || 5, 1), 10);
      const results = await Promise.race([
        provider.searchWeb(query, { count, apiKey }),
        timeout(30000, 'Search timed out'),
      ]) as any[];

      return ok(safeStringify(results));
    }

    // webpeel_crawl
    if (name === 'webpeel_crawl') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');

      const { crawl } = await import('../../core/crawler.js');
      const results = await Promise.race([
        crawl(url, {
          maxPages: args.maxPages as number | undefined,
          maxDepth: args.maxDepth as number | undefined,
          render: (args.render as boolean) || false,
        }),
        timeout(600000, 'Crawl timed out'),
      ]);
      return ok(safeStringify(results));
    }

    // webpeel_map
    if (name === 'webpeel_map') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');

      const { mapDomain } = await import('../../core/map.js');
      const results = await Promise.race([
        mapDomain(url, { maxUrls: args.maxUrls as number | undefined }),
        timeout(600000, 'Map timed out'),
      ]);
      return ok(safeStringify(results));
    }

    // webpeel_extract
    if (name === 'webpeel_extract') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');

      const options: PeelOptions = {
        render: (args.render as boolean) || false,
        extract: {
          selectors: args.selectors as Record<string, string> | undefined,
          prompt: args.prompt as string | undefined,
          llmApiKey: args.llmApiKey as string | undefined,
        },
      };
      const result = await Promise.race([
        peel(url, options),
        timeout(60000, 'Extract timed out'),
      ]);
      return ok(safeStringify(result));
    }

    // webpeel_batch
    if (name === 'webpeel_batch') {
      const urls = args.urls as string[];
      if (!urls || !Array.isArray(urls) || urls.length === 0) throw new Error('Invalid urls');
      if (urls.length > 50) throw new Error('Too many URLs (max 50)');

      const options: PeelOptions & { concurrency?: number } = {
        concurrency: (args.concurrency as number) || 3,
        format: (args.format as 'markdown' | 'text' | 'html') || 'markdown',
      };
      const results = await Promise.race([
        peelBatch(urls, options),
        timeout(300000, 'Batch timed out'),
      ]);
      return ok(safeStringify(results));
    }

    // webpeel_research (and legacy alias webpeel_agent)
    if (name === 'webpeel_research') {
      const query = args.query as string;
      if (!query || typeof query !== 'string') throw new Error('Invalid query');

      const { research } = await import('../../core/research.js');
      const result = await Promise.race([
        research({
          query,
          maxSources: (args.maxSources as number) ?? 5,
          maxDepth: (args.maxDepth as number) ?? 1,
          apiKey: args.llmApiKey as string | undefined,
          model: args.llmModel as string | undefined,
          baseUrl: args.llmBaseUrl as string | undefined,
          outputFormat: (args.outputFormat as 'report' | 'sources') ?? 'report',
          timeout: (args.timeout as number) ?? 60000,
        }),
        timeout(180000, 'Research timed out'),
      ]);
      return ok(safeStringify(result));
    }

    if (name === 'webpeel_agent') {
      const prompt = args.prompt as string;
      const llmApiKey = args.llmApiKey as string;
      if (!prompt || typeof prompt !== 'string') throw new Error('Invalid prompt');
      if (!llmApiKey || typeof llmApiKey !== 'string') throw new Error('Invalid llmApiKey');

      const result = await Promise.race([
        runAgent({
          prompt,
          llmApiKey,
          llmModel: args.llmModel as string | undefined,
          depth: (args.depth as AgentDepth) || 'basic',
          topic: (args.topic as AgentTopic) || 'general',
          maxSources: args.maxSources as number | undefined,
          outputSchema: args.outputSchema as Record<string, any> | undefined,
        }),
        timeout(180000, 'Agent timed out'),
      ]);
      return ok(safeStringify(result));
    }

    // webpeel_screenshot
    if (name === 'webpeel_screenshot') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (url.length > 2048) throw new Error('URL too long');

      const width = args.width as number | undefined;
      const height = args.height as number | undefined;
      const format = (args.format as 'png' | 'jpeg') || 'png';
      const quality = args.quality as number | undefined;
      const waitFor = (args.waitFor as number) || 0;
      const stealth = (args.stealth as boolean) || false;
      const fullPage = (args.fullPage as boolean) || false;

      if (width !== undefined && (width < 100 || width > 5000)) throw new Error('Invalid width: must be 100–5000');
      if (height !== undefined && (height < 100 || height > 5000)) throw new Error('Invalid height: must be 100–5000');
      if (!['png', 'jpeg'].includes(format)) throw new Error('Invalid format');
      if (quality !== undefined && (quality < 1 || quality > 100)) throw new Error('Invalid quality: must be 1–100');
      if (waitFor < 0 || waitFor > 60000) throw new Error('Invalid waitFor: must be 0–60000');

      const { takeScreenshot } = await import('../../core/screenshot.js');
      const result = await Promise.race([
        takeScreenshot(url, {
          fullPage,
          width,
          height,
          format,
          quality,
          waitFor,
          stealth,
          actions: args.actions as any[] | undefined,
        }),
        timeout(60000, 'Screenshot timed out'),
      ]) as any;

      return ok(safeStringify({
        url: result.url,
        format: result.format,
        contentType: result.contentType,
        screenshot: result.screenshot,
      }));
    }

    // webpeel_summarize
    if (name === 'webpeel_summarize') {
      const url = args.url as string;
      const llmApiKey = args.llmApiKey as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (url.length > 2048) throw new Error('URL too long');
      if (!llmApiKey || typeof llmApiKey !== 'string') throw new Error('Invalid llmApiKey');

      const options: PeelOptions = {
        render: (args.render as boolean) || false,
        extract: {
          prompt: (args.prompt as string) || 'Summarize this webpage in 2-3 sentences.',
          llmApiKey,
          llmModel: (args.llmModel as string) || 'gpt-4o-mini',
          llmBaseUrl: (args.llmBaseUrl as string) || 'https://api.openai.com/v1',
        },
      };

      const result = await Promise.race([
        peel(url, options),
        timeout(60000, 'Summarize timed out'),
      ]) as any;

      return ok(safeStringify({
        url: result.url,
        title: result.title,
        summary: result.extracted,
      }));
    }

    // webpeel_answer
    if (name === 'webpeel_answer') {
      const question = args.question as string;
      const llmProvider = args.llmProvider as string;
      const llmApiKey = args.llmApiKey as string;
      if (!question || typeof question !== 'string') throw new Error('Invalid question');
      if (question.length > 2000) throw new Error('Question too long (max 2000 characters)');

      const validLlmProviders: LLMProviderId[] = ['openai', 'anthropic', 'google'];
      if (!llmProvider || !validLlmProviders.includes(llmProvider as LLMProviderId)) {
        throw new Error('Invalid llmProvider: must be openai, anthropic, or google');
      }
      if (!llmApiKey || typeof llmApiKey !== 'string') throw new Error('Invalid llmApiKey');

      const spId = (args.searchProvider as string) === 'brave' ? 'brave' : 'duckduckgo';
      const maxSources = typeof args.maxSources === 'number' ? Math.min(Math.max(args.maxSources, 1), 10) : 5;

      const result = await Promise.race([
        answerQuestion({
          question,
          searchProvider: spId as any,
          searchApiKey: args.searchApiKey as string | undefined,
          llmProvider: llmProvider as LLMProviderId,
          llmApiKey,
          llmModel: args.llmModel as string | undefined,
          maxSources,
          stream: false,
        }),
        timeout(180000, 'Answer timed out'),
      ]);

      return ok(safeStringify(result));
    }

    // webpeel_brand
    if (name === 'webpeel_brand') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (url.length > 2048) throw new Error('URL too long');

      const options: PeelOptions = {
        render: (args.render as boolean) || false,
        extract: {
          selectors: {
            primaryColor: 'meta[name="theme-color"]',
            title: 'title',
            logo: 'img[class*="logo"], img[alt*="logo"]',
          },
        },
      };

      const result = await Promise.race([
        peel(url, options),
        timeout(60000, 'Brand extraction timed out'),
      ]) as any;

      return ok(safeStringify({
        url: result.url,
        title: result.title,
        extracted: result.extracted,
        metadata: result.metadata,
        colors: extractColorsFromContent(result.content || ''),
        fonts: extractFontsFromContent(result.content || ''),
      }));
    }

    // webpeel_change_track
    if (name === 'webpeel_change_track') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (url.length > 2048) throw new Error('URL too long');

      const options: PeelOptions = {
        render: (args.render as boolean) || false,
      };

      const result = await Promise.race([
        peel(url, options),
        timeout(60000, 'Change tracking timed out'),
      ]) as any;

      return ok(safeStringify({
        url: result.url,
        title: result.title,
        fingerprint: result.fingerprint,
        tokens: result.tokens,
        contentType: result.contentType,
        lastChecked: new Date().toISOString(),
      }));
    }

    // webpeel_deep_fetch
    if (name === 'webpeel_deep_fetch') {
      const query = args.query as string;
      if (!query || typeof query !== 'string') throw new Error('Invalid query');

      const count = Math.min(Math.max((args.count as number) || 5, 1), 10);
      const format = (args.format as 'markdown' | 'text') || 'markdown';

      // Step 1: Search for the query using best available provider
      const { getBestSearchProvider } = await import('../../core/search-provider.js');
      const { provider, apiKey } = getBestSearchProvider();
      const searchResults = await Promise.race([
        provider.searchWeb(query, { count, apiKey }),
        timeout(30000, 'Search timed out'),
      ]) as any;

      const results = searchResults?.results ?? searchResults ?? [];
      const topResults = Array.isArray(results) ? results.slice(0, count) : [];

      if (topResults.length === 0) {
        return ok(safeStringify({ query, sources: [], content: '', totalTokens: 0 }));
      }

      // Step 2: Fetch all URLs in parallel
      const urls = topResults.map((r: any) => r.url).filter(Boolean);
      const pages = await Promise.race([
        peelBatch(urls, { concurrency: 5, format }),
        timeout(120000, 'Batch fetch timed out'),
      ]) as any[];

      // Step 3: Merge content with source attribution
      const sources: Array<{ url: string; title: string }> = [];
      const contentParts: string[] = [];
      let totalTokens = 0;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i] as any;
        const searchResult = topResults[i] as any;
        const url = urls[i];
        const title = page?.title || searchResult?.title || url;

        sources.push({ url, title });

        if (page?.content) {
          contentParts.push(`## Source ${i + 1}: ${title}\n**URL:** ${url}\n\n${page.content}\n\n---\n`);
          totalTokens += page.tokens || 0;
        } else if (page?.error) {
          contentParts.push(`## Source ${i + 1}: ${title}\n**URL:** ${url}\n\n*(Failed to fetch: ${page.error})*\n\n---\n`);
        }
      }

      const mergedContent = contentParts.join('\n');

      return ok(safeStringify({
        query,
        sources,
        content: mergedContent,
        totalTokens,
      }));
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const err = error as Error;
    return {
      content: [{ type: 'text', text: safeStringify({ error: err.name || 'Error', message: err.message || 'Unknown error' }) }],
      isError: true,
    };
  }
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function timeout(ms: number, msg: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}

// ---------------------------------------------------------------------------
// Create a fresh MCP server instance (stateless — one per request)
// ---------------------------------------------------------------------------

function createMcpServer(): Server {
  const server = new Server(
    { name: 'webpeel', version: pkgVersion },
    { capabilities: { tools: {} } },
  );

  const tools = getTools();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>);
  });

  return server;
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared MCP handler logic
// ---------------------------------------------------------------------------

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  // Require authentication — reject unauthenticated requests.
  // The /:apiKey/v2/mcp path validates the key before calling this handler.
  // The /mcp and /v2/mcp paths rely on the global auth middleware (Bearer token).
  if (!req.auth?.keyInfo) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Authentication required. Pass API key via Authorization: Bearer <key> header or use /:apiKey/v2/mcp path.' },
      id: null,
    });
    return;
  }

  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    // Connect server ↔ transport
    await server.connect(transport);

    // Delegate to transport — it reads the JSON-RPC body and writes the response.
    // We pass req.body as the pre-parsed body (Express already parsed JSON).
    await transport.handleRequest(
      req as unknown as IncomingMessage & { auth?: any },
      res as unknown as ServerResponse,
      req.body,
    );

    // Clean up (don't await — fire and forget)
    transport.close().catch(() => {});
    server.close().catch(() => {});
  } catch (error: any) {
    console.error('MCP endpoint error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      });
    }
  }
}

function mcpMethodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed. Use POST to send MCP JSON-RPC messages.',
    },
    id: null,
  });
}

function mcpDeleteOk(_req: Request, res: Response): void {
  res.status(200).json({ ok: true });
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------

export function createMcpRouter(authStore?: AuthStore): Router {
  const router = Router();

  // POST /mcp — legacy path, MCP Streamable HTTP transport
  router.post('/mcp', handleMcpPost);
  router.get('/mcp', mcpMethodNotAllowed);
  router.delete('/mcp', mcpDeleteOk);

  // POST /v2/mcp — canonical v2 path; auth via Authorization: Bearer <key> header
  // The global auth middleware already validates the Bearer token, so no extra
  // validation is needed here.
  router.post('/v2/mcp', handleMcpPost);
  router.get('/v2/mcp', mcpMethodNotAllowed);
  router.delete('/v2/mcp', mcpDeleteOk);

  // POST /:apiKey/v2/mcp — Firecrawl-style: API key embedded in URL path
  // e.g. https://api.webpeel.dev/wbp_abc123/v2/mcp
  // Validate the key ourselves since the global middleware only reads headers.
  router.post('/:apiKey/v2/mcp', async (req: Request, res: Response) => {
    const { apiKey } = req.params;

    // Basic format guard — reject obviously malformed keys early
    if (!apiKey || apiKey.length < 8) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Invalid API key' },
        id: null,
      });
      return;
    }

    // If we have an authStore, validate the key
    if (authStore) {
      try {
        const keyInfo = await authStore.validateKey(String(apiKey));
        if (!keyInfo) {
          res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Invalid or expired API key' },
            id: null,
          });
          return;
        }
        // Inject auth info so downstream tools can use it
        req.auth = {
          keyInfo,
          tier: (keyInfo.tier ?? 'free') as 'free' | 'starter' | 'pro' | 'enterprise' | 'max',
          rateLimit: 100,
          softLimited: false,
          extraUsageAvailable: false,
        };
      } catch (err) {
        console.error('MCP auth error:', err);
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        });
        return;
      }
    }

    return handleMcpPost(req, res);
  });

  router.get('/:apiKey/v2/mcp', mcpMethodNotAllowed);
  router.delete('/:apiKey/v2/mcp', mcpDeleteOk);

  return router;
}
