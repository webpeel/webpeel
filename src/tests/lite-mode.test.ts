/**
 * Tests for Lite Mode (`lite: true`)
 *
 * Lite mode does a fast fetch + basic HTML-to-markdown with zero heavy processing:
 * no BM25 budget distillation, no content pruning, no quality scoring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { peel } from '../index.js';

// Mock smartFetch to avoid real network requests
vi.mock('../core/strategies.js', () => ({
  smartFetch: vi.fn(async (url: string, options: any) => {
    return {
      url,
      html: `
        <html>
          <head>
            <title>Lite Mode Test Page</title>
            <meta name="description" content="A test page for lite mode." />
          </head>
          <body>
            <nav>Navigation that would normally be pruned</nav>
            <article>
              <h1>Main Article Heading</h1>
              <p>This is the main content of the page. It has enough text to be useful for testing purposes.</p>
              <p>Second paragraph with more content that makes the page substantial enough for testing.</p>
            </article>
            <footer>Footer content that would normally be pruned</footer>
          </body>
        </html>
      `,
      method: 'simple',
      statusCode: 200,
      contentType: 'text/html',
      elapsed: 50,
    };
  }),
  cleanup: vi.fn(),
}));

// Mock domain-extractors to prevent API calls in tests
vi.mock('../core/domain-extractors.js', () => ({
  getDomainExtractor: vi.fn(() => null),
  extractDomainData: vi.fn(() => null),
}));

describe('lite mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns content in lite mode', async () => {
    const result = await peel('https://example.com', { lite: true });

    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.url).toBe('https://example.com');
  });

  it('lite mode extracts the title', async () => {
    const result = await peel('https://example.com', { lite: true });

    expect(result.title).toBe('Lite Mode Test Page');
  });

  it('lite mode returns markdown content', async () => {
    const result = await peel('https://example.com', { lite: true });

    // Should contain heading from the article
    expect(result.content).toContain('Main Article Heading');
    expect(result.content).toContain('main content');
  });

  it('lite mode does not set quality score based on heavy analysis', async () => {
    const result = await peel('https://example.com', { lite: true });

    // In lite mode, quality is set to 0.5 (unknown), not calculated from content
    expect(result.quality).toBe(0.5);
  });

  it('lite mode skips budget distillation', async () => {
    // Even with budget set, lite mode should skip distillation
    const result = await peel('https://example.com', { lite: true, budget: 100 });

    // Content should be present — not empty or distilled
    expect(result.content).toBeTruthy();
    expect(result.content).toContain('Main Article Heading');
  });

  it('lite mode does not add readability result', async () => {
    const result = await peel('https://example.com', { lite: true, readable: true });

    // postProcess returns early in lite mode, so readability is skipped
    expect(result.readability).toBeUndefined();
  });

  it('lite mode result has standard fields', async () => {
    const result = await peel('https://example.com', { lite: true });

    expect(result.url).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.method).toBeDefined();
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('lite mode works without any extra options', async () => {
    // Minimal usage: just lite flag
    const result = await peel('https://news.ycombinator.com', { lite: true });

    expect(result.content).toBeTruthy();
    expect(result.method).toBe('simple');
  });
});

describe('lite mode vs default mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lite mode returns content for a normal URL', async () => {
    const liteResult = await peel('https://example.com', { lite: true });

    expect(liteResult.content).toBeTruthy();
    expect(liteResult.quality).toBe(0.5); // Fixed lite-mode quality, not calculated
  });

  it('default mode calculates quality from content', async () => {
    const defaultResult = await peel('https://example.com');

    // Default mode should compute quality (non-0.5 for content-rich page)
    // quality is computed via calculateQuality which returns a real score
    expect(defaultResult.quality).toBeDefined();
    expect(typeof defaultResult.quality).toBe('number');
  });
});
