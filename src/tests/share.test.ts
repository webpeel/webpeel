/**
 * Tests for share routes
 *
 * Covers:
 * - generateShareId: uniqueness, length, character set
 * - POST /v1/share: auth required, content-direct storage, rate limiting
 * - GET /s/:id: serve share, increment view count, 404 for missing/expired
 * - Expiry logic: expired shares return 404 (next() to reader)
 * - View count increment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { generateShareId } from '../server/routes/share.js';

// ─── Mock peel so tests don't make real network calls ─────────────────────────

vi.mock('../index.js', () => ({
  peel: vi.fn(async (_url: string) => ({
    content: '# Mocked Content\n\nThis is a mocked article.',
    title: 'Mocked Title',
    tokens: 10,
  })),
}));

vi.mock('../server/middleware/url-validator.js', () => ({
  validateUrlForSSRF: vi.fn(),
  SSRFError: class SSRFError extends Error {},
}));

// ─── Mock pg.Pool ─────────────────────────────────────────────────────────────

function makeMockPool(overrides: Record<string, any> = {}) {
  const rows: Record<string, any> = {};

  const defaultQuery = async (sql: string, params?: any[]) => {
    // INSERT
    if (/^INSERT INTO shared_reads/.test(sql.trim())) {
      const id = params![0];
      rows[id] = {
        id,
        url: params![1],
        title: params![2],
        content: params![3],
        tokens: params![4],
        created_by: params![5],
        created_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        view_count: 0,
      };
      return { rows: [] };
    }

    // SELECT 1 FROM shared_reads WHERE id = $1 (collision check)
    if (/SELECT 1 FROM shared_reads WHERE id/.test(sql)) {
      const id = params![0];
      return { rows: rows[id] ? [{}] : [] };
    }

    // UPDATE shared_reads ... RETURNING (public GET)
    if (/UPDATE shared_reads/.test(sql)) {
      const id = params![0];
      const row = rows[id];
      if (!row) return { rows: [] };
      // Check expiry
      if (row.expires_at < new Date()) return { rows: [] };
      row.view_count += 1;
      return { rows: [row] };
    }

    return { rows: [] };
  };

  return {
    query: overrides.query || defaultQuery,
  };
}

// ─── App factories ────────────────────────────────────────────────────────────

async function makePublicApp(pool: any = null) {
  const { createSharePublicRouter } = await import('../server/routes/share.js');
  const app = express();
  app.use(express.json());
  app.use(createSharePublicRouter(pool));
  // Fallback: simulate reader's /s/* handler
  app.get('/s/*', (req, res) => {
    res.status(200).json({ fallthrough: true, path: req.path });
  });
  return app;
}

async function makeProtectedApp(pool: any = null) {
  const { createShareRouter } = await import('../server/routes/share.js');
  const app = express();
  app.use(express.json());

  // Inject fake auth middleware
  app.use((req: any, _res: any, next: any) => {
    req.auth = { keyInfo: { accountId: 'user-uuid-123' }, tier: 'free', softLimited: false, extraUsageAvailable: false };
    next();
  });

  app.use(createShareRouter(pool));
  return app;
}

async function makeUnauthApp(pool: any = null) {
  const { createShareRouter } = await import('../server/routes/share.js');
  const app = express();
  app.use(express.json());
  // No auth middleware — req.auth is undefined
  app.use(createShareRouter(pool));
  return app;
}

// ─── Tests: generateShareId ───────────────────────────────────────────────────

describe('generateShareId', () => {
  it('generates IDs of length 9', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateShareId()).toHaveLength(9);
    }
  });

  it('generates IDs with only base64url characters (a-z, A-Z, 0-9, -, _)', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateShareId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{9}$/);
    }
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateShareId()));
    // With 9 chars of base64url there are 64^9 ≈ 68 trillion possibilities
    // 1000 samples should all be unique
    expect(ids.size).toBe(1000);
  });
});

// ─── Tests: POST /v1/share ────────────────────────────────────────────────────

describe('POST /v1/share', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    const pool = makeMockPool();
    const app = await makeUnauthApp(pool);
    const res = await request(app)
      .post('/v1/share')
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('unauthorized');
  });

  it('returns 400 when url is missing', async () => {
    const pool = makeMockPool();
    const app = await makeProtectedApp(pool);
    const res = await request(app).post('/v1/share').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request');
  });

  it('creates a share with content provided directly (no peel call)', async () => {
    const pool = makeMockPool();
    const app = await makeProtectedApp(pool);
    const res = await request(app).post('/v1/share').send({
      url: 'https://example.com',
      content: '# Hello World\n\nThis is shared content.',
      title: 'Hello World',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.shareId).toBeDefined();
    expect(res.body.shareId).toMatch(/^[A-Za-z0-9_-]{9}$/);
    expect(res.body.shareUrl).toContain('/s/');
    expect(res.body.shareUrl).toContain(res.body.shareId);
  });

  it('creates a share by fetching the URL when no content is provided', async () => {
    const pool = makeMockPool();
    const app = await makeProtectedApp(pool);
    const res = await request(app).post('/v1/share').send({
      url: 'https://example.com',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.shareId).toMatch(/^[A-Za-z0-9_-]{9}$/);
  });

  it('returns 503 when no database pool is available', async () => {
    const app = await makeProtectedApp(null); // no pool
    const res = await request(app).post('/v1/share').send({
      url: 'https://example.com',
      content: 'Some content',
    });
    expect(res.status).toBe(503);
    expect(res.body.error.type).toBe('unavailable');
  });

  it('enforces rate limit of 50 shares per day', async () => {
    // Import fresh module to reset rate limit state
    vi.resetModules();
    const { createShareRouter } = await import('../server/routes/share.js');

    const pool = makeMockPool();
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      // Use a unique user ID to isolate this test
      req.auth = { keyInfo: { accountId: 'rate-limit-test-user-999' } };
      next();
    });
    app.use(createShareRouter(pool));

    // Send 50 successful shares
    for (let i = 0; i < 50; i++) {
      const res = await request(app).post('/v1/share').send({
        url: 'https://example.com',
        content: `Content ${i}`,
        title: `Title ${i}`,
      });
      expect(res.status).toBe(201);
    }

    // 51st should be rate limited
    const res = await request(app).post('/v1/share').send({
      url: 'https://example.com',
      content: 'Over limit',
    });
    expect(res.status).toBe(429);
    expect(res.body.error.type).toBe('rate_limited');
  });
});

// ─── Tests: GET /s/:id ────────────────────────────────────────────────────────

describe('GET /s/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTML page for a valid share ID', async () => {
    const pool = makeMockPool();
    // Pre-populate a share
    await pool.query(
      'INSERT INTO shared_reads (id, url, title, content, tokens, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      ['abc123xyz', 'https://example.com', 'Test Title', '# Hello\n\nContent here.', 5, 'user-1']
    );

    const app = await makePublicApp(pool);
    const res = await request(app).get('/s/abc123xyz').set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('WebPeel');
    expect(res.text).toContain('Test Title');
    expect(res.text).toContain('Hello');
    expect(res.text).toContain('Try WebPeel');
  });

  it('returns JSON for application/json accept header', async () => {
    const pool = makeMockPool();
    await pool.query(
      'INSERT INTO shared_reads (id, url, title, content, tokens, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      ['json12345', 'https://example.com', 'JSON Title', '# JSON Content', 3, 'user-1']
    );

    const app = await makePublicApp(pool);
    const res = await request(app).get('/s/json12345').set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.content).toBe('# JSON Content');
    expect(res.body.title).toBe('JSON Title');
  });

  it('returns markdown for text/markdown accept header', async () => {
    const pool = makeMockPool();
    await pool.query(
      'INSERT INTO shared_reads (id, url, title, content, tokens, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      ['md1234567', 'https://example.com', 'MD Title', '# Markdown!', 2, 'user-1']
    );

    const app = await makePublicApp(pool);
    const res = await request(app).get('/s/md1234567').set('Accept', 'text/markdown');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toBe('# Markdown!');
  });

  it('falls through to next handler for non-existent share IDs', async () => {
    const pool = makeMockPool(); // empty — no shares
    const app = await makePublicApp(pool);
    const res = await request(app).get('/s/notfound1').set('Accept', 'application/json');
    // Should fall through to our fallback handler
    expect(res.status).toBe(200);
    expect(res.body.fallthrough).toBe(true);
  });

  it('falls through for non-matching ID patterns (search queries)', async () => {
    const pool = makeMockPool();
    const app = await makePublicApp(pool);
    // Search queries have spaces/special chars — won't match ID pattern
    const res = await request(app)
      .get('/s/stripe%20pricing')
      .set('Accept', 'application/json');
    // Should fall through immediately (pattern doesn't match)
    expect(res.body.fallthrough).toBe(true);
  });

  it('increments view count on each access', async () => {
    const pool = makeMockPool();
    // 'viewcount' = 9 chars ✓
    await pool.query(
      'INSERT INTO shared_reads (id, url, title, content, tokens, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      ['viewcount', 'https://example.com', 'View Title', '# Content', 2, 'user-1']
    );

    const app = await makePublicApp(pool);

    // First access
    const res1 = await request(app).get('/s/viewcount').set('Accept', 'application/json');
    expect(res1.status).toBe(200);
    expect(res1.body.viewCount).toBe(1);

    // Second access
    const res2 = await request(app).get('/s/viewcount').set('Accept', 'application/json');
    expect(res2.status).toBe(200);
    expect(res2.body.viewCount).toBe(2);
  });

  it('falls through for expired shares', async () => {
    // Simulate expired share by making the pool return empty rows
    const expiredPool = {
      query: async (sql: string, _params?: any[]) => {
        if (/UPDATE shared_reads/.test(sql)) {
          return { rows: [] }; // expired — no rows returned
        }
        return { rows: [] };
      },
    };

    const app = await makePublicApp(expiredPool);
    // 'expired12' = 9 chars ✓
    const res = await request(app).get('/s/expired12').set('Accept', 'application/json');
    // Falls through to the search handler
    expect(res.body.fallthrough).toBe(true);
  });

  it('falls through when no database pool is available', async () => {
    const app = await makePublicApp(null); // no pool
    const res = await request(app).get('/s/nodb12345').set('Accept', 'application/json');
    expect(res.body.fallthrough).toBe(true);
  });

  it('HTML page includes social meta tags', async () => {
    const pool = makeMockPool();
    await pool.query(
      'INSERT INTO shared_reads (id, url, title, content, tokens, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      ['meta12345', 'https://example.com', 'Meta Test', '# Meta content here', 3, 'user-1']
    );

    const app = await makePublicApp(pool);
    const res = await request(app).get('/s/meta12345').set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
    expect(res.text).toContain('og:description');
    expect(res.text).toContain('twitter:card');
    expect(res.text).toContain('twitter:title');
  });
});
