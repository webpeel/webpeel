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
    { capabilities: { tools: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

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
  // Require authentication
  const mcpAuthId = req.auth?.keyInfo?.accountId || (req as unknown as { user?: { userId?: string } }).user?.userId;
  if (!mcpAuthId) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message:
          'Authentication required. Pass API key via Authorization: Bearer <key> header or use /:apiKey/v2/mcp path.',
      },
      id: null,
    });
    return;
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
    error: { code: -32000, message: 'Method not allowed. Use POST to send MCP JSON-RPC messages.' },
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
