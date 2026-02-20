#!/usr/bin/env node

/**
 * MCP Server for WebPeel
 * Provides webpeel_fetch and webpeel_search tools for Claude Desktop / Cursor
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { peel, peelBatch } from '../index.js';
import type { PeelOptions } from '../types.js';
import { normalizeActions } from '../core/actions.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSearchProvider, type SearchProviderId } from '../core/search-provider.js';
import { answerQuestion, type LLMProviderId } from '../core/answer.js';
import { extractInlineJson, type LLMProvider as InlineLLMProvider } from '../core/extract-inline.js';

// Read version from package.json
let pkgVersion = '0.3.1';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
  pkgVersion = pkg.version;
} catch { /* fallback */ }

/**
 * Helper function to extract colors from content
 */
function extractColorsFromContent(content: string): string[] {
  const colors: string[] = [];
  const hexRegex = /#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}/g;
  const matches = content.match(hexRegex);
  if (matches) {
    colors.push(...[...new Set(matches)].slice(0, 10));
  }
  return colors;
}

/**
 * Helper function to extract font information from content
 */
function extractFontsFromContent(content: string): string[] {
  const fonts: string[] = [];
  const fontRegex = /font-family:\s*([^;}"'\n]+)/gi;
  let match;
  while ((match = fontRegex.exec(content)) !== null) {
    fonts.push(match[1].trim());
  }
  return [...new Set(fonts)].slice(0, 5);
}

const server = new Server(
  {
    name: 'webpeel',
    version: pkgVersion,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Legacy searchWeb function removed — search logic now lives in
// core/search-provider.ts (DuckDuckGoProvider / BraveSearchProvider).

const tools: Tool[] = [
  {
    name: 'webpeel_fetch',
    description: 'Fetch a URL and return clean, AI-ready markdown content. Handles JavaScript rendering and anti-bot protections automatically. Supports page actions (click, scroll, type), structured extraction, token budgets, image extraction, tag filtering, and geo-targeting. Use stealth=true for protected sites.',
    annotations: {
      title: 'Fetch Web Page',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
        render: {
          type: 'boolean',
          description: 'Force browser rendering (slower but handles JavaScript-heavy sites)',
          default: false,
        },
        stealth: {
          type: 'boolean',
          description: 'Use stealth mode to bypass bot detection (auto-enables render=true)',
          default: false,
        },
        wait: {
          type: 'number',
          description: 'Milliseconds to wait for dynamic content (only used with render=true)',
          default: 0,
        },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'html'],
          description: 'Output format: markdown (default), text, or html',
          default: 'markdown',
        },
        screenshot: {
          type: 'boolean',
          description: 'Capture a screenshot of the page (returns base64-encoded PNG)',
          default: false,
        },
        screenshotFullPage: {
          type: 'boolean',
          description: 'Full-page screenshot (default: viewport only)',
          default: false,
        },
        selector: {
          type: 'string',
          description: 'CSS selector to extract specific content (e.g., "article", ".main-content")',
        },
        exclude: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'CSS selectors to exclude from content (e.g., [".sidebar", ".ads"])',
        },
        includeTags: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Only include content from these HTML tags/classes (e.g., ["article", "main", ".content"])',
        },
        excludeTags: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Remove these HTML tags/classes from content (e.g., ["nav", "footer", ".sidebar"])',
        },
        images: {
          type: 'boolean',
          description: 'Extract image URLs from the page (returns array of image objects with src, alt, title)',
          default: false,
        },
        location: {
          type: 'string',
          description: 'ISO 3166-1 alpha-2 country code for geo-targeting (e.g., "US", "DE", "JP")',
        },
        headers: {
          type: 'object',
          description: 'Custom HTTP headers to send',
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['click', 'type', 'fill', 'scroll', 'wait', 'press', 'hover', 'select', 'waitForSelector', 'screenshot'] },
              selector: { type: 'string', description: 'CSS selector (for click, type, fill, select, hover, waitForSelector)' },
              value: { type: 'string', description: 'Value for type/fill/select actions' },
              text: { type: 'string', description: 'Alias for value (Firecrawl compat)' },
              key: { type: 'string', description: 'Keyboard key for press action (e.g., "Enter")' },
              milliseconds: { type: 'number', description: 'Wait duration in ms (for wait action)' },
              ms: { type: 'number', description: 'Alias for milliseconds' },
              direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
              amount: { type: 'number', description: 'Scroll amount in pixels' },
              timeout: { type: 'number', description: 'Per-action timeout override in ms (default 5000, max 30000 total)' },
            },
            required: ['type'],
          },
          description: 'Page actions to execute before extraction. Auto-enables browser rendering. Examples: [{type: "click", selector: ".load-more"}, {type: "wait", milliseconds: 2000}, {type: "scroll", direction: "down", amount: 500}]',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum token count for output (truncates if exceeded)',
        },
        extract: {
          type: 'object',
          description: 'Structured data extraction options: {selectors: {field: "css"}} or {schema: {...}}',
        },
        inlineExtract: {
          type: 'object',
          description: 'Inline LLM-powered JSON extraction (BYOK). Provide schema and/or prompt, plus llmProvider & llmApiKey.',
          properties: {
            schema: {
              type: 'object',
              description: 'JSON Schema describing the desired output structure',
            },
            prompt: {
              type: 'string',
              description: 'Natural language prompt describing what to extract',
            },
          },
        },
        llmProvider: {
          type: 'string',
          enum: ['openai', 'anthropic', 'google'],
          description: 'LLM provider for inline extraction (required with inlineExtract)',
        },
        llmApiKey: {
          type: 'string',
          description: 'LLM API key for inline extraction — BYOK (required with inlineExtract)',
        },
        llmModel: {
          type: 'string',
          description: 'LLM model name (optional, uses provider default)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_search',
    description: 'Search the web and return results with titles, URLs, and snippets. Supports DuckDuckGo (free, default) and Brave Search (requires API key). Use this to find relevant web pages before fetching them.',
    annotations: {
      title: 'Search the Web',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        count: {
          type: 'number',
          description: 'Number of results to return (1-10)',
          default: 5,
          minimum: 1,
          maximum: 10,
        },
        provider: {
          type: 'string',
          enum: ['duckduckgo', 'brave'],
          description: 'Search provider (default: duckduckgo). Use "brave" with a searchApiKey for better results.',
          default: 'duckduckgo',
        },
        searchApiKey: {
          type: 'string',
          description: 'API key for Brave Search (required when provider is "brave")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'webpeel_batch',
    description: 'Fetch multiple URLs in batch with concurrency control. Returns an array of results or errors.',
    annotations: {
      title: 'Batch Fetch URLs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Array of URLs to fetch',
        },
        concurrency: {
          type: 'number',
          description: 'Max concurrent fetches (default: 3)',
          default: 3,
          minimum: 1,
          maximum: 10,
        },
        render: {
          type: 'boolean',
          description: 'Force browser rendering for all URLs',
          default: false,
        },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'html'],
          description: 'Output format for all URLs',
          default: 'markdown',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to extract specific content',
        },
      },
      required: ['urls'],
    },
  },
  {
    name: 'webpeel_crawl',
    description: 'Crawl a website starting from a URL, following links and extracting content. Supports sitemap-first discovery, BFS/DFS strategies, and content deduplication. Respects robots.txt and rate limits. Perfect for gathering documentation or site content.',
    annotations: {
      title: 'Crawl Website',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Starting URL to crawl from',
        },
        maxPages: {
          type: 'number',
          description: 'Maximum number of pages to crawl (default: 10, max: 100)',
          default: 10,
          minimum: 1,
          maximum: 100,
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to crawl (default: 2, max: 5)',
          default: 2,
          minimum: 1,
          maximum: 5,
        },
        allowedDomains: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Only crawl URLs from these domains (default: same domain as starting URL)',
        },
        excludePatterns: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Exclude URLs matching these regex patterns',
        },
        respectRobotsTxt: {
          type: 'boolean',
          description: 'Respect robots.txt (default: true)',
          default: true,
        },
        rateLimitMs: {
          type: 'number',
          description: 'Rate limit between requests in milliseconds (default: 1000)',
          default: 1000,
          minimum: 100,
        },
        sitemapFirst: {
          type: 'boolean',
          description: 'Discover URLs via sitemap.xml before crawling (default: false)',
          default: false,
        },
        render: {
          type: 'boolean',
          description: 'Use browser rendering for all pages',
          default: false,
        },
        stealth: {
          type: 'boolean',
          description: 'Use stealth mode for all pages',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_map',
    description: 'Discover all URLs on a domain using sitemap.xml and link crawling. Returns a comprehensive list of URLs without fetching their content. Perfect for understanding site structure or planning a crawl.',
    annotations: {
      title: 'Map Website URLs',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Starting URL or domain to map',
        },
        maxUrls: {
          type: 'number',
          description: 'Maximum URLs to discover (default: 5000, max: 10000)',
          default: 5000,
          minimum: 1,
          maximum: 10000,
        },
        includePatterns: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Only include URLs matching these patterns (regex)',
        },
        excludePatterns: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Exclude URLs matching these patterns (regex)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_extract',
    description: 'Extract structured data from a webpage using CSS selectors, JSON schema validation, or AI-powered extraction with natural language prompts. Perfect for scraping product data, article metadata, or any structured content.',
    annotations: {
      title: 'Extract Structured Data',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to extract from',
        },
        selectors: {
          type: 'object',
          description: 'Map of field names to CSS selectors, e.g., {"title": "h1", "price": ".price"}',
        },
        schema: {
          type: 'object',
          description: 'JSON schema describing expected output structure',
        },
        prompt: {
          type: 'string',
          description: 'Natural language prompt for AI-powered extraction (requires llmApiKey)',
        },
        llmApiKey: {
          type: 'string',
          description: 'API key for LLM-powered extraction (OpenAI-compatible)',
        },
        llmModel: {
          type: 'string',
          description: 'LLM model to use (default: gpt-4o-mini)',
          default: 'gpt-4o-mini',
        },
        llmBaseUrl: {
          type: 'string',
          description: 'LLM API base URL (default: https://api.openai.com/v1)',
          default: 'https://api.openai.com/v1',
        },
        render: {
          type: 'boolean',
          description: 'Use browser rendering',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_brand',
    description: 'Extract branding and design system from a URL. Returns colors, fonts, typography, and visual identity elements.',
    annotations: {
      title: 'Extract Branding',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to extract branding from',
        },
        render: {
          type: 'boolean',
          description: 'Use browser rendering',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_change_track',
    description: 'Track changes on a URL by generating a content fingerprint. Use this to detect when a page has been updated.',
    annotations: {
      title: 'Track Page Changes',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to track for changes',
        },
        render: {
          type: 'boolean',
          description: 'Use browser rendering',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_summarize',
    description: 'Generate an AI-powered summary of a webpage using an LLM. Requires an OpenAI-compatible API key.',
    annotations: {
      title: 'Summarize Page',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to summarize',
        },
        llmApiKey: {
          type: 'string',
          description: 'API key for LLM (OpenAI-compatible)',
        },
        prompt: {
          type: 'string',
          description: 'Custom summary prompt (default: "Summarize this webpage in 2-3 sentences.")',
          default: 'Summarize this webpage in 2-3 sentences.',
        },
        llmModel: {
          type: 'string',
          description: 'LLM model to use (default: gpt-4o-mini)',
          default: 'gpt-4o-mini',
        },
        llmBaseUrl: {
          type: 'string',
          description: 'LLM API base URL (default: https://api.openai.com/v1)',
          default: 'https://api.openai.com/v1',
        },
        render: {
          type: 'boolean',
          description: 'Use browser rendering',
          default: false,
        },
      },
      required: ['url', 'llmApiKey'],
    },
  },
  {
    name: 'webpeel_answer',
    description: 'Ask a question, search the web, fetch top results, and generate a cited answer using an LLM (BYOK). Returns an answer with [1], [2] source citations. Supports OpenAI, Anthropic, and Google LLMs.',
    annotations: {
      title: 'Answer a Question',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to answer',
        },
        searchProvider: {
          type: 'string',
          enum: ['duckduckgo', 'brave'],
          description: 'Search provider (default: duckduckgo)',
          default: 'duckduckgo',
        },
        searchApiKey: {
          type: 'string',
          description: 'API key for Brave Search (required when searchProvider is "brave")',
        },
        llmProvider: {
          type: 'string',
          enum: ['openai', 'anthropic', 'google'],
          description: 'LLM provider to use for answer generation',
        },
        llmApiKey: {
          type: 'string',
          description: 'API key for the LLM provider (BYOK)',
        },
        llmModel: {
          type: 'string',
          description: 'LLM model name (optional, uses provider default)',
        },
        maxSources: {
          type: 'number',
          description: 'Maximum number of sources to fetch (1-10, default 5)',
          default: 5,
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['question', 'llmProvider', 'llmApiKey'],
    },
  },
  {
    name: 'webpeel_screenshot',
    description: 'Take a screenshot of a URL and return a base64-encoded image. Supports full page or viewport capture, custom dimensions, PNG/JPEG format, quality setting, and page actions before capture.',
    annotations: {
      title: 'Take Screenshot',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to screenshot',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture the full scrollable page (default: viewport only)',
          default: false,
        },
        width: {
          type: 'number',
          description: 'Viewport width in pixels (default: 1280)',
          default: 1280,
          minimum: 100,
          maximum: 5000,
        },
        height: {
          type: 'number',
          description: 'Viewport height in pixels (default: 720)',
          default: 720,
          minimum: 100,
          maximum: 5000,
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: 'Image format (default: png)',
          default: 'png',
        },
        quality: {
          type: 'number',
          description: 'JPEG quality 1-100 (ignored for PNG)',
          minimum: 1,
          maximum: 100,
        },
        waitFor: {
          type: 'number',
          description: 'Milliseconds to wait after page load before screenshot',
          default: 0,
        },
        stealth: {
          type: 'boolean',
          description: 'Use stealth mode to bypass bot detection',
          default: false,
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
          },
          description: 'Page actions to execute before screenshot (e.g., [{type: "click", selector: ".btn"}, {type: "wait", ms: 2000}])',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_research',
    description: 'Conduct autonomous multi-step web research on a topic. Searches the web, fetches top sources, extracts relevant content using BM25, optionally follows promising links, and synthesizes a comprehensive report with citations. Returns a markdown report and structured source list. Requires LLM API key for synthesis; without one it returns raw extracted source content.',
    annotations: {
      title: 'Deep Research Agent',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Research question or topic to investigate',
        },
        maxSources: {
          type: 'number',
          description: 'Maximum number of sources to consult (default: 5)',
          default: 5,
          minimum: 1,
          maximum: 20,
        },
        maxDepth: {
          type: 'number',
          description: 'Link-following depth: 1 = search results only, 2+ = follow links within top sources (default: 1)',
          default: 1,
          minimum: 1,
          maximum: 3,
        },
        llmApiKey: {
          type: 'string',
          description: 'LLM API key for synthesis (falls back to OPENAI_API_KEY env var)',
        },
        llmModel: {
          type: 'string',
          description: 'LLM model to use for synthesis (default: gpt-4o-mini)',
        },
        llmBaseUrl: {
          type: 'string',
          description: 'LLM API base URL (default: https://api.openai.com/v1)',
        },
        outputFormat: {
          type: 'string',
          enum: ['report', 'sources'],
          description: 'Output format: "report" = synthesized markdown report (needs LLM key), "sources" = raw extracted source content (default: report)',
          default: 'report',
        },
        timeout: {
          type: 'number',
          description: 'Maximum research time in milliseconds (default: 60000)',
          default: 60000,
        },
      },
      required: ['query'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'webpeel_fetch') {
      const { 
        url, 
        render, 
        stealth,
        wait, 
        format, 
        screenshot, 
        screenshotFullPage, 
        selector, 
        exclude, 
        includeTags,
        excludeTags,
        images,
        location,
        headers,
        actions,
        maxTokens,
        extract,
        inlineExtract,
        llmProvider,
        llmApiKey,
        llmModel,
      } = args as {
        url: string;
        render?: boolean;
        stealth?: boolean;
        wait?: number;
        format?: 'markdown' | 'text' | 'html';
        screenshot?: boolean;
        screenshotFullPage?: boolean;
        selector?: string;
        exclude?: string[];
        includeTags?: string[];
        excludeTags?: string[];
        images?: boolean;
        location?: string;
        headers?: Record<string, string>;
        actions?: any[];
        maxTokens?: number;
        extract?: any;
        inlineExtract?: { schema?: Record<string, any>; prompt?: string };
        llmProvider?: string;
        llmApiKey?: string;
        llmModel?: string;
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      if (wait !== undefined) {
        if (typeof wait !== 'number' || isNaN(wait) || wait < 0 || wait > 60000) {
          throw new Error('Invalid wait parameter: must be between 0 and 60000ms');
        }
      }

      if (format !== undefined && !['markdown', 'text', 'html'].includes(format)) {
        throw new Error('Invalid format parameter: must be "markdown", "text", or "html"');
      }

      if (selector !== undefined && typeof selector !== 'string') {
        throw new Error('Invalid selector parameter: must be a string');
      }

      if (exclude !== undefined && !Array.isArray(exclude)) {
        throw new Error('Invalid exclude parameter: must be an array');
      }

      if (headers !== undefined && typeof headers !== 'object') {
        throw new Error('Invalid headers parameter: must be an object');
      }

      if (actions !== undefined && !Array.isArray(actions)) {
        throw new Error('Invalid actions parameter: must be an array');
      }

      if (maxTokens !== undefined) {
        if (typeof maxTokens !== 'number' || isNaN(maxTokens) || maxTokens < 100) {
          throw new Error('Invalid maxTokens parameter: must be at least 100');
        }
      }

      if (extract !== undefined && typeof extract !== 'object') {
        throw new Error('Invalid extract parameter: must be an object');
      }

      if (includeTags !== undefined && !Array.isArray(includeTags)) {
        throw new Error('Invalid includeTags parameter: must be an array');
      }

      if (excludeTags !== undefined && !Array.isArray(excludeTags)) {
        throw new Error('Invalid excludeTags parameter: must be an array');
      }

      if (images !== undefined && typeof images !== 'boolean') {
        throw new Error('Invalid images parameter: must be a boolean');
      }

      if (location !== undefined && typeof location !== 'string') {
        throw new Error('Invalid location parameter: must be a string');
      }

      // Normalize actions (handles Firecrawl-style aliases)
      const normalizedActions = actions ? normalizeActions(actions) : undefined;
      const hasActions = normalizedActions && normalizedActions.length > 0;

      const options: PeelOptions = {
        render: render || hasActions || false,
        stealth: stealth || false,
        wait: wait || 0,
        format: format || 'markdown',
        screenshot: screenshot || false,
        screenshotFullPage: screenshotFullPage || false,
        selector,
        exclude,
        includeTags,
        excludeTags,
        images,
        location: location ? { country: location } : undefined,
        headers,
        actions: normalizedActions,
        maxTokens,
        extract,
        // Agent-friendly default: cap tokens at 4000 when no explicit limit is set.
        // This prevents agents from receiving 30K+ token pages they can't use.
        budget: maxTokens === undefined ? 4000 : undefined,
      };

      // SECURITY: Wrap in timeout (60 seconds max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('MCP operation timed out after 60s')), 60000);
      });

      const result = await Promise.race([
        peel(url, options),
        timeoutPromise,
      ]) as any;

      // Inline LLM extraction (post-fetch, BYOK)
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

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(result, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize result',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_search') {
      const { query, count, provider, searchApiKey: searchKey } = args as {
        query: string;
        count?: number;
        provider?: string;
        searchApiKey?: string;
      };

      // SECURITY: Validate input parameters
      if (!query || typeof query !== 'string') {
        throw new Error('Invalid query parameter');
      }

      if (query.length > 500) {
        throw new Error('Query too long (max 500 characters)');
      }

      if (count !== undefined) {
        if (typeof count !== 'number' || isNaN(count) || count < 1 || count > 10) {
          throw new Error('Invalid count parameter: must be between 1 and 10');
        }
      }

      const validProviders: SearchProviderId[] = ['duckduckgo', 'brave'];
      const providerId: SearchProviderId = provider && validProviders.includes(provider as SearchProviderId)
        ? (provider as SearchProviderId)
        : 'duckduckgo';

      const resultCount = Math.min(Math.max(count || 5, 1), 10);

      // SECURITY: Wrap in timeout (30 seconds max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Search operation timed out after 30s')), 30000);
      });

      const searchProvider = getSearchProvider(providerId);
      const results = await Promise.race([
        searchProvider.searchWeb(query, {
          count: resultCount,
          apiKey: searchKey || undefined,
        }),
        timeoutPromise,
      ]) as any;

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(results, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize results',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_batch') {
      const { urls, concurrency, render, format, selector } = args as {
        urls: string[];
        concurrency?: number;
        render?: boolean;
        format?: 'markdown' | 'text' | 'html';
        selector?: string;
      };

      // SECURITY: Validate input parameters
      if (!urls || !Array.isArray(urls)) {
        throw new Error('Invalid urls parameter: must be an array');
      }

      if (urls.length === 0) {
        throw new Error('URLs array cannot be empty');
      }

      if (urls.length > 50) {
        throw new Error('Too many URLs (max 50)');
      }

      for (const url of urls) {
        if (!url || typeof url !== 'string') {
          throw new Error('Invalid URL in array');
        }
        if (url.length > 2048) {
          throw new Error('URL too long (max 2048 characters)');
        }
      }

      if (concurrency !== undefined) {
        if (typeof concurrency !== 'number' || isNaN(concurrency) || concurrency < 1 || concurrency > 10) {
          throw new Error('Invalid concurrency parameter: must be between 1 and 10');
        }
      }

      const options: PeelOptions & { concurrency?: number } = {
        concurrency: concurrency || 3,
        render: render || false,
        format: format || 'markdown',
        selector,
      };

      // SECURITY: Wrap in timeout (5 minutes max for batch)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Batch operation timed out after 5 minutes')), 300000);
      });

      const results = await Promise.race([
        peelBatch(urls, options),
        timeoutPromise,
      ]) as any;

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(results, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize batch results',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_crawl') {
      const { crawl } = await import('../core/crawler.js');
      
      const {
        url,
        maxPages,
        maxDepth,
        allowedDomains,
        excludePatterns,
        respectRobotsTxt,
        rateLimitMs,
        sitemapFirst,
        render,
        stealth,
      } = args as {
        url: string;
        maxPages?: number;
        maxDepth?: number;
        allowedDomains?: string[];
        excludePatterns?: string[];
        respectRobotsTxt?: boolean;
        rateLimitMs?: number;
        sitemapFirst?: boolean;
        render?: boolean;
        stealth?: boolean;
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      if (maxPages !== undefined) {
        if (typeof maxPages !== 'number' || isNaN(maxPages) || maxPages < 1 || maxPages > 100) {
          throw new Error('Invalid maxPages parameter: must be between 1 and 100');
        }
      }

      if (maxDepth !== undefined) {
        if (typeof maxDepth !== 'number' || isNaN(maxDepth) || maxDepth < 1 || maxDepth > 5) {
          throw new Error('Invalid maxDepth parameter: must be between 1 and 5');
        }
      }

      if (allowedDomains !== undefined && !Array.isArray(allowedDomains)) {
        throw new Error('Invalid allowedDomains parameter: must be an array');
      }

      if (excludePatterns !== undefined && !Array.isArray(excludePatterns)) {
        throw new Error('Invalid excludePatterns parameter: must be an array');
      }

      if (rateLimitMs !== undefined) {
        if (typeof rateLimitMs !== 'number' || isNaN(rateLimitMs) || rateLimitMs < 100) {
          throw new Error('Invalid rateLimitMs parameter: must be at least 100ms');
        }
      }

      // SECURITY: Wrap in timeout (10 minutes max for crawling)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Crawl operation timed out after 10 minutes')), 600000);
      });

      const results = await Promise.race([
        crawl(url, {
          maxPages,
          maxDepth,
          allowedDomains,
          excludePatterns,
          respectRobotsTxt,
          rateLimitMs,
          sitemapFirst,
          render,
          stealth,
        }),
        timeoutPromise,
      ]) as any;

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(results, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize crawl results',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_map') {
      const { mapDomain } = await import('../core/map.js');
      
      const {
        url,
        maxUrls,
        includePatterns,
        excludePatterns,
      } = args as {
        url: string;
        maxUrls?: number;
        includePatterns?: string[];
        excludePatterns?: string[];
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      if (maxUrls !== undefined) {
        if (typeof maxUrls !== 'number' || isNaN(maxUrls) || maxUrls < 1 || maxUrls > 10000) {
          throw new Error('Invalid maxUrls parameter: must be between 1 and 10000');
        }
      }

      if (includePatterns !== undefined && !Array.isArray(includePatterns)) {
        throw new Error('Invalid includePatterns parameter: must be an array');
      }

      if (excludePatterns !== undefined && !Array.isArray(excludePatterns)) {
        throw new Error('Invalid excludePatterns parameter: must be an array');
      }

      // SECURITY: Wrap in timeout (10 minutes max for mapping)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Map operation timed out after 10 minutes')), 600000);
      });

      const results = await Promise.race([
        mapDomain(url, {
          maxUrls,
          includePatterns,
          excludePatterns,
        }),
        timeoutPromise,
      ]) as any;

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(results, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize map results',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_extract') {
      const {
        url,
        selectors,
        schema,
        prompt,
        llmApiKey,
        llmModel,
        llmBaseUrl,
        render,
      } = args as {
        url: string;
        selectors?: Record<string, string>;
        schema?: any;
        prompt?: string;
        llmApiKey?: string;
        llmModel?: string;
        llmBaseUrl?: string;
        render?: boolean;
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      if (selectors !== undefined && typeof selectors !== 'object') {
        throw new Error('Invalid selectors parameter: must be an object');
      }

      if (schema !== undefined && typeof schema !== 'object') {
        throw new Error('Invalid schema parameter: must be an object');
      }

      if (prompt !== undefined && typeof prompt !== 'string') {
        throw new Error('Invalid prompt parameter: must be a string');
      }

      if (llmApiKey !== undefined && typeof llmApiKey !== 'string') {
        throw new Error('Invalid llmApiKey parameter: must be a string');
      }

      if (llmModel !== undefined && typeof llmModel !== 'string') {
        throw new Error('Invalid llmModel parameter: must be a string');
      }

      if (llmBaseUrl !== undefined && typeof llmBaseUrl !== 'string') {
        throw new Error('Invalid llmBaseUrl parameter: must be a string');
      }

      if (!selectors && !schema && !prompt) {
        throw new Error('Either selectors, schema, or prompt must be provided');
      }

      const options: PeelOptions = {
        render: render || false,
        extract: {
          selectors,
          schema,
          prompt,
          llmApiKey,
          llmModel,
          llmBaseUrl,
        },
      };

      // SECURITY: Wrap in timeout (60 seconds max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Extract operation timed out after 60s')), 60000);
      });

      const result = await Promise.race([
        peel(url, options),
        timeoutPromise,
      ]) as any;

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(result, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize extract result',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_brand') {
      const { url, render } = args as {
        url: string;
        render?: boolean;
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      const options: PeelOptions = {
        render: render || false,
        extract: {
          selectors: {
            primaryColor: 'meta[name="theme-color"]',
            title: 'title',
            logo: 'img[class*="logo"], img[alt*="logo"]',
          },
        },
      };

      // SECURITY: Wrap in timeout (60 seconds max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Brand extraction timed out after 60s')), 60000);
      });

      const result = await Promise.race([
        peel(url, options),
        timeoutPromise,
      ]) as any;

      // Extract branding info
      const branding = {
        url: result.url,
        title: result.title,
        extracted: result.extracted,
        metadata: result.metadata,
        colors: extractColorsFromContent(result.content),
        fonts: extractFontsFromContent(result.content),
      };

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(branding, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize branding result',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_change_track') {
      const { url, render } = args as {
        url: string;
        render?: boolean;
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      const options: PeelOptions = {
        render: render || false,
      };

      // SECURITY: Wrap in timeout (60 seconds max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Change tracking timed out after 60s')), 60000);
      });

      const result = await Promise.race([
        peel(url, options),
        timeoutPromise,
      ]) as any;

      // Return tracking info
      const trackingInfo = {
        url: result.url,
        title: result.title,
        fingerprint: result.fingerprint,
        tokens: result.tokens,
        contentType: result.contentType,
        lastChecked: new Date().toISOString(),
      };

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(trackingInfo, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize tracking result',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_summarize') {
      const {
        url,
        llmApiKey,
        prompt,
        llmModel,
        llmBaseUrl,
        render,
      } = args as {
        url: string;
        llmApiKey: string;
        prompt?: string;
        llmModel?: string;
        llmBaseUrl?: string;
        render?: boolean;
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      if (!llmApiKey || typeof llmApiKey !== 'string') {
        throw new Error('Invalid llmApiKey parameter: must be a string');
      }

      if (prompt !== undefined && typeof prompt !== 'string') {
        throw new Error('Invalid prompt parameter: must be a string');
      }

      if (llmModel !== undefined && typeof llmModel !== 'string') {
        throw new Error('Invalid llmModel parameter: must be a string');
      }

      if (llmBaseUrl !== undefined && typeof llmBaseUrl !== 'string') {
        throw new Error('Invalid llmBaseUrl parameter: must be a string');
      }

      const options: PeelOptions = {
        render: render || false,
        extract: {
          prompt: prompt || 'Summarize this webpage in 2-3 sentences.',
          llmApiKey,
          llmModel: llmModel || 'gpt-4o-mini',
          llmBaseUrl: llmBaseUrl || 'https://api.openai.com/v1',
        },
      };

      // SECURITY: Wrap in timeout (60 seconds max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Summarize operation timed out after 60s')), 60000);
      });

      const result = await Promise.race([
        peel(url, options),
        timeoutPromise,
      ]) as any;

      // Return summary
      const summaryResult = {
        url: result.url,
        title: result.title,
        summary: result.extracted,
      };

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(summaryResult, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize summary result',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_answer') {
      const {
        question,
        searchProvider: sp,
        searchApiKey: sak,
        llmProvider: lp,
        llmApiKey: lak,
        llmModel: lm,
        maxSources: ms,
      } = args as {
        question: string;
        searchProvider?: string;
        searchApiKey?: string;
        llmProvider: string;
        llmApiKey: string;
        llmModel?: string;
        maxSources?: number;
      };

      // SECURITY: Validate input parameters
      if (!question || typeof question !== 'string') {
        throw new Error('Invalid question parameter');
      }

      if (question.length > 2000) {
        throw new Error('Question too long (max 2000 characters)');
      }

      const validLlmProviders: LLMProviderId[] = ['openai', 'anthropic', 'google'];
      if (!lp || !validLlmProviders.includes(lp as LLMProviderId)) {
        throw new Error('Invalid llmProvider parameter: must be openai, anthropic, or google');
      }

      if (!lak || typeof lak !== 'string') {
        throw new Error('Invalid llmApiKey parameter: must be a string');
      }

      const validSearchProviders: SearchProviderId[] = ['duckduckgo', 'brave'];
      const resolvedSp: SearchProviderId = sp && validSearchProviders.includes(sp as SearchProviderId)
        ? (sp as SearchProviderId)
        : 'duckduckgo';

      const resolvedMs = typeof ms === 'number'
        ? Math.min(Math.max(ms, 1), 10)
        : 5;

      // SECURITY: Wrap in timeout (3 minutes max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Answer operation timed out after 3 minutes')), 180000);
      });

      const result = await Promise.race([
        answerQuestion({
          question,
          searchProvider: resolvedSp,
          searchApiKey: sak || undefined,
          llmProvider: lp as LLMProviderId,
          llmApiKey: lak,
          llmModel: lm || undefined,
          maxSources: resolvedMs,
          stream: false,
        }),
        timeoutPromise,
      ]) as any;

      // SECURITY: Handle JSON serialization errors
      let resultText: string;
      try {
        resultText = JSON.stringify(result, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize answer result',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_screenshot') {
      const { takeScreenshot } = await import('../core/screenshot.js');

      const {
        url,
        fullPage,
        width,
        height,
        format,
        quality,
        waitFor,
        stealth,
        actions,
      } = args as {
        url: string;
        fullPage?: boolean;
        width?: number;
        height?: number;
        format?: 'png' | 'jpeg';
        quality?: number;
        waitFor?: number;
        stealth?: boolean;
        actions?: any[];
      };

      // SECURITY: Validate input parameters
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL parameter');
      }

      if (url.length > 2048) {
        throw new Error('URL too long (max 2048 characters)');
      }

      if (width !== undefined && (typeof width !== 'number' || width < 100 || width > 5000)) {
        throw new Error('Invalid width: must be between 100 and 5000');
      }

      if (height !== undefined && (typeof height !== 'number' || height < 100 || height > 5000)) {
        throw new Error('Invalid height: must be between 100 and 5000');
      }

      if (format !== undefined && !['png', 'jpeg'].includes(format)) {
        throw new Error('Invalid format: must be png or jpeg');
      }

      if (quality !== undefined && (typeof quality !== 'number' || quality < 1 || quality > 100)) {
        throw new Error('Invalid quality: must be between 1 and 100');
      }

      if (waitFor !== undefined && (typeof waitFor !== 'number' || waitFor < 0 || waitFor > 60000)) {
        throw new Error('Invalid waitFor: must be between 0 and 60000');
      }

      // SECURITY: Wrap in timeout (60 seconds max)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot timed out after 60s')), 60000);
      });

      const result = await Promise.race([
        takeScreenshot(url, {
          fullPage: fullPage || false,
          width,
          height,
          format: format || 'png',
          quality,
          waitFor,
          stealth: stealth || false,
          actions,
        }),
        timeoutPromise,
      ]) as any;

      let resultText: string;
      try {
        resultText = JSON.stringify({
          url: result.url,
          format: result.format,
          contentType: result.contentType,
          screenshot: result.screenshot,
        }, null, 2);
      } catch (jsonError) {
        resultText = JSON.stringify({
          error: 'serialization_error',
          message: 'Failed to serialize screenshot result',
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    }

    if (name === 'webpeel_research') {
      const {
        query,
        maxSources,
        maxDepth,
        llmApiKey,
        llmModel,
        llmBaseUrl,
        outputFormat,
        timeout,
      } = args as {
        query: string;
        maxSources?: number;
        maxDepth?: number;
        llmApiKey?: string;
        llmModel?: string;
        llmBaseUrl?: string;
        outputFormat?: 'report' | 'sources';
        timeout?: number;
      };

      const { research } = await import('../core/research.js');

      const result = await research({
        query,
        maxSources: maxSources ?? 5,
        maxDepth: maxDepth ?? 1,
        apiKey: llmApiKey,
        model: llmModel,
        baseUrl: llmBaseUrl,
        outputFormat: outputFormat ?? 'report',
        timeout: timeout ?? 60000,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              report: result.report,
              sources: result.sources,
              totalSourcesFound: result.totalSourcesFound,
              sourcesConsulted: result.sourcesConsulted,
              elapsed: result.elapsed,
              tokensUsed: result.tokensUsed,
              cost: result.cost,
            }, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const err = error as Error;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: err.name || 'Error',
            message: err.message || 'Unknown error occurred',
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const isHttpMode =
    process.env.MCP_HTTP_MODE === 'true' ||
    process.env.HTTP_STREAMABLE_SERVER === 'true';

  if (isHttpMode) {
    // HTTP Streamable transport — start a minimal Express server
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const express = await import('express');
    const httpApp = express.default();

    // Parse JSON bodies so req.body is available for the transport
    httpApp.use(express.default.json({ limit: '1mb' }));

    httpApp.post('/v2/mcp', async (req: any, res: any) => {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        transport.close().catch(() => {});
      } catch (err) {
        console.error('MCP HTTP error:', err);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          });
        }
      }
    });

    httpApp.get('/v2/mcp', (_req: any, res: any) => {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Use POST to send MCP messages.' },
        id: null,
      });
    });

    const port = parseInt(process.env.MCP_PORT || '3100', 10);
    httpApp.listen(port, () => {
      console.error(`WebPeel MCP server (HTTP) listening on port ${port}`);
    });
  } else {
    // Default: stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('WebPeel MCP server running on stdio');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
