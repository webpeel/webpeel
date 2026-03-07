/**
 * Shared types for MCP handlers.
 * Both the standalone MCP server and HTTP MCP route import from here.
 */

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

export interface McpContext {
  accountId?: string;
  /** pg.Pool passed by the HTTP route for webpeel_watch */
  pool?: unknown;
}

export type McpHandler = (args: Record<string, unknown>, ctx?: McpContext) => Promise<McpToolResult>;

/** Wrap a JSON-serialized string in a text content block. */
export function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Wrap an error message in a text content block with isError=true. */
export function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/** Safely JSON-stringify any value; falls back to String() on error. */
export function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/** Generic timeout promise. */
export function timeout<T>(ms: number, label: string): Promise<T> {
  return new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
  );
}
