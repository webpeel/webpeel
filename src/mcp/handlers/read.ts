/**
 * handleRead — fetch any URL as clean markdown.
 * Auto-detects YouTube URLs and extracts transcripts.
 */

import { peel } from '../../index.js';
import type { PeelOptions, PeelResult } from '../../types.js';
import { textResult, safeStringify, timeout, type McpHandler } from './types.js';

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

export const handleRead: McpHandler = async (args, _ctx?) => {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const format = (args['format'] as string | undefined) || 'markdown';
  const render = (args['render'] as boolean | undefined) || false;
  const question = args['question'] as string | undefined;
  const summary = (args['summary'] as boolean | undefined) || false;
  const budgetArg = args['budget'] as number | undefined;
  const readable = (args['readable'] as boolean | undefined) || false;

  // YouTube auto-detection
  if (isYouTubeUrl(url)) {
    const { getYouTubeTranscript } = await import('../../core/youtube.js');
    const language = (args['language'] as string | undefined) || 'en';
    const transcript = await Promise.race([
      getYouTubeTranscript(url, { language }),
      timeout<never>(60000, 'YouTube transcript'),
    ]);
    return textResult(safeStringify(transcript));
  }

  // Build summary extraction options if requested
  const extractOpts = summary
    ? { prompt: 'Summarize this webpage in 2-3 concise sentences.' }
    : undefined;

  const options: PeelOptions = {
    render,
    format: format as 'markdown' | 'text' | 'html',
    question,
    budget: budgetArg ?? 4000,
    readable,
    ...(extractOpts ? { extract: extractOpts } : {}),
  };

  const result = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'MCP read'),
  ]) as PeelResult;

  // Auth wall detection — return a helpful message with instructions
  if (result.authRequired) {
    let authHost = url;
    try { authHost = new URL(url).hostname.replace('www.', ''); } catch { /* ignore */ }
    return textResult(
      `🔐 Authentication Required\n\n` +
      `This page is behind a login wall and cannot be accessed without authentication.\n\n` +
      `To access this content:\n` +
      `1. Ask the user to run: webpeel profile create ${authHost}\n` +
      `2. They'll log in via a browser that opens\n` +
      `3. Then fetch with: webpeel_read with url="${url}" and profile="${authHost}"\n\n` +
      `Partial content (if any):\n${result.content?.slice(0, 500) || '(none)'}`,
    );
  }

  const out: Record<string, unknown> = {
    url: result.url || url,
    title: result.title || '',
    tokens: result.tokens || 0,
    content: result.content,
  };
  if (result.metadata) out['metadata'] = result.metadata;
  if (result.quickAnswer) out['quickAnswer'] = result.quickAnswer;
  if (result.extracted) out['extracted'] = result.extracted;
  if (result.images) out['images'] = result.images;

  return textResult(safeStringify(out));
};
