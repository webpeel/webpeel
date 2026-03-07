/**
 * /v1/do — Intent-based endpoint.
 * One endpoint that understands natural language and routes internally.
 * POST /v1/do { task: "find Stripe fees" }
 * GET  /v1/do?task=find+Stripe+fees
 */

import { Router, Request, Response } from 'express';
import { parseIntent } from '../../mcp/smart-router.js';
import { getHandler } from '../../mcp/handlers/index.js';
import type { McpContext } from '../../mcp/handlers/types.js';

export function createDoRouter(): Router {
  const router = Router();

  async function handleDo(req: Request, res: Response): Promise<void> {
    const task = req.body?.task || (req.query?.task as string);
    if (!task?.trim()) {
      res.status(400).json({ success: false, error: { type: 'missing_task', message: 'Provide task= parameter or {"task": "..."}', hint: 'POST {"task": "search for X"} or GET /v1/do?task=search+for+X', docs: 'https://webpeel.dev/docs/errors#missing_task' }, requestId: req.requestId });
      return;
    }

    const startMs = Date.now();
    const intent = parseIntent(task);

    // Map intent to handler
    const toolName = `webpeel_${intent.intent}`;
    const handler = getHandler(toolName);
    if (!handler) {
      res.status(400).json({ success: false, error: { type: 'unknown_intent', message: `Could not understand: "${task}"`, hint: 'Try phrasing as: "fetch https://example.com", "search for AI news", or "screenshot https://example.com"', docs: 'https://webpeel.dev/docs/errors#unknown_intent' }, requestId: req.requestId });
      return;
    }

    // Build args from parsed intent
    const args: Record<string, unknown> = { ...intent.params };
    if (intent.url) args.url = intent.url;
    if (intent.query) args.query = intent.query;

    try {
      const ctx: McpContext = {
        accountId:
          (req as any).auth?.keyInfo?.accountId || (req as any).user?.userId,
      };
      const result = await handler(args, ctx);

      // Extract text content from MCP result format
      const firstItem = result.content?.[0];
      const content = firstItem?.type === 'text' ? firstItem.text : undefined;
      let parsed: any;
      try {
        parsed = JSON.parse(content || '{}');
      } catch {
        parsed = { raw: content };
      }

      res.json({
        task,
        intent: intent.intent,
        ...(intent.url ? { url: intent.url } : {}),
        ...(intent.query ? { query: intent.query } : {}),
        result: parsed,
        elapsed: Date.now() - startMs,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: {
          type: 'execution_failed',
          message: err.message,
          docs: 'https://webpeel.dev/docs/errors#execution_failed',
        },
        requestId: req.requestId,
      });
    }
  }

  router.get('/', handleDo);
  router.post('/', handleDo);

  return router;
}
