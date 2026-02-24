/**
 * Tests for auto-detect render/stealth mode in smartFetch().
 *
 * Verifies that WebPeel automatically escalates from simple → browser → stealth
 * without requiring explicit render/stealth flags from the caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- vi.hoisted() ensures these exist before the hoisted vi.mock() runs ---
const { mockSimpleImpl, mockBrowserImpl } = vi.hoisted(() => ({
  mockSimpleImpl: vi.fn(),
  mockBrowserImpl: vi.fn(),
}));

// ---- mock the fetcher module BEFORE importing strategies ------------------
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

// ---- helpers ---------------------------------------------------------------

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://example.com',
    html:
      '<html><head><title>Test</title></head><body>' +
      '<p>This is a real page with plenty of meaningful content. ' +
      'There is enough text here to pass the escalation threshold cleanly.</p>' +
      '</body></html>',
    method: 'simple' as const,
    statusCode: 200,
    contentType: 'text/html',
    elapsed: 50,
    ...overrides,
  };
}

function spaShell(rootDiv = '<div id="root"></div>'): string {
  const scripts = Array.from(
    { length: 8 },
    (_, i) => `<script src="/static/chunk-${i}.js"></script>`
  ).join('');
  return (
    `<!DOCTYPE html><html><head><title>App</title>${scripts}</head><body>` +
    `${rootDiv}<noscript>You need to enable JavaScript to run this app.</noscript>` +
    `</body></html>`
  );
}

function cloudflareChallengePage(): string {
  return `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>
    <div class="cf-browser-verification cf-spinner">
      <div class="cf-challenge">Checking your browser before accessing the site.</div>
      <script>window._cf_chl_opt = {};</script>
    </div>
    <div id="cf-chl-widget-abc" class="cf-turnstile"></div>
    Ray ID: abc123def456
  </body></html>`;
}

function richStaticHtml(): string {
  return `<html><head><title>News Article</title></head><body>
    <article>
      <h1>Today's Top Story</h1>
      <p>This article has substantial content that should be detected as real content.
      There is enough text here that the escalation logic should not trigger, and the
      simple fetch result should be returned directly without any browser rendering at all.</p>
      <p>More content follows with additional paragraphs that add to the total visible
      text count, making this clearly a real content page and not a JavaScript SPA shell.</p>
    </article>
  </body></html>`;
}

// ============================================================================

describe('auto-detect: domain-based browser rendering (no render:true needed)', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  const cases: [string, string][] = [
    ['x.com', 'https://x.com/elonmusk'],
    ['twitter.com', 'https://twitter.com/user'],
    ['reddit.com', 'https://reddit.com/r/programming'],
    ['instagram.com', 'https://instagram.com/user'],
    ['facebook.com', 'https://facebook.com/page'],
  ];

  for (const [domain, url] of cases) {
    it(`auto-escalates to browser for ${domain}`, async () => {
      mockBrowserImpl.mockResolvedValue(makeResult({ url, method: 'browser' }));

      const result = await smartFetch(url, { noCache: true });

      expect(mockSimpleImpl).not.toHaveBeenCalled();
      expect(['browser', 'stealth']).toContain(result.method);
    });
  }
});

// ============================================================================

describe('auto-detect: domain-based stealth mode (no stealth:true needed)', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  const cases: [string, string][] = [
    ['linkedin.com', 'https://linkedin.com/in/user'],
    ['bloomberg.com', 'https://bloomberg.com/news/articles/test'],
    ['glassdoor.com', 'https://glassdoor.com/Reviews/company'],
    ['amazon.com', 'https://amazon.com/dp/B08N5WRWNW'],
    ['zillow.com', 'https://zillow.com/homes/for-sale'],
  ];

  for (const [domain, url] of cases) {
    it(`auto-escalates to stealth for ${domain}`, async () => {
      mockBrowserImpl.mockResolvedValue(makeResult({ url, method: 'stealth' }));

      const result = await smartFetch(url, { noCache: true });

      expect(mockSimpleImpl).not.toHaveBeenCalled();
      expect(result.method).toBe('stealth');
    });
  }
});

// ============================================================================

describe('auto-detect: hashbang (#!) URL detection', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  const hashbangUrls = [
    'https://example.com/#!/home',
    'https://angularapp.example.com/#!/users/123',
    'https://legacyspa.example.com/#!dashboard',
  ];

  for (const url of hashbangUrls) {
    it(`auto-renders hashbang URL: ${url}`, async () => {
      mockBrowserImpl.mockResolvedValue(makeResult({ url, method: 'browser' }));

      const result = await smartFetch(url, { noCache: true });

      expect(mockSimpleImpl).not.toHaveBeenCalled();
      expect(['browser', 'stealth']).toContain(result.method);
    });
  }
});

// ============================================================================

describe('auto-detect: SPA HTML pattern detection', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  it('escalates when simple fetch returns empty <div id="root"></div>', async () => {
    mockSimpleImpl.mockResolvedValue(makeResult({ html: spaShell('<div id="root"></div>') }));
    mockBrowserImpl.mockResolvedValue(
      makeResult({
        html: '<html><body><h1>Loaded content</h1><p>React app rendered correctly with full content now.</p></body></html>',
        method: 'browser',
      })
    );

    const result = await smartFetch('https://reactapp.example.com', { noCache: true });

    expect(result.method).toBe('browser');
    expect(mockBrowserImpl).toHaveBeenCalled();
  });

  it('escalates when simple fetch returns empty <div id="app"></div>', async () => {
    mockSimpleImpl.mockResolvedValue(makeResult({ html: spaShell('<div id="app"></div>') }));
    mockBrowserImpl.mockResolvedValue(
      makeResult({
        html: '<html><body><h1>Vue App</h1><p>Vue.js rendered content is here now.</p></body></html>',
        method: 'browser',
      })
    );

    const result = await smartFetch('https://vueapp.example.com', { noCache: true });

    expect(result.method).toBe('browser');
  });

  it('escalates when simple fetch returns empty <div id="__next"></div> (Next.js)', async () => {
    mockSimpleImpl.mockResolvedValue(makeResult({ html: spaShell('<div id="__next"></div>') }));
    mockBrowserImpl.mockResolvedValue(
      makeResult({
        html: '<html><body><h1>Next.js Page</h1><p>Server-side rendered content loaded properly.</p></body></html>',
        method: 'browser',
      })
    );

    const result = await smartFetch('https://nextjsapp.example.com', { noCache: true });

    expect(result.method).toBe('browser');
  });

  it('escalates when noscript says "enable JavaScript to run this app"', async () => {
    const noscriptHtml = `<!DOCTYPE html><html><head><title>App</title>
      <script src="/bundle.js"></script>
      <script src="/vendor.js"></script>
      <script src="/app.js"></script>
      <script src="/runtime.js"></script>
      <script src="/polyfills.js"></script>
    </head><body>
      <app-root></app-root>
      <noscript>Please enable JavaScript to continue using this application.</noscript>
    </body></html>`;

    mockSimpleImpl.mockResolvedValue(makeResult({ html: noscriptHtml }));
    mockBrowserImpl.mockResolvedValue(
      makeResult({
        html: '<html><body><h1>Angular App</h1><p>Angular content loaded with full hydration.</p></body></html>',
        method: 'browser',
      })
    );

    const result = await smartFetch('https://angularapp.example.com', { noCache: true });

    expect(result.method).toBe('browser');
  });

  it('escalates when many script tags with very little visible text', async () => {
    const scriptHeavy =
      `<!DOCTYPE html><html><head><title>App</title>` +
      Array.from({ length: 12 }, (_, i) => `<script src="/chunk-${i}.js"></script>`).join('') +
      `</head><body><div id="react-root"></div></body></html>`;

    mockSimpleImpl.mockResolvedValue(makeResult({ html: scriptHeavy }));
    mockBrowserImpl.mockResolvedValue(
      makeResult({
        html: '<html><body><h1>App</h1><p>Content rendered by browser after JS execution.</p></body></html>',
        method: 'browser',
      })
    );

    const result = await smartFetch('https://heavy-spa.example.com', { noCache: true });

    expect(result.method).toBe('browser');
  });

  it('does NOT escalate for static pages with real content', async () => {
    mockSimpleImpl.mockResolvedValue(makeResult({ html: richStaticHtml() }));

    const result = await smartFetch('https://news.example.com', { noCache: true });

    expect(result.method).toBe('simple');
    expect(mockBrowserImpl).not.toHaveBeenCalled();
  });
});

// ============================================================================

describe('auto-detect: challenge escalation (simple → browser → stealth)', () => {
  beforeEach(() => {
    mockSimpleImpl.mockReset();
    mockBrowserImpl.mockReset();
  });

  it('escalates from simple → browser → stealth when Cloudflare detected', async () => {
    mockSimpleImpl.mockResolvedValue(
      makeResult({ html: cloudflareChallengePage(), statusCode: 403 })
    );

    let browserCallCount = 0;
    mockBrowserImpl.mockImplementation(async (_url: string, opts: { stealth?: boolean }) => {
      browserCallCount++;
      if (opts?.stealth) {
        return makeResult({
          html: '<html><body><h1>Success</h1><p>Got past Cloudflare with stealth mode.</p></body></html>',
          method: 'stealth',
        });
      }
      return makeResult({ html: cloudflareChallengePage(), statusCode: 403, method: 'browser' });
    });

    const result = await smartFetch('https://cloudflare-protected.example.com', { noCache: true });

    expect(result.method).toBe('stealth');
    expect(browserCallCount).toBeGreaterThanOrEqual(2);
  });

  it('marks challengeDetected=true when all escalation tiers fail', async () => {
    mockSimpleImpl.mockResolvedValue(
      makeResult({ html: cloudflareChallengePage(), statusCode: 403 })
    );
    mockBrowserImpl.mockResolvedValue(
      makeResult({ html: cloudflareChallengePage(), statusCode: 403, method: 'stealth' })
    );

    const result = await smartFetch('https://impenetrable.example.com', { noCache: true });

    expect(result.challengeDetected).toBe(true);
  });

  it('escalates from browser → stealth when challenge detected at browser level (forced-browser domain)', async () => {
    // Use x.com — forced to browser mode, skips simple fetch
    let browserCallCount = 0;
    mockBrowserImpl.mockImplementation(async (_url: string, opts: { stealth?: boolean }) => {
      browserCallCount++;
      if (opts?.stealth) {
        return makeResult({
          html: '<html><body><h1>Real Content</h1><p>Content loaded in stealth mode.</p></body></html>',
          method: 'stealth',
        });
      }
      return makeResult({ html: cloudflareChallengePage(), statusCode: 403, method: 'browser' });
    });

    const result = await smartFetch('https://x.com/user', { noCache: true });

    expect(result.method).toBe('stealth');
    expect(mockSimpleImpl).not.toHaveBeenCalled();
    expect(browserCallCount).toBeGreaterThanOrEqual(2);
  });
});
