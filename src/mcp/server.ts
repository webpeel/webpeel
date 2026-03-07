#!/usr/bin/env node

/**
 * MCP Server for WebPeel
 * 7 consolidated tools (1 meta + 6 specific) with full backward compatibility.
 * All 20 legacy tool names still work — they're just routed to the new handlers.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { peel, peelBatch } from '../index.js';
import type { PeelOptions, PeelResult, ExtractOptions, PageAction } from '../types.js';
import { normalizeActions } from '../core/actions.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSearchProvider, getBestSearchProvider, type SearchProviderId } from '../core/search-provider.js';
import { answerQuestion, type LLMProviderId } from '../core/answer.js';
import { extractInlineJson, type LLMProvider as InlineLLMProvider } from '../core/extract-inline.js';
import { quickAnswer } from '../core/quick-answer.js';
import { runAgent } from '../core/agent.js';
import { parseIntent } from './smart-router.js';

// Read version from package.json
let pkgVersion = '0.3.1';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
  pkgVersion = pkg.version;
} catch { /* fallback */ }

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractColorsFromContent(content: string): string[] {
  const hexRegex = /#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}/g;
  const matches = content.match(hexRegex);
  return matches ? [...new Set(matches)].slice(0, 10) : [];
}

function extractFontsFromContent(content: string): string[] {
  const fontRegex = /font-family:\s*([^;}"'\n]+)/gi;
  const fonts: string[] = [];
  let match;
  while ((match = fontRegex.exec(content)) !== null) {
    fonts.push(match[1].trim());
  }
  return [...new Set(fonts)].slice(0, 5);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ error: 'serialization_error', message: 'Failed to serialize result' });
  }
}

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

function timeout<T>(ms: number, label: string): Promise<T> {
  return new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  );
}

// ── Tool definitions (7 public tools) ─────────────────────────────────────────

