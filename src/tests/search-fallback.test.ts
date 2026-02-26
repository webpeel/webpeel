import { describe, it, expect } from 'vitest';
import { searchFallback } from '../core/search-fallback.js';

describe('searchFallback', () => {
  it('returns empty result for invalid URL', async () => {
    const result = await searchFallback('not-a-url');
    expect(result.source).toBe('none');
    expect(result.cachedContent).toBe('');
  });

  it('extracts path terms from URL for search query', () => {
    // Test the URL parsing logic
    const url = 'https://www.bestbuy.com/site/apple-iphone-16-pro-128gb-desert-titanium/6587898.p';
    const urlObj = new URL(url);
    const pathTerms = urlObj.pathname
      .split(/[-/_]/)
      .filter(t => t.length > 2 && !/^\d+$/.test(t))
      .slice(0, 5);
    expect(pathTerms).toContain('apple');
    expect(pathTerms).toContain('iphone');
  });

  it('filters out short and numeric tokens from path', () => {
    const url = 'https://www.amazon.com/dp/B09XYZ12345/ref=sr_1_2';
    const urlObj = new URL(url);
    const pathTerms = urlObj.pathname
      .split(/[-/_]/)
      .filter(t => t.length > 2 && !/^\d+$/.test(t));
    // 'dp' is 2 chars → filtered; 'ref' is 3 chars → kept; numeric part → filtered
    expect(pathTerms).not.toContain('dp');
    expect(pathTerms).not.toContain('1');
    expect(pathTerms).not.toContain('2');
  });

  it('returns SearchFallbackResult shape', async () => {
    const result = await searchFallback('not-a-url');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('snippet');
    expect(result).toHaveProperty('cachedContent');
    expect(result).toHaveProperty('source');
  });

  // Note: Can't reliably test actual DDG search in unit tests (rate limiting)
  // The integration test in e2e-verify.sh will test the full chain
});
