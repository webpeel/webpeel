/**
 * Proxy support tests
 * Tests that verify proxy option is correctly passed through the WebPeel chain.
 * Actual proxy connections are mocked to avoid requiring a real proxy server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock factories so they're available before vi.mock() ───────────────

const { mockSmartFetch } = vi.hoisted(() => {
  const mockSmartFetch = vi.fn(async (url: string, options: any) => ({
    url,
    html: `<html><head><title>Proxy Test</title></head><body><p>proxy: ${options?.proxy ?? 'none'}</p></body></html>`,
    method: 'simple' as const,
    statusCode: 200,
    contentType: 'text/html',
    elapsed: 50,
    screenshot: undefined,
  }));
  return { mockSmartFetch };
});

vi.mock('../core/strategies.js', () => ({
  smartFetch: mockSmartFetch,
  cleanup: vi.fn(),
}));

import { peel } from '../index.js';

describe('proxy option in PeelOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Proxy URL is passed through from peel() to smartFetch ─────────
  it('passes proxy URL from peel() to smartFetch', async () => {
    const proxyUrl = 'http://proxy.example.com:8080';
    await peel('https://example.com', { proxy: proxyUrl });

    expect(mockSmartFetch).toHaveBeenCalledOnce();
    const [, options] = mockSmartFetch.mock.calls[0];
    expect(options.proxy).toBe(proxyUrl);
  });

  // ── Test 2: Proxy is undefined when not provided ─────────────────────────
  it('does not set proxy when option is not provided', async () => {
    await peel('https://example.com');

    expect(mockSmartFetch).toHaveBeenCalledOnce();
    const [, options] = mockSmartFetch.mock.calls[0];
    expect(options.proxy).toBeUndefined();
  });

  // ── Test 3: render=true passes proxy to browser options ──────────────────
  it('passes proxy option with render mode', async () => {
    const proxyUrl = 'http://proxy.example.com:8080';
    await peel('https://example.com', { proxy: proxyUrl, render: true });

    expect(mockSmartFetch).toHaveBeenCalledOnce();
    const [, options] = mockSmartFetch.mock.calls[0];
    expect(options.proxy).toBe(proxyUrl);
    expect(options.forceBrowser).toBe(true);
  });

  // ── Test 4: stealth mode passes proxy through ─────────────────────────────
  it('passes proxy option with stealth mode', async () => {
    const proxyUrl = 'socks5://proxy.example.com:1080';
    await peel('https://example.com', { proxy: proxyUrl, stealth: true });

    expect(mockSmartFetch).toHaveBeenCalledOnce();
    const [, options] = mockSmartFetch.mock.calls[0];
    expect(options.proxy).toBe(proxyUrl);
    expect(options.stealth).toBe(true);
  });

  // ── Test 5: Proxy fetches are not cached ─────────────────────────────────
  it('fetches are not cached when proxy is set', async () => {
    const proxyUrl = 'http://proxy.example.com:8080';

    await peel('https://example.com', { proxy: proxyUrl });
    await peel('https://example.com', { proxy: proxyUrl });

    // smartFetch should be called both times (not cached)
    expect(mockSmartFetch).toHaveBeenCalledTimes(2);
  });

  // ── Test 6: Proxy URL preserved exactly as-is ────────────────────────────
  it('preserves proxy URL string exactly as passed', async () => {
    const proxyUrl = 'http://user:p%40ssw0rd@proxy.example.com:8080';
    await peel('https://example.com', { proxy: proxyUrl });

    const [, options] = mockSmartFetch.mock.calls[0];
    expect(options.proxy).toBe(proxyUrl);
  });

  // ── Test 7: Proxy works alongside custom headers ──────────────────────────
  it('proxy can be combined with custom headers', async () => {
    const proxyUrl = 'http://proxy.example.com:8080';
    const headers = { 'X-Custom': 'value' };
    await peel('https://example.com', { proxy: proxyUrl, headers });

    const [, options] = mockSmartFetch.mock.calls[0];
    expect(options.proxy).toBe(proxyUrl);
    expect(options.headers).toEqual(headers);
  });

  // ── Test 8: Proxy works alongside cookies ─────────────────────────────────
  it('proxy can be combined with cookies', async () => {
    const proxyUrl = 'socks5://proxy.example.com:1080';
    const cookies = ['session=abc123'];
    await peel('https://example.com', { proxy: proxyUrl, cookies });

    const [, options] = mockSmartFetch.mock.calls[0];
    expect(options.proxy).toBe(proxyUrl);
    expect(options.cookies).toEqual(cookies);
  });
});

describe('proxy URL parsing', () => {
  // ── Test 9: HTTP proxy URL parsing ───────────────────────────────────────
  it('parses HTTP proxy URL correctly', () => {
    const proxyUrl = 'http://proxy.example.com:8080';
    const parsed = new URL(proxyUrl);
    expect(parsed.protocol).toBe('http:');
    expect(parsed.hostname).toBe('proxy.example.com');
    expect(parsed.port).toBe('8080');
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
  });

  // ── Test 10: HTTPS proxy URL parsing ─────────────────────────────────────
  it('parses HTTPS proxy URL correctly', () => {
    const proxyUrl = 'https://secure-proxy.example.com:8443';
    const parsed = new URL(proxyUrl);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('secure-proxy.example.com');
    expect(parsed.port).toBe('8443');
  });

  // ── Test 11: SOCKS5 proxy URL parsing ────────────────────────────────────
  it('parses SOCKS5 proxy URL correctly', () => {
    const proxyUrl = 'socks5://proxy.example.com:1080';
    const parsed = new URL(proxyUrl);
    expect(parsed.protocol).toBe('socks5:');
    expect(parsed.hostname).toBe('proxy.example.com');
    expect(parsed.port).toBe('1080');
  });

  // ── Test 12: Proxy URL with auth parsed into Playwright format ────────────
  it('correctly parses proxy auth into Playwright server/username/password', () => {
    const proxyUrl = 'http://proxyuser:proxypass@192.168.1.100:3128';
    const parsed = new URL(proxyUrl);

    // Simulate the parsing logic used in browserFetch
    const playwrightProxy = {
      server: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
    };

    expect(playwrightProxy.server).toBe('http://192.168.1.100:3128');
    expect(playwrightProxy.username).toBe('proxyuser');
    expect(playwrightProxy.password).toBe('proxypass');
  });

  // ── Test 13: Proxy URL without auth yields undefined credentials ──────────
  it('yields undefined username/password when proxy has no credentials', () => {
    const proxyUrl = 'http://proxy.example.com:8080';
    const parsed = new URL(proxyUrl);

    const playwrightProxy = {
      server: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
    };

    expect(playwrightProxy.server).toBe('http://proxy.example.com:8080');
    expect(playwrightProxy.username).toBeUndefined();
    expect(playwrightProxy.password).toBeUndefined();
  });

  // ── Test 14: Residential SOCKS5 proxy with auth ───────────────────────────
  it('parses residential SOCKS5 proxy with credentials correctly', () => {
    const proxyUrl = 'socks5://residential_user:residential_pass@gate.smartproxy.com:7000';
    const parsed = new URL(proxyUrl);

    const playwrightProxy = {
      server: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
    };

    expect(playwrightProxy.server).toBe('socks5://gate.smartproxy.com:7000');
    expect(playwrightProxy.username).toBe('residential_user');
    expect(playwrightProxy.password).toBe('residential_pass');
  });

  // ── Test 15: All common proxy format variants are parseable ───────────────
  it('all common proxy URL formats are parseable', () => {
    const proxies = [
      'http://proxy.example.com:8080',
      'https://proxy.example.com:8443',
      'socks5://proxy.example.com:1080',
      'http://user:pass@proxy.example.com:8080',
      'socks5://user:pass@proxy.example.com:1080',
    ];

    for (const proxy of proxies) {
      expect(() => new URL(proxy)).not.toThrow();
    }
  });
});
