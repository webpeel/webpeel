/**
 * Tests for src/core/research.ts — Deep Research Agent
 *
 * All actual web fetches are mocked via vi.mock / vi.stubGlobal.
 * No network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake PeelResult-like object */
function fakePeelResult(overrides: {
  url?: string;
  title?: string;
  content?: string;
} = {}) {
  return {
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Example Title',
    content: overrides.content ?? 'This is the page content with some relevant information.',
    metadata: {},
    links: [],
    tokens: 10,
    method: 'simple' as const,
    elapsed: 50,
    contentType: 'html' as const,
    quality: 0.9,
    fingerprint: 'abc123',
  };
}

/**
 * Build a fake DuckDuckGo search result page in markdown.
 * Each entry is a markdown link pointing to a non-DDG domain.
 */
function fakeDDGPage(entries: Array<{ title: string; url: string }>): string {
  return entries
    .map(({ title, url }) => `- [${title}](${url})`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that touch the module
// ---------------------------------------------------------------------------

// We mock the `../index.js` module (which exports `peel`) and
// `./bm25-filter.js` so we control BM25 output.

const mockPeel = vi.fn();
const mockFilterByRelevance = vi.fn();
const mockEstimateCost = vi.fn();

vi.mock('../index.js', () => ({
  peel: (...args: any[]) => mockPeel(...args),
}));

vi.mock('../core/bm25-filter.js', () => ({
  filterByRelevance: (...args: any[]) => mockFilterByRelevance(...args),
  computeRelevanceScore: (_content: string, _query: string) => 0.65,
}));

vi.mock('../core/llm-extract.js', () => ({
  estimateCost: (...args: any[]) => mockEstimateCost(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { research } from '../core/research.js';

// ---------------------------------------------------------------------------
// Default mock implementations
// ---------------------------------------------------------------------------

function defaultFilterImpl(content: string) {
  return { content, kept: 5, total: 5, reductionPercent: 20 };
}

function setupDefaultMocks(searchUrls: Array<{ title: string; url: string }> = []) {
  // Search result page
  mockPeel.mockImplementation(async (url: string) => {
    if (url.includes('duckduckgo.com')) {
      return fakePeelResult({
        url,
        title: 'DuckDuckGo',
        content: fakeDDGPage(searchUrls),
      });
    }
    // Content pages
    return fakePeelResult({ url, title: `Page: ${url}`, content: `Content of ${url}` });
  });

  mockFilterByRelevance.mockImplementation(defaultFilterImpl);
  mockEstimateCost.mockReturnValue(0.001);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('research()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. URL extraction from search results
  it('extracts URLs from DuckDuckGo search results', async () => {
    const searchUrls = [
      { title: 'Result A', url: 'https://siteA.com/page' },
      { title: 'Result B', url: 'https://siteB.com/page' },
    ];
    setupDefaultMocks(searchUrls);

    const result = await research({
      query: 'test query',
      maxSources: 5,
      outputFormat: 'sources',
    });

    expect(result.totalSourcesFound).toBe(2);
    expect(result.sourcesConsulted).toBe(2);
    expect(result.sources.map(s => s.url)).toContain('https://siteA.com/page');
    expect(result.sources.map(s => s.url)).toContain('https://siteB.com/page');
  });

  // 2. DuckDuckGo links are excluded from source list
  it('excludes duckduckgo.com links from sources', async () => {
    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('duckduckgo.com')) {
        return fakePeelResult({
          url,
          content: [
            '[DDG link](https://duckduckgo.com/?q=foo)',
            '[Real site](https://real-site.com/article)',
          ].join('\n'),
        });
      }
      return fakePeelResult({ url });
    });
    mockFilterByRelevance.mockImplementation(defaultFilterImpl);

    const result = await research({ query: 'test', outputFormat: 'sources' });

    const sourceUrls = result.sources.map(s => s.url);
    expect(sourceUrls.every(u => !u.includes('duckduckgo.com'))).toBe(true);
    expect(sourceUrls).toContain('https://real-site.com/article');
  });

  // 3. maxSources limits the number of pages fetched
  it('respects maxSources limit', async () => {
    const searchUrls = Array.from({ length: 10 }, (_, i) => ({
      title: `Site ${i}`,
      url: `https://site${i}.com`,
    }));
    setupDefaultMocks(searchUrls);

    const result = await research({ query: 'laptops', maxSources: 3, outputFormat: 'sources' });

    // Should only fetch 3 sources (plus the search page itself)
    expect(result.sourcesConsulted).toBe(3);
    // peel called: 1 (search) + 3 (sources) = 4
    expect(mockPeel).toHaveBeenCalledTimes(4);
  });

  // 4. Sources sorted by relevance (descending)
  it('sorts sources by relevance descending', async () => {
    const searchUrls = [
      { title: 'Low relevance', url: 'https://low.com' },
      { title: 'High relevance', url: 'https://high.com' },
      { title: 'Mid relevance', url: 'https://mid.com' },
    ];

    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('duckduckgo.com')) {
        return fakePeelResult({ url, content: fakeDDGPage(searchUrls) });
      }
      return fakePeelResult({ url, content: `Content of ${url}` });
    });

    // Return different reductionPercent per URL to produce different relevance scores
    mockFilterByRelevance.mockImplementation((content: string) => {
      if (content.includes('low.com')) return { content, reductionPercent: 80, kept: 1, total: 5 };
      if (content.includes('high.com')) return { content, reductionPercent: 10, kept: 5, total: 5 };
      if (content.includes('mid.com')) return { content, reductionPercent: 50, kept: 3, total: 5 };
      return defaultFilterImpl(content);
    });

    const result = await research({ query: 'test', maxSources: 3, outputFormat: 'sources' });

    const relevances = result.sources.map(s => s.relevance);
    for (let i = 0; i < relevances.length - 1; i++) {
      expect(relevances[i]).toBeGreaterThanOrEqual(relevances[i + 1]);
    }
  });

  // 5. outputFormat='sources' produces raw report without LLM
  it('outputFormat=sources skips LLM and returns raw source content', async () => {
    setupDefaultMocks([{ title: 'A', url: 'https://a.com' }]);

    // No apiKey provided; no fetch mock for LLM endpoint
    const result = await research({
      query: 'coffee beans',
      maxSources: 1,
      outputFormat: 'sources',
    });

    expect(result.report).toContain('Source 1');
    expect(result.tokensUsed).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });

  // 6. maxDepth=1 does NOT follow links
  it('maxDepth=1 does not follow links within source pages', async () => {
    const searchUrls = [{ title: 'Main', url: 'https://main.com' }];
    // The source page contains follow-up links that should NOT be fetched when maxDepth=1
    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('duckduckgo.com')) {
        return fakePeelResult({ url, content: fakeDDGPage(searchUrls) });
      }
      return fakePeelResult({
        url,
        content: 'See also [Deep Link](https://deeper.com/article) for more info.',
      });
    });
    mockFilterByRelevance.mockImplementation(defaultFilterImpl);

    await research({ query: 'test', maxSources: 1, maxDepth: 1, outputFormat: 'sources' });

    // Only 2 calls: search + main.com (deeper.com should NOT be fetched)
    expect(mockPeel).toHaveBeenCalledTimes(2);
    const calledUrls = mockPeel.mock.calls.map((c: any[]) => c[0] as string);
    expect(calledUrls).not.toContain('https://deeper.com/article');
  });

  // 7. maxDepth=2 follows links from top sources
  it('maxDepth=2 follows links from top sources', async () => {
    const searchUrls = [{ title: 'Main', url: 'https://main.com' }];
    const followUrl = 'https://deeper.com/article';

    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('duckduckgo.com')) {
        return fakePeelResult({ url, content: fakeDDGPage(searchUrls) });
      }
      if (url === 'https://main.com') {
        return fakePeelResult({
          url,
          content: `Main content. See [Deeper](${followUrl}) for details.`,
        });
      }
      return fakePeelResult({ url, content: 'Deeper content.' });
    });

    // filterByRelevance is called per fetch; its output is used to extract links
    mockFilterByRelevance.mockImplementation((content: string) => ({
      content,
      reductionPercent: 20,
      kept: 5,
      total: 5,
    }));

    await research({ query: 'test', maxSources: 1, maxDepth: 2, outputFormat: 'sources' });

    const calledUrls = mockPeel.mock.calls.map((c: any[]) => c[0] as string);
    expect(calledUrls).toContain(followUrl);
  });

  // 8. Returns correct elapsed time
  it('returns elapsed time in the result', async () => {
    setupDefaultMocks([{ title: 'A', url: 'https://a.com' }]);

    const before = Date.now();
    const result = await research({ query: 'timing test', maxSources: 1, outputFormat: 'sources' });
    const after = Date.now();

    expect(result.elapsed).toBeGreaterThanOrEqual(0);
    expect(result.elapsed).toBeLessThanOrEqual(after - before + 50);
  });

  // 9. LLM synthesis is called when apiKey is provided (report format)
  it('calls LLM synthesis when apiKey and outputFormat=report', async () => {
    setupDefaultMocks([{ title: 'A', url: 'https://a.com' }]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '# Research Report\nFindings here.' } }],
        usage: { prompt_tokens: 500, completion_tokens: 200 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await research({
      query: 'test topic',
      maxSources: 1,
      outputFormat: 'report',
      apiKey: 'test-api-key',
    });

    // LLM fetch should have been called (at least once, for synthesis)
    const llmCalls = mockFetch.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('/chat/completions'),
    );
    expect(llmCalls.length).toBeGreaterThan(0);
    expect(result.report).toContain('Research Report');
    expect(result.tokensUsed).toBeDefined();
    expect(result.tokensUsed?.input).toBe(500);
    expect(result.tokensUsed?.output).toBe(200);

    vi.unstubAllGlobals();
  });

  // 10. No LLM call when no apiKey (falls back to sources report)
  it('falls back to sources report when no apiKey provided', async () => {
    setupDefaultMocks([
      { title: 'A', url: 'https://a.com' },
      { title: 'B', url: 'https://b.com' },
    ]);

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await research({
      query: 'coffee',
      maxSources: 2,
      outputFormat: 'report',
      // No apiKey — should not call LLM
    });

    // fetch should only be called for the search (DDG) — peel does that internally
    // LLM endpoint should NOT be called
    const llmCalls = mockFetch.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('/chat/completions'),
    );
    expect(llmCalls.length).toBe(0);
    expect(result.report).toContain('Source 1');
    expect(result.tokensUsed).toBeUndefined();

    vi.unstubAllGlobals();
  });

  // 11. totalSourcesFound reflects search results count
  it('totalSourcesFound reflects number of links found in search results', async () => {
    const searchUrls = Array.from({ length: 7 }, (_, i) => ({
      title: `Site ${i}`,
      url: `https://site${i}.com`,
    }));
    setupDefaultMocks(searchUrls);

    const result = await research({ query: 'test', maxSources: 3, outputFormat: 'sources' });

    expect(result.totalSourcesFound).toBe(7);
    expect(result.sourcesConsulted).toBe(3); // capped by maxSources
  });

  // 12. Failed source fetches are gracefully skipped
  it('gracefully skips sources that fail to fetch', async () => {
    const searchUrls = [
      { title: 'Good', url: 'https://good.com' },
      { title: 'Bad', url: 'https://bad.com' },
    ];

    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('duckduckgo.com')) {
        return fakePeelResult({ url, content: fakeDDGPage(searchUrls) });
      }
      if (url.includes('bad.com')) {
        throw new Error('Connection refused');
      }
      return fakePeelResult({ url, content: 'Good content.' });
    });
    mockFilterByRelevance.mockImplementation(defaultFilterImpl);

    const result = await research({ query: 'test', maxSources: 2, outputFormat: 'sources' });

    // Only the good source should appear
    expect(result.sourcesConsulted).toBe(1);
    expect(result.sources[0].url).toBe('https://good.com');
  });

  // 13. Relevance score is clamped between 0 and 1
  it('relevance scores are clamped between 0 and 1', async () => {
    setupDefaultMocks([{ title: 'A', url: 'https://a.com' }]);
    // Simulate extreme reductionPercent values
    mockFilterByRelevance.mockReturnValueOnce({
      content: 'Filtered content',
      reductionPercent: 150, // > 100 — should clamp to 0
      kept: 1,
      total: 5,
    });

    const result = await research({ query: 'test', maxSources: 1, outputFormat: 'sources' });

    for (const source of result.sources) {
      expect(source.relevance).toBeGreaterThanOrEqual(0);
      expect(source.relevance).toBeLessThanOrEqual(1);
    }
  });

  // 14. onProgress callback is called for each phase
  it('calls onProgress for each phase', async () => {
    setupDefaultMocks([{ title: 'A', url: 'https://a.com' }]);

    const phases: string[] = [];
    await research({
      query: 'test',
      maxSources: 1,
      outputFormat: 'sources',
      onProgress: (step) => {
        phases.push(step.phase);
      },
    });

    expect(phases).toContain('searching');
    expect(phases).toContain('fetching');
    expect(phases).toContain('extracting');
  });

  // 15. Empty search results produces empty sources list (no crash)
  it('handles empty search results without crashing', async () => {
    mockPeel.mockImplementation(async () =>
      fakePeelResult({ content: 'No links here at all.' }),
    );
    mockFilterByRelevance.mockImplementation(defaultFilterImpl);

    const result = await research({ query: 'very obscure topic', outputFormat: 'sources' });

    expect(result.sourcesConsulted).toBe(0);
    expect(result.totalSourcesFound).toBe(0);
    expect(result.report).toBe('');
  });
});
