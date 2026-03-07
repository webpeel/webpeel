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
import '../types.js'; // Augments Express.Request with requestId
import type { Pool } from 'pg';
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
import { quickAnswer } from '../../core/quick-answer.js';
import { getBestSearchProvider } from '../../core/search-provider.js';
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
// Tool definitions — 7 consolidated tools (matches src/mcp/server.ts)
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: 'webpeel',
      description:
        "Your complete web toolkit. Describe what you want in plain language. " +
        "Examples: 'read https://stripe.com', 'screenshot bbc.com on mobile', " +
        "'find best AI frameworks', 'extract prices from stripe.com/pricing', " +
        "'watch stripe.com/pricing for changes'",
      annotations: { title: 'WebPeel Smart Web Tool', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          task: { type: 'string', description: 'Plain English description of what you want to do with the web.' },
        },
        required: ['task'],
      },
    },
    {
      name: 'webpeel_read',
      description: 'Read any URL and return clean markdown. Handles web pages, YouTube videos, and PDFs automatically. Use question= for Q&A about the page, summary=true for a summary.',
      annotations: { title: 'Read Web Page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          format: { type: 'string', enum: ['markdown', 'text', 'html'], description: 'Output format (default: markdown)', default: 'markdown' },
          render: { type: 'boolean', description: 'Force browser rendering for JS-heavy sites', default: false },
          question: { type: 'string', description: 'Ask a question about the page content (BM25, no LLM needed)' },
          summary: { type: 'boolean', description: 'Return a summary instead of full content', default: false },
          budget: { type: 'number', description: 'Smart token budget — distill content to N tokens' },
          readable: { type: 'boolean', description: 'Reader mode — extract only article content', default: false },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_see',
      description: "See any page visually. Returns a screenshot. Use mode='design' for design analysis, mode='compare' with compare_url for visual comparison.",
      annotations: { title: 'See Page Visually', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to screenshot' },
          mode: { type: 'string', enum: ['screenshot', 'design', 'compare'], description: "Mode: 'screenshot' (default), 'design' (analysis), 'compare' (visual diff)", default: 'screenshot' },
          compare_url: { type: 'string', description: "Second URL to compare against (for mode='compare')" },
          viewport: { type: 'string', enum: ['mobile', 'tablet', 'desktop'], description: 'Viewport size preset' },
          full_page: { type: 'boolean', description: 'Capture the full scrollable page', default: false },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_find',
      description: "Find anything on the web. Pass a query to search, or a url to discover all pages on that domain. Use depth='deep' for multi-source research.",
      annotations: { title: 'Find on the Web', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
          url: { type: 'string', description: 'Domain URL to map/discover all pages' },
          depth: { type: 'string', enum: ['quick', 'deep'], description: "Search depth: 'quick' = single search, 'deep' = multi-source research", default: 'quick' },
          limit: { type: 'number', description: 'Max results to return (default: 5)', default: 5 },
        },
      },
    },
    {
      name: 'webpeel_extract',
      description: "Extract structured data from any URL. Pass fields=['price','title'] for specific data, or omit for auto-detection. Returns typed JSON.",
      annotations: { title: 'Extract Structured Data', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to extract from' },
          schema: { type: 'object', description: 'JSON schema describing desired output structure' },
          fields: { type: 'array', items: { type: 'string' }, description: "Specific fields to extract, e.g. ['price', 'title', 'description']" },
          format: { type: 'string', enum: ['json', 'markdown'], description: 'Output format (default: json)', default: 'json' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_monitor',
      description: 'Watch a URL for changes. Returns diff on subsequent calls. Add webhook= for persistent monitoring with notifications.',
      annotations: { title: 'Monitor URL for Changes', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to monitor' },
          webhook: { type: 'string', description: 'Webhook URL to notify when content changes' },
          interval: { type: 'string', description: "Check interval, e.g. '1h', '30m', '1d'", default: '1h' },
          selector: { type: 'string', description: 'CSS selector to monitor a specific part of the page' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_act',
      description: 'Interact with a web page. Click buttons, fill forms, navigate. Returns screenshot + extracted content after actions complete.',
      annotations: { title: 'Act on Web Page', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to interact with' },
          actions: {
            type: 'array',
            description: 'Actions to perform, e.g. [{type:"click",selector:".btn"}, {type:"type",selector:"#q",value:"hello"}]',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['click', 'type', 'fill', 'scroll', 'wait', 'press', 'hover', 'select'] },
                selector: { type: 'string' },
                value: { type: 'string' },
                key: { type: 'string' },
                milliseconds: { type: 'number' },
              },
              required: ['type'],
            },
          },
          extract_after: { type: 'boolean', description: 'Extract content after actions complete', default: true },
          screenshot_after: { type: 'boolean', description: 'Take screenshot after actions complete', default: false },
        },
        required: ['url', 'actions'],
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

async function handleToolCall(name: string, args: Record<string, unknown>, pool?: Pool | null, req?: Request): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
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
        readable: (args.readable as boolean) || false,
        lite: (args.lite as boolean) || false,
        budget: args.budget as number | undefined,
        question: args.question as string | undefined,
        screenshot: (args.screenshot as boolean) || false,
        actions: parsedActions,
      };

      // Auto-budget: default to 4000 tokens for MCP when no budget specified
      // Lite mode disables auto-budget
      if (options.budget === undefined && !options.lite) {
        options.budget = 4000;
      }

      // Cache key and bypass logic
      const mcpNoCache = args.noCache === true;
      const mcpCacheTtlMs = typeof args.cacheTtl === 'number' ? (args.cacheTtl as number) * 1000 : 5 * 60 * 1000;
      const mcpActionsKey = parsedActions ? JSON.stringify(parsedActions) : '';
      const mcpCacheKey = `mcp:fetch:${url}:${options.render}:${options.wait}:${options.format}:${options.selector}:${options.images}:${mcpActionsKey}:${options.budget}`;

      // Check cache (skip for noCache or inline extraction requests)
      const hasInlineExtract = args.inlineExtract && ((args.inlineExtract as any).schema || (args.inlineExtract as any).prompt);
      if (!mcpNoCache && !hasInlineExtract) {
        const cached = mcpFetchCache.get(mcpCacheKey);
        if (cached) {
          const cacheAge = Date.now() - cached.timestamp;
          if (cacheAge < mcpCacheTtlMs) {
            const r = cached.result;
            const cachedOutput: Record<string, any> = {
              url: r.url || url,
              title: r.title || r.metadata?.title || '',
              tokens: r.tokens || 0,
              content: r.content,
              _cache: 'HIT',
              _cacheAge: Math.floor(cacheAge / 1000),
            };
            if (r.metadata && Object.keys(r.metadata).length > 0) cachedOutput.metadata = r.metadata;
            if (r.domainData) cachedOutput.domainData = r.domainData;
            if (r.readability) cachedOutput.readability = { readingTime: r.readability.readingTime, wordCount: r.readability.wordCount };
            if (r.quickAnswer) cachedOutput.quickAnswer = r.quickAnswer;
            if (r.json) cachedOutput.json = r.json;
            if (r.extracted) cachedOutput.extracted = r.extracted;
            if (r.images && r.images.length > 0) cachedOutput.images = r.images;
            if (r.screenshot) cachedOutput.screenshot = r.screenshot;
            if (r.fingerprint) cachedOutput.fingerprint = r.fingerprint;
            if (r.linkCount !== undefined) cachedOutput.linkCount = r.linkCount;
            if (r.quality !== undefined) cachedOutput.quality = r.quality;
            if (r.timing) cachedOutput.timing = r.timing;
            if (r.method) cachedOutput.method = r.method;
            if (r.freshness) cachedOutput.freshness = r.freshness;
            if (r.prunedPercent !== undefined) cachedOutput.prunedPercent = r.prunedPercent;
            return ok(safeStringify(cachedOutput));
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

      // Build consistent output — always include url, title, tokens
      const output: Record<string, any> = {
        url: result.url || url,
        title: result.title || result.metadata?.title || '',
        tokens: result.tokens || 0,
        content: result.content,
      };
      if (result.metadata && Object.keys(result.metadata).length > 0) output.metadata = result.metadata;
      if (result.domainData) output.domainData = result.domainData;
      if (result.readability) output.readability = {
        readingTime: result.readability.readingTime,
        wordCount: result.readability.wordCount,
      };
      if (result.quickAnswer) output.quickAnswer = result.quickAnswer;
      if (result.json) output.json = result.json;
      if (result.extracted) output.extracted = result.extracted;
      if (result.images && result.images.length > 0) output.images = result.images;
      if (result.screenshot) output.screenshot = result.screenshot;
      if (result.fingerprint) output.fingerprint = result.fingerprint;
      if (result.extractTokensUsed) output.extractTokensUsed = result.extractTokensUsed;
      if (result._cache) output._cache = result._cache;
      if (result._cacheAge !== undefined) output._cacheAge = result._cacheAge;
      if (result.linkCount !== undefined) output.linkCount = result.linkCount;
      if (result.quality !== undefined) output.quality = result.quality;
      if (result.timing) output.timing = result.timing;
      if (result.method) output.method = result.method;
      if (result.freshness) output.freshness = result.freshness;
      if (result.prunedPercent !== undefined) output.prunedPercent = result.prunedPercent;

      return ok(safeStringify(output));
    }

    // webpeel_search
    if (name === 'webpeel_search') {
      const query = args.query as string;
      if (!query || typeof query !== 'string') throw new Error('Invalid query');

      const { getBestSearchProvider } = await import('../../core/search-provider.js');
      const { provider, apiKey } = getBestSearchProvider();
      const count = Math.min(Math.max((args.count as number) || 5, 1), 10);
      const rawResults = await Promise.race([
        provider.searchWeb(query, { count, apiKey }),
        timeout(30000, 'Search timed out'),
      ]) as any;

      // Normalize to consistent format
      const resultsList = Array.isArray(rawResults) ? rawResults : (rawResults?.results ?? []);
      const normalizedResults = resultsList.map((r: any) => ({
        title: r.title || '',
        url: r.url || r.link || '',
        snippet: r.snippet || r.description || r.body || '',
        ...(r.favicon ? { favicon: r.favicon } : {}),
      }));

      return ok(safeStringify({ query, count: normalizedResults.length, results: normalizedResults }));
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

    // agent — LLM-free data agent: search + fetch + BM25 extraction
    if (name === 'agent') {
      const llmApiKey = args.llmApiKey as string | undefined;

      // LLM mode: delegate to existing runAgent
      if (llmApiKey) {
        const prompt = args.prompt as string;
        if (!prompt || typeof prompt !== 'string') throw new Error('Missing prompt for LLM agent mode');
        const result = await Promise.race([
          runAgent({
            prompt,
            llmApiKey,
            urls: args.urls as string[] | undefined,
            llmModel: args.llmModel as string | undefined,
            maxSources: (args.maxResults as number) || (args.maxSources as number) || undefined,
          }),
          timeout(180000, 'Agent timed out'),
        ]);
        return ok(safeStringify(result));
      }

      // LLM-free mode: search + fetch + BM25 quickAnswer
      const urls = (args.urls as string[]) || [];
      const search = args.search as string | undefined;
      if ((!urls || urls.length === 0) && !search) {
        throw new Error('Provide at least "urls" or "search". For LLM-powered research, also pass "llmApiKey".');
      }

      const prompt = args.prompt as string | undefined;
      const schema = args.schema as Record<string, string> | undefined;
      const budget = (args.budget as number) || 4000;
      const maxResults = Math.min((args.maxResults as number) || 5, 20);

      const targetUrls: string[] = [...urls];
      if (search) {
        try {
          const { provider, apiKey } = getBestSearchProvider();
          const searchResults = await provider.searchWeb(search, { count: Math.max(maxResults, 5), apiKey });
          for (const r of searchResults) {
            if (!targetUrls.includes(r.url)) targetUrls.push(r.url);
          }
        } catch { /* continue with provided URLs */ }
      }

      const urlsToFetch = targetUrls.slice(0, maxResults);
      const agentResults: Array<{ url: string; title: string; extracted: Record<string, string> | null; content: string; confidence: number }> = [];

      await Promise.all(urlsToFetch.map(async (url) => {
        try {
          const page = await peel(url, { budget, format: 'markdown' });
          const content = page.content || '';
          const title = page.title || url;
          let extracted: Record<string, string> | null = null;
          let confidence = 0;

          if (schema && Object.keys(schema).length > 0) {
            extracted = {};
            let total = 0;
            for (const [field] of Object.entries(schema)) {
              const question = prompt ? `${prompt} — specifically: what is the ${field}?` : `What is the ${field}?`;
              const qa = quickAnswer({ question, content, maxPassages: 1, url });
              extracted[field] = qa.answer || '';
              total += qa.confidence;
            }
            if ('source' in schema) extracted['source'] = url;
            confidence = Object.keys(schema).length > 0 ? total / Object.keys(schema).length : 0;
          } else if (prompt) {
            const qa = quickAnswer({ question: prompt, content, maxPassages: 3, url });
            confidence = qa.confidence;
          }

          agentResults.push({ url, title, extracted, content: content.slice(0, 500) + (content.length > 500 ? '…' : ''), confidence });
        } catch { /* skip */ }
      }));

      return ok(safeStringify({
        success: true,
        data: { results: agentResults, totalSources: agentResults.length },
      }));
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

    // webpeel_design_analysis
    if (name === 'webpeel_design_analysis') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (url.length > 2048) throw new Error('URL too long');

      const { takeDesignAnalysis } = await import('../../core/screenshot.js');
      const result = await Promise.race([
        takeDesignAnalysis(url, {}),
        timeout(90000, 'Design analysis timed out'),
      ]) as any;

      return ok(safeStringify({
        url: result.url,
        analysis: result.analysis,
      }));
    }

    // webpeel_design_compare
    if (name === 'webpeel_design_compare') {
      const url1 = args.url1 as string;
      const url2 = args.url2 as string;
      if (!url1 || typeof url1 !== 'string') throw new Error('Invalid url1');
      if (!url2 || typeof url2 !== 'string') throw new Error('Invalid url2');
      if (url1.length > 2048) throw new Error('url1 too long');
      if (url2.length > 2048) throw new Error('url2 too long');
      if (url1 === url2) throw new Error('url1 and url2 must be different URLs');

      const { takeDesignComparison } = await import('../../core/screenshot.js');
      const result = await Promise.race([
        takeDesignComparison(url1, url2, {}),
        timeout(120000, 'Design comparison timed out'),
      ]) as any;

      return ok(safeStringify({
        subjectUrl: result.subjectUrl,
        referenceUrl: result.referenceUrl,
        score: result.comparison.score,
        summary: result.comparison.summary,
        gaps: result.comparison.gaps,
        subjectAnalysis: result.comparison.subjectAnalysis,
        referenceAnalysis: result.comparison.referenceAnalysis,
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

      const _validSearchProviders = ['duckduckgo', 'brave', 'stealth', 'google'];
      const spId = _validSearchProviders.includes(args.searchProvider as string)
        ? (args.searchProvider as string)
        : 'duckduckgo';
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
      const rawFormat = (args.format as string) || 'markdown';
      const isComparison = rawFormat === 'comparison';
      const format = (isComparison ? 'markdown' : rawFormat) as 'markdown' | 'text';

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
      const sources: Array<{ url: string; title: string; relevanceScore: number; snippet?: string }> = [];
      const contentParts: string[] = [];
      let totalTokens = 0;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i] as any;
        const searchResult = topResults[i] as any;
        const pageUrl = urls[i];
        const title = page?.title || searchResult?.title || pageUrl;
        // Position-based relevance score (top result = 1.0, decreasing)
        const relevanceScore = Math.round((1 - i / Math.max(pages.length, 1)) * 100) / 100;

        sources.push({ url: pageUrl, title, relevanceScore, ...(searchResult?.snippet ? { snippet: searchResult.snippet } : {}) });

        if (page?.content) {
          contentParts.push(`## Source ${i + 1}: ${title}\n**URL:** ${pageUrl}\n\n${page.content}\n\n---\n`);
          totalTokens += page.tokens || 0;
        } else if (page?.error) {
          contentParts.push(`## Source ${i + 1}: ${title}\n**URL:** ${pageUrl}\n\n*(Failed to fetch: ${page.error})*\n\n---\n`);
        }
      }

      const mergedContent = contentParts.join('\n');

      const deepFetchOutput: Record<string, any> = {
        query,
        sources,
        content: mergedContent,
        totalTokens,
      };

      // For comparison format, add a structured comparison hint
      if (isComparison) {
        deepFetchOutput.format = 'comparison';
        deepFetchOutput.comparisonNote = 'Sources fetched and ranked by relevance. Review sources array and content sections for side-by-side comparison.';
      }

      return ok(safeStringify(deepFetchOutput));
    }

    // webpeel_quick_answer
    if (name === 'webpeel_quick_answer') {
      const url = args.url as string;
      const question = args.question as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      if (url.length > 2048) throw new Error('URL too long');
      if (!question || typeof question !== 'string') throw new Error('Invalid question');
      if (question.length > 1000) throw new Error('Question too long (max 1000 characters)');

      const maxPassages = typeof args.maxPassages === 'number' ? Math.min(Math.max(args.maxPassages, 1), 10) : 3;

      const peelResult = await Promise.race([
        peel(url, {
          render: (args.render as boolean) || false,
          format: 'markdown',
          budget: 8000,
        }),
        timeout(60000, 'Quick answer fetch timed out'),
      ]) as any;

      const { quickAnswer } = await import('../../core/quick-answer.js');
      const qa = quickAnswer({
        question,
        content: peelResult.content || '',
        url: peelResult.url || url,
        maxPassages,
      });

      return ok(safeStringify({
        url: peelResult.url || url,
        title: peelResult.title,
        question: qa.question,
        answer: qa.answer,
        confidence: qa.confidence,
        passages: qa.passages,
        method: qa.method,
      }));
    }

    // webpeel_youtube
    if (name === 'webpeel_youtube') {
      const url = args.url as string;
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');

      const { getYouTubeTranscript } = await import('../../core/youtube.js');
      const transcript = await Promise.race([
        getYouTubeTranscript(url, {
          language: (args.language as string | undefined) ?? 'en',
        }),
        timeout(60000, 'YouTube transcript extraction timed out'),
      ]);
      return ok(safeStringify(transcript));
    }

    // webpeel_auto_extract
    if (name === 'webpeel_auto_extract') {
      const url = args.url as string;
      if (!url) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Missing url parameter' }) }] };
      const { autoExtract } = await import('../../core/auto-extract.js');
      const result = await peel(url, { format: 'html' });
      const extracted = autoExtract(result.content || '', url);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          url,
          pageType: extracted.type,
          structured: extracted,
        }, null, 2) }],
      };
    }

    // webpeel_watch
    if (name === 'webpeel_watch') {
      const action = args.action as string;
      if (!pool) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Watch feature requires database connection. Use the REST API at /v1/watch instead.' }) }] };
      }
      const { WatchManager } = await import('../../core/watch-manager.js');
      const wm = new WatchManager(pool);
      const accountId = (req as any)?.auth?.keyInfo?.accountId || (req as any)?.auth?.keyInfo?.userId || 'anonymous';

      if (action === 'create') {
        const watch = await wm.create(
          accountId,
          args.url as string,
          {
            webhookUrl: args.webhookUrl as string | undefined,
            checkIntervalMinutes: (args.intervalMinutes as number) || 60,
            selector: args.selector as string | undefined,
          },
        );
        return { content: [{ type: 'text', text: JSON.stringify(watch, null, 2) }] };
      }
      if (action === 'list') {
        const watches = await wm.list(accountId);
        return { content: [{ type: 'text', text: JSON.stringify(watches, null, 2) }] };
      }
      if (action === 'check') {
        const result = await wm.check(args.id as string);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      if (action === 'delete') {
        await wm.delete(args.id as string);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown watch action: ${action}` }) }] };
    }

    // webpeel_hotels
    if (name === 'webpeel_hotels') {
      const { searchHotels, parseDate, addDays } = await import('../../core/hotel-search.js');
      const destination = args.destination as string;
      if (!destination) return { content: [{ type: 'text', text: safeStringify({ error: 'Missing destination' }) }] };
      const checkin = args.checkin ? parseDate(args.checkin as string) : parseDate('tomorrow');
      const checkout = args.checkout ? parseDate(args.checkout as string) : addDays(checkin, 1);
      const sort = (['price', 'rating', 'value'].includes(args.sort as string) ? args.sort : 'price') as 'price' | 'rating' | 'value';
      const limit = Math.max(1, Math.min(50, (args.limit as number) || 20));
      const result = await searchHotels({ destination, checkin, checkout, sort, limit, stealth: true });
      return { content: [{ type: 'text', text: safeStringify({ destination, checkin, checkout, sources: result.sources, count: result.results.length, results: result.results.slice(0, limit) }) }] };
    }

    // webpeel_act — page interaction (click, fill, scroll, screenshot)
    if (name === 'webpeel_act') {
      const url = args.url as string;
      const actions = (args.actions as any[]) || [];
      const extract = args.extract !== false;
      const screenshot = Boolean(args.screenshot);

      if (!url) return { content: [{ type: 'text', text: safeStringify({ error: 'url is required' }) }] };
      if (!actions.length) return { content: [{ type: 'text', text: safeStringify({ error: 'actions array is required' }) }] };

      const { peel } = await import('../../index.js');
      const { normalizeActions } = await import('../../core/actions.js');
      const normalized = normalizeActions(actions) || [];

      const result = await peel(url, {
        render: true,
        actions: normalized,
        screenshot,
        format: 'markdown',
        budget: 4000,
        timeout: 25000,
      });

      return {
        content: [{
          type: 'text',
          text: safeStringify({
            url: result.url,
            title: result.title,
            content: extract ? result.content : undefined,
            screenshot: result.screenshot,
            method: result.method,
            elapsed: result.elapsed,
          }),
        }],
      };
    }

    // ── Consolidated tools (route to existing specific handlers) ──
    // These are the 7 new public tools that map to the 20+ legacy handlers.

    // webpeel_read → webpeel_fetch (with YouTube auto-detect)
    if (name === 'webpeel_read') {
      const url = args.url as string;
      if (!url) return { content: [{ type: 'text', text: safeStringify({ error: 'url is required' }) }] };

      // YouTube auto-detect
      const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        // Route to YouTube handler
        const { getYouTubeTranscript } = await import('../../core/youtube.js');
        const transcript = await getYouTubeTranscript(url, { language: (args.language as string) || 'en' });
        return { content: [{ type: 'text', text: safeStringify(transcript) }] };
      }

      // Standard fetch
      const { peel } = await import('../../index.js');
      const result = await peel(url, {
        render: Boolean(args.render),
        format: ((args.format as string) || 'markdown') as 'markdown' | 'html' | 'text' | 'clean',
        budget: (args.budget as number) || 4000,
        readable: Boolean(args.readable),
        summary: Boolean(args.summary),
        timeout: 30000,
      });

      const response: Record<string, unknown> = {
        url: result.url,
        title: result.title,
        content: result.content,
        tokens: result.tokens,
        method: result.method,
        elapsed: result.elapsed,
      };
      if (args.question && result.content) {
        const { quickAnswer } = await import('../../core/quick-answer.js');
        const qa = quickAnswer({ content: result.content, question: args.question as string, url: result.url });
        response.answer = qa.answer;
        response.confidence = qa.confidence;
      }
      if (args.summary && result.content) {
        response.summary = result.content.slice(0, 500);
      }
      return { content: [{ type: 'text', text: safeStringify(response) }] };
    }

    // webpeel_see → screenshot / design analysis / design compare
    if (name === 'webpeel_see') {
      const url = args.url as string;
      if (!url) return { content: [{ type: 'text', text: safeStringify({ error: 'url is required' }) }] };

      const mode = (args.mode as string) || 'screenshot';
      const compareUrl = args.compare_url as string | undefined;

      // Resolve viewport
      let width = 1280, height = 720;
      if (args.viewport === 'mobile') { width = 390; height = 844; }
      else if (args.viewport === 'tablet') { width = 768; height = 1024; }
      else if (args.viewport && typeof args.viewport === 'object') {
        const vp = args.viewport as { width?: number; height?: number };
        width = vp.width ?? 1280;
        height = vp.height ?? 720;
      }

      if (mode === 'design') {
        const { takeDesignAnalysis } = await import('../../core/screenshot.js');
        const analysis = await takeDesignAnalysis(url, { width, height });
        return { content: [{ type: 'text', text: safeStringify(analysis) }] };
      }

      if (mode === 'compare' && compareUrl) {
        const { takeDesignComparison } = await import('../../core/screenshot.js');
        const comparison = await takeDesignComparison(url, compareUrl, {});
        return { content: [{ type: 'text', text: safeStringify(comparison) }] };
      }

      // Default: screenshot
      const { peel } = await import('../../index.js');
      const result = await peel(url, {
        render: true,
        screenshot: true,
        fullPage: Boolean(args.full_page),
        timeout: 30000,
      });
      return { content: [{ type: 'text', text: safeStringify({ url: result.url, title: result.title, screenshot: result.screenshot }) }] };
    }

    // webpeel_find → search (query) or map (url without query)
    if (name === 'webpeel_find') {
      const query = args.query as string | undefined;
      const url = args.url as string | undefined;
      const limit = Math.min(Math.max((args.limit as number) ?? 5, 1), 20);

      // URL-only: map domain
      if (url && !query) {
        const { mapDomain } = await import('../../core/map.js');
        const results = await mapDomain(url, { maxUrls: limit * 100 });
        return { content: [{ type: 'text', text: safeStringify(results) }] };
      }

      if (!query) return { content: [{ type: 'text', text: safeStringify({ error: 'Either query or url is required' }) }] };

      // Question detection → BM25 Q&A (like /v1/ask)
      const isQuestion = /\?$/.test(query.trim()) ||
        /^(what|how|when|where|why|who|which|can|does|is|are|do|did|will|would|could|should)\b/i.test(query.trim());

      if (isQuestion) {
        const { getBestSearchProvider: getBSP } = await import('../../core/search-provider.js');
        const { provider, apiKey: sKey } = getBSP();
        const searchResults = await provider.searchWeb(query, { count: Math.min(limit, 5), apiKey: sKey });
        if (searchResults.length > 0) {
          const { peel } = await import('../../index.js');
          const topUrl = searchResults[0].url;
          const result = await peel(topUrl, { budget: 4000, timeout: 15000 });
          const { quickAnswer } = await import('../../core/quick-answer.js');
          const answer = quickAnswer({ content: result.content || '', question: query, url: topUrl });
          return { content: [{ type: 'text', text: safeStringify({ question: query, answer: answer.answer, confidence: answer.confidence, sources: searchResults.slice(0, 3).map((r: any) => ({ url: r.url, title: r.title })), method: 'bm25' }) }] };
        }
      }

      // Regular search
      const { getBestSearchProvider: getBSP2 } = await import('../../core/search-provider.js');
      const { provider: sp, apiKey: sk } = getBSP2();
      const results = await sp.searchWeb(query, { count: limit, apiKey: sk });
      return { content: [{ type: 'text', text: safeStringify({ query, results: results.slice(0, limit) }) }] };
    }

    // webpeel_monitor → watch/change detection
    if (name === 'webpeel_monitor') {
      const url = args.url as string;
      if (!url) return { content: [{ type: 'text', text: safeStringify({ error: 'url is required' }) }] };

      const webhook = args.webhook as string | undefined;
      if (webhook) {
        return { content: [{ type: 'text', text: safeStringify({ message: 'Persistent webhook monitoring requires the hosted API. Use webpeel_monitor without webhook= for one-time change detection.', url }) }] };
      }

      // One-time change snapshot
      const { peel } = await import('../../index.js');
      const result = await peel(url, {
        render: Boolean(args.render),
        ...(args.selector ? { selector: args.selector as string } : {}),
        timeout: 30000,
      });
      return {
        content: [{
          type: 'text',
          text: safeStringify({
            url: result.url,
            title: result.title,
            content: result.content?.slice(0, 2000),
            tokens: result.tokens,
            snapshot_at: new Date().toISOString(),
            tip: 'Call again later to compare content manually, or use webhook= for persistent monitoring.',
          }),
        }],
      };
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

function createMcpServer(pool?: Pool | null, req?: Request): Server {
  const server = new Server(
    { name: 'webpeel', version: pkgVersion },
    { capabilities: { tools: {} } },
  );

  const tools = getTools();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>, pool, req);
  });

  return server;
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared MCP handler logic
// ---------------------------------------------------------------------------

async function handleMcpPost(req: Request, res: Response, pool?: Pool | null): Promise<void> {
  // Require authentication — reject unauthenticated requests.
  // The /:apiKey/v2/mcp path validates the key before calling this handler.
  // The /mcp and /v2/mcp paths rely on the global auth middleware (Bearer token).
  const mcpAuthId = req.auth?.keyInfo?.accountId || (req as any).user?.userId;
  if (!mcpAuthId) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Authentication required. Pass API key via Authorization: Bearer <key> header or use /:apiKey/v2/mcp path.' },
      id: null,
    });
    return;
  }

  try {
    const server = createMcpServer(pool, req);
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

export function createMcpRouter(_authStore?: AuthStore, pool?: Pool | null): Router {
  const router = Router();
  const boundHandler = (req: Request, res: Response) => handleMcpPost(req, res, pool);

  // POST /mcp — legacy path, MCP Streamable HTTP transport
  router.post('/mcp', boundHandler);
  router.get('/mcp', mcpMethodNotAllowed);
  router.delete('/mcp', mcpDeleteOk);

  // POST /v2/mcp — canonical v2 path; auth via Authorization: Bearer <key> header
  // The global auth middleware already validates the Bearer token, so no extra
  // validation is needed here.
  router.post('/v2/mcp', boundHandler);
  router.get('/v2/mcp', mcpMethodNotAllowed);
  router.delete('/v2/mcp', mcpDeleteOk);

  // SECURITY: /:apiKey/v2/mcp — BLOCKED. API keys in URLs are insecure because
  // they get recorded in server logs, browser history, and proxy access logs.
  // All methods return 400 with instructions to use the Authorization header.
  const mcpInsecureAuthHandler = (req: Request, res: Response): void => {
    res.status(400).json({
      success: false,
      error: {
        type: 'insecure_auth',
        message: 'API keys in URLs are insecure.',
        hint: 'Use the Authorization header instead: Authorization: Bearer wp_your_key',
        docs: 'https://webpeel.dev/docs/api-reference#authentication',
      },
      requestId: req.requestId,
    });
  };

  router.post('/:apiKey/v2/mcp', mcpInsecureAuthHandler);
  router.get('/:apiKey/v2/mcp', mcpInsecureAuthHandler);
  router.delete('/:apiKey/v2/mcp', mcpInsecureAuthHandler);

  return router;
}
