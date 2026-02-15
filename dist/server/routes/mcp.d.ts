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
import { Router } from 'express';
export declare function createMcpRouter(): Router;
//# sourceMappingURL=mcp.d.ts.map