const publicTools: Tool[] = [
  {
    name: 'webpeel',
    description:
      "Your complete web toolkit. Describe what you want in plain language. " +
      "Examples: 'read https://stripe.com', 'screenshot bbc.com on mobile', " +
      "'find best AI frameworks', 'extract prices from stripe.com/pricing', " +
      "'watch stripe.com/pricing for changes'",
    annotations: {
      title: 'WebPeel Smart Web Tool',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Plain English description of what you want to do with the web.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'webpeel_read',
    description:
      'Read any URL and return clean markdown. Handles web pages, YouTube videos, and PDFs ' +
      'automatically. Use question= for Q&A about the page, summary=true for a summary.',
    annotations: {
      title: 'Read Web Page',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'html'],
          description: 'Output format (default: markdown)',
          default: 'markdown',
        },
        render: {
          type: 'boolean',
          description: 'Force browser rendering for JS-heavy sites',
          default: false,
        },
        question: {
          type: 'string',
          description: 'Ask a question about the page content (BM25, no LLM needed)',
        },
        summary: {
          type: 'boolean',
          description: 'Return a summary instead of full content',
          default: false,
        },
        budget: {
          type: 'number',
          description: 'Smart token budget — distill content to N tokens',
        },
        readable: {
          type: 'boolean',
          description: 'Reader mode — extract only article content',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_see',
    description:
      "See any page visually. Returns a screenshot. Use mode='design' for design analysis, " +
      "mode='compare' with compare_url for visual comparison.",
    annotations: {
      title: 'See Page Visually',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to screenshot' },
        mode: {
          type: 'string',
          enum: ['screenshot', 'design', 'compare'],
          description: "Mode: 'screenshot' (default), 'design' (analysis), 'compare' (visual diff)",
          default: 'screenshot',
        },
        compare_url: {
          type: 'string',
          description: "Second URL to compare against (for mode='compare')",
        },
        viewport: {
          description: "Viewport size: 'mobile' | 'tablet' | {width, height}",
          oneOf: [
            { type: 'string', enum: ['mobile', 'tablet', 'desktop'] },
            {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
              },
              required: ['width', 'height'],
            },
          ],
        },
        full_page: {
          type: 'boolean',
          description: 'Capture the full scrollable page',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_find',
    description:
      'Find anything on the web. Pass a query to search, or a url to discover all pages on ' +
      "that domain. Use depth='deep' for multi-source research.",
    annotations: {
      title: 'Find on the Web',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        url: { type: 'string', description: 'Domain URL to map/discover all pages' },
        depth: {
          type: 'string',
          enum: ['quick', 'deep'],
          description: "Search depth: 'quick' = single search, 'deep' = multi-source research",
          default: 'quick',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'webpeel_extract',
    description:
      "Extract structured data from any URL. Pass fields=['price','title'] for specific data, " +
      'or omit for auto-detection. Returns typed JSON.',
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
        url: { type: 'string', description: 'URL to extract from' },
        schema: { type: 'object', description: 'JSON schema describing desired output structure' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: "Specific fields to extract, e.g. ['price', 'title', 'description']",
        },
        format: {
          type: 'string',
          enum: ['json', 'markdown'],
          description: 'Output format (default: json)',
          default: 'json',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_monitor',
    description:
      'Watch a URL for changes. Returns diff on subsequent calls. ' +
      'Add webhook= for persistent monitoring with notifications.',
    annotations: {
      title: 'Monitor URL for Changes',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to monitor' },
        webhook: {
          type: 'string',
          description: 'Webhook URL to notify when content changes',
        },
        interval: {
          type: 'string',
          description: "Check interval, e.g. '1h', '30m', '1d'",
          default: '1h',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to monitor a specific part of the page',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'webpeel_act',
    description:
      'Interact with a web page. Click buttons, fill forms, navigate. ' +
      'Returns screenshot + extracted content after actions complete.',
    annotations: {
      title: 'Act on Web Page',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to interact with' },
        actions: {
          type: 'array',
          description:
            'Actions to perform, e.g. [{type:"click",selector:".btn"}, {type:"type",selector:"#q",value:"hello"}]',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['click', 'type', 'fill', 'scroll', 'wait', 'press', 'hover', 'select'],
              },
              selector: { type: 'string' },
              value: { type: 'string' },
              key: { type: 'string' },
              milliseconds: { type: 'number' },
            },
            required: ['type'],
          },
        },
        extract_after: {
          type: 'boolean',
          description: 'Extract content after actions complete',
          default: true,
        },
        screenshot_after: {
          type: 'boolean',
          description: 'Take screenshot after actions complete',
          default: false,
        },
      },
      required: ['url', 'actions'],
    },
  },
];

// ── Server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'webpeel', version: pkgVersion },
  { capabilities: { tools: {} } }
);

// ── Handlers ───────────────────────────────────────────────────────────────────

/**
 * webpeel_read: fetch a URL as clean markdown.
 * Auto-detects YouTube URLs and extracts transcripts.
 */
async function handleRead(args: Record<string, unknown>) {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const format = (args['format'] as string | undefined) || 'markdown';
  const render = (args['render'] as boolean | undefined) || false;
  const question = args['question'] as string | undefined;
  const summary = (args['summary'] as boolean | undefined) || false;
  const budgetArg = args['budget'] as number | undefined;
  const readable = (args['readable'] as boolean | undefined) || false;

  // YouTube auto-detection
  if (isYouTubeUrl(url)) {
    const { getYouTubeTranscript } = await import('../core/youtube.js');
    const language = (args['language'] as string | undefined) || 'en';
    const transcript = await Promise.race([
      getYouTubeTranscript(url, { language }),
      timeout<never>(60000, 'YouTube transcript'),
    ]);
    return textResponse(safeJson(transcript));
  }

  // Build summary prompt if requested
  const extractOpts = summary
    ? { prompt: 'Summarize this webpage in 2-3 concise sentences.' }
    : undefined;

  const options: PeelOptions = {
    render,
    format: format as 'markdown' | 'text' | 'html',
    question,
    budget: budgetArg ?? 4000,
    readable,
    ...(extractOpts ? { extract: extractOpts } : {}),
  };

  const result = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'MCP read'),
  ]) as PeelResult;

  const out: Record<string, unknown> = {
    url: result.url || url,
    title: result.title || '',
    tokens: result.tokens || 0,
    content: result.content,
  };
  if (result.metadata) out['metadata'] = result.metadata;
  if (result.quickAnswer) out['quickAnswer'] = result.quickAnswer;
  if (result.extracted) out['extracted'] = result.extracted;
  if (result.images) out['images'] = result.images;

  return textResponse(safeJson(out));
}

/**
 * webpeel_see: take a screenshot, optionally with design analysis or comparison.
 */
async function handleSee(args: Record<string, unknown>) {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const mode = (args['mode'] as string | undefined) || 'screenshot';
  const compareUrl = args['compare_url'] as string | undefined;
  const fullPage = (args['full_page'] as boolean | undefined) || false;
  const viewportArg = args['viewport'];

  // Resolve viewport
  let width = 1280;
  let height = 720;
  if (viewportArg && typeof viewportArg === 'object' && !Array.isArray(viewportArg)) {
    const vp = viewportArg as { width?: number; height?: number };
    width = vp.width ?? 1280;
    height = vp.height ?? 720;
  } else if (viewportArg === 'mobile') {
    width = 390; height = 844;
  } else if (viewportArg === 'tablet') {
    width = 768; height = 1024;
  }
  // Params from smart router viewport object
  if (args['viewport'] && typeof args['viewport'] === 'object') {
    const vp = args['viewport'] as { width?: number; height?: number };
    if (vp.width) width = vp.width;
    if (vp.height) height = vp.height;
  }

  if (mode === 'design') {
    const { browserDesignAnalysis } = await import('../core/fetcher.js');
    const result = await Promise.race([
      browserDesignAnalysis(url, { width, height }),
      timeout<never>(90000, 'Design analysis'),
    ]) as { analysis: unknown; finalUrl: string };
    return textResponse(safeJson({ url: result.finalUrl, mode: 'design', analysis: result.analysis }));
  }

  if (mode === 'compare' && compareUrl) {
    const { browserDiff } = await import('../core/fetcher.js');
    const diff = await Promise.race([
      browserDiff(url, compareUrl, { width, height, fullPage }),
      timeout<never>(90000, 'Design compare'),
    ]) as { diffBuffer: Buffer; diffPixels: number; totalPixels: number; diffPercent: number };
    return textResponse(safeJson({
      url,
      compare_url: compareUrl,
      mode: 'compare',
      diffPixels: diff.diffPixels,
      totalPixels: diff.totalPixels,
      diffPercent: diff.diffPercent,
      screenshot: diff.diffBuffer.toString('base64'),
    }));
  }

  // Default: screenshot
  const { takeScreenshot } = await import('../core/screenshot.js');
  const result = await Promise.race([
    takeScreenshot(url, { fullPage, width, height, format: 'png' }),
    timeout<never>(60000, 'Screenshot'),
  ]) as { url: string; screenshot: string; format: string };

  return textResponse(safeJson({ url: result.url, mode: 'screenshot', screenshot: result.screenshot, format: result.format }));
}

