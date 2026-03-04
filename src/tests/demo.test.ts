/**
 * Tests for GET /v1/demo
 *
 * Covers:
 * - Allowed domain returns 200 with content
 * - Blocked domain returns 403
 * - Rate limit returns 429 after 3 requests
 * - Response is truncated to 2000 chars
 * - Cache hit returns same content faster
 * - SSRF URLs (localhost, 169.254.x) are blocked
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { RateLimiter } from '../server/middleware/rate-limit.js';

// ── Mock simpleFetch to avoid real network calls ──────────────────────────────

const MOCK_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Stripe | Financial Infrastructure for the Internet</title>
  <meta name="description" content="Stripe payment infrastructure" />
</head>
<body>
  <main>
    <h1>Stripe</h1>
    <p>Financial infrastructure for the internet. Millions of companies use Stripe to accept payments.</p>
    <p>Stripe is a payment processing platform that offers a suite of APIs for accepting payments.</p>
  </main>
</body>
</html>
`;

const LONG_CONTENT_CHARS = 'A sentence about payments. '.repeat(300); // ~8100 chars
const MOCK_LONG_HTML = `
<!DOCTYPE html>
<html>
<head><title>Long Page</title></head>
<body><main><p>${LONG_CONTENT_CHARS}</p></main></body>
</html>
`;

vi.mock('../core/http-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/http-fetch.js')>();
  return {
    ...actual,
    simpleFetch: vi.fn(async (url: string) => {
      const isLong = url.includes('long');
      return {
        html: isLong ? MOCK_LONG_HTML : MOCK_HTML,
        url,
        statusCode: 200,
        contentType: 'text/html',
      };
    }),
    // Keep the real validateUrl for SSRF protection tests
    validateUrl: actual.validateUrl,
  };
});

// ── App factory ───────────────────────────────────────────────────────────────

/**
 * Create a fresh app with fresh rate limiters each time.
 * This prevents rate limit state from bleeding between tests.
 */
async function makeApp(limitPerMinute = 100, limitPerDay = 1000) {
  // Dynamic import so the mock applies
  const { createDemoRouter } = await import('../server/routes/demo.js');
  const app = express();
  app.use(express.json());
  app.use(createDemoRouter({
    perMinute: new RateLimiter(60_000),
    perDay: new RateLimiter(24 * 60 * 60 * 1000),
  }));
  return { app, limitPerMinute, limitPerDay };
}

/**
 * Create a fresh app with tight rate limits for rate-limit testing.
 */
