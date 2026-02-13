/**
 * Health check endpoint
 */

import { Router, Request, Response } from 'express';
import { fetch as undiciFetch } from 'undici';

const startTime = Date.now();

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    
    res.json({
      status: 'healthy',
      version: '0.3.0',
      uptime,
      timestamp: new Date().toISOString(),
    });
  });

  // Temporary debug endpoint to diagnose outbound fetch issues on Render
  router.get('/debug/fetch', async (_req: Request, res: Response) => {
    const results: Record<string, any> = {};
    
    // Test 1: undici fetch with minimal headers
    try {
      const r = await undiciFetch('https://example.com', {
        headers: { 'User-Agent': 'WebPeel/0.3.0' },
      });
      results.undiciSimple = { status: r.status, ok: r.ok, headers: Object.fromEntries(r.headers.entries()) };
    } catch (e: any) {
      results.undiciSimple = { error: e.message, cause: e.cause?.message || e.cause?.code || String(e.cause) };
    }

    // Test 2: undici with manual redirect (like our fetcher)
    try {
      const r = await undiciFetch('https://example.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'text/html',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        redirect: 'manual',
      });
      results.undiciManual = { status: r.status, ok: r.ok };
    } catch (e: any) {
      results.undiciManual = { error: e.message, cause: e.cause?.message || e.cause?.code || String(e.cause) };
    }

    // Test 3: Node global fetch
    try {
      const r = await globalThis.fetch('https://example.com');
      results.globalFetch = { status: r.status, ok: r.ok };
    } catch (e: any) {
      results.globalFetch = { error: e.message, cause: e.cause?.message || e.cause?.code || String(e.cause) };
    }

    // Test 4: DuckDuckGo (same as search endpoint)
    try {
      const r = await undiciFetch('https://html.duckduckgo.com/html/?q=test', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      results.duckduckgo = { status: r.status, ok: r.ok };
    } catch (e: any) {
      results.duckduckgo = { error: e.message, cause: e.cause?.message || e.cause?.code || String(e.cause) };
    }

    res.json(results);
  });

  return router;
}