/**
 * webpeel_find: search the web, discover domain URLs, or do deep research.
 */
async function handleFind(args: Record<string, unknown>) {
  const query = args['query'] as string | undefined;
  const url = args['url'] as string | undefined;
  const depth = (args['depth'] as string | undefined) || 'quick';
  const limit = Math.min(Math.max((args['limit'] as number | undefined) ?? 5, 1), 20);

  // URL-based: map/discover pages on a domain
  if (url && !query) {
    const { mapDomain } = await import('../core/map.js');
    const results = await Promise.race([
      mapDomain(url, { maxUrls: limit * 100 }),
      timeout<never>(600000, 'Map domain'),
    ]);
    return textResponse(safeJson(results));
  }

  if (!query) throw new Error('Either query or url is required');

  // Question-mode: if the query looks like a natural language question and depth
  // isn't forced to 'deep', use the LLM-free BM25 Q&A path (search → fetch → BM25).
  // This is the /v1/ask feature — no API key required, deterministic.
  const isQuestion = /\?$/.test(query.trim()) ||
    /^(what|how|when|where|why|who|which|can|does|is|are|do|did|will|would|could|should)\b/i.test(query.trim());

  if (isQuestion && depth !== 'deep') {
    const numSources = Math.min(limit, 5);
    const { provider, apiKey } = getBestSearchProvider();
    let searchResults: Array<{ url: string; title: string; snippet: string }>;
    try {
      searchResults = (await Promise.race([
        provider.searchWeb(query, { count: numSources, apiKey }),
        timeout<never>(30000, 'Ask search'),
      ])) as Array<{ url: string; title: string; snippet: string }>;
    } catch {
      searchResults = [];
    }

    if (searchResults.length === 0) {
      return textResponse(safeJson({ question: query, answer: null, confidence: 0, sources: [], method: 'bm25' }));
    }

    const fetched = await Promise.allSettled(
      searchResults.slice(0, numSources).map((r) =>
        peel(r.url, { budget: 3000, format: 'markdown', timeout: 12000 }).then((result) => ({ result, searchResult: r })),
      ),
    );

    const answers = fetched
      .filter((f): f is PromiseFulfilledResult<any> => f.status === 'fulfilled')
      .map((f) => {
        const { result, searchResult } = f.value as { result: PeelResult; searchResult: { url: string; title: string; snippet: string } };
        const qa = quickAnswer({ question: query, content: result.content || '', url: result.url || searchResult.url, maxPassages: 2 });
        return {
          answer: qa.answer,
          confidence: qa.confidence,
          source: { url: result.url || searchResult.url, title: result.title || searchResult.title, snippet: searchResult.snippet },
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const best = answers[0];
    return textResponse(safeJson({
      question: query,
      answer: best?.answer || null,
      confidence: best?.confidence || 0,
      sources: answers.map((a) => ({ ...a.source, confidence: a.confidence })),
      method: 'bm25',
    }));
  }

  // Deep research mode
  if (depth === 'deep') {
    const { provider, apiKey } = getBestSearchProvider();
    const searchResults = await Promise.race([
      provider.searchWeb(query, { count: limit, apiKey }),
      timeout<never>(30000, 'Search'),
    ]) as Array<{ url: string; title?: string; snippet?: string }>;

    const results = Array.isArray(searchResults)
      ? searchResults
      : (searchResults as unknown as { results: Array<{ url: string; title?: string; snippet?: string }> }).results ?? [];
    const topN = results.slice(0, limit);

    if (topN.length === 0) {
      return textResponse(safeJson({ query, sources: [], content: '', totalTokens: 0 }));
    }

    const urls = topN.map((r) => r.url).filter(Boolean);
    const pages = await Promise.race([
      peelBatch(urls, { concurrency: 5, format: 'markdown' }),
      timeout<never>(120000, 'Batch fetch'),
    ]) as PeelResult[];

    const sources: Array<{ url: string; title: string; relevanceScore: number }> = [];
    const contentParts: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const sr = topN[i];
      const pageUrl = urls[i];
      const title = page.title || sr.title || pageUrl;
      const relevanceScore = Math.round((1 - i / Math.max(pages.length, 1)) * 100) / 100;
      sources.push({ url: pageUrl, title, relevanceScore });
      if (page.content) {
        contentParts.push(`## Source ${i + 1}: ${title}\n**URL:** ${pageUrl}\n\n${page.content}\n\n---\n`);
        totalTokens += page.tokens || 0;
      }
    }

    return textResponse(safeJson({ query, sources, content: contentParts.join('\n'), totalTokens }));
  }

  // Quick search (default)
  const validProviders: SearchProviderId[] = ['duckduckgo', 'brave', 'stealth', 'google'];
  const providerId: SearchProviderId = ((args['provider'] as string | undefined) && validProviders.includes(args['provider'] as SearchProviderId))
    ? (args['provider'] as SearchProviderId)
    : 'duckduckgo';

  const searchProvider = getSearchProvider(providerId);
  const results = await Promise.race([
    searchProvider.searchWeb(query, { count: limit }),
    timeout<never>(30000, 'Search'),
  ]);

  return textResponse(safeJson(results));
}

/**
 * webpeel_extract: extract structured data from a URL.
 * Supports auto-detection, field lists, schema, and brand presets.
 */
async function handleExtract(args: Record<string, unknown>) {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const schema = args['schema'] as Record<string, any> | undefined;
  const fields = args['fields'] as string[] | undefined;
  const render = (args['render'] as boolean | undefined) || false;

  // Brand preset: fields=['name','logo','colors','fonts','socials'] or brand flag
  const isBrandPreset =
    (args['_brand'] as boolean | undefined) ||
    (Array.isArray(fields) &&
      ['name', 'logo', 'colors', 'fonts', 'socials'].every((f) => fields.includes(f)));

  if (isBrandPreset) {
    const options: PeelOptions = {
      render,
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
      timeout<never>(60000, 'Brand extraction'),
    ]) as PeelResult;

    return textResponse(safeJson({
      url: result.url,
      title: result.title,
      extracted: result.extracted,
      metadata: result.metadata,
      colors: extractColorsFromContent(result.content || ''),
      fonts: extractFontsFromContent(result.content || ''),
    }));
  }

  // Auto-extract when no schema provided
  if (!schema && (!fields || fields.length === 0)) {
    const htmlResult = await Promise.race([
      peel(url, { format: 'html', render }),
      timeout<never>(60000, 'Auto-extract fetch'),
    ]) as PeelResult;

    const { autoExtract } = await import('../core/auto-extract.js');
    const extracted = autoExtract(htmlResult.content || '', url);
    return textResponse(safeJson({ url, pageType: extracted.type, structured: extracted }));
  }

  // Field-based extraction (CSS selectors from field names)
  if (fields && fields.length > 0 && !schema) {
    const selectors: Record<string, string> = {};
    for (const field of fields) {
      // Map common field names to CSS selectors
      const fieldSelectorMap: Record<string, string> = {
        price: '[class*="price"], [data-price]',
        title: 'h1, title',
        description: '[class*="description"], [class*="summary"]',
        image: 'img[class*="main"], img[class*="hero"]',
        name: 'h1, [class*="name"]',
        logo: 'img[class*="logo"], img[alt*="logo"]',
        colors: 'meta[name="theme-color"]',
        fonts: 'link[rel="stylesheet"]',
        socials: 'a[href*="twitter.com"], a[href*="linkedin.com"], a[href*="github.com"]',
      };
      selectors[field] = fieldSelectorMap[field] || `[class*="${field}"], [id*="${field}"]`;
    }
    const options: PeelOptions = { render, extract: { selectors } };
    const result = await Promise.race([
      peel(url, options),
      timeout<never>(60000, 'Field extraction'),
    ]) as PeelResult;
    return textResponse(safeJson(result));
  }

  // Schema-based extraction
  const options: PeelOptions = {
    render,
    extract: { schema },
  };
  const result = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'Schema extraction'),
  ]) as PeelResult;

  return textResponse(safeJson(result));
}

