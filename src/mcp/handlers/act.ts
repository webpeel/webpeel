/**
 * handleAct — perform browser actions on a page, then optionally extract content.
 */

import { peel } from '../../index.js';
import type { PeelResult } from '../../types.js';
import { normalizeActions } from '../../core/actions.js';
import { textResult, safeStringify, type McpHandler } from './types.js';

export const handleAct: McpHandler = async (args, _ctx?) => {
  const url = args.url as string;
  const rawActions = (args.actions as unknown[]) || [];
  const extract = args.extract !== false; // default true
  const screenshot = Boolean(args.screenshot);

  if (!url) return textResult(safeStringify({ error: 'url is required' }));
  if (!rawActions.length) return textResult(safeStringify({ error: 'actions array is required' }));

  // Normalize actions (handles Firecrawl-style aliases)
  const actions = normalizeActions(rawActions as Parameters<typeof normalizeActions>[0]) || [];

  const result = await peel(url, {
    render: true,       // actions always require browser
    actions,
    screenshot,
    format: 'markdown',
    budget: 4000,
    timeout: 60000,
  }) as PeelResult;

  return textResult(safeStringify({
    url: result.url,
    title: result.title,
    content: extract ? result.content : undefined,
    screenshot: result.screenshot,
    method: result.method,
    elapsed: result.elapsed,
  }));
};
