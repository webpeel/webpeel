/**
 * Hosted MCP endpoint — POST /mcp, POST /v2/mcp, POST /:apiKey/v2/mcp
 *
 * Thin HTTP/SSE transport wrapper. All tool logic lives in the shared handler
 * registry at src/mcp/handlers/. This file handles:
 *   - Express routing and auth
 *   - MCP Streamable HTTP transport setup
 *   - Passing McpContext (accountId, pool) to handlers
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
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getHandler } from '../../mcp/handlers/index.js';
import { toolDefinitions } from '../../mcp/handlers/definitions.js';

// Read version from package.json
let pkgVersion = '0.7.0';
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8'));
  pkgVersion = pkg.version;
} catch { /* fallback */ }

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return JSON.stringify({ error: 'serialization_error', message: 'Failed to serialize result' });
  }
}

// ---------------------------------------------------------------------------
// Create a fresh MCP server instance (stateless — one per request)
// ---------------------------------------------------------------------------

function createMcpServer(pool?: Pool | null, req?: Request): Server {
  const mcpServer = new Server(
    { name: 'webpeel', version: pkgVersion },
    { capabilities: { tools: {}, prompts: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

  // MCP Prompts — pre-built templates for common web data tasks
  const mcpPrompts = [
    {
      name: 'research',
      description: 'Research a topic by searching the web and synthesizing findings from multiple sources.',
      arguments: [{ name: 'topic', description: 'Topic to research', required: true }],
    },
    {
      name: 'extract-product',
      description: 'Extract structured product data (name, price, rating, reviews) from any e-commerce URL.',
      arguments: [{ name: 'url', description: 'Product page URL (Amazon, Best Buy, etc.)', required: true }],
    },
    {
      name: 'monitor-price',
      description: 'Set up price monitoring for a product page. Tracks changes and reports diffs.',
      arguments: [{ name: 'url', description: 'Product URL to monitor', required: true }],
    },
    {
      name: 'summarize',
      description: 'Fetch a web page and provide a concise summary of its content.',
      arguments: [{ name: 'url', description: 'URL to summarize', required: true }],
    },
  ];

  mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: mcpPrompts }));

  mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const promptMap: Record<string, (a: Record<string, string>) => { messages: Array<{ role: string; content: { type: string; text: string } }> }> = {
      'research': (a) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Research "${a.topic}" using webpeel_find with depth="deep", then summarize the key findings with sources.` } }] }),
      'extract-product': (a) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Use webpeel_extract on ${a.url} with fields=['name','price','rating','reviews','availability'] and return the structured data.` } }] }),
      'monitor-price': (a) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Use webpeel_monitor on ${a.url} with selector=".price" to track price changes. Report the current price and set up monitoring.` } }] }),
      'summarize': (a) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Use webpeel_read on ${a.url} with budget=500 to get a concise version, then summarize the key points in 3-4 sentences.` } }] }),
    };
    const handler = promptMap[name];
    if (!handler) throw new Error(`Prompt not found: ${name}`);
    return handler((args || {}) as Record<string, string>);
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    // Build context: auth + pool for HTTP-specific features (webpeel_watch)
    const accountId =
      req?.auth?.keyInfo?.accountId ||
      (req as unknown as { user?: { userId?: string } })?.user?.userId ||
      'anonymous';
    const ctx = { accountId, pool: pool ?? undefined };

    try {
      const handler = getHandler(name);
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await handler(args, ctx)) as any;
    } catch (error) {
      const err = error as Error;
      return {
        content: [
          {
            type: 'text' as const,
            text: safeStringify({ error: err.name || 'Error', message: err.message || 'Unknown error' }),
          },
        ],
        isError: true,
      };
    }
  });

  return mcpServer;
}

// ---------------------------------------------------------------------------
// Shared MCP request handler
// ---------------------------------------------------------------------------

async function handleMcpPost(req: Request, res: Response, pool?: Pool | null): Promise<void> {
  // Allow unauthenticated access to discovery methods (initialize, tools/list)
  // so MCP marketplaces (Smithery, Glama) and clients can discover our tools.
  // Actual tool execution (tools/call) still works without auth but uses free-tier limits.
  const mcpAuthId = req.auth?.keyInfo?.accountId || (req as unknown as { user?: { userId?: string } }).user?.userId;
  const body = req.body;
  const method = body?.method || (Array.isArray(body) ? body[0]?.method : undefined);
  const isDiscovery = method === 'initialize' || method === 'tools/list' || method === 'notifications/initialized';
  
  // Only block if no auth AND it's not a discovery method
  if (!mcpAuthId && !isDiscovery) {
    // Still allow tools/call without auth — it'll use anonymous rate limits
    // This enables free-tier MCP usage without signup
  }

  try {
    const mcpServer = createMcpServer(pool, req);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req as unknown as IncomingMessage & { auth?: any },
      res as unknown as ServerResponse,
      req.body,
    );

    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  } catch (error) {
    console.error('MCP endpoint error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          type: 'internal_error',
          message: 'Internal error',
          docs: 'https://webpeel.dev/docs/errors#internal_error',
        },
        requestId: req.requestId,
      });
    }
  }
}

function mcpMethodNotAllowed(req: Request, res: Response): void {
  res.status(405).json({ success: false, error: { type: 'method_not_allowed', message: 'Method not allowed. Use POST to send MCP JSON-RPC messages.', hint: 'Send a POST request with a JSON-RPC body', docs: 'https://webpeel.dev/docs/errors#method_not_allowed' }, requestId: req.requestId });
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

  // GET /.well-known/mcp/server-card.json — MCP server discovery (Smithery, Glama, etc.)
  router.get('/.well-known/mcp/server-card.json', (_req: Request, res: Response) => {
    res.json({
      name: 'WebPeel',
      description: 'The web data platform for AI agents — fetch, search, crawl, extract, monitor, screenshot. 55+ domain extractors, 65-98% token savings.',
      version: '0.21.87',
      tools_count: 7,
      homepage: 'https://webpeel.dev',
      documentation: 'https://webpeel.dev/docs/mcp',
      mcp_endpoint: 'https://api.webpeel.dev/mcp',
      authentication: { type: 'optional', description: 'Bearer token optional. Works without auth using free-tier limits.' },
    });
  });

  // POST /mcp — legacy path
  router.post('/mcp', boundHandler);
  router.get('/mcp', mcpMethodNotAllowed);
  router.delete('/mcp', mcpDeleteOk);

  // POST /v2/mcp — canonical v2 path; auth via Authorization: Bearer <key> header
  router.post('/v2/mcp', boundHandler);
  router.get('/v2/mcp', mcpMethodNotAllowed);
  router.delete('/v2/mcp', mcpDeleteOk);

  // SECURITY: /:apiKey/v2/mcp — BLOCKED. API keys in URLs are insecure.
  const mcpInsecureAuthHandler = (req: Request, res: Response): void => {
    res.status(400).json({ success: false, error: { type: 'insecure_auth', message: 'API keys in URLs are insecure.', hint: 'Use the Authorization header instead: Authorization: Bearer wp_your_key', docs: 'https://webpeel.dev/docs/api-reference#authentication' }, requestId: req.requestId });
  };

  router.post('/:apiKey/v2/mcp', mcpInsecureAuthHandler);
  router.get('/:apiKey/v2/mcp', mcpInsecureAuthHandler);
  router.delete('/:apiKey/v2/mcp', mcpInsecureAuthHandler);

  return router;
}