/**
 * webpeel_monitor: watch a URL for changes, with optional webhook.
 */
async function handleMonitor(args: Record<string, unknown>) {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const webhook = args['webhook'] as string | undefined;
  const selector = args['selector'] as string | undefined;
  const render = (args['render'] as boolean | undefined) || false;

  if (webhook) {
    // Webhook-based persistent monitoring requires hosted API
    return textResponse(safeJson({
      message:
        'Persistent webhook monitoring requires the hosted API (api.webpeel.dev). ' +
        'Use webpeel_monitor without webhook= for one-time change detection.',
      url,
      webhook,
    }));
  }

  // One-time change snapshot (change_track logic)
  const options: PeelOptions = { render: render || false, ...(selector ? { selector } : {}) };
  const result = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'Monitor'),
  ]) as PeelResult;

  return textResponse(safeJson({
    url: result.url,
    title: result.title,
    fingerprint: result.fingerprint,
    tokens: result.tokens,
    contentType: result.contentType,
    lastChecked: new Date().toISOString(),
  }));
}

/**
 * webpeel_act: perform browser actions on a page, then optionally extract content.
 */
async function handleAct(args: Record<string, unknown>) {
  const url = args.url as string;
  const actions = args.actions as any[];
  const extract = args.extract !== false; // default true
  const screenshot = Boolean(args.screenshot);

  if (!url) return textResponse(safeJson({ error: 'url is required' }));
  if (!actions?.length) return textResponse(safeJson({ error: 'actions array is required' }));

  // Reuse the full peel() pipeline — same as handleFetch
  const { peel } = await import('../index.js');
  const result = await peel(url, {
    render: true,       // actions always require browser
    actions,
    screenshot,
    format: 'markdown',
    budget: 4000,
    timeout: 60000,
  });

  return textResponse(safeJson({
    url: result.url,
    title: result.title,
    content: extract ? result.content : undefined,
    screenshot: result.screenshot,
    method: result.method,
    elapsed: result.elapsed,
  }));
}

