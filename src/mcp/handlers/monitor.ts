/**
 * handleMonitor — watch a URL for changes, with optional webhook.
 */

import { peel } from '../../index.js';
import type { PeelOptions, PeelResult } from '../../types.js';
import { textResult, safeStringify, timeout, type McpHandler } from './types.js';

export const handleMonitor: McpHandler = async (args, _ctx?) => {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const webhook = args['webhook'] as string | undefined;
  const selector = args['selector'] as string | undefined;
  const render = (args['render'] as boolean | undefined) || false;

  if (webhook) {
    // Webhook-based persistent monitoring requires hosted API
    return textResult(safeStringify({
      message:
        'Persistent webhook monitoring requires the hosted API (api.webpeel.dev). ' +
        'Use webpeel_monitor without webhook= for one-time change detection.',
      url,
      webhook,
    }));
  }

  // One-time change snapshot (change_track logic)
  const options: PeelOptions = {
    render: render || false,
    ...(selector ? { selector } : {}),
  };
  const result = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'Monitor'),
  ]) as PeelResult;

  return textResult(safeStringify({
    url: result.url,
    title: result.title,
    fingerprint: result.fingerprint,
    tokens: result.tokens,
    contentType: result.contentType,
    lastChecked: new Date().toISOString(),
  }));
};
