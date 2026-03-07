#!/usr/bin/env node

/**
 * MCP Server for WebPeel — stdio transport.
 * Thin wrapper: imports from the shared handler registry in ./handlers/.
 * All tool logic lives in src/mcp/handlers/*.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getHandler } from './handlers/index.js';
import { toolDefinitions } from './handlers/definitions.js';

// Read version from package.json
let pkgVersion = '0.3.1';
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
  pkgVersion = pkg.version;
} catch { /* fallback */ }

// ── Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: 'webpeel', version: pkgVersion },
  { capabilities: { tools: {} } },
);

// ── tools/list — return the 7 public tool definitions ─────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

// ── tools/call — dispatch to shared handler registry ──────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs || {}) as Record<string, unknown>;

  try {
    const handler = getHandler(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    // Standalone has no accountId / pool context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await handler(args)) as any;
  } catch (error) {
    const err = error as Error;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: err.name || 'Error',
            message: err.message || 'Unknown error',
          }),
        },
      ],
      isError: true,
    };
  }
});

// ── Main — stdio or HTTP mode ──────────────────────────────────────────────

async function main() {
  const isHttpMode =
    process.env['MCP_HTTP_MODE'] === 'true' ||
    process.env['HTTP_STREAMABLE_SERVER'] === 'true';

  if (isHttpMode) {
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
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
      } catch {
        if (!s.headersSent) {
          s.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error' },
            id: null,
          });
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
