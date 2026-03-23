/**
 * handleExtract — extract structured data from a URL.
 * Supports auto-detection, field lists, schema, and brand presets.
 * Supports LLM-based extraction via llmProvider + llmApiKey.
 */

import { peel } from '../../index.js';
import type { PeelOptions, PeelResult } from '../../types.js';
import { textResult, safeStringify, timeout, type McpHandler } from './types.js';
import { extractWithLLM, type LLMProvider } from '../../core/llm-extract.js';

function extractColorsFromContent(content: string): string[] {
  const hexRegex = /#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}/g;
  const matches = content.match(hexRegex);
  return matches ? [...new Set(matches)].slice(0, 10) : [];
}

function extractFontsFromContent(content: string): string[] {
  const fontRegex = /font-family:\s*([^;}"'\n]+)/gi;
  const fonts: string[] = [];
  let match;
  while ((match = fontRegex.exec(content)) !== null) {
    fonts.push(match[1].trim());
  }
  return [...new Set(fonts)].slice(0, 5);
}

export const handleExtract: McpHandler = async (args, _ctx?) => {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const schema = args['schema'] as Record<string, unknown> | undefined;
  const fields = args['fields'] as string[] | undefined;
  const render = (args['render'] as boolean | undefined) || false;
  const llmApiKey = args['llmApiKey'] as string | undefined;
  const llmProvider = args['llmProvider'] as LLMProvider | undefined;
  const llmModel = args['llmModel'] as string | undefined;
  const llmBaseUrl = args['llmBaseUrl'] as string | undefined;
  const prompt = args['prompt'] as string | undefined;

  // LLM-based extraction: when llmApiKey (and optionally llmProvider) are provided
  if (llmApiKey && (schema || prompt)) {
    const peelResult = await Promise.race([
      peel(url, { format: 'markdown', render }),
      timeout<never>(60000, 'LLM extract fetch'),
    ]) as PeelResult;

    const extractResult = await extractWithLLM({
      content: peelResult.content,
      schema: schema as object | undefined,
      prompt,
      llmApiKey,
      llmProvider: llmProvider || 'openai',
      llmModel,
      baseUrl: llmBaseUrl,
    });

    return textResult(safeStringify({
      success: true,
      url: peelResult.url,
      data: extractResult.items.length === 1 ? extractResult.items[0] : extractResult.items,
      llm: {
        provider: extractResult.provider || llmProvider || 'openai',
        model: extractResult.model,
        tokens: extractResult.tokensUsed,
      },
    }));
  }

  // Brand preset: fields=['name','logo','colors','fonts','socials'] or _brand flag
  const isBrandPreset =
    (args['_brand'] as boolean | undefined) ||
    (Array.isArray(fields) &&
      ['name', 'logo', 'colors', 'fonts', 'socials'].every((f) => fields.includes(f)));

  if (isBrandPreset) {
    const options: PeelOptions = {
      render,
      extract: {
        selectors: {
          primaryColor: 'meta[name="theme-color"]',
          title: 'title',
          logo: 'img[class*="logo"], img[alt*="logo"]',
        },
      },
    };
    const result = await Promise.race([
      peel(url, options),
      timeout<never>(60000, 'Brand extraction'),
    ]) as PeelResult;

    return textResult(safeStringify({
      url: result.url,
      title: result.title,
      extracted: result.extracted,
      metadata: result.metadata,
      colors: extractColorsFromContent(result.content || ''),
      fonts: extractFontsFromContent(result.content || ''),
    }));
  }

  // Auto-extract when no schema provided
  if (!schema && (!fields || fields.length === 0)) {
    const htmlResult = await Promise.race([
      peel(url, { format: 'html', render }),
      timeout<never>(60000, 'Auto-extract fetch'),
    ]) as PeelResult;

    const { autoExtract } = await import('../../core/auto-extract.js');
    const extracted = autoExtract(htmlResult.content || '', url);
    return textResult(safeStringify({ url, pageType: extracted.type, structured: extracted }));
  }

  // Field-based extraction (CSS selectors from field names)
  if (fields && fields.length > 0 && !schema) {
    const fieldSelectorMap: Record<string, string> = {
      price: '[class*="price"], [data-price]',
      title: 'h1, title',
      description: '[class*="description"], [class*="summary"]',
      image: 'img[class*="main"], img[class*="hero"]',
      name: 'h1, [class*="name"]',
      logo: 'img[class*="logo"], img[alt*="logo"]',
      colors: 'meta[name="theme-color"]',
      fonts: 'link[rel="stylesheet"]',
      socials: 'a[href*="twitter.com"], a[href*="linkedin.com"], a[href*="github.com"]',
    };
    const selectors: Record<string, string> = {};
    for (const field of fields) {
      selectors[field] = fieldSelectorMap[field] || `[class*="${field}"], [id*="${field}"]`;
    }
    const options: PeelOptions = { render, extract: { selectors } };
    const result = await Promise.race([
      peel(url, options),
      timeout<never>(60000, 'Field extraction'),
    ]) as PeelResult;
    return textResult(safeStringify(result));
  }

  // Schema-based extraction
  const options: PeelOptions = {
    render,
    extract: { schema },
  };
  const result = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'Schema extraction'),
  ]) as PeelResult;

  return textResult(safeStringify(result));
};
