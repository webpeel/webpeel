/**
 * Tests for API key scope enforcement middleware.
 *
 * Tests the requireScope() middleware and the full auth→scope pipeline
 * using supertest against a minimal Express app.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { requireScope } from '../server/middleware/scope-guard.js';
import type { KeyScope } from '../server/pg-auth-store.js';

/**
 * Helper: build a minimal Express app with the scope guard and a test route.
 * The `keyScope` is injected directly onto the request to bypass actual auth.
 */
function buildApp(allowedScopes: KeyScope[], injectScope?: KeyScope | undefined) {
  const app = express();

  // Simulate auth middleware by injecting keyScope
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // crypto.randomUUID() polyfill for Node 19+
    (req as any).requestId = '00000000-0000-0000-0000-000000000000';
    req.keyScope = injectScope;
    next();
  });

  app.get('/test', requireScope(...allowedScopes), (_req: Request, res: Response) => {
    res.json({ success: true, message: 'ok' });
  });

  return app;
}

describe('requireScope middleware', () => {
  describe('full-access keys', () => {
    it('can access endpoints that require full scope', async () => {
      const app = buildApp(['full'], 'full');
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('can access endpoints that require read scope', async () => {
      const app = buildApp(['full', 'read'], 'full');
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('can access endpoints that require any scope', async () => {
      const app = buildApp(['full', 'read', 'restricted'], 'full');
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });
  });

  describe('read-only keys', () => {
    it('can access endpoints that allow read scope', async () => {
      const app = buildApp(['full', 'read'], 'read');
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('can access endpoints open to all scopes', async () => {
      const app = buildApp(['full', 'read', 'restricted'], 'read');
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('is blocked from endpoints that require full scope', async () => {
      const app = buildApp(['full'], 'read');
      const res = await request(app).get('/test');
      expect(res.status).toBe(403);
    });

    it('returns correct 403 error shape for insufficient scope', async () => {
      const app = buildApp(['full'], 'read');
      const res = await request(app).get('/test');
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.type).toBe('insufficient_scope');
      expect(res.body.error.message).toContain("'read' scope");
      expect(res.body.error.message).toContain('full');
      expect(res.body.error.docs).toBe('https://webpeel.dev/docs/authentication#scopes');
      expect(res.body.error.hint).toBeTruthy();
      expect(res.body.requestId).toBeTruthy();
    });
  });

  describe('restricted keys', () => {
    it('can access endpoints open to all scopes', async () => {
      const app = buildApp(['full', 'read', 'restricted'], 'restricted');
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('is blocked from read-only endpoints', async () => {
      const app = buildApp(['full', 'read'], 'restricted');
      const res = await request(app).get('/test');
      expect(res.status).toBe(403);
    });

    it('is blocked from full-only endpoints', async () => {
      const app = buildApp(['full'], 'restricted');
      const res = await request(app).get('/test');
      expect(res.status).toBe(403);
    });

    it('returns correct 403 error shape', async () => {
      const app = buildApp(['full', 'read'], 'restricted');
      const res = await request(app).get('/test');
      expect(res.status).toBe(403);
      expect(res.body.error.type).toBe('insufficient_scope');
      expect(res.body.error.message).toContain("'restricted' scope");
      expect(res.body.error.message).toContain('full');
      expect(res.body.error.message).toContain('read');
    });
  });

  describe('JWT sessions (keyScope = undefined)', () => {
    it('bypass scope enforcement when keyScope is undefined', async () => {
      // JWT session: keyScope is undefined — should always pass through
      const app = buildApp(['full'], undefined);
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });

    it('bypass full-only endpoints', async () => {
      const app = buildApp(['full'], undefined);
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    });
  });

  describe('scope guard with multiple allowed scopes', () => {
    it('allows the first scope in the list', async () => {
      const app = buildApp(['full', 'read'], 'full');
      expect((await request(app).get('/test')).status).toBe(200);
    });

    it('allows the second scope in the list', async () => {
      const app = buildApp(['full', 'read'], 'read');
      expect((await request(app).get('/test')).status).toBe(200);
    });

    it('blocks a scope not in the list', async () => {
      const app = buildApp(['full', 'read'], 'restricted');
      expect((await request(app).get('/test')).status).toBe(403);
    });
  });

  describe('error response format', () => {
    it('includes requestId in 403 response', async () => {
      const app = buildApp(['full'], 'read');
      const res = await request(app).get('/test');
      expect(res.body.requestId).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('mentions the key scope and required scopes in message', async () => {
      const app = buildApp(['full', 'read'], 'restricted');
      const res = await request(app).get('/test');
      expect(res.body.error.message).toContain("'restricted'");
      expect(res.body.error.message).toContain('full');
      expect(res.body.error.message).toContain('read');
    });

    it('provides docs link', async () => {
      const app = buildApp(['full'], 'read');
      const res = await request(app).get('/test');
      expect(res.body.error.docs).toContain('webpeel.dev');
    });
  });
});
