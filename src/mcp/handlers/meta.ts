/**
 * handleMeta — the 'webpeel' meta tool.
 * Parses plain-language intent and routes to the appropriate handler.
 */

import { parseIntent } from '../smart-router.js';
import { handleRead } from './read.js';
import { handleSee } from './see.js';
import { handleFind } from './find.js';
import { handleExtract } from './extract.js';
import { handleMonitor } from './monitor.js';
import { handleAct } from './act.js';
import type { McpHandler } from './types.js';

export const handleMeta: McpHandler = async (args, ctx?) => {
  const task = args['task'] as string;
  if (!task || typeof task !== 'string') throw new Error('task is required');

  const parsed = parseIntent(task);
  const routedArgs: Record<string, unknown> = { ...parsed.params };
  if (parsed.url) routedArgs['url'] = parsed.url;
  if (parsed.query) routedArgs['query'] = parsed.query;

  switch (parsed.intent) {
    case 'read':    return handleRead(routedArgs, ctx);
    case 'see':     return handleSee(routedArgs, ctx);
    case 'find':    return handleFind(routedArgs, ctx);
    case 'extract': return handleExtract(routedArgs, ctx);
    case 'monitor': return handleMonitor(routedArgs, ctx);
    case 'act':     return handleAct(routedArgs, ctx);
    default:        return handleRead(routedArgs, ctx);
  }
};
