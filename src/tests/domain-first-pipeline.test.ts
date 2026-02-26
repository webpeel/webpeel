/**
 * Tests for the domain-first pipeline extraction feature.
 *
 * Verifies that:
 *  1. Known domain URLs (Reddit, GitHub, HN) attempt API extraction BEFORE smartFetch
 *  2. If domain API succeeds, smartFetch is never called
 *  3. If domain API returns null (e.g. Twitter needing HTML), smartFetch IS called
 *  4. If smartFetch throws AND a domain extractor exists, domain API is tried as fallback
 *  5. Non-domain URLs go straight to smartFetch
 *  6. When domainApiHandled=true, parseContent is a no-op (preserves pre-set content)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createContext,
  fetchContent,
  detectContentType,
  parseContent,
  normalizeOptions,
} from '../core/pipeline.js';

// ---------------------------------------------------------------------------
// Mocks — must appear before any imports of the mocked modules
// ---------------------------------------------------------------------------

vi.mock('../core/strategies.js', () => ({
  smartFetch: vi.fn(),
}));

vi.mock('../core/domain-extractors.js', () => ({
  getDomainExtractor: vi.fn(),
  extractDomainData: vi.fn(),
}));

import { smartFetch } from '../core/strategies.js';
import { getDomainExtractor, extractDomainData } from '../core/domain-extractors.js';

const mockSmartFetch = vi.mocked(smartFetch);
const mockGetDomainExtractor = vi.mocked(getDomainExtractor);
const mockExtractDomainData = vi.mocked(extractDomainData);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** A domain extract result that passes the >50 char cleanContent threshold */
function makeDomainResult(domain: string, title: string): any {
  return {
    domain,
    type: 'post',
    structured: { title },
    cleanContent: `This is clean structured content extracted directly from the ${domain} API without needing a browser fetch. It is definitely longer than 50 characters.`,
  };
}

