/**
 * Tests for the Actions API
 * - normalizeActions (format normalization + validation)
 * - /v2/scrape route with actions (POST)
 * - /v1/fetch route with actions query param (GET)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeActions, DEFAULT_ACTION_TIMEOUT_MS, MAX_TOTAL_ACTIONS_MS } from '../core/actions.js';

// ─── normalizeActions ────────────────────────────────────────────────────────

describe('normalizeActions', () => {
  it('returns undefined for falsy input', () => {
    expect(normalizeActions(undefined)).toBeUndefined();
    expect(normalizeActions(null)).toBeUndefined();
    expect(normalizeActions('')).toBeUndefined();
    expect(normalizeActions(0)).toBeUndefined();
  });

  it('throws on non-array input', () => {
    expect(() => normalizeActions('click')).toThrow('must be an array');
    expect(() => normalizeActions(42)).toThrow('must be an array');
    expect(() => normalizeActions({})).toThrow('must be an array');
  });

  it('throws on actions without type', () => {
    expect(() => normalizeActions([{ selector: 'x' }])).toThrow('missing type');
  });

  it('normalizes click action', () => {
    const result = normalizeActions([{ type: 'click', selector: '.btn' }]);
    expect(result).toEqual([{ type: 'click', selector: '.btn', timeout: undefined }]);
  });

  it('normalizes wait action with milliseconds (Firecrawl style)', () => {
    const result = normalizeActions([{ type: 'wait', milliseconds: 2000 }]);
    expect(result).toEqual([{ type: 'wait', ms: 2000, timeout: undefined }]);
  });

  it('normalizes wait action with ms', () => {
    const result = normalizeActions([{ type: 'wait', ms: 1500 }]);
    expect(result).toEqual([{ type: 'wait', ms: 1500, timeout: undefined }]);
  });

  it('normalizes wait action with default', () => {
    const result = normalizeActions([{ type: 'wait' }]);
    expect(result).toEqual([{ type: 'wait', ms: 1000, timeout: undefined }]);
  });

  it('normalizes type action with text alias (Firecrawl)', () => {
    const result = normalizeActions([{ type: 'type', selector: '#search', text: 'hello' }]);
    expect(result).toEqual([{ type: 'type', selector: '#search', value: 'hello', timeout: undefined }]);
  });

  it('normalizes type action with value', () => {
    const result = normalizeActions([{ type: 'type', selector: '#search', value: 'hello' }]);
    expect(result).toEqual([{ type: 'type', selector: '#search', value: 'hello', timeout: undefined }]);
  });

  it('normalizes scroll with direction and amount', () => {
    const result = normalizeActions([{ type: 'scroll', direction: 'down', amount: 500 }]);
    expect(result).toEqual([{
      type: 'scroll',
      direction: 'down',
      amount: 500,
      to: undefined,
      timeout: undefined,
    }]);
  });

  it('normalizes scroll with legacy to field', () => {
    const result = normalizeActions([{ type: 'scroll', to: 'bottom' }]);
    expect(result).toEqual([{
      type: 'scroll',
      direction: undefined,
      amount: undefined,
      to: 'bottom',
      timeout: undefined,
    }]);
  });

  it('normalizes press action', () => {
    const result = normalizeActions([{ type: 'press', key: 'Enter' }]);
    expect(result).toEqual([{ type: 'press', key: 'Enter', timeout: undefined }]);
  });

  it('normalizes select action', () => {
    const result = normalizeActions([{ type: 'select', selector: 'select#country', value: 'US' }]);
    expect(result).toEqual([{ type: 'select', selector: 'select#country', value: 'US', timeout: undefined }]);
  });

  it('normalizes screenshot action', () => {
    const result = normalizeActions([{ type: 'screenshot' }]);
    expect(result).toEqual([{ type: 'screenshot', timeout: undefined }]);
  });

  it('normalizes fill action with text alias', () => {
    const result = normalizeActions([{ type: 'fill', selector: '#input', text: 'data' }]);
    expect(result).toEqual([{ type: 'fill', selector: '#input', value: 'data', timeout: undefined }]);
  });

  it('normalizes hover action', () => {
    const result = normalizeActions([{ type: 'hover', selector: '.menu' }]);
    expect(result).toEqual([{ type: 'hover', selector: '.menu', timeout: undefined }]);
  });

  it('normalizes waitForSelector action', () => {
    const result = normalizeActions([{ type: 'waitForSelector', selector: '.loaded' }]);
    expect(result).toEqual([{ type: 'waitForSelector', selector: '.loaded', timeout: undefined }]);
  });

  it('preserves timeout override', () => {
    const result = normalizeActions([{ type: 'click', selector: '.btn', timeout: 10000 }]);
    expect(result).toEqual([{ type: 'click', selector: '.btn', timeout: 10000 }]);
  });

  it('handles full Firecrawl-style actions array', () => {
    const input = [
      { type: 'click', selector: 'button.load-more' },
      { type: 'type', selector: '#search', text: 'hello' },
      { type: 'scroll', direction: 'down', amount: 500 },
      { type: 'wait', milliseconds: 2000 },
      { type: 'press', key: 'Enter' },
      { type: 'screenshot' },
      { type: 'select', selector: 'select#country', value: 'US' },
    ];
    const result = normalizeActions(input);
    expect(result).toHaveLength(7);
    expect(result![0]!.type).toBe('click');
    expect(result![1]!.type).toBe('type');
    expect(result![1]!.value).toBe('hello');
    expect(result![2]!.type).toBe('scroll');
    expect(result![2]!.direction).toBe('down');
    expect(result![2]!.amount).toBe(500);
    expect(result![3]!.type).toBe('wait');
    expect(result![3]!.ms).toBe(2000);
    expect(result![4]!.type).toBe('press');
    expect(result![4]!.key).toBe('Enter');
    expect(result![5]!.type).toBe('screenshot');
    expect(result![6]!.type).toBe('select');
    expect(result![6]!.value).toBe('US');
  });

  it('returns empty array for empty input', () => {
    expect(normalizeActions([])).toEqual([]);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('action constants', () => {
  it('has correct default timeout', () => {
    expect(DEFAULT_ACTION_TIMEOUT_MS).toBe(5000);
  });

  it('has correct max total timeout', () => {
    expect(MAX_TOTAL_ACTIONS_MS).toBe(30000);
  });
});

// ─── POST /v2/scrape route ──────────────────────────────────────────────────

// Mock peel function globally for route tests
vi.mock('../index.js', async () => ({
  peel: vi.fn().mockResolvedValue({
    url: 'https://example.com',
    title: 'Test',
    content: '# Test',
    method: 'browser',
    elapsed: 100,
    tokens: 50,
    metadata: {},
    links: [],
    fingerprint: 'abc123',
    quality: 0.9,
  }),
}));

import { peel as mockPeel } from '../index.js';
import express, { Express } from 'express';
import request from 'supertest';
import { createFetchRouter } from '../server/routes/fetch.js';
import { InMemoryAuthStore } from '../server/auth-store.js';

describe('POST /v2/scrape with actions', () => {
  let app: Express;
  let authStore: InMemoryAuthStore;

  beforeEach(() => {
    vi.clearAllMocks();
    authStore = new InMemoryAuthStore();
    app = express();
    app.use(express.json());
    app.use(createFetchRouter(authStore));
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app).post('/v2/scrape').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid URL', async () => {
    const res = await request(app).post('/v2/scrape').send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('calls peel with correct options for basic request', async () => {
    const res = await request(app)
      .post('/v2/scrape')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(mockPeel).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ format: 'markdown' }),
    );
  });

  it('forces render when actions provided', async () => {
    const res = await request(app)
      .post('/v2/scrape')
      .send({
        url: 'https://example.com',
        actions: [
          { type: 'click', selector: 'button' },
          { type: 'wait', milliseconds: 1000 },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockPeel).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        render: true,
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'click', selector: 'button' }),
          expect.objectContaining({ type: 'wait', ms: 1000 }),
        ]),
      }),
    );
  });

  it('normalizes Firecrawl-style scroll action', async () => {
    await request(app)
      .post('/v2/scrape')
      .send({
        url: 'https://example.com',
        actions: [{ type: 'scroll', direction: 'down', amount: 500 }],
      });

    expect(mockPeel).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        render: true,
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'scroll', direction: 'down', amount: 500 }),
        ]),
      }),
    );
  });

  it('returns 400 for invalid actions', async () => {
    const res = await request(app)
      .post('/v2/scrape')
      .send({
        url: 'https://example.com',
        actions: 'not-an-array',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/v2/scrape')
      .send({ url: 'https://example.com', format: 'xml' });

    expect(res.status).toBe(400);
  });
});

describe('POST /v1/fetch with actions', () => {
  let app: Express;
  let authStore: InMemoryAuthStore;

  beforeEach(() => {
    vi.clearAllMocks();
    authStore = new InMemoryAuthStore();
    app = express();
    app.use(express.json());
    app.use(createFetchRouter(authStore));
  });

  it('forces render when actions provided in POST body', async () => {
    const res = await request(app)
      .post('/v1/fetch')
      .send({
        url: 'https://example.com',
        actions: [
          { type: 'click', selector: '.load-more' },
          { type: 'wait', ms: 2000 },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockPeel).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        render: true,
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'click', selector: '.load-more' }),
          expect.objectContaining({ type: 'wait', ms: 2000 }),
        ]),
      }),
    );
  });
});