// ── Full webpeel_fetch handler (backward compat + power users) ─────────────────

async function handleFetch(args: Record<string, unknown>) {
  const {
    url,
    render,
    stealth,
    wait,
    format,
    screenshot: ssFlag,
    screenshotFullPage,
    selector,
    exclude,
    includeTags,
    excludeTags,
    images,
    location,
    headers,
    actions: rawActions,
    autoScroll: autoScrollParam,
    maxTokens,
    extract,
    inlineExtract,
    llmProvider,
    llmApiKey,
    llmModel,
    question,
    budget: budgetArg,
    readable,
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
    actions?: unknown[];
    autoScroll?: boolean | object;
    maxTokens?: number;
    extract?: ExtractOptions;
    inlineExtract?: { schema?: Record<string, any>; prompt?: string };
    llmProvider?: string;
    llmApiKey?: string;
    llmModel?: string;
    question?: string;
    budget?: number;
    readable?: boolean;
  };

  if (!url || typeof url !== 'string') throw new Error('Invalid URL parameter');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const normalizedActions = rawActions ? normalizeActions(rawActions as PageAction[]) : undefined;
  const hasActions = normalizedActions && normalizedActions.length > 0;

  const options: PeelOptions = {
    render: render || hasActions || !!autoScrollParam || false,
    stealth: stealth || false,
    wait: wait || 0,
    format: format || 'markdown',
    screenshot: ssFlag || false,
    screenshotFullPage: screenshotFullPage || false,
    selector,
    exclude,
    includeTags,
    excludeTags,
    images,
    location: location ? { country: location } : undefined,
    headers,
    actions: normalizedActions,
    autoScroll: autoScrollParam,
    maxTokens,
    extract,
    readable: readable || false,
    lite: (args['lite'] as boolean) || false,
    question,
    budget: (args['lite'] as boolean) ? undefined : (budgetArg ?? (maxTokens === undefined ? 4000 : undefined)),
  };

    const peeled = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'MCP operation'),
  ]) as PeelResult;

  // For inline LLM extraction we need to attach extra fields; use a mutable wrapper
  const result: PeelResult & { json?: Record<string, any>; extractTokensUsed?: { input: number; output: number } } = peeled;

  // Inline LLM extraction
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

  const out: Record<string, unknown> = {
    url: result.url || url,
    title: result.title || result.metadata?.title || '',
    tokens: result.tokens || 0,
    content: result.content,
  };
  if (result.metadata) out['metadata'] = result.metadata;
  if (result.domainData) out['domainData'] = result.domainData;
  if (result.readability) out['readability'] = { readingTime: result.readability.readingTime, wordCount: result.readability.wordCount };
  if (result.quickAnswer) out['quickAnswer'] = result.quickAnswer;
  if (result.json) out['json'] = result.json;
  if (result.extracted) out['extracted'] = result.extracted;
  if (result.images?.length) out['images'] = result.images;
  if (result.screenshot) out['screenshot'] = result.screenshot;
  if (result.fingerprint) out['fingerprint'] = result.fingerprint;
  if (result.extractTokensUsed) out['extractTokensUsed'] = result.extractTokensUsed;
  if (result.quality !== undefined) out['quality'] = result.quality;
  if (result.timing) out['timing'] = result.timing;
  if (result.method) out['method'] = result.method;

  return textResponse(safeJson(out));
}

// ── ListToolsRequest — only the 7 public tools ─────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: publicTools }));