/** A minimal smartFetch result for a successful HTTP fetch */
function makeFetchResult(url: string): any {
  return {
    html: '<html><head><title>Test</title></head><body><p>Some content here</p></body></html>',
    url,
    status: 200,
    contentType: 'text/html',
    method: 'simple',
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Domain-first pipeline extraction', () => {
  // ── Test 1: Reddit URL skips browser fetch ────────────────────────────────
  it('Reddit URL: domain API succeeds on first-pass, smartFetch is NOT called', async () => {
    const url = 'https://www.reddit.com/r/programming/comments/abc123/test_post/';

    // getDomainExtractor returns a truthy extractor for reddit.com
    mockGetDomainExtractor.mockReturnValue(vi.fn());
    // extractDomainData returns rich API content
    mockExtractDomainData.mockResolvedValue(makeDomainResult('reddit.com', 'Test Reddit Post'));

    const ctx = createContext(url, {});
    normalizeOptions(ctx);
    await fetchContent(ctx);

    // smartFetch must NOT have been called — domain API handled it
    expect(mockSmartFetch).not.toHaveBeenCalled();

    // ctx should reflect the domain API result
    expect(ctx.domainApiHandled).toBe(true);
    expect(ctx.quality).toBe(0.95);
    expect(ctx.content).toContain('reddit.com');
    expect(ctx.fetchResult?.method).toBe('domain-api');
    expect(ctx.title).toBe('Test Reddit Post');
  });

  // ── Test 2: GitHub URL skips browser fetch ────────────────────────────────
  it('GitHub URL: domain API succeeds on first-pass, smartFetch is NOT called', async () => {
    const url = 'https://github.com/vitest-dev/vitest/issues/1234';

    mockGetDomainExtractor.mockReturnValue(vi.fn());
    mockExtractDomainData.mockResolvedValue(makeDomainResult('github.com', 'Vitest Issue 1234'));

    const ctx = createContext(url, {});
    normalizeOptions(ctx);
    await fetchContent(ctx);

    expect(mockSmartFetch).not.toHaveBeenCalled();
    expect(ctx.domainApiHandled).toBe(true);
    expect(ctx.quality).toBe(0.95);
    expect(ctx.fetchResult?.method).toBe('domain-api');
    expect(ctx.title).toBe('Vitest Issue 1234');
  });

  // ── Test 3: Twitter URL falls back to smartFetch when domain API returns null
  it('Twitter URL: extractDomainData returns null (needs HTML), smartFetch IS called', async () => {
    const url = 'https://x.com/user/status/999';

    // getDomainExtractor returns truthy (Twitter has an extractor)
    mockGetDomainExtractor.mockReturnValue(vi.fn());
    // But extractDomainData returns null because it needs real HTML to work
    mockExtractDomainData.mockResolvedValue(null);
    mockSmartFetch.mockResolvedValue(makeFetchResult(url));

    const ctx = createContext(url, {});
    normalizeOptions(ctx);
    await fetchContent(ctx);

    // smartFetch MUST have been called as the fallback path
    expect(mockSmartFetch).toHaveBeenCalledOnce();
    // domainApiHandled should NOT be set
    expect(ctx.domainApiHandled).toBeFalsy();
    expect(ctx.fetchResult?.url).toBe(url);
  });

  // ── Test 4: Domain API fallback when smartFetch fails ─────────────────────
  it('Domain API fallback: smartFetch throws, domain API provides content on fallback', async () => {
    const url = 'https://www.reddit.com/r/AskReddit/comments/xyz/question/';

    mockGetDomainExtractor.mockReturnValue(vi.fn());
    // First call (domain-first): returns null — so we proceed to smartFetch
    // Second call (fallback inside catch): returns real content
    mockExtractDomainData
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeDomainResult('reddit.com', 'AskReddit Question'));

    // smartFetch throws (e.g. site blocked the request)
    mockSmartFetch.mockRejectedValue(new Error('NetworkError: site blocked browser request'));

    const ctx = createContext(url, {});
    normalizeOptions(ctx);
    await fetchContent(ctx);

    // Should have called smartFetch (which threw)
    expect(mockSmartFetch).toHaveBeenCalledOnce();
    // Should have fallen back to domain API successfully
    expect(ctx.domainApiHandled).toBe(true);
    expect(ctx.quality).toBe(0.90);
    expect(ctx.fetchResult?.method).toBe('domain-api-fallback');
    expect(ctx.content).toContain('reddit.com');
  });

  // ── Test 5: Non-domain URL goes straight to smartFetch ───────────────────
  it('Non-domain URL: getDomainExtractor returns null, smartFetch is called normally', async () => {
    const url = 'https://example.com/article/some-blog-post';

    // No domain extractor registered for example.com
    mockGetDomainExtractor.mockReturnValue(null);
    mockSmartFetch.mockResolvedValue(makeFetchResult(url));

    const ctx = createContext(url, {});
    normalizeOptions(ctx);
    await fetchContent(ctx);

    expect(mockSmartFetch).toHaveBeenCalledOnce();
    expect(mockExtractDomainData).not.toHaveBeenCalled();
    expect(ctx.domainApiHandled).toBeFalsy();
    expect(ctx.fetchResult?.url).toBe(url);
  });

  // ── Test 6: domainApiHandled skips parseContent ───────────────────────────
  it('domainApiHandled=true: parseContent is a no-op, pre-set content is preserved', async () => {
    const ctx = createContext('https://www.reddit.com/r/test', {});
    normalizeOptions(ctx);

    // Simulate what fetchContent sets when domain API handled the content
    ctx.domainApiHandled = true;
    ctx.content = 'Pre-set structured content from domain API — must not be overwritten';
    ctx.title = 'Pre-set Title';
    ctx.fetchResult = {
      html: '<html><body><h1>Ignore this HTML</h1><p>Should not be parsed</p></body></html>',
      url: 'https://www.reddit.com/r/test',
      status: 200,
      contentType: 'text/html',
      method: 'domain-api',
    };
    ctx.contentType = 'html';

    await parseContent(ctx);

    // Content must remain exactly as set — parseContent must have been skipped
    expect(ctx.content).toBe('Pre-set structured content from domain API — must not be overwritten');
    expect(ctx.title).toBe('Pre-set Title');
  });

  // ── Bonus: detectContentType is also skipped when domainApiHandled ─────────
  it('domainApiHandled=true: detectContentType is a no-op, contentType unchanged', () => {
    const ctx = createContext('https://github.com/owner/repo', {});
    normalizeOptions(ctx);

    ctx.domainApiHandled = true;
    ctx.contentType = 'json'; // Set to something non-default to verify it's preserved
    ctx.fetchResult = {
      html: '<html><body>ignored</body></html>',
      url: 'https://github.com/owner/repo',
      status: 200,
      contentType: 'text/html', // Would normally set contentType to 'html'
      method: 'domain-api',
    };

    detectContentType(ctx);

    // contentType must NOT have been changed to 'html' by detectContentType
    expect(ctx.contentType).toBe('json');
  });
});