async function makeTightLimitApp() {
  const { createDemoRouter } = await import('../server/routes/demo.js');
  const tightMinute = new RateLimiter(60_000);
  const tightDay = new RateLimiter(24 * 60 * 60 * 1000);
  const app = express();
  app.use(express.json());
  app.use(createDemoRouter({ perMinute: tightMinute, perDay: tightDay }));
  return { app, tightMinute, tightDay };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_URL = 'https://stripe.com';
const BLOCKED_URL = 'https://evil.com/steal-data';
const SSRF_LOCALHOST = 'http://localhost:3000/internal';
const SSRF_METADATA = 'http://169.254.169.254/latest/meta-data/';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /v1/demo', () => {
  // ── Missing URL ──────────────────────────────────────────────────────────────

  it('returns 400 when url is missing', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/v1/demo');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  // ── Blocked domain ───────────────────────────────────────────────────────────

  it('returns 403 for blocked domain', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: BLOCKED_URL });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/domain not allowed/i);
  });

  it('returns 403 for subdomain not in allowlist (api.stripe.com)', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: 'https://api.stripe.com/v1/charges' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/domain not allowed/i);
  });

  // ── SSRF blocking ────────────────────────────────────────────────────────────

  it('blocks localhost SSRF attempts', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: SSRF_LOCALHOST });

    // localhost is not in the allowlist → 403 before SSRF check
    expect([400, 403]).toContain(res.status);
    expect(res.body.error).toBeDefined();
  });

  it('blocks link-local SSRF (169.254.x.x)', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: SSRF_METADATA });

    // 169.254.x.x is not in the allowlist → 403
    expect([400, 403]).toContain(res.status);
    expect(res.body.error).toBeDefined();
  });

  // ── Successful fetch ─────────────────────────────────────────────────────────

  it('returns 200 with content for allowed domain', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: ALLOWED_URL });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
    expect(typeof res.body.content).toBe('string');
    expect(res.body.content.length).toBeGreaterThan(0);
    expect(res.body.demo).toBe(true);
    expect(res.body.signUpUrl).toBe('https://app.webpeel.dev');
    expect(typeof res.body.fetchTimeMs).toBe('number');
    expect(typeof res.body.wordCount).toBe('number');
  });

  it('includes a title in the response', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: ALLOWED_URL });

    expect(res.status).toBe(200);
    expect(typeof res.body.title).toBe('string');
  });

  // ── Content truncation ───────────────────────────────────────────────────────

  it('truncates content to max 2000 chars', async () => {
    const { app } = await makeApp();
    // 'long' in URL triggers MOCK_LONG_HTML with >2000 chars of content
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: 'https://github.com?q=long' });

    expect(res.status).toBe(200);
    expect(res.body.content.length).toBeLessThanOrEqual(2000);
  });

  it('sets truncated=true when content was cut', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: 'https://github.com?q=long' });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.content.length).toBeLessThanOrEqual(2000);
  });

  it('sets truncated=false when content fits within 2000 chars', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: ALLOWED_URL }); // short mock HTML

    expect(res.status).toBe(200);
    // Short mock — should not need truncation
    expect(res.body.truncated).toBe(false);
    expect(res.body.content.length).toBeLessThanOrEqual(2000);
  });

  // ── CORS headers ─────────────────────────────────────────────────────────────

  it('sets CORS header for webpeel.dev origin', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .set('Origin', 'https://webpeel.dev')
      .query({ url: ALLOWED_URL });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://webpeel.dev');
  });

  it('sets CORS header for localhost origin', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .set('Origin', 'http://localhost:3000')
      .query({ url: ALLOWED_URL });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('handles OPTIONS preflight', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .options('/v1/demo')
      .set('Origin', 'https://webpeel.dev');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toMatch(/GET/);
  });

  // ── Cache ─────────────────────────────────────────────────────────────────────

  it('returns X-Cache: MISS on first request', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: 'https://stackoverflow.com' });

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
  });

  it('returns X-Cache: HIT on second request for same URL', async () => {
    const { app } = await makeApp();
    const testUrl = 'https://arxiv.org';

    const first = await request(app)
      .get('/v1/demo')
      .query({ url: testUrl });
    expect(first.status).toBe(200);
    expect(first.headers['x-cache']).toBe('MISS');

    const second = await request(app)
      .get('/v1/demo')
      .query({ url: testUrl });
    expect(second.status).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');

    expect(second.body.content).toBe(first.body.content);
    expect(second.body.title).toBe(first.body.title);
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────────

  it('returns 429 after 3 requests from the same IP within a minute', async () => {
    // Use tight limiter (limit=3/min), with a dedicated IP
    const { createDemoRouter } = await import('../server/routes/demo.js');
    const tightMinute = new RateLimiter(60_000);
    const tightDay = new RateLimiter(24 * 60 * 60 * 1000);

    const app = express();
    app.use(express.json());
    app.use(createDemoRouter({ perMinute: tightMinute, perDay: tightDay }));

    const ip = '203.0.113.42'; // RFC 5737 test IP

    // 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .get('/v1/demo')
        .set('X-Forwarded-For', ip)
        .query({ url: 'https://techcrunch.com' });
      expect(res.status).toBe(200);
    }

    // 4th request should be rate limited
    const limited = await request(app)
      .get('/v1/demo')
      .set('X-Forwarded-For', ip)
      .query({ url: 'https://techcrunch.com' });

    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatch(/rate limit/i);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body.signUpUrl).toBe('https://app.webpeel.dev');
  });

  // ── Invalid URL ───────────────────────────────────────────────────────────────

  it('returns 400 for non-HTTP(S) protocol', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: 'ftp://stripe.com/file' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed URL', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/v1/demo')
      .query({ url: 'not-a-url-at-all' });

    expect(res.status).toBe(400);
  });
});