// ── CallToolRequest — route to handlers ────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, unknown>;

  try {
    // ── Meta tool ────────────────────────────────────────────────────────────
    if (name === 'webpeel') {
      const task = args['task'] as string;
      if (!task || typeof task !== 'string') throw new Error('task is required');

      const parsed = parseIntent(task);
      const routedArgs: Record<string, unknown> = { ...parsed.params };
      if (parsed.url) routedArgs['url'] = parsed.url;

      switch (parsed.intent) {
        case 'read':
          return handleRead(routedArgs);
        case 'see':
          return handleSee(routedArgs);
        case 'find':
          if (parsed.query) routedArgs['query'] = parsed.query;
          return handleFind(routedArgs);
        case 'extract':
          return handleExtract(routedArgs);
        case 'monitor':
          return handleMonitor(routedArgs);
        case 'act':
          return handleAct(routedArgs);
      }
    }

    // ── New public tools ─────────────────────────────────────────────────────
    if (name === 'webpeel_read') return handleRead(args);
    if (name === 'webpeel_see') return handleSee(args);
    if (name === 'webpeel_find') return handleFind(args);
    if (name === 'webpeel_extract') return handleExtract(args);
    if (name === 'webpeel_monitor') return handleMonitor(args);
    if (name === 'webpeel_act') return handleAct(args);

    // ── Backward compatibility aliases ───────────────────────────────────────

    // webpeel_fetch → webpeel_read (full-featured)
    if (name === 'webpeel_fetch') return handleFetch(args);

    // webpeel_youtube → webpeel_read (YouTube auto-detected)
    if (name === 'webpeel_youtube') {
      const { getYouTubeTranscript } = await import('../core/youtube.js');
      const url = args['url'] as string;
      if (!url || typeof url !== 'string') throw new Error('url is required');
      const language = (args['language'] as string | undefined) || 'en';
      const transcript = await Promise.race([
        getYouTubeTranscript(url, { language }),
        timeout<never>(60000, 'YouTube transcript'),
      ]);
      return textResponse(safeJson(transcript));
    }

    // webpeel_summarize → webpeel_read(summary=true)
    if (name === 'webpeel_summarize') {
      const { url, llmApiKey, prompt, llmModel, llmBaseUrl, render } = args as {
        url: string; llmApiKey: string; prompt?: string;
        llmModel?: string; llmBaseUrl?: string; render?: boolean;
      };
      if (!url) throw new Error('url is required');
      if (!llmApiKey) throw new Error('llmApiKey is required');
      const options: PeelOptions = {
        render: render || false,
        extract: {
          prompt: prompt || 'Summarize this webpage in 2-3 sentences.',
          llmApiKey,
          llmModel: llmModel || 'gpt-4o-mini',
          llmBaseUrl: llmBaseUrl || 'https://api.openai.com/v1',
        },
      };
      const result = await Promise.race([peel(url, options), timeout<never>(60000, 'Summarize')]) as PeelResult;
      return textResponse(safeJson({ url: result.url, title: result.title, summary: result.extracted }));
    }

    // webpeel_answer → webpeel_read(question=...)
    if (name === 'webpeel_answer') {
      const { question: q, searchProvider: sp, searchApiKey: sak, llmProvider: lp, llmApiKey: lak, llmModel: lm, maxSources: ms } = args as {
        question: string; searchProvider?: string; searchApiKey?: string;
        llmProvider: string; llmApiKey: string; llmModel?: string; maxSources?: number;
      };
      if (!q) throw new Error('question is required');
      if (!lp) throw new Error('llmProvider is required');
      if (!lak) throw new Error('llmApiKey is required');
      const validLlm: LLMProviderId[] = ['openai', 'anthropic', 'google'];
      if (!validLlm.includes(lp as LLMProviderId)) throw new Error('Invalid llmProvider');
      const validSp: SearchProviderId[] = ['duckduckgo', 'brave', 'stealth', 'google'];
      const resolvedSp = (sp && validSp.includes(sp as SearchProviderId) ? sp : 'duckduckgo') as SearchProviderId;
      const result = await Promise.race([
        answerQuestion({
          question: q, searchProvider: resolvedSp, searchApiKey: sak,
          llmProvider: lp as LLMProviderId, llmApiKey: lak, llmModel: lm,
          maxSources: Math.min(Math.max(ms ?? 5, 1), 10), stream: false,
        }),
        timeout<never>(180000, 'Answer'),
      ]);
      return textResponse(safeJson(result));
    }

    // webpeel_quick_answer → webpeel_read(question=...)
    if (name === 'webpeel_quick_answer') {
      const { url, question: q, maxPassages: mpArg, render } = args as {
        url: string; question: string; maxPassages?: number; render?: boolean;
      };
      if (!url) throw new Error('url is required');
      if (!q) throw new Error('question is required');
      const maxPassages = typeof mpArg === 'number' ? Math.min(Math.max(mpArg, 1), 10) : 3;
      const peelResult = await Promise.race([
        peel(url, { render: render || false, format: 'markdown', budget: 8000 }),
        timeout<never>(60000, 'Quick answer fetch'),
      ]) as PeelResult;
      const qa = quickAnswer({ question: q, content: peelResult.content || '', url: peelResult.url || url, maxPassages });
      return textResponse(safeJson({
        url: peelResult.url || url, title: peelResult.title,
        question: qa.question, answer: qa.answer, confidence: qa.confidence,
        passages: qa.passages, method: qa.method,
      }));
    }

    // webpeel_screenshot → webpeel_see
    if (name === 'webpeel_screenshot') {
      const { takeScreenshot } = await import('../core/screenshot.js');
      const { url, fullPage, width, height, format, quality, waitFor, stealth, actions } = args as {
        url: string; fullPage?: boolean; width?: number; height?: number;
        format?: 'png' | 'jpeg'; quality?: number; waitFor?: number;
        stealth?: boolean; actions?: PageAction[];
      };
      if (!url) throw new Error('url is required');
      const result = await Promise.race([
        takeScreenshot(url, { fullPage: fullPage || false, width, height, format: format || 'png', quality, waitFor, stealth: stealth || false, actions }),
        timeout<never>(60000, 'Screenshot'),
      ]);
      return textResponse(safeJson({ url: result.url, format: result.format, contentType: result.contentType, screenshot: result.screenshot }));
    }

    // webpeel_search → webpeel_find(quick)
    if (name === 'webpeel_search') {
      return handleFind({ ...args, depth: 'quick' });
    }

    // webpeel_research → webpeel_find(deep)
    if (name === 'webpeel_research') {
      const { query, maxSources, maxDepth, llmApiKey, llmModel, llmBaseUrl, outputFormat, timeout: resTimeout } = args as {
        query: string; maxSources?: number; maxDepth?: number; llmApiKey?: string;
        llmModel?: string; llmBaseUrl?: string; outputFormat?: 'report' | 'sources'; timeout?: number;
      };
      const { research } = await import('../core/research.js');
      const result = await research({
        query, maxSources: maxSources ?? 5, maxDepth: maxDepth ?? 1,
        apiKey: llmApiKey, model: llmModel, baseUrl: llmBaseUrl,
        outputFormat: outputFormat ?? 'report', timeout: resTimeout ?? 60000,
      });
      return textResponse(safeJson({
        report: result.report, sources: result.sources,
        totalSourcesFound: result.totalSourcesFound, sourcesConsulted: result.sourcesConsulted,
        elapsed: result.elapsed, tokensUsed: result.tokensUsed, cost: result.cost,
      }));
    }

    // webpeel_deep_fetch → webpeel_find(depth='deep')
    if (name === 'webpeel_deep_fetch') {
      const { query, count: countArg, format: formatArg } = args as {
        query: string; count?: number; format?: string;
      };
      if (!query) throw new Error('query is required');
      return handleFind({ query, depth: 'deep', limit: Math.min(Math.max(countArg ?? 5, 1), 10), format: formatArg });
    }

    // webpeel_map → webpeel_find(url=...)
    if (name === 'webpeel_map') {
      const { url, maxUrls, includePatterns, excludePatterns } = args as {
        url: string; maxUrls?: number; includePatterns?: string[]; excludePatterns?: string[];
      };
      if (!url) throw new Error('url is required');
      const { mapDomain } = await import('../core/map.js');
      const results = await Promise.race([
        mapDomain(url, { maxUrls, includePatterns, excludePatterns }),
        timeout<never>(600000, 'Map'),
      ]);
      return textResponse(safeJson(results));
    }

    // webpeel_brand → webpeel_extract(fields=['name','logo','colors','fonts','socials'])
    if (name === 'webpeel_brand') {
      return handleExtract({ ...args, _brand: true });
    }

    // webpeel_auto_extract → webpeel_extract (auto mode)
    if (name === 'webpeel_auto_extract') {
      return handleExtract(args);
    }

    // webpeel_extract (legacy — same as new)
    if (name === 'webpeel_extract') {
      return handleExtract(args);
    }

    // webpeel_change_track → webpeel_monitor
    if (name === 'webpeel_change_track') return handleMonitor(args);

    // webpeel_watch → webpeel_monitor
    if (name === 'webpeel_watch') {
      const action = args['action'] as string | undefined;
      if (!action || action === 'list' || action === 'check' || action === 'delete') {
        return textResponse(safeJson({
          message: 'URL watching requires the hosted API (api.webpeel.dev). Use webpeel_monitor for one-time change detection.',
        }));
      }
      if (action === 'create') {
        return handleMonitor({ url: args['url'] as string, webhook: args['webhookUrl'] as string | undefined });
      }
      return textResponse(safeJson({ message: 'URL watching requires the hosted API (api.webpeel.dev).' }));
    }

    // webpeel_batch — developer tool, keep as-is
    if (name === 'webpeel_batch') {
      const { urls, concurrency, render, format, selector } = args as {
        urls: string[]; concurrency?: number; render?: boolean;
        format?: 'markdown' | 'text' | 'html'; selector?: string;
      };
      if (!urls || !Array.isArray(urls)) throw new Error('urls must be an array');
      if (urls.length === 0) throw new Error('urls cannot be empty');
      if (urls.length > 50) throw new Error('Too many URLs (max 50)');
      const options: PeelOptions & { concurrency?: number } = {
        concurrency: concurrency || 3, render: render || false,
        format: format || 'markdown', selector,
      };
      const results = await Promise.race([
        peelBatch(urls, options),
        timeout<never>(300000, 'Batch'),
      ]);
      return textResponse(safeJson(results));
    }

    // webpeel_crawl — developer tool, keep as-is
    if (name === 'webpeel_crawl') {
      const { crawl } = await import('../core/crawler.js');
      const { url, maxPages, maxDepth, allowedDomains, excludePatterns, respectRobotsTxt, rateLimitMs, sitemapFirst, render, stealth } = args as {
        url: string; maxPages?: number; maxDepth?: number; allowedDomains?: string[];
        excludePatterns?: string[]; respectRobotsTxt?: boolean; rateLimitMs?: number;
        sitemapFirst?: boolean; render?: boolean; stealth?: boolean;
      };
      if (!url) throw new Error('url is required');
      const results = await Promise.race([
        crawl(url, { maxPages, maxDepth, allowedDomains, excludePatterns, respectRobotsTxt, rateLimitMs, sitemapFirst, render, stealth }),
        timeout<never>(600000, 'Crawl'),
      ]);
      return textResponse(safeJson(results));
    }

    // webpeel_hotels — deprecated
    if (name === 'webpeel_hotels') {
      return textResponse(safeJson({ message: 'This tool has been deprecated.' }));
    }

    // agent — deprecated
    if (name === 'agent') {
      // Keep backward compat: if llmApiKey provided, run agent
      const llmApiKey = args['llmApiKey'] as string | undefined;
      if (llmApiKey) {
        const promptArg = args['prompt'] as string;
        if (!promptArg) throw new Error('prompt is required');
        const result = await runAgent({
          prompt: promptArg,
          llmApiKey,
          urls: args['urls'] as string[] | undefined,
          maxSources: (args['maxResults'] as number) || undefined,
        });
        return textResponse(safeJson(result));
      }

      // LLM-free mode
      const urlsArg = (args['urls'] as string[]) || [];
      const searchArg = args['search'] as string | undefined;
      if (urlsArg.length === 0 && !searchArg) {
        return textResponse(safeJson({
          message: 'This tool has been deprecated. Use the webpeel tool instead.',
        }));
      }

      const promptArg = args['prompt'] as string | undefined;
      const schema = args['schema'] as Record<string, string> | undefined;
      const budgetArg = (args['budget'] as number) || 4000;
      const maxResults = Math.min((args['maxResults'] as number) || 5, 20);

      const targetUrls: string[] = [...urlsArg];
      if (searchArg) {
        try {
          const { provider, apiKey } = getBestSearchProvider();
          const searchResults = await provider.searchWeb(searchArg, { count: Math.max(maxResults, 5), apiKey });
          for (const r of searchResults) {
            if (!targetUrls.includes(r.url)) targetUrls.push(r.url);
          }
        } catch { /* continue with provided URLs */ }
      }

      const urlsToFetch = targetUrls.slice(0, maxResults);
      const agentResults: Array<{
        url: string; title: string;
        extracted: Record<string, string> | null;
        content: string; confidence: number;
      }> = [];

      await Promise.all(urlsToFetch.map(async (u) => {
        try {
          const page = await peel(u, { budget: budgetArg, format: 'markdown' }) as PeelResult;
          const content = page.content || '';
          const title = page.title || u;
          let extracted: Record<string, string> | null = null;
          let confidence = 0;

          if (schema && Object.keys(schema).length > 0) {
            extracted = {};
            let total = 0;
            for (const [field] of Object.entries(schema)) {
              const q = promptArg ? `${promptArg} — specifically: what is the ${field}?` : `What is the ${field}?`;
              const qa = quickAnswer({ question: q, content, maxPassages: 1, url: u });
              extracted[field] = qa.answer || '';
              total += qa.confidence;
            }
            if ('source' in schema) extracted['source'] = u;
            confidence = Object.keys(schema).length > 0 ? total / Object.keys(schema).length : 0;
          } else if (promptArg) {
            const qa = quickAnswer({ question: promptArg, content, maxPassages: 3, url: u });
            confidence = qa.confidence;
          }

          agentResults.push({ url: u, title, extracted, content: content.slice(0, 500) + (content.length > 500 ? '…' : ''), confidence });
        } catch { /* skip failed URLs */ }
      }));

      return textResponse(safeJson({
        success: true,
        data: { results: agentResults, totalSources: agentResults.length },
      }));
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const err = error as Error;
    return {
      content: [{ type: 'text' as const, text: safeJson({ error: err.name || 'Error', message: err.message || 'Unknown error' }) }],
      isError: true,
    };
  }
});

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const isHttpMode =
    process.env['MCP_HTTP_MODE'] === 'true' ||
    process.env['HTTP_STREAMABLE_SERVER'] === 'true';

  if (isHttpMode) {
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const express = await import('express');
    const httpApp = express.default();
    httpApp.use(express.default.json({ limit: '1mb' }));

    httpApp.post('/v2/mcp', async (req: unknown, res: unknown) => {
      const r = req as import('express').Request;
      const s = res as import('express').Response;
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await transport.handleRequest(r as any, s as any, r.body);
        transport.close().catch(() => {});
      } catch (err) {
        if (!s.headersSent) {
          s.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
        }
      }
    });

    httpApp.get('/v2/mcp', (_req: unknown, res: unknown) => {
      (res as import('express').Response).status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Use POST to send MCP messages.' },
        id: null,
      });
    });

    const port = parseInt(process.env['MCP_PORT'] || '3100', 10);
    httpApp.listen(port, () => {
      process.stderr.write(`WebPeel MCP server (HTTP) listening on port ${port}\n`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('WebPeel MCP server running on stdio\n');
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
