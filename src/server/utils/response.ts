/**
 * Response helpers — consistent API envelope formatting.
 *
 * errorResponse  — always emits the standard error envelope.
 * successResponse — emits the wrapped success envelope (use only when the
 *                   client opts-in via ?envelope=true or
 *                   Accept: application/json+envelope).
 */

import type { Response } from 'express';

/**
 * Send a uniform error response.
 *
 * Shape:
 * ```json
 * {
 *   "success": false,
 *   "error": { "type", "message", "hint"?, "docs" },
 *   "metadata": { "requestId" }
 * }
 * ```
 */
export function errorResponse(
  res: Response,
  statusCode: number,
  type: string,
  message: string,
  hint?: string,
): void {
  const requestId = (res.req as any).requestId || 'unknown';
  res.status(statusCode).json({
    success: false,
    error: {
      type,
      message,
      ...(hint ? { hint } : {}),
      docs: 'https://webpeel.dev/docs/api-reference#errors',
    },
    metadata: { requestId },
  });
}

/**
 * Send a success response with the standard data/metadata envelope.
 *
 * Shape:
 * ```json
 * {
 *   "success": true,
 *   "data": { ...peelResult },
 *   "metadata": { "requestId", ...extra }
 * }
 * ```
 */
export function successResponse(
  res: Response,
  data: any,
  extra?: Record<string, any>,
): void {
  const requestId = (res.req as any).requestId || 'unknown';
  res.json({
    success: true,
    data,
    metadata: {
      requestId,
      ...(extra ?? {}),
    },
  });
}

/**
 * Return true when the incoming request opts in to the success envelope.
 * Clients signal this via `?envelope=true` or the `Accept` header value
 * `application/json+envelope`.
 */
export function wantsEnvelope(req: { query: Record<string, any>; headers: Record<string, any> }): boolean {
  if (req.query['envelope'] === 'true') return true;
  const accept = req.headers['accept'] as string | undefined;
  if (accept && accept.includes('application/json+envelope')) return true;
  return false;
}
