/**
 * handleFetch — the full-featured webpeel_fetch handler.
 * Supports all options: render, stealth, actions, inline LLM extraction, etc.
 */

import { peel } from '../../index.js';
import type { PeelOptions, PeelResult, ExtractOptions, PageAction } from '../../types.js';
import { normalizeActions } from '../../core/actions.js';
import { extractInlineJson, type LLMProvider as InlineLLMProvider } from '../../core/extract-inline.js';
import { textResult, safeStringify, timeout, type McpHandler } from './types.js';

export const handleFetch: McpHandler = async (args, _ctx?) => {
  const {
    url,
    render,
    stealth,
    wait,
    format,
    screenshot: ssFlag,
    screenshotFullPage,
    selector,
    exclude,
    includeTags,
    excludeTags,
    images,
    location,
    headers,
    actions: rawActions,
    autoScroll: autoScrollParam,
    maxTokens,
    extract,
    inlineExtract,
    llmProvider,
    llmApiKey,
    llmModel,
    question,
    budget: budgetArg,
    readable,
  } = args as {
    url: string;
    render?: boolean;
    stealth?: boolean;
    wait?: number;
    format?: 'markdown' | 'text' | 'html';
    screenshot?: boolean;
    screenshotFullPage?: boolean;
    selector?: string;
    exclude?: string[];
    includeTags?: string[];
    excludeTags?: string[];
    images?: boolean;
    location?: string;
    headers?: Record<string, string>;
    actions?: unknown[];
    autoScroll?: boolean | object;
    maxTokens?: number;
    extract?: ExtractOptions;
    inlineExtract?: { schema?: Record<string, unknown>; prompt?: string };
    llmProvider?: string;
    llmApiKey?: string;
    llmModel?: string;
    question?: string;
    budget?: number;
    readable?: boolean;
  };

  if (!url || typeof url !== 'string') throw new Error('Invalid URL parameter');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const normalizedActions = rawActions ? normalizeActions(rawActions as PageAction[]) : undefined;
  const hasActions = normalizedActions && normalizedActions.length > 0;

  const options: PeelOptions = {
    render: render || hasActions || !!autoScrollParam || false,
    stealth: stealth || false,
    wait: wait || 0,
    format: format || 'markdown',
    screenshot: ssFlag || false,
    screenshotFullPage: screenshotFullPage || false,
    selector,
    exclude,
    includeTags,
    excludeTags,
    images,
    location: location ? { country: location } : undefined,
    headers,
    actions: normalizedActions,
    autoScroll: autoScrollParam,
    maxTokens,
    extract,
    readable: readable || false,
    lite: (args['lite'] as boolean) || false,
    question,
    budget: (args['lite'] as boolean) ? undefined : (budgetArg ?? (maxTokens === undefined ? 4000 : undefined)),
  };

  const peeled = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'MCP operation'),
  ]) as PeelResult;

  // Allow mutable result for inline extraction annotations
  const result = peeled as PeelResult & { json?: Record<string, unknown>; extractTokensUsed?: { input: number; output: number } };

  // Inline LLM extraction (BYOK)
  if (inlineExtract && (inlineExtract.schema || inlineExtract.prompt) && llmApiKey && llmProvider) {
    const validProviders: InlineLLMProvider[] = ['openai', 'anthropic', 'google'];
    if (validProviders.includes(llmProvider as InlineLLMProvider)) {
      const extractResult = await extractInlineJson(result.content, {
        schema: inlineExtract.schema,
        prompt: inlineExtract.prompt,
        llmProvider: llmProvider as InlineLLMProvider,
        llmApiKey,
        llmModel,
      });
      result.json = extractResult.data;
      result.extractTokensUsed = extractResult.tokensUsed;
    }
  }

  const out: Record<string, unknown> = {
    url: result.url || url,
    title: result.title || result.metadata?.title || '',
    tokens: result.tokens || 0,
    content: result.content,
  };
  if (result.metadata) out['metadata'] = result.metadata;
  if (result.domainData) out['domainData'] = result.domainData;
  if (result.readability) {
    out['readability'] = {
      readingTime: result.readability.readingTime,
      wordCount: result.readability.wordCount,
    };
  }
  if (result.quickAnswer) out['quickAnswer'] = result.quickAnswer;
  if (result.json) out['json'] = result.json;
  if (result.extracted) out['extracted'] = result.extracted;
  if (result.images?.length) out['images'] = result.images;
  if (result.screenshot) out['screenshot'] = result.screenshot;
  if (result.fingerprint) out['fingerprint'] = result.fingerprint;
  if (result.extractTokensUsed) out['extractTokensUsed'] = result.extractTokensUsed;
  if (result.quality !== undefined) out['quality'] = result.quality;
  if (result.timing) out['timing'] = result.timing;
  if (result.method) out['method'] = result.method;

  return textResult(safeStringify(out));
};
