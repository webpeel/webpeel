/**
 * Tests for LLM-based extraction module.
 * No actual API calls — all fetch responses are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildUserMessage,
  parseItems,
  estimateCost,
  extractWithLLM,
  convertSimpleToJsonSchema,
  isFullJsonSchema,
  type LLMExtractionOptions,
} from '../core/llm-extract.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockFetch(items: Array<Record<string, any>>, usage = { prompt_tokens: 1000, completion_tokens: 500 }) {
  const body = JSON.stringify({ items });
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: body } }],
      usage,
      model: 'gpt-4o-mini',
    }),
    text: async () => body,
  });
}

// ---------------------------------------------------------------------------
// convertSimpleToJsonSchema
// ---------------------------------------------------------------------------

describe('convertSimpleToJsonSchema', () => {
  it('converts a simple flat object with string values', () => {
    const example = { name: '', price: '', url: '' };
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.type).toBe('object');
    expect(schema.properties.name).toEqual({ type: 'string' });
    expect(schema.properties.price).toEqual({ type: 'string' });
    expect(schema.properties.url).toEqual({ type: 'string' });
  });

  it('converts an array of objects', () => {
    const example = [{ name: '', price: '', url: '' }];
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.type).toBe('array');
    expect(schema.items.type).toBe('object');
    expect(schema.items.properties.name).toEqual({ type: 'string' });
  });

  it('converts nested objects', () => {
    const example = { product: { name: '', price: 0 }, rating: 4.5 };
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.type).toBe('object');
    expect(schema.properties.product.type).toBe('object');
    expect(schema.properties.product.properties.name).toEqual({ type: 'string' });
    expect(schema.properties.product.properties.price).toEqual({ type: 'integer' });
    expect(schema.properties.rating).toEqual({ type: 'number' });
  });

  it('converts integer values correctly', () => {
    const example = { count: 0 };
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.properties.count).toEqual({ type: 'integer' });
  });

  it('converts float values correctly', () => {
    const example = { rating: 4.5 };
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.properties.rating).toEqual({ type: 'number' });
  });

  it('handles boolean values', () => {
    const example = { inStock: false };
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.properties.inStock).toEqual({ type: 'boolean' });
  });

  it('handles arrays with objects containing nested arrays', () => {
    const example = { products: [{ name: '', tags: [''] }] };
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.properties.products.type).toBe('array');
    expect(schema.properties.products.items.properties.name).toEqual({ type: 'string' });
    expect(schema.properties.products.items.properties.tags.type).toBe('array');
  });

  it('handles empty objects', () => {
    const example = {};
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.type).toBe('object');
    expect(schema.properties).toEqual({});
  });

  it('handles empty arrays', () => {
    const example: unknown[] = [];
    const schema = convertSimpleToJsonSchema(example as any) as any;
    expect(schema.type).toBe('array');
  });

  it('converts the Firecrawl-style example correctly', () => {
    const example = { products: [{ name: '', price: '', url: '' }] };
    const schema = convertSimpleToJsonSchema(example) as any;
    expect(schema.type).toBe('object');
    expect(schema.properties.products.type).toBe('array');
    expect(schema.properties.products.items.type).toBe('object');
    expect(Object.keys(schema.properties.products.items.properties)).toEqual(['name', 'price', 'url']);
  });
});

// ---------------------------------------------------------------------------
// isFullJsonSchema
// ---------------------------------------------------------------------------

describe('isFullJsonSchema', () => {
  it('returns true for a full JSON Schema object', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'number' },
      },
    };
    expect(isFullJsonSchema(schema)).toBe(true);
  });

  it('returns false for a simple example object', () => {
    const example = { name: '', price: '' };
    expect(isFullJsonSchema(example)).toBe(false);
  });

  it('returns false for an array example', () => {
    const example = [{ name: '' }];
    expect(isFullJsonSchema(example as any)).toBe(false);
  });

  it('returns false when type is missing but properties is present', () => {
    const schema = { properties: { name: { type: 'string' } } };
    expect(isFullJsonSchema(schema)).toBe(false);
  });

  it('returns false when type is object but properties is missing', () => {
    const schema = { type: 'object' };
    expect(isFullJsonSchema(schema)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildUserMessage
// ---------------------------------------------------------------------------

describe('buildUserMessage', () => {
  it('includes content in the message', () => {
    const msg = buildUserMessage('Hello world');
    expect(msg).toContain('Hello world');
  });

  it('appends custom instruction when provided', () => {
    const msg = buildUserMessage('Some content', 'extract all links');
    expect(msg).toContain('extract all links');
  });

  it('does NOT append instruction section when instruction is undefined', () => {
    const msg = buildUserMessage('Some content');
    expect(msg).not.toContain('Additional instruction:');
  });

  it('includes schema when provided', () => {
    const schema = { title: 'string', price: 'number' };
    const msg = buildUserMessage('Some content', undefined, schema);
    expect(msg).toContain('Extract data matching this schema:');
    expect(msg).toContain('"title"');
    expect(msg).toContain('"price"');
  });

  it('includes both instruction and schema when both provided', () => {
    const schema = { name: 'string' };
    const msg = buildUserMessage('content', 'focus on hotels', schema);
    expect(msg).toContain('focus on hotels');
    expect(msg).toContain('Extract data matching this schema:');
  });

  it('includes a full JSON Schema in the user message', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'number' },
      },
    };
    const msg = buildUserMessage('content', undefined, schema);
    expect(msg).toContain('"properties"');
    expect(msg).toContain('"name"');
  });
});

// ---------------------------------------------------------------------------
// Content truncation
// ---------------------------------------------------------------------------

describe('Content truncation', () => {
  it('truncates content over 100K chars to 50K chars', () => {
    const long = 'A'.repeat(200_000);
    const msg = buildUserMessage(long);
    // The truncated slice is 50K chars; the message adds some prefix text
    // Check the total content portion is <= 50K + overhead
    const contentStart = msg.indexOf('A');
    const contentEnd = msg.lastIndexOf('A');
    const extractedContent = msg.slice(contentStart, contentEnd + 1);
    expect(extractedContent.length).toBe(50_000);
  });

  it('does NOT truncate content under 100K chars', () => {
    const short = 'B'.repeat(1000);
    const msg = buildUserMessage(short);
    // Content should appear verbatim
    expect(msg).toContain('B'.repeat(1000));
  });
});

// ---------------------------------------------------------------------------
// parseItems
// ---------------------------------------------------------------------------

describe('parseItems', () => {
  it('parses { items: [...] } format', () => {
    const text = JSON.stringify({ items: [{ title: 'Hotel A', price: '$99' }] });
    const result = parseItems(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Hotel A');
    expect(result[0]!.price).toBe('$99');
  });

  it('parses bare array format', () => {
    const text = JSON.stringify([{ title: 'Hotel A' }, { title: 'Hotel B' }]);
    const result = parseItems(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.title).toBe('Hotel A');
  });

  it('parses { data: [...] } format', () => {
    const text = JSON.stringify({ data: [{ name: 'Product X' }] });
    const result = parseItems(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Product X');
  });

  it('parses { results: [...] } format', () => {
    const text = JSON.stringify({ results: [{ id: 1 }] });
    const result = parseItems(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(1);
  });

  it('wraps a single object in an array', () => {
    const text = JSON.stringify({ title: 'Single Item' });
    const result = parseItems(text);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]!.title).toBe('Single Item');
  });

  it('throws on completely invalid JSON', () => {
    expect(() => parseItems('not json at all!!!!')).toThrow();
  });

  it('parses schema-shaped response (object with schema keys)', () => {
    const schemaResponse = { products: [{ name: 'Widget', price: '$9.99' }] };
    const result = parseItems(JSON.stringify(schemaResponse));
    // single object wrapped in array
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]!.products).toBeDefined();
  });

  it('handles JSON embedded in text (with preamble)', () => {
    const text = 'Sure, here is the JSON:\n[{"title":"Item A"}]';
    const result = parseItems(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Item A');
  });

  it('handles JSON object embedded in text', () => {
    const text = 'Here is the result:\n{"name":"Widget","price":"$5"}';
    const result = parseItems(text);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]!.name).toBe('Widget');
  });
});

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

describe('estimateCost', () => {
  it('calculates gpt-4o-mini cost correctly', () => {
    // 1000 input tokens: 1000/1M * $0.15 = $0.00015
    // 500 output tokens: 500/1M * $0.60 = $0.0003
    // Total: $0.00045
    const cost = estimateCost('gpt-4o-mini', 1000, 500);
    expect(cost).toBeCloseTo(0.00045, 8);
  });

  it('calculates gpt-4o cost correctly', () => {
    // 1000 input: $0.0025; 500 output: $0.005 => $0.0075
    const cost = estimateCost('gpt-4o', 1000, 500);
    expect(cost).toBeCloseTo(0.0075, 8);
  });

  it('returns undefined for unknown models', () => {
    const cost = estimateCost('llama-3-70b', 1000, 500);
    expect(cost).toBeUndefined();
  });

  it('handles zero tokens', () => {
    const cost = estimateCost('gpt-4o-mini', 0, 0);
    expect(cost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractWithLLM — full integration (fetch mocked)
// ---------------------------------------------------------------------------

describe('extractWithLLM', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws a clear error when no API key is provided', async () => {
    // Remove env var in case it's set
    const origEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await expect(
      extractWithLLM({ content: 'some content' })
    ).rejects.toThrow(/API key/i);

    process.env.OPENAI_API_KEY = origEnv;
  });

  it('returns items from mocked { items: [...] } response', async () => {
    global.fetch = makeMockFetch([{ title: 'Hotel A', price: '$99' }]);

    const result = await extractWithLLM({
      content: 'Hotel A - $99 per night',
      apiKey: 'sk-test-key',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe('Hotel A');
    expect(result.items[0]!.price).toBe('$99');
  });

  it('returns items from bare array response', async () => {
    const items = [{ title: 'Hotel A' }, { title: 'Hotel B' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(items) } }],
        usage: { prompt_tokens: 500, completion_tokens: 200 },
        model: 'gpt-4o-mini',
      }),
      text: async () => JSON.stringify(items),
    });

    const result = await extractWithLLM({
      content: 'Hotel A and Hotel B',
      apiKey: 'sk-test-key',
    });

    expect(result.items).toHaveLength(2);
  });

  it('reports token usage correctly', async () => {
    global.fetch = makeMockFetch(
      [{ title: 'Item 1' }],
      { prompt_tokens: 1000, completion_tokens: 500 }
    );

    const result = await extractWithLLM({
      content: 'content',
      apiKey: 'sk-test-key',
    });

    expect(result.tokensUsed.input).toBe(1000);
    expect(result.tokensUsed.output).toBe(500);
  });

  it('calculates cost estimate', async () => {
    global.fetch = makeMockFetch(
      [],
      { prompt_tokens: 1000, completion_tokens: 500 }
    );

    const result = await extractWithLLM({
      content: 'content',
      apiKey: 'sk-test-key',
      model: 'gpt-4o-mini',
    });

    expect(result.cost).toBeCloseTo(0.00045, 8);
  });

  it('throws on 401 unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      extractWithLLM({ content: 'content', apiKey: 'sk-invalid' })
    ).rejects.toThrow(/authentication failed/i);
  });

  it('throws on 429 rate limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    });

    await expect(
      extractWithLLM({ content: 'content', apiKey: 'sk-test-key' })
    ).rejects.toThrow(/rate limit/i);
  });

  it('uses custom model and baseUrl', async () => {
    let capturedUrl = '';
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '[]' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: 'gpt-3.5-turbo',
        }),
        text: async () => '[]',
      };
    });

    await extractWithLLM({
      content: 'test',
      apiKey: 'sk-test',
      model: 'gpt-3.5-turbo',
      baseUrl: 'https://custom.api.com/v1',
    });

    expect(capturedUrl).toBe('https://custom.api.com/v1/chat/completions');
    expect(capturedBody.model).toBe('gpt-3.5-turbo');
  });

  it('sends instruction in user message when provided', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '[]' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '[]',
      };
    });

    await extractWithLLM({
      content: 'test content',
      instruction: 'only extract hotel names',
      apiKey: 'sk-test',
    });

    const userContent = capturedBody.messages[1].content;
    expect(userContent).toContain('only extract hotel names');
  });

  // -------------------------------------------------------------------------
  // Schema-aware tests (new)
  // -------------------------------------------------------------------------

  it('uses schema-aware system prompt when schema is provided', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ name: 'Widget', price: '$5' }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '{}',
      };
    });

    await extractWithLLM({
      content: 'Widget is $5',
      apiKey: 'sk-test',
      schema: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'string' } } },
    });

    const systemPrompt = capturedBody.messages[0].content;
    expect(systemPrompt).toContain('EXACTLY matches the provided schema');
    expect(systemPrompt).not.toContain('Return a JSON array');
  });

  it('uses generic system prompt when NO schema is provided', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '[]' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '[]',
      };
    });

    await extractWithLLM({ content: 'test', apiKey: 'sk-test' });

    const systemPrompt = capturedBody.messages[0].content;
    expect(systemPrompt).toContain('Return a JSON array');
  });

  it('uses json_schema response_format for full JSON Schema', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ name: 'Widget', price: '$5' }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '{}',
      };
    });

    const fullSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'string' },
      },
    };

    await extractWithLLM({
      content: 'Widget - $5',
      apiKey: 'sk-test',
      schema: fullSchema,
    });

    expect(capturedBody.response_format.type).toBe('json_schema');
    expect(capturedBody.response_format.json_schema.name).toBe('extraction');
    expect(capturedBody.response_format.json_schema.strict).toBe(true);
  });

  it('uses json_object response_format for simple example schema', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"products":[{"name":"Widget","price":"$5"}]}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '{}',
      };
    });

    // Simple example schema (no type/properties)
    const simpleSchema = { products: [{ name: '', price: '' }] };

    await extractWithLLM({
      content: 'Widget - $5',
      apiKey: 'sk-test',
      schema: simpleSchema,
    });

    // Simple schemas get converted to full JSON Schema internally, which has type+properties
    // so they now use json_schema format
    expect(capturedBody.response_format.type).toBeDefined();
  });

  it('auto-converts simple schema to full JSON Schema before sending', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"name":"Widget"}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '{}',
      };
    });

    const simpleSchema = { name: '', price: '' };

    await extractWithLLM({
      content: 'Widget - $5',
      apiKey: 'sk-test',
      schema: simpleSchema,
    });

    // The user message should contain the CONVERTED schema (with type/properties)
    const userMsg = capturedBody.messages[1].content;
    expect(userMsg).toContain('"type"');
    expect(userMsg).toContain('"properties"');
  });

  it('passes schema in user message when schema is provided', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '[]' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '[]',
      };
    });

    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };

    await extractWithLLM({
      content: 'some content',
      apiKey: 'sk-test',
      schema,
    });

    const userContent = capturedBody.messages[1].content;
    expect(userContent).toContain('Extract data matching this schema:');
    expect(userContent).toContain('"name"');
  });

  it('works with both schema and instruction together', async () => {
    let capturedBody: any = {};

    global.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"name":"Widget","price":"$5"}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o-mini',
        }),
        text: async () => '{}',
      };
    });

    await extractWithLLM({
      content: 'Widget for $5',
      apiKey: 'sk-test',
      instruction: 'Focus on product details',
      schema: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'string' } } },
    });

    const userContent = capturedBody.messages[1].content;
    expect(userContent).toContain('Focus on product details');
    expect(userContent).toContain('Extract data matching this schema:');
  });
});
