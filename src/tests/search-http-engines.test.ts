/**
 * Unit tests for HTTP-based Bing + Google search methods on DuckDuckGoProvider.
 * Tests HTML parsing, URL decoding, deduplication, and error resilience.
 * No network calls are made — undici fetch is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted ensures the mock fn is available before vi.mock factories run (hoisting)
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

// ── Mock undici BEFORE the search-provider module is imported ────────────────
vi.mock('undici', () => ({
  fetch: mockFetch,
  ProxyAgent: vi.fn().mockImplementation(() => ({})),
}));

// Mock browser-pool to avoid Playwright side-effects in unit tests
vi.mock('../core/browser-pool.js', () => ({
  getStealthBrowser: vi.fn().mockResolvedValue({}),
  getRandomUserAgent: vi.fn().mockReturnValue('Mozilla/5.0'),
  applyStealthScripts: vi.fn().mockResolvedValue(undefined),
  closePool: vi.fn(),
}));

// Mock proxy-config to avoid env-var dependency
vi.mock('../core/proxy-config.js', () => ({
  getWebshareProxy: vi.fn().mockReturnValue(null),
  getWebshareProxyUrl: vi.fn().mockReturnValue(null),
  hasWebshareProxy: vi.fn().mockReturnValue(false),
  toPlaywrightProxy: vi.fn(),
}));

import { DuckDuckGoProvider, mergeSearchResults, providerStats, type WebSearchResult } from '../core/search-provider.js';

// ── Realistic sample HTML fixtures ──────────────────────────────────────────

const BING_HTML = `<!DOCTYPE html><html><body>
<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.com/page1">Example Page 1</a></h2>
    <div class="b_caption"><p>This is the snippet for example page 1 about TypeScript.</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="https://another.com/article">Another Article About TypeScript</a></h2>
    <div class="b_caption"><p>Comprehensive guide to TypeScript generics and interfaces.</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="https://www.bing.com/ck/a?!&&p=abc123&u=a1aHR0cHM6Ly9yZWRpcmVjdGVkLmNvbS9wYWdl&ntb=1">Redirect Result</a></h2>
    <div class="b_caption"><p>This result has a Bing redirect URL that needs decoding.</p></div>
  </li>
  <div class="b_ad">
    <li class="b_algo">
      <h2><a href="https://ads.example.com/ad">Ad Inside b_ad</a></h2>
      <div class="b_caption"><p>This is an ad and should be filtered out.</p></div>
    </li>
  </div>
  <li class="b_algo">
    <h2><a href="ftp://invalid-protocol.com/page">Invalid Protocol</a></h2>
    <div class="b_caption"><p>Should be filtered — not http/https.</p></div>
  </li>
</ol>
</body></html>`;

// Bing redirect URL: the "u" param is base64url of "https://redirected.com/page" (prefixed with "a1")
// Buffer.from('https://redirected.com/page').toString('base64url') = 'aHR0cHM6Ly9yZWRpcmVjdGVkLmNvbS9wYWdl'

const GOOGLE_HTML = `<!DOCTYPE html><html><body>
<div id="search">
  <div class="g">
    <a href="https://google-result1.com/typescript-guide"><h3>TypeScript Official Guide</h3></a>
    <div class="VwiC3b">Learn TypeScript from official documentation with examples.</div>
  </div>
  <div class="g">
    <a href="https://google-result2.org/ts-handbook">
      <h3>The TypeScript Handbook</h3>
    </a>
    <div class="VwiC3b">A comprehensive handbook for TypeScript developers covering all features.</div>
  </div>
  <div class="g" data-text-ad="1">
    <a href="https://ads.google-result.com/ad"><h3>Ad Result — Should Be Filtered</h3></a>
    <div class="VwiC3b">This is a paid advertisement.</div>
  </div>
  <div class="g">
    <a href="https://www.google.com/search?q=related"><h3>Related Search (Google Internal)</h3></a>
    <div class="VwiC3b">Internal google link — should be filtered.</div>
  </div>
  <div class="g">
    <a href="https://duplicate-result.com/page"><h3>Duplicate Result</h3></a>
    <div class="VwiC3b">This appears twice in results.</div>
  </div>
  <div class="g">
    <a href="https://duplicate-result.com/page"><h3>Duplicate Result Again</h3></a>
    <div class="VwiC3b">Same URL as the previous one — should be deduped.</div>
  </div>
</div>
</body></html>`;

const EMPTY_BING_HTML = `<!DOCTYPE html><html><body><ol id="b_results"></ol></body></html>`;
const EMPTY_GOOGLE_HTML = `<!DOCTYPE html><html><body><div id="search"></div></body></html>`;

// ── Helper to make mockFetch return a fixed HTML response ───────────────────
function mockSuccessResponse(html: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => html,
  });
}

function mockErrorResponse(status = 429): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => 'Too Many Requests',
  });
}

function mockNetworkError(): void {
  mockFetch.mockRejectedValueOnce(new Error('Network error: connection refused'));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('_searchBingHttp — HTML parsing', () => {
  let provider: DuckDuckGoProvider;
  const defaultOpts = { count: 10 };

  beforeEach(() => {
    provider = new DuckDuckGoProvider();
    providerStats.reset('bing-http');
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses standard Bing result items (title, url, snippet)', async () => {
    mockSuccessResponse(BING_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', defaultOpts);

    // Should find at least the first two standard results
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]!.title).toBe('Example Page 1');
    expect(results[0]!.url).toBe('https://example.com/page1');
    expect(results[0]!.snippet).toContain('TypeScript');
  });

  it('decodes Bing redirect URLs (base64url "u" param prefixed with "a1")', async () => {
    mockSuccessResponse(BING_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', defaultOpts);

    // Third result has a Bing /ck/a? redirect URL
    const redirectResult = results.find((r: WebSearchResult) => r.url === 'https://redirected.com/page');
    expect(redirectResult).toBeDefined();
    expect(redirectResult!.url).toBe('https://redirected.com/page');
  });

  it('filters out results inside .b_ad containers', async () => {
    mockSuccessResponse(BING_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', defaultOpts);

    const adResult = results.find((r: WebSearchResult) => r.url.includes('ads.example.com'));
    expect(adResult).toBeUndefined();
  });

  it('filters out results with non-HTTP/HTTPS protocols', async () => {
    mockSuccessResponse(BING_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', defaultOpts);

    const ftpResult = results.find((r: WebSearchResult) => r.url.startsWith('ftp://'));
    expect(ftpResult).toBeUndefined();
  });

  it('returns [] on HTTP error response (not throw)', async () => {
    mockErrorResponse(429);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', defaultOpts);
    expect(results).toEqual([]);
    expect(results.length).toBe(0);
  });

  it('returns [] on network error (not throw)', async () => {
    mockNetworkError();
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', defaultOpts);
    expect(results).toEqual([]);
  });

  it('returns [] for empty Bing HTML (no li.b_algo elements)', async () => {
    mockSuccessResponse(EMPTY_BING_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', defaultOpts);
    expect(results).toEqual([]);
  });

  it('records failure in providerStats on HTTP error', async () => {
    mockErrorResponse(503);
    await (provider as any)._searchBingHttp('typescript', defaultOpts);
    const stats = providerStats.getStats('bing-http');
    expect(stats.attempts).toBe(1);
    expect(stats.failures).toBe(1);
  });

  it('records success in providerStats when results are found', async () => {
    mockSuccessResponse(BING_HTML);
    await (provider as any)._searchBingHttp('typescript', defaultOpts);
    const stats = providerStats.getStats('bing-http');
    expect(stats.attempts).toBe(1);
    expect(stats.failures).toBe(0);
  });

  it('respects count limit', async () => {
    mockSuccessResponse(BING_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript', { count: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe('_searchBingHttp — Bing redirect URL decoding', () => {
  let provider: DuckDuckGoProvider;

  beforeEach(() => {
    provider = new DuckDuckGoProvider();
    providerStats.reset('bing-http');
    mockFetch.mockReset();
  });

  it('decodes absolute Bing /ck/a? redirect URL', async () => {
    // Build a Bing HTML with absolute redirect
    const targetUrl = 'https://typescript-lang.org/docs/handbook/2/types.html';
    const encoded = Buffer.from(targetUrl).toString('base64url');
    const html = `<html><body>
      <li class="b_algo">
        <h2><a href="https://www.bing.com/ck/a?!&&p=xyz&u=a1${encoded}&ntb=1">TypeScript Docs</a></h2>
        <div class="b_caption"><p>Official TypeScript documentation.</p></div>
      </li>
    </body></html>`;
    mockSuccessResponse(html);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('typescript docs', { count: 5 });
    expect(results.length).toBe(1);
    expect(results[0]!.url).toBe(targetUrl);
  });

  it('decodes relative Bing /ck/a? redirect URL', async () => {
    const targetUrl = 'https://example.com/relative-redirect-test';
    const encoded = Buffer.from(targetUrl).toString('base64url');
    const html = `<html><body>
      <li class="b_algo">
        <h2><a href="/ck/a?!&&p=abc&u=a1${encoded}&ntb=1">Relative Redirect</a></h2>
        <div class="b_caption"><p>Snippet for relative redirect.</p></div>
      </li>
    </body></html>`;
    mockSuccessResponse(html);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('redirect test', { count: 5 });
    expect(results.length).toBe(1);
    expect(results[0]!.url).toBe(targetUrl);
  });

  it('uses rawUrl when "u" param is missing from redirect URL', async () => {
    const html = `<html><body>
      <li class="b_algo">
        <h2><a href="https://direct.example.com/no-redirect">Direct URL</a></h2>
        <div class="b_caption"><p>No redirect, direct URL.</p></div>
      </li>
    </body></html>`;
    mockSuccessResponse(html);
    const results: WebSearchResult[] = await (provider as any)._searchBingHttp('direct', { count: 5 });
    expect(results.length).toBe(1);
    expect(results[0]!.url).toBe('https://direct.example.com/no-redirect');
  });
});

describe('_searchGoogleHttp — HTML parsing', () => {
  let provider: DuckDuckGoProvider;
  const defaultOpts = { count: 10 };

  beforeEach(() => {
    provider = new DuckDuckGoProvider();
    providerStats.reset('google-http');
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses standard Google div.g result items (title, url, snippet)', async () => {
    mockSuccessResponse(GOOGLE_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', defaultOpts);

    expect(results.length).toBeGreaterThanOrEqual(2);
    const result1 = results.find((r: WebSearchResult) => r.url === 'https://google-result1.com/typescript-guide');
    expect(result1).toBeDefined();
    expect(result1!.title).toBe('TypeScript Official Guide');
    expect(result1!.snippet).toContain('TypeScript');
  });

  it('filters out ad blocks (data-text-ad attribute)', async () => {
    mockSuccessResponse(GOOGLE_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', defaultOpts);

    const adResult = results.find((r: WebSearchResult) => r.url.includes('ads.google-result.com'));
    expect(adResult).toBeUndefined();
  });

  it('filters out internal Google links (google.com URLs)', async () => {
    mockSuccessResponse(GOOGLE_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', defaultOpts);

    const internalResult = results.find((r: WebSearchResult) => r.url.includes('google.com'));
    expect(internalResult).toBeUndefined();
  });

  it('deduplicates results with the same URL', async () => {
    mockSuccessResponse(GOOGLE_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', defaultOpts);

    const duplicateUrls = results.filter((r: WebSearchResult) => r.url === 'https://duplicate-result.com/page');
    expect(duplicateUrls.length).toBe(1);
  });

  it('returns [] on HTTP error response (not throw)', async () => {
    mockErrorResponse(503);
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', defaultOpts);
    expect(results).toEqual([]);
  });

  it('returns [] on network error (not throw)', async () => {
    mockNetworkError();
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', defaultOpts);
    expect(results).toEqual([]);
  });

  it('returns [] for empty Google HTML (no div.g elements)', async () => {
    mockSuccessResponse(EMPTY_GOOGLE_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', defaultOpts);
    expect(results).toEqual([]);
  });

  it('records failure in providerStats on HTTP error', async () => {
    mockErrorResponse(429);
    await (provider as any)._searchGoogleHttp('typescript', defaultOpts);
    const stats = providerStats.getStats('google-http');
    expect(stats.attempts).toBe(1);
    expect(stats.failures).toBe(1);
  });

  it('records success in providerStats when results are found', async () => {
    mockSuccessResponse(GOOGLE_HTML);
    await (provider as any)._searchGoogleHttp('typescript', defaultOpts);
    const stats = providerStats.getStats('google-http');
    expect(stats.attempts).toBe(1);
    expect(stats.failures).toBe(0);
  });

  it('respects count limit', async () => {
    mockSuccessResponse(GOOGLE_HTML);
    const results: WebSearchResult[] = await (provider as any)._searchGoogleHttp('typescript', { count: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe('mergeSearchResults — deduplication and ordering', () => {
  it('deduplicates results by normalized URL (trailing slash)', () => {
    const input: WebSearchResult[] = [
      { title: 'A', url: 'https://example.com/page/', snippet: 'a' },
      { title: 'B', url: 'https://example.com/page', snippet: 'b' },
      { title: 'C', url: 'https://other.com/page', snippet: 'c' },
    ];
    const result = mergeSearchResults(input, 10);
    expect(result.length).toBe(2);
    expect(result[0]!.title).toBe('A'); // first occurrence wins
    expect(result[1]!.title).toBe('C');
  });

  it('deduplicates by normalized URL (www prefix)', () => {
    const input: WebSearchResult[] = [
      { title: 'First', url: 'https://www.example.com/path', snippet: 'first' },
      { title: 'Second', url: 'https://example.com/path', snippet: 'second' },
    ];
    const result = mergeSearchResults(input, 10);
    expect(result.length).toBe(1);
    expect(result[0]!.title).toBe('First');
  });

  it('limits results to maxCount', () => {
    const input: WebSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example-${i}.com/page`,
      snippet: `snippet ${i}`,
    }));
    const result = mergeSearchResults(input, 5);
    expect(result.length).toBe(5);
  });

  it('preserves original order (first occurrence wins for dupes)', () => {
    const input: WebSearchResult[] = [
      { title: 'First',  url: 'https://a.com/page', snippet: '1' },
      { title: 'Second', url: 'https://b.com/page', snippet: '2' },
      { title: 'Third',  url: 'https://a.com/page', snippet: '3' }, // dupe of First
      { title: 'Fourth', url: 'https://c.com/page', snippet: '4' },
    ];
    const result = mergeSearchResults(input, 10);
    expect(result.map((r: WebSearchResult) => r.title)).toEqual(['First', 'Second', 'Fourth']);
  });

  it('returns empty array for empty input', () => {
    expect(mergeSearchResults([], 10)).toEqual([]);
  });

  it('handles maxCount of 0 correctly', () => {
    const input: WebSearchResult[] = [{ title: 'A', url: 'https://a.com', snippet: 'a' }];
    expect(mergeSearchResults(input, 0)).toEqual([]);
  });

  it('merges results from Bing + Google together', () => {
    const bingResults: WebSearchResult[] = [
      { title: 'Bing1', url: 'https://bing-result1.com/page', snippet: 'bing snippet 1' },
      { title: 'Bing2', url: 'https://bing-result2.com/page', snippet: 'bing snippet 2' },
      { title: 'Shared', url: 'https://shared-result.com/page', snippet: 'shared from bing' },
    ];
    const googleResults: WebSearchResult[] = [
      { title: 'Google1', url: 'https://google-result1.com/page', snippet: 'google snippet 1' },
      { title: 'Shared (Google)', url: 'https://shared-result.com/page', snippet: 'shared from google' },
    ];
    const merged = mergeSearchResults([...bingResults, ...googleResults], 10);
    expect(merged.length).toBe(4); // 3 Bing + 1 new Google (shared is deduped)
    // Bing version of shared result is kept (first occurrence)
    const shared = merged.find((r: WebSearchResult) => r.url === 'https://shared-result.com/page');
    expect(shared!.title).toBe('Shared');
  });
});
