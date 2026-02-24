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
      description: 'Fetch any URL and return clean markdown content. Use budget=4000 to get token-efficient output (strips boilerplate, compresses tables). Handles JavaScript rendering and bot detection automatically. Use readable=true for article-only content, question="..." for instant Q&A.',
      annotations: { title: 'Fetch Web Page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          format: { type: 'string', enum: ['markdown', 'html', 'text'], description: 'Output format (default: markdown)', default: 'markdown' },
          render: { type: 'boolean', description: 'Use browser rendering for JavaScript-heavy sites', default: false },
          stealth: { type: 'boolean', description: 'Stealth mode for bot-protected sites (Amazon, LinkedIn, etc.)', default: false },
          readable: { type: 'boolean', description: 'Reader mode — extract only article content, strip all noise', default: false },
          question: { type: 'string', description: 'Ask a question about the content (BM25, no LLM needed). Returns the most relevant passages.' },
          budget: { type: 'number', description: 'Smart token budget — distill content to N tokens' },
          selector: { type: 'string', description: 'CSS selector to extract specific content' },
          screenshot: { type: 'boolean', description: 'Also take a screenshot', default: false },
          wait: { type: 'number', description: 'Milliseconds to wait for dynamic content', default: 0 },
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
      description: 'Search the web and return structured results with titles, URLs, and snippets. No API key needed.',
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
      description: 'Crawl a website starting from a URL. Returns content for all discovered pages up to the specified depth/limit.',
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
      description: 'Discover all URLs on a domain via sitemap and link crawling. Returns a structured URL list.',
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
      description: 'Extract structured data from a URL using CSS selectors, JSON Schema, or LLM. Returns typed key-value pairs.',
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
      description: 'Fetch multiple URLs concurrently. Pass an array of URLs, get back an array of results.',
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
      description: 'Multi-step web research: searches the web, fetches top sources, follows leads, and synthesizes findings into a report with citations.',
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
      description: 'Take a screenshot of any URL. Returns a PNG image. Supports full-page capture and viewport sizing.',
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
      description: 'Generate an AI summary of a URL\'s content. Requires an LLM API key (BYOK).',
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
      description: 'Ask a question about a URL and get an AI-generated answer with citations. Requires an LLM API key (BYOK). For LLM-free Q&A, use webpeel_quick_answer instead.',
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
      description: 'Extract branding assets from a URL: logo, colors, fonts, and social links.',
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
      description: 'Track content changes on a URL. First call saves a snapshot, subsequent calls show what changed.',
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
      description: 'Search + fetch + analyze in one call. Fetches multiple sources for a query, scores by relevance, deduplicates facts, and merges into structured intelligence. No LLM key needed. Supports \'comparison\' format for vs-queries.',
      annotations: { title: 'Deep Fetch Research', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query to research' },
          count: { type: 'number', description: 'Number of top results to fetch (default: 5, max: 10)', default: 5, minimum: 1, maximum: 10 },
          format: { type: 'string', enum: ['markdown', 'text', 'comparison'], description: 'Content format (default: markdown). Use "comparison" for vs-queries to get a side-by-side structure.', default: 'markdown' },
        },
        required: ['query'],
      },
    },
    {
      name: 'webpeel_youtube',
      description: 'Extract the full transcript from a YouTube video. Returns timestamped segments and video metadata. No API key needed. Supports all YouTube URL formats.',
      annotations: { title: 'Extract YouTube Transcript', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'YouTube video URL (supports youtube.com/watch, youtu.be, embed, shorts, and mobile URLs)' },
          language: { type: 'string', description: 'Preferred transcript language code (default: en). Falls back to any available language if not found.' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_auto_extract',
      description: 'Detect page type and extract structured JSON automatically. Supports pricing pages, product listings, contact info, articles, and API documentation. No LLM needed.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to fetch and auto-extract structured data from' },
        },
        required: ['url'],
      },
    },
    {
      name: 'webpeel_quick_answer',
      description: 'Ask a question about a URL\'s content — no LLM key needed. Uses BM25 relevance scoring to find and return the most relevant passages. Returns answer text with confidence score.',
      annotations: { title: 'Quick Answer (No LLM)', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to fetch and search' },
          question: { type: 'string', description: 'Question to answer from the page content' },
          maxPassages: { type: 'number', description: 'Maximum number of relevant passages to return (default: 3)', default: 3, minimum: 1, maximum: 10 },
          render: { type: 'boolean', description: 'Use browser rendering', default: false },
        },
        required: ['url', 'question'],
      },
    },
    {
      name: 'webpeel_watch',
      description: 'Monitor a URL for changes with webhook notifications. Create persistent watchers that check on a schedule and alert when content changes.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'check', 'delete'], description: 'Watch action to perform' },
          url: { type: 'string', description: 'URL to monitor (for create)' },
          id: { type: 'string', description: 'Watch ID (for check/delete)' },
          webhookUrl: { type: 'string', description: 'Webhook URL to notify on changes (for create)' },
          intervalMinutes: { type: 'number', description: 'Check interval in minutes (default: 60)' },
          selector: { type: 'string', description: 'CSS selector to monitor specific content (optional)' },
        },
        required: ['action'],
      },
    },
    {
      name: 'webpeel_hotels',
      description: 'Search multiple travel sites for hotels in parallel. Returns sorted results from Kayak, Booking.com, Google Travel, and Expedia.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          destination: { type: 'string', description: 'Destination city or area (e.g., "Manhattan", "Paris")' },
          checkin: { type: 'string', description: 'Check-in date (ISO or natural language like "tomorrow")' },
          checkout: { type: 'string', description: 'Check-out date. Defaults to day after checkin.' },
          sort: { type: 'string', enum: ['price', 'rating', 'value'], description: 'Sort order (default: price)' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        required: ['destination'],
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
        budget: args.budget as number | undefined,
        question: args.question as string | undefined,
        screenshot: (args.screenshot as boolean) || false,
        actions: parsedActions,
      };

      // Auto-budget: default to 4000 tokens for MCP when no budget specified
      if (options.budget === undefined) {
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
  if (!req.auth?.keyInfo) {
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
  const mcpInsecureAuthHandler = (_req: Request, res: Response): void => {
    res.status(400).json({
      error: 'insecure_auth',
      message: 'API keys in URLs are insecure. Use the Authorization header instead: Authorization: Bearer wp_your_key',
      docs: 'https://webpeel.dev/docs/api-reference#authentication',
    });
  };

  router.post('/:apiKey/v2/mcp', mcpInsecureAuthHandler);
  router.get('/:apiKey/v2/mcp', mcpInsecureAuthHandler);
  router.delete('/:apiKey/v2/mcp', mcpInsecureAuthHandler);

  return router;
}
