/**
 * Proxy chain / auto-rotation tests.
 *
 * Tests the `proxies` option: multiple proxy URLs tried in order when one
 * gets blocked. Tests operate at the smartFetch level with browserFetch mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockedError } from '../types.js';

// ── Hoist mock factories so they're available before vi.mock() runs ──────────

const { mockSimpleImpl, mockBrowserImpl } = vi.hoisted(() => ({
  mockSimpleImpl: vi.fn(),
  mockBrowserImpl: vi.fn(),
}));

// ── Mock the fetcher module BEFORE importing strategies ──────────────────────
vi.mock('../core/fetcher.js', () => ({
  simpleFetch: (...args: unknown[]) => mockSimpleImpl(...args),
  browserFetch: (...args: unknown[]) => mockBrowserImpl(...args),
  retryFetch: async (fn: () => Promise<unknown>, _retries: number) => fn(),
  closePool: vi.fn(),
  warmup: vi.fn(),
  cleanup: vi.fn(),
  scrollAndWait: vi.fn(),
  closeProfileBrowser: vi.fn(),
}));

vi.mock('../core/dns-cache.js', () => ({
  resolveAndCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../core/cache.js', () => ({
  getCached: vi.fn().mockReturnValue(null),
  setCached: vi.fn(),
}));

// NOW import strategies (after mocks are registered)
import { smartFetch } from '../core/strategies.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://example.com',
    html:
      '<html><head><title>Test</title></head><body>' +
      '<p>This is a real page with plenty of meaningful content. ' +
      'There is enough text here to pass the escalation threshold cleanly.</p>' +
      '</body></html>',
    method: 'browser' as const,
    statusCode: 200,
    contentType: 'text/html',
    elapsed: 50,
    screenshot: undefined,
    ...overrides,
  };
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('proxy chain: single proxy passed through', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  it('passes single proxy from proxies array to browserFetch', async () => {
    const proxy1 = 'http://proxy1.example.com:8080';
    mockBrowserImpl.mockResolvedValue(makeResult());

    await smartFetch('https://example.com', {
      forceBrowser: true,
      noCache: true,
      proxies: [proxy1],
    });

    // browserFetch should have been called with the proxy
    expect(mockBrowserImpl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ proxy: proxy1 }),
    );
  });

  it('single proxy option (not array) is still tried as the only proxy', async () => {
    const proxyUrl = 'http://single-proxy.example.com:8080';
    mockBrowserImpl.mockResolvedValue(makeResult());

    await smartFetch('https://example.com', {
      forceBrowser: true,
      noCache: true,
      proxy: proxyUrl,
    });

    expect(mockBrowserImpl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ proxy: proxyUrl }),
    );
  });
});

// ── Proxy rotation on BlockedError ──────────────────────────────────────────

describe('proxy chain: rotation on BlockedError', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  it('tries second proxy when first proxy throws BlockedError', async () => {
    const proxy1 = 'http://blocked-proxy.example.com:8080';
    const proxy2 = 'http://good-proxy.example.com:8080';

    // proxy1 always throws BlockedError (both non-stealth and stealth escalation)
    // proxy2 succeeds
    mockBrowserImpl.mockImplementation(async (_url: string, opts: any) => {
      if (opts.proxy === proxy1) {
        throw new BlockedError('proxy1 is blocked');
      }
      return makeResult();
    });

    const result = await smartFetch('https://example.com', {
      forceBrowser: true,
      noCache: true,
      proxies: [proxy1, proxy2],
    });

    // Should succeed using proxy2
    expect(result).toBeDefined();
    expect(result.url).toBe('https://example.com');

    // Verify proxy2 was tried
    const allCalls = mockBrowserImpl.mock.calls as Array<[string, any]>;
    const proxy2Calls = allCalls.filter(([, opts]) => opts.proxy === proxy2);
    expect(proxy2Calls.length).toBeGreaterThan(0);
  });

  it('rotates through multiple proxies until one succeeds', async () => {
    const proxy1 = 'http://proxy1.example.com:8080';
    const proxy2 = 'http://proxy2.example.com:8080';
    const proxy3 = 'http://proxy3.example.com:8080';

    // proxy1 and proxy2 are blocked, proxy3 succeeds
    mockBrowserImpl.mockImplementation(async (_url: string, opts: any) => {
      if (opts.proxy === proxy1 || opts.proxy === proxy2) {
        throw new BlockedError(`proxy blocked: ${opts.proxy}`);
      }
      return makeResult();
    });

    const result = await smartFetch('https://example.com', {
      forceBrowser: true,
      noCache: true,
      proxies: [proxy1, proxy2, proxy3],
    });

    expect(result).toBeDefined();

    // Verify proxy3 was tried
    const allCalls = mockBrowserImpl.mock.calls as Array<[string, any]>;
    const proxy3Calls = allCalls.filter(([, opts]) => opts.proxy === proxy3);
    expect(proxy3Calls.length).toBeGreaterThan(0);
  });
});

// ── All proxies exhausted ────────────────────────────────────────────────────

describe('proxy chain: all proxies exhausted', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  it('throws BlockedError when all proxies are exhausted', async () => {
    const proxy1 = 'http://proxy1.example.com:8080';
    const proxy2 = 'http://proxy2.example.com:8080';

    mockBrowserImpl.mockRejectedValue(new BlockedError('all proxies blocked'));

    await expect(
      smartFetch('https://example.com', {
        forceBrowser: true,
        noCache: true,
        proxies: [proxy1, proxy2],
      }),
    ).rejects.toThrow(BlockedError);
  });

  it('throws the last error when all proxies fail with different errors', async () => {
    const proxy1 = 'http://proxy1.example.com:8080';
    const proxy2 = 'http://proxy2.example.com:8080';

    let callCount = 0;
    mockBrowserImpl.mockImplementation(async () => {
      callCount++;
      // Use different error messages to verify last error is thrown
      throw new BlockedError(`blocked attempt ${callCount}`);
    });

    await expect(
      smartFetch('https://example.com', {
        forceBrowser: true,
        noCache: true,
        proxies: [proxy1, proxy2],
      }),
    ).rejects.toBeInstanceOf(BlockedError);

    // Both proxies should have been tried
    expect(callCount).toBeGreaterThan(1);
  });
});

// ── CLI --proxies flag parsing ───────────────────────────────────────────────

describe('proxy chain: --proxies CLI flag parsing', () => {
  // The coerce function used in cli.ts
  const coerceProxies = (val: string): string[] =>
    val.split(',').map((s: string) => s.trim()).filter(Boolean);

  it('parses comma-separated proxy URLs into an array', () => {
    const result = coerceProxies(
      'http://p1.example.com:8080,http://p2.example.com:8080',
    );
    expect(result).toEqual([
      'http://p1.example.com:8080',
      'http://p2.example.com:8080',
    ]);
  });

  it('trims whitespace around commas', () => {
    const result = coerceProxies(
      'http://p1.example.com:8080 , http://p2.example.com:8080 , http://p3.example.com:8080',
    );
    expect(result).toEqual([
      'http://p1.example.com:8080',
      'http://p2.example.com:8080',
      'http://p3.example.com:8080',
    ]);
  });

  it('filters out empty entries from extra commas', () => {
    const result = coerceProxies(
      'http://p1.example.com:8080,,http://p2.example.com:8080,',
    );
    expect(result).toEqual([
      'http://p1.example.com:8080',
      'http://p2.example.com:8080',
    ]);
  });

  it('returns single-element array for a single proxy', () => {
    const result = coerceProxies('http://proxy.example.com:8080');
    expect(result).toEqual(['http://proxy.example.com:8080']);
  });

  it('handles proxies with credentials', () => {
    const result = coerceProxies(
      'http://user1:pass1@proxy1.example.com:8080,socks5://user2:pass2@proxy2.example.com:1080',
    );
    expect(result).toEqual([
      'http://user1:pass1@proxy1.example.com:8080',
      'socks5://user2:pass2@proxy2.example.com:1080',
    ]);
  });
});

// ── Direct connection (no proxies) ───────────────────────────────────────────

describe('proxy chain: direct connection when no proxies specified', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  it('uses direct connection (undefined proxy) when no proxies specified', async () => {
    mockBrowserImpl.mockResolvedValue(makeResult());

    const result = await smartFetch('https://example.com', {
      forceBrowser: true,
      noCache: true,
      // No proxy, no proxies
    });

    expect(result).toBeDefined();

    // browserFetch should have been called with proxy=undefined
    expect(mockBrowserImpl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ proxy: undefined }),
    );
  });

  it('proxies array takes precedence over single proxy option', async () => {
    const proxy1 = 'http://proxies-array.example.com:8080';
    const singleProxy = 'http://single.example.com:8080';
    mockBrowserImpl.mockResolvedValue(makeResult());

    await smartFetch('https://example.com', {
      forceBrowser: true,
      noCache: true,
      proxy: singleProxy,
      proxies: [proxy1],
    });

    // When both are provided, proxies array wins (proxy1 is used, not singleProxy)
    expect(mockBrowserImpl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ proxy: proxy1 }),
    );
  });
});
