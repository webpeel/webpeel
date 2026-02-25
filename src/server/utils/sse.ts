/**
 * Server-Sent Events (SSE) utility helpers.
 */

import type { Request, Response } from 'express';

/**
 * Initialize an SSE response stream.
 * Must be called before any writes.
 */
export function initSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx compatibility
  res.flushHeaders();
}

/**
 * Send a named SSE event with JSON-serialised data.
 */
export function sendSSE(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Close an SSE stream.
 */
export function endSSE(res: Response): void {
  res.end();
}

/**
 * Returns true when the request opts-in to SSE streaming via
 * `?stream=true` or `Accept: text/event-stream`.
 */
export function wantsSSE(req: Request): boolean {
  if (req.query['stream'] === 'true') return true;
  const accept = req.headers['accept'];
  if (accept && accept.includes('text/event-stream')) return true;
  return false;
}
