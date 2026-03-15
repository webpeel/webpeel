/**
 * Tests for structured-extract.ts — Firecrawl-compatible JSON schema extraction.
 *
 * 30+ tests covering:
 *   - LLM extraction with mock (prompt construction, JSON parsing)
 *   - Heuristic extraction (string, boolean, number fields)
 *   - Schema validation (required fields, type coercion)
 *   - Error handling (invalid schema, empty content, malformed LLM response)
 *   - Helper utilities (simpleToExtractionSchema, isTypeSchema)
 *   - Integration with route (createExtractRouter)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractStructured,
  simpleToExtractionSchema,
  isTypeSchema,
  type ExtractionSchema,
  type ExtractionResult,
} from '../core/structured-extract.js';

// ---------------------------------------------------------------------------
// Mock fetch for LLM calls
// ---------------------------------------------------------------------------

function makeLLMMock(jsonResponse: Record<string, unknown>, usage = { input: 200, output: 100 }) {
  const text = JSON.stringify(jsonResponse);
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: usage.input, completion_tokens: usage.output },
    }),
    text: async () => text,
    body: null,
  });
}

function makeLLMMockWithCodeFence(jsonResponse: Record<string, unknown>) {
  const text = '```json\n' + JSON.stringify(jsonResponse, null, 2) + '\n```';
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 300, completion_tokens: 150 },
    }),
    text: async () => text,
    body: null,
  });
}

function makeErrorMock(status: number, message: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: message }),
    text: async () => message,
    body: null,
  });
}

const SAMPLE_CONTENT = `
# Acme Corp

Acme Corp is an open source company building AI-powered tools.

**Company Mission**: To make AI accessible to everyone.

**Is Open Source**: Yes, our core product is open source.

**Employees**: 42

**Founded**: 2020
`;

const SAMPLE_SCHEMA: ExtractionSchema = {
  type: 'object',
  properties: {
    company_mission: { type: 'string', description: 'The company mission statement' },
    is_open_source: { type: 'boolean', description: 'Whether the product is open source' },
    employees: { type: 'number', description: 'Number of employees' },
  },
};

// ---------------------------------------------------------------------------
// simpleToExtractionSchema
// ---------------------------------------------------------------------------

describe('simpleToExtractionSchema', () => {
  it('converts a simple field:type map to ExtractionSchema', () => {
    const result = simpleToExtractionSchema({ company_name: 'string', is_active: 'boolean', score: 'number' });
    expect(result.type).toBe('object');
    expect(result.properties.company_name).toEqual({ type: 'string' });
    expect(result.properties.is_active).toEqual({ type: 'boolean' });
    expect(result.properties.score).toEqual({ type: 'number' });
  });

  it('handles empty input', () => {
    const result = simpleToExtractionSchema({});
    expect(result.type).toBe('object');
    expect(Object.keys(result.properties)).toHaveLength(0);
  });

  it('preserves all field names', () => {
    const fields = { a: 'string', b: 'boolean', c: 'number', d: 'array', e: 'object' };
    const result = simpleToExtractionSchema(fields);
    expect(Object.keys(result.properties)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

// ---------------------------------------------------------------------------
// isTypeSchema
// ---------------------------------------------------------------------------

describe('isTypeSchema', () => {
  it('returns true for type-name values', () => {
    expect(isTypeSchema({ name: 'string', active: 'boolean', count: 'number' })).toBe(true);
  });

  it('returns true for array and object types', () => {
    expect(isTypeSchema({ items: 'array', meta: 'object' })).toBe(true);
  });

  it('returns false for CSS selector values', () => {
    expect(isTypeSchema({ title: 'h1', price: '.price-tag' })).toBe(false);
  });

  it('returns false for mixed values', () => {
    expect(isTypeSchema({ name: 'string', title: 'h1' })).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isTypeSchema({})).toBe(false);
  });

  it('returns false when values are not strings', () => {
    expect(isTypeSchema({ count: 'string', valid: 'boolean' })).toBe(true);
    // Non-string value
    expect(isTypeSchema({ count: 42 } as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractStructured — empty content
// ---------------------------------------------------------------------------

describe('extractStructured - empty content', () => {
  it('returns zero confidence and empty data for empty string', async () => {
    const result = await extractStructured('', SAMPLE_SCHEMA);
    expect(result.data).toEqual({});
    expect(result.confidence).toBe(0);
    expect(result.tokensUsed).toBe(0);
  });

  it('returns zero confidence for whitespace-only content', async () => {
    const result = await extractStructured('   \n\t  ', SAMPLE_SCHEMA);
    expect(result.data).toEqual({});
    expect(result.confidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractStructured — invalid schema
// ---------------------------------------------------------------------------

describe('extractStructured - schema validation', () => {
  it('throws for null schema', async () => {
    await expect(extractStructured('content', null as any)).rejects.toThrow('Invalid schema');
  });

  it('throws for schema without type=object', async () => {
    await expect(
      extractStructured('content', { type: 'array', properties: {} } as any)
    ).rejects.toThrow('Invalid schema');
  });

  it('throws for schema without properties', async () => {
    await expect(
      extractStructured('content', { type: 'object' } as any)
    ).rejects.toThrow('Invalid schema');
  });
});

// ---------------------------------------------------------------------------
// extractStructured — heuristic extraction (no LLM)
// ---------------------------------------------------------------------------

describe('extractStructured - heuristic extraction', () => {
  it('extracts string fields from content', async () => {
    const result = await extractStructured(SAMPLE_CONTENT, SAMPLE_SCHEMA);
    expect(result.tokensUsed).toBe(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it('extracts boolean fields — positive indicator', async () => {
    const content = 'is_open_source: Yes, this is fully open source.';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: { is_open_source: { type: 'boolean' } },
    };
    const result = await extractStructured(content, schema);
    expect(result.data.is_open_source).toBe(true);
  });

  it('extracts boolean fields — negative indicator', async () => {
    const content = 'is_open_source: No, this is proprietary software.';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: { is_open_source: { type: 'boolean' } },
    };
    const result = await extractStructured(content, schema);
    expect(result.data.is_open_source).toBe(false);
  });

  it('extracts number fields from content', async () => {
    const content = 'employees: 42\nfounded: 2020';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: {
        employees: { type: 'number' },
        founded: { type: 'number' },
      },
    };
    const result = await extractStructured(content, schema);
    expect(result.data.employees).toBe(42);
    expect(result.data.founded).toBe(2020);
  });

  it('returns null for missing fields', async () => {
    const content = 'This is a page about cats.';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: { company_mission: { type: 'string' } },
    };
    const result = await extractStructured(content, schema);
    expect(result.data.company_mission).toBeNull();
  });

  it('confidence is proportional to fill rate', async () => {
    // Content matches 2 of 3 fields
    const content = 'company_mission: Build great things.\nemployees: 10';
    const result = await extractStructured(content, SAMPLE_SCHEMA);

    // Should be between 0.3 (no fields) and 0.5 (all fields)
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it('handles JSON-like string fields in content', async () => {
    const content = '"company_mission": "To innovate and inspire."';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: { company_mission: { type: 'string' } },
    };
    const result = await extractStructured(content, schema);
    expect(typeof result.data.company_mission).toBe('string');
  });

  it('confidence is 0.1 when no fields found (all null)', async () => {
    const content = 'A page with completely unrelated content about the weather.';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: { turnip_count: { type: 'number' }, pixel_density: { type: 'number' } },
    };
    const result = await extractStructured(content, schema);
    // When all fields are null (nothing extracted), confidence should be very low (0.1)
    expect(result.confidence).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// extractStructured — LLM extraction (mocked)
// ---------------------------------------------------------------------------

describe('extractStructured - LLM extraction', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls LLM with system prompt and schema', async () => {
    const mockFetch = makeLLMMock({ company_mission: 'Build great software', is_open_source: true, employees: 42 });
    globalThis.fetch = mockFetch;

    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('openai.com');
    const body = JSON.parse(opts.body as string);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Extract the following fields');
    expect(body.messages[1].content).toContain('"company_mission"');
  });

  it('includes optional prompt in user message', async () => {
    const mockFetch = makeLLMMock({ company_mission: 'AI tools' });
    globalThis.fetch = mockFetch;

    await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
      'Focus on the company mission',
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.messages[1].content).toContain('Focus on the company mission');
  });

  it('parses LLM JSON response correctly', async () => {
    globalThis.fetch = makeLLMMock({
      company_mission: 'To make AI accessible',
      is_open_source: true,
      employees: 42,
    });

    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
    );

    expect(result.data.company_mission).toBe('To make AI accessible');
    expect(result.data.is_open_source).toBe(true);
    expect(result.data.employees).toBe(42);
  });

  it('parses LLM response wrapped in code fences', async () => {
    globalThis.fetch = makeLLMMockWithCodeFence({
      company_mission: 'To empower developers',
      is_open_source: false,
      employees: 100,
    });

    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
    );

    expect(result.data.company_mission).toBe('To empower developers');
    expect(result.data.is_open_source).toBe(false);
  });

  it('reports token usage from LLM response', async () => {
    globalThis.fetch = makeLLMMock({ company_mission: 'Test' }, { input: 300, output: 150 });

    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
    );

    expect(result.tokensUsed).toBe(450);
  });

  it('confidence is high (0.85+) for full LLM response', async () => {
    globalThis.fetch = makeLLMMock({
      company_mission: 'Build AI tools',
      is_open_source: true,
      employees: 50,
    });

    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
    );

    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it('falls back to heuristic on malformed LLM response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Sorry, I cannot extract that data.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      text: async () => 'Sorry, I cannot extract that data.',
      body: null,
    });

    // Should not throw — falls back to heuristic
    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
    );

    expect(result).toBeDefined();
    expect(result.confidence).toBeLessThanOrEqual(0.5); // heuristic confidence
  });

  it('re-throws auth errors from LLM', async () => {
    globalThis.fetch = makeErrorMock(401, 'Unauthorized');

    await expect(
      extractStructured(SAMPLE_CONTENT, SAMPLE_SCHEMA, { provider: 'openai', apiKey: 'bad-key' })
    ).rejects.toThrow();
  });

  it('coerces string to boolean in LLM response', async () => {
    globalThis.fetch = makeLLMMock({ is_open_source: 'true' });

    const schema: ExtractionSchema = {
      type: 'object',
      properties: { is_open_source: { type: 'boolean' } },
    };

    const result = await extractStructured('content', schema, { provider: 'openai', apiKey: 'sk-test' });
    expect(result.data.is_open_source).toBe(true);
  });

  it('coerces number string to number in LLM response', async () => {
    globalThis.fetch = makeLLMMock({ employees: '42' });

    const schema: ExtractionSchema = {
      type: 'object',
      properties: { employees: { type: 'number' } },
    };

    const result = await extractStructured('content', schema, { provider: 'openai', apiKey: 'sk-test' });
    expect(result.data.employees).toBe(42);
  });

  it('sets null for fields missing in LLM response', async () => {
    globalThis.fetch = makeLLMMock({ company_mission: 'Test' }); // employees + is_open_source missing

    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'openai', apiKey: 'sk-test' },
    );

    expect(result.data.is_open_source).toBeNull();
    expect(result.data.employees).toBeNull();
  });

  it('uses Anthropic provider correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ company_mission: 'AI for all' }) }],
        usage: { input_tokens: 200, output_tokens: 80 },
      }),
      text: async () => JSON.stringify({ company_mission: 'AI for all' }),
      body: null,
    });
    globalThis.fetch = mockFetch;

    const result = await extractStructured(
      SAMPLE_CONTENT,
      SAMPLE_SCHEMA,
      { provider: 'anthropic', apiKey: 'sk-ant-test' },
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('anthropic.com');
    expect(result.data.company_mission).toBe('AI for all');
  });

  it('truncates very long content to 12000 chars', async () => {
    const longContent = 'x'.repeat(20000);
    const mockFetch = makeLLMMock({ company_mission: 'Test' });
    globalThis.fetch = mockFetch;

    await extractStructured(longContent, SAMPLE_SCHEMA, { provider: 'openai', apiKey: 'sk-test' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const userMsg = body.messages[1].content as string;
    // Content slice is 12000 chars max
    expect(userMsg.length).toBeLessThan(15000);
  });
});

// ---------------------------------------------------------------------------
// Route integration — createExtractRouter
// ---------------------------------------------------------------------------

describe('createExtractRouter', () => {
  it('exports createExtractRouter function', async () => {
    const mod = await import('../server/routes/extract.js');
    expect(typeof mod.createExtractRouter).toBe('function');
  });

  it('creates a router', async () => {
    const { createExtractRouter } = await import('../server/routes/extract.js');
    const router = createExtractRouter();
    expect(router).toBeDefined();
    expect(typeof router).toBe('function'); // Express router is a function
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('extractStructured - edge cases', () => {
  it('handles schema with required fields', async () => {
    const schema: ExtractionSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        required_field: { type: 'string' },
      },
      required: ['required_field'],
    };

    // Heuristic extraction (no LLM)
    const result = await extractStructured('name: Test Company', schema);
    expect(result).toBeDefined();
    // required_field is null since not in content — confidence might be lower
    expect(result.data.required_field).toBeNull();
  });

  it('extracts string from markdown bold pattern', async () => {
    const content = '**Company Mission**: To revolutionize data extraction.';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: { company_mission: { type: 'string' } },
    };
    const result = await extractStructured(content, schema);
    // Should find something via heuristic
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('returns tokensUsed=0 for heuristic extraction', async () => {
    const result = await extractStructured(SAMPLE_CONTENT, SAMPLE_SCHEMA);
    expect(result.tokensUsed).toBe(0);
  });

  it('handles content with colon-separated values', async () => {
    const content = 'employees: 150\nfounded: 2018\nrevenue: 5000000';
    const schema: ExtractionSchema = {
      type: 'object',
      properties: {
        employees: { type: 'number' },
        founded: { type: 'number' },
      },
    };
    const result = await extractStructured(content, schema);
    expect(result.data.employees).toBe(150);
    expect(result.data.founded).toBe(2018);
  });

  it('handles schema with single field', async () => {
    const schema: ExtractionSchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
    };
    const result = await extractStructured('# My Title\nSome content', schema);
    expect(result.confidence).toBeGreaterThan(0);
  });
});
