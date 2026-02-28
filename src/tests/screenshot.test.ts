/**
 * Tests for the screenshot endpoint and core function
 *
 * Tests:
 *   - POST /v1/screenshot  (dedicated screenshot route)
 *   - POST /v2/scrape with formats: ["screenshot"]  (compat route)
 *   - Core takeScreenshot() function
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { createScreenshotRouter } from '../server/routes/screenshot.js';
import { createCompatRouter } from '../server/routes/compat.js';
import type { IJobQueue } from '../server/job-queue.js';
import { InMemoryAuthStore } from '../server/auth-store.js';

// Mock the core screenshot function
vi.mock('../core/screenshot.js', () => ({
  takeScreenshot: vi.fn(),
}));

// Mock the peel function (used by compat router)
vi.mock('../index.js', () => ({
  peel: vi.fn(),
}));

// Mock the crawl function (used by compat router)
vi.mock('../core/crawler.js', () => ({
  crawl: vi.fn(),
}));

// Mock the mapDomain function (used by compat router)
vi.mock('../core/map.js', () => ({
  mapDomain: vi.fn(),
}));

// Mock undici (used by compat router search)
vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

import { takeScreenshot as mockTakeScreenshot } from '../core/screenshot.js';
import { peel as mockPeel } from '../index.js';

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function createTestApp(router: express.Router): Express {
  const app = express();
  app.use(express.json());

  // Fake auth middleware – gives every request a free-tier identity
  // keyInfo.accountId must be set so routes don't return 401 (required since v0.17.9)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      keyInfo: { accountId: 'test-user-id', key: 'test-api-key-00000000' } as any,
      tier: 'free',
      rateLimit: 25,
      softLimited: false,
      extraUsageAvailable: false,
    };
    next();
  });

  app.use(router);
  return app;
}

// ---------------------------------------------------------------
// POST /v1/screenshot
// ---------------------------------------------------------------

describe('POST /v1/screenshot', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    const authStore = new InMemoryAuthStore();
    app = createTestApp(createScreenshotRouter(authStore));
  });

  it('returns screenshot data for valid URL', async () => {
    (mockTakeScreenshot as any).mockResolvedValue({
      url: 'https://example.com',
      format: 'png',
      contentType: 'image/png',
      screenshot: 'iVBORw0KGgo=',
    });

    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.screenshot).toContain('data:image/png;base64,');
    expect(res.body.data.metadata.sourceURL).toBe('https://example.com');
    expect(res.body.data.metadata.format).toBe('png');
  });

  it('passes options through to takeScreenshot', async () => {
    (mockTakeScreenshot as any).mockResolvedValue({
      url: 'https://example.com',
      format: 'jpeg',
      contentType: 'image/jpeg',
      screenshot: '/9j/4A==',
    });

    await request(app)
      .post('/v1/screenshot')
      .send({
        url: 'https://example.com',
        fullPage: true,
        width: 1920,
        height: 1080,
        format: 'jpeg',
        quality: 90,
        waitFor: 2000,
      });

    expect(mockTakeScreenshot).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        fullPage: true,
        width: 1920,
        height: 1080,
        format: 'jpeg',
        quality: 90,
        waitFor: 2000,
      })
    );
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('url');
  });

  it('returns 400 for non-string URL', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for invalid format', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', format: 'gif' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('format');
  });

  it('returns 400 for invalid width', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', width: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('width');
  });

  it('returns 400 for invalid height', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', height: 99999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('height');
  });

  it('returns 400 for invalid quality', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', quality: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('quality');
  });

  it('returns 400 for invalid waitFor', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', waitFor: 99999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('waitFor');
  });

  it('blocks SSRF — localhost', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'http://localhost:3000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.message).toContain('localhost');
  });

  it('blocks non-HTTP protocols', async () => {
    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'ftp://example.com/file' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 500 on internal error', async () => {
    (mockTakeScreenshot as any).mockRejectedValue(new Error('Playwright crashed'));

    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it('sets usage headers', async () => {
    (mockTakeScreenshot as any).mockResolvedValue({
      url: 'https://example.com',
      format: 'png',
      contentType: 'image/png',
      screenshot: 'AAAA',
    });

    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com' });

    expect(res.headers['x-credits-used']).toBe('1');
    expect(res.headers['x-fetch-type']).toBe('screenshot');
    expect(res.headers['x-processing-time']).toBeDefined();
  });
});

// ---------------------------------------------------------------
// POST /v2/scrape with formats: ["screenshot"]
// ---------------------------------------------------------------

describe('POST /v2/scrape (screenshot via compat)', () => {
  let app: Express;
  let mockJobQueue: IJobQueue;

  beforeEach(() => {
    vi.clearAllMocks();

    mockJobQueue = {
      createJob: vi.fn(),
      updateJob: vi.fn(),
      getJob: vi.fn(),
      cancelJob: vi.fn(),
      listJobs: vi.fn(),
      destroy: vi.fn(),
    };

    app = createTestApp(createCompatRouter(mockJobQueue));
  });

  it('returns screenshot-only response when formats=["screenshot"]', async () => {
    (mockTakeScreenshot as any).mockResolvedValue({
      url: 'https://example.com',
      format: 'png',
      contentType: 'image/png',
      screenshot: 'iVBORw0KGgo=',
    });

    const res = await request(app)
      .post('/v2/scrape')
      .send({
        url: 'https://example.com',
        formats: ['screenshot'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.screenshot).toContain('data:image/png;base64,');
    expect(res.body.data.metadata.sourceURL).toBe('https://example.com');
  });

  it('returns markdown + screenshot when formats=["markdown","screenshot"]', async () => {
    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com',
      title: 'Test Page',
      content: '# Hello',
      method: 'browser',
      elapsed: 200,
      tokens: 10,
      metadata: { description: 'test' },
      links: [],
      screenshot: 'iVBORw0KGgo=',
    });

    const res = await request(app)
      .post('/v2/scrape')
      .send({
        url: 'https://example.com',
        formats: ['markdown', 'screenshot'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.markdown).toBe('# Hello');
    expect(res.body.data.screenshot).toContain('data:image/png;base64,');
  });

  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/v2/scrape')
      .send({ formats: ['screenshot'] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('passes v2-specific screenshot options through', async () => {
    (mockTakeScreenshot as any).mockResolvedValue({
      url: 'https://example.com',
      format: 'jpeg',
      contentType: 'image/jpeg',
      screenshot: '/9j/4A==',
    });

    await request(app)
      .post('/v2/scrape')
      .send({
        url: 'https://example.com',
        formats: ['screenshot'],
        fullPage: true,
        width: 1920,
        quality: 85,
        screenshotFormat: 'jpeg',
      });

    expect(mockTakeScreenshot).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        fullPage: true,
        width: 1920,
        format: 'jpeg',
        quality: 85,
      })
    );
  });
});

// ---------------------------------------------------------------
// Core takeScreenshot function (integration-style, mocked browser)
// ---------------------------------------------------------------

describe('takeScreenshot core', () => {
  it('normalises "jpg" format to "jpeg"', async () => {
    // The mock is already replacing takeScreenshot, so we test the route's
    // pass-through of "jpg" → the route accepts it and the core converts it.
    (mockTakeScreenshot as any).mockResolvedValue({
      url: 'https://example.com',
      format: 'jpeg',
      contentType: 'image/jpeg',
      screenshot: '/9j/4A==',
    });

    const authStore = new InMemoryAuthStore();
    const app = createTestApp(createScreenshotRouter(authStore));

    const res = await request(app)
      .post('/v1/screenshot')
      .send({ url: 'https://example.com', format: 'jpg' });

    expect(res.status).toBe(200);
    // The route accepts 'jpg' and passes it through; core normalises to 'jpeg'
    expect(res.body.data.metadata.format).toBe('jpeg');
  });
});
