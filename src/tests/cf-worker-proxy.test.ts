import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isCfWorkerAvailable, cfWorkerFetch } from '../core/cf-worker-proxy.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Cloudflare Worker Proxy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('isCfWorkerAvailable() returns false when env var not set', () => {
    delete process.env.WEBPEEL_CF_WORKER_URL;
    expect(isCfWorkerAvailable()).toBe(false);
  });

  it('isCfWorkerAvailable() returns true when env var is set', () => {
    process.env.WEBPEEL_CF_WORKER_URL = 'https://webpeel-proxy.workers.dev';
    expect(isCfWorkerAvailable()).toBe(true);
  });

  it('throws when worker URL not configured', async () => {
    delete process.env.WEBPEEL_CF_WORKER_URL;
    await expect(cfWorkerFetch('https://example.com')).rejects.toThrow('not configured');
  });

  it('fetches via worker and returns result', async () => {
    process.env.WEBPEEL_CF_WORKER_URL = 'https://webpeel-proxy.workers.dev';

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 200,
        body: '<html><h1>Product Page</h1><span class="price">$299</span></html>',
        finalUrl: 'https://www.bestbuy.com/product/123',
        headers: { 'content-type': 'text/html' },
        timing: { totalMs: 1200 },
        edge: 'EWR',
      }),
    });

    const result = await cfWorkerFetch('https://www.bestbuy.com/product/123');
    expect(result.html).toContain('Product Page');
    expect(result.statusCode).toBe(200);
    expect(result.method).toBe('cf-worker');
    expect(result.edge).toBe('EWR');
    expect(result.url).toBe('https://www.bestbuy.com/product/123');
  });

  it('sends auth token when WEBPEEL_CF_WORKER_TOKEN is set', async () => {
    process.env.WEBPEEL_CF_WORKER_URL = 'https://webpeel-proxy.workers.dev';
    process.env.WEBPEEL_CF_WORKER_TOKEN = 'my-secret-token';

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 200,
        body: '<html>ok</html>',
        finalUrl: 'https://example.com',
        headers: {},
      }),
    });

    await cfWorkerFetch('https://example.com');

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1];
    expect(options.headers['Authorization']).toBe('Bearer my-secret-token');
  });

  it('throws on worker error response', async () => {
    process.env.WEBPEEL_CF_WORKER_URL = 'https://webpeel-proxy.workers.dev';

    mockFetch.mockResolvedValueOnce({
      json: async () => ({ error: 'fetch failed: connection reset' }),
    });

    await expect(cfWorkerFetch('https://example.com')).rejects.toThrow('CF Worker proxy failed');
  });
});
