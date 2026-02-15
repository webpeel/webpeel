/**
 * Tests for inline structured extraction (BYOK LLM)
 *
 * Tests:
 * - Core extractInlineJson function
 * - POST /v1/fetch with extract param
 * - POST /v2/scrape with extract param
 * - POST /v1/scrape (compat) with extract + formats
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

// Mock peel (used by fetch.ts and compat.ts via ../../index.js)
vi.mock('../index.js', () => ({
  peel: vi.fn(),
}));

// Mock inline extraction
vi.mock('../core/extract-inline.js', () => ({
  extractInlineJson: vi.fn(),
}));

// Mock crawler (used by compat.ts)
vi.mock('../core/crawler.js', () => ({
  crawl: vi.fn(),
}));

// Mock map (used by compat.ts)
vi.mock('../core/map.js', () => ({
  mapDomain: vi.fn(),
}));

// Mock undici (used by compat.ts search)
vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

// Mock URL validator
vi.mock('../server/middleware/url-validator.js', () => ({
  validateUrlForSSRF: vi.fn(),
  SSRFError: class SSRFError extends Error {},
}));

import { peel as mockPeel } from '../index.js';
import { extractInlineJson as mockExtractInline } from '../core/extract-inline.js';
import { createFetchRouter } from '../server/routes/fetch.js';
import { createCompatRouter } from '../server/routes/compat.js';
import type { AuthStore } from '../server/auth-store.js';
import type { IJobQueue } from '../server/job-queue.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockAuthStore(): AuthStore {
  return {
    validateKey: vi.fn().mockResolvedValue(null),
    trackUsage: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockJobQueue(): IJobQueue {
  return {
    createJob: vi.fn(),
    updateJob: vi.fn(),
    getJob: vi.fn(),
    cancelJob: vi.fn(),
    listJobs: vi.fn(),
    destroy: vi.fn(),
  };
}

const MOCK_PEEL_RESULT = {
  url: 'https://example.com',
  title: 'Example Page',
  content: '# Example\n\nProduct: Widget\nPrice: $29.99\nFeatures: fast, reliable',
  method: 'simple',
  elapsed: 120,
  tokens: 30,
  metadata: { description: 'An example page' },
  links: [],
};

const MOCK_EXTRACT_RESULT = {
  data: {
    title: 'Widget',
    price: 29.99,
    features: ['fast', 'reliable'],
  },
  tokensUsed: { input: 500, output: 80 },
};

// ---------------------------------------------------------------------------
// POST /v1/fetch — inline extraction
// ---------------------------------------------------------------------------

describe('POST /v1/fetch — inline extraction', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockPeel as any).mockResolvedValue({ ...MOCK_PEEL_RESULT });
    (mockExtractInline as any).mockResolvedValue({ ...MOCK_EXTRACT_RESULT });

    app = express();
    app.use(express.json());
    app.use(createFetchRouter(makeMockAuthStore()));
  });

  it('returns json field when extract + BYOK params are provided', async () => {
    const res = await request(app)
      .post('/v1/fetch')
      .send({
        url: 'https://example.com',
        extract: {
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              price: { type: 'number' },
            },
          },
          prompt: 'Extract the product info',
        },
        llmProvider: 'openai',
        llmApiKey: 'sk-test-key-1234567890abcdef',
      });

    expect(res.status).toBe(200);
    expect(res.body.json).toEqual(MOCK_EXTRACT_RESULT.data);
    expect(res.body.extractTokensUsed).toEqual(MOCK_EXTRACT_RESULT.tokensUsed);
    expect(res.body.content).toBeDefined();

    // Verify extractInlineJson was called with the right args
    expect(mockExtractInline).toHaveBeenCalledWith(
      MOCK_PEEL_RESULT.content,
      expect.objectContaining({
        llmProvider: 'openai',
        llmApiKey: 'sk-test-key-1234567890abcdef',
        schema: expect.objectContaining({ type: 'object' }),
        prompt: 'Extract the product info',
      }),
    );
  });

  it('works with Firecrawl-compatible formats array', async () => {
    const res = await request(app)
      .post('/v1/fetch')
      .send({
        url: 'https://example.com',
        formats: [
          {
            type: 'json',
            schema: { type: 'object', properties: { title: { type: 'string' } } },
            prompt: 'Get title',
          },
        ],
        llmProvider: 'anthropic',
        llmApiKey: 'sk-ant-test-key-1234567890',
      });

    expect(res.status).toBe(200);
    expect(res.body.json).toEqual(MOCK_EXTRACT_RESULT.data);
    expect(mockExtractInline).toHaveBeenCalledWith(
      MOCK_PEEL_RESULT.content,
      expect.objectContaining({
        llmProvider: 'anthropic',
        prompt: 'Get title',
      }),
    );
  });

  it('returns 400 if extract is provided but llmProvider is missing', async () => {
    const res = await request(app)
      .post('/v1/fetch')
      .send({
        url: 'https://example.com',
        extract: { schema: { type: 'object' } },
        llmApiKey: 'sk-test-key-1234567890abcdef',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.message).toContain('llmProvider');
  });

  it('returns 400 if extract is provided but llmApiKey is missing', async () => {
    const res = await request(app)
      .post('/v1/fetch')
      .send({
        url: 'https://example.com',
        extract: { schema: { type: 'object' } },
        llmProvider: 'openai',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.message).toContain('llmApiKey');
  });

  it('works without extract param (normal fetch)', async () => {
    const res = await request(app)
      .post('/v1/fetch')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(res.body.content).toBeDefined();
    expect(res.body.json).toBeUndefined();
    expect(mockExtractInline).not.toHaveBeenCalled();
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app).post('/v1/fetch').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 for invalid llmProvider value', async () => {
    const res = await request(app)
      .post('/v1/fetch')
      .send({
        url: 'https://example.com',
        extract: { prompt: 'Extract data' },
        llmProvider: 'invalid-provider',
        llmApiKey: 'sk-test-key-1234567890abcdef',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('llmProvider');
  });
});

// ---------------------------------------------------------------------------
// POST /v2/scrape — inline extraction (same handler)
// ---------------------------------------------------------------------------

describe('POST /v2/scrape — inline extraction', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockPeel as any).mockResolvedValue({ ...MOCK_PEEL_RESULT });
    (mockExtractInline as any).mockResolvedValue({ ...MOCK_EXTRACT_RESULT });

    app = express();
    app.use(express.json());
    app.use(createFetchRouter(makeMockAuthStore()));
  });

  it('returns json field on /v2/scrape', async () => {
    const res = await request(app)
      .post('/v2/scrape')
      .send({
        url: 'https://example.com',
        extract: {
          schema: { type: 'object', properties: { title: { type: 'string' } } },
        },
        llmProvider: 'google',
        llmApiKey: 'google-api-key-12345678901234',
      });

    expect(res.status).toBe(200);
    expect(res.body.json).toEqual(MOCK_EXTRACT_RESULT.data);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/scrape (compat) — inline extraction
// ---------------------------------------------------------------------------

describe('POST /v1/scrape (compat) — inline extraction', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockPeel as any).mockResolvedValue({ ...MOCK_PEEL_RESULT });
    (mockExtractInline as any).mockResolvedValue({ ...MOCK_EXTRACT_RESULT });

    app = express();
    app.use(express.json());
    app.use(createCompatRouter(makeMockJobQueue()));
  });

  it('supports extract param at top level', async () => {
    const res = await request(app)
      .post('/v1/scrape')
      .send({
        url: 'https://example.com',
        extract: {
          schema: { type: 'object', properties: { title: { type: 'string' } } },
          prompt: 'Get title',
        },
        llmProvider: 'openai',
        llmApiKey: 'sk-test-key-1234567890abcdef',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.json).toEqual(MOCK_EXTRACT_RESULT.data);
    expect(res.body.data.extractTokensUsed).toEqual(MOCK_EXTRACT_RESULT.tokensUsed);
  });

  it('supports Firecrawl-compatible formats array with json object', async () => {
    const res = await request(app)
      .post('/v1/scrape')
      .send({
        url: 'https://example.com',
        formats: [
          'markdown',
          {
            type: 'json',
            schema: { type: 'object', properties: { price: { type: 'number' } } },
            prompt: 'Get the price',
          },
        ],
        llmProvider: 'anthropic',
        llmApiKey: 'sk-ant-test-key-1234567890',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.json).toEqual(MOCK_EXTRACT_RESULT.data);
  });

  it('falls back to metadata when formats includes "json" string without LLM keys', async () => {
    const res = await request(app)
      .post('/v1/scrape')
      .send({
        url: 'https://example.com',
        formats: ['markdown', 'json'],
      });

    expect(res.status).toBe(200);
    // Should fall back to metadata, not call extractInlineJson
    expect(mockExtractInline).not.toHaveBeenCalled();
    expect(res.body.data.json).toBeDefined();
  });
});
