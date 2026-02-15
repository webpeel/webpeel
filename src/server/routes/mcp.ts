/**
 * Hosted MCP endpoint — POST /mcp
 *
 * Accepts MCP Streamable HTTP transport (JSON-RPC over HTTP).
 * Users connect with: { "url": "https://api.webpeel.dev/mcp" }
 *
 * Each request creates a stateless MCP server, processes the JSON-RPC
 * message(s), and returns the response.  This mirrors what Exa does at
 * mcp.exa.ai/mcp.
 */

import { Router, Request, Response } from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { peel, peelBatch } from '../../index.js';
import type { PeelOptions } from '../../types.js';
import { normalizeActions } from '../../core/actions.js';
import { runAgent } from '../../core/agent.js';
import type { AgentDepth, AgentTopic } from '../../core/agent.js';
import { extractInlineJson, type LLMProvider as InlineLLMProvider } from '../../core/extract-inline.js';
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
      name: 'webpeel_agent',
      description: 'Run autonomous web research: searches, fetches, and synthesises an answer using an LLM (BYOK). Supports basic/thorough depth, topic filters, and structured output.',
      annotations: { title: 'Web Research Agent', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Research question / prompt' },
          llmApiKey: { type: 'string', description: 'Your OpenAI-compatible API key (BYOK)' },
          llmModel: { type: 'string', description: 'LLM model (default: gpt-4o-mini)' },
          depth: { type: 'string', enum: ['basic', 'thorough'], default: 'basic' },
          topic: { type: 'string', enum: ['general', 'news', 'technical', 'academic'], default: 'general' },
          maxSources: { type: 'number', description: 'Max sources (1-20)', default: 5 },
          outputSchema: { type: 'object', description: 'JSON Schema for structured output' },
        },
        required: ['prompt', 'llmApiKey'],
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

      return ok(safeStringify(result));
    }

    // webpeel_search
    if (name === 'webpeel_search') {
      const query = args.query as string;
      if (!query || typeof query !== 'string') throw new Error('Invalid query');

      const { getSearchProvider } = await import('../../core/search-provider.js');
      const provider = getSearchProvider('duckduckgo');
      const count = Math.min(Math.max((args.count as number) || 5, 1), 10);
      const results = await Promise.race([
        provider.searchWeb(query, { count }),
        timeout(30000, 'Search timed out'),
      ]);
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

    // webpeel_agent
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

export function createMcpRouter(): Router {
  const router = Router();

  // POST /mcp — MCP Streamable HTTP transport
  router.post('/mcp', async (req: Request, res: Response) => {
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
  });

  // GET /mcp — some MCP clients probe with GET for SSE connection
  router.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Use POST to send MCP JSON-RPC messages.',
      },
      id: null,
    });
  });

  // DELETE /mcp — session teardown (no-op for stateless)
  router.delete('/mcp', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  return router;
}
