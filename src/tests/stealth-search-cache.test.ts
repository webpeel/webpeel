import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StealthSearchProvider } from '../core/search-provider.js';

// Access private cache methods via casting for unit testing
type CacheAccessor = {
  getCachedSearch(query: string, count: number): any;
  setCachedSearch(query: string, count: number, results: any[]): void;
};

describe('StealthSearchProvider search cache', () => {
  let provider: StealthSearchProvider & CacheAccessor;

  beforeEach(() => {
    provider = new StealthSearchProvider() as any;
    // Clear the static cache between tests
    (StealthSearchProvider as any).searchCache.clear();
  });

  it('returns null for cache miss', () => {
    expect(provider.getCachedSearch('some query', 10)).toBeNull();
  });

  it('caches and retrieves search results within TTL', () => {
    const results = [
      { title: 'Test', url: 'https://example.com', snippet: 'A test result' },
    ];
    provider.setCachedSearch('test query', 10, results);

    const cached = provider.getCachedSearch('test query', 10);
    expect(cached).toEqual(results);
    expect(cached).toHaveLength(1);
  });

  it('normalises query case for cache key', () => {
    const results = [
      { title: 'Test', url: 'https://example.com', snippet: 'snippet' },
    ];
    provider.setCachedSearch('Best Pizza NYC', 10, results);

    const cached = provider.getCachedSearch('best pizza nyc', 10);
    expect(cached).toEqual(results);
  });

  it('differentiates by count', () => {
    const results5 = [{ title: 'A', url: 'https://a.com', snippet: 'a' }];
    const results10 = [
      { title: 'A', url: 'https://a.com', snippet: 'a' },
      { title: 'B', url: 'https://b.com', snippet: 'b' },
    ];
    provider.setCachedSearch('query', 5, results5);
    provider.setCachedSearch('query', 10, results10);

    expect(provider.getCachedSearch('query', 5)).toHaveLength(1);
    expect(provider.getCachedSearch('query', 10)).toHaveLength(2);
  });

  it('expires entries after TTL', () => {
    const results = [{ title: 'T', url: 'https://t.com', snippet: 's' }];
    provider.setCachedSearch('old query', 10, results);

    // Manually expire the entry by backdating its timestamp
    const cache = (StealthSearchProvider as any).searchCache;
    const key = 'old query::10';
    const entry = cache.get(key);
    entry.ts = Date.now() - 100_000; // 100s ago, past 90s TTL

    expect(provider.getCachedSearch('old query', 10)).toBeNull();
    // Entry should have been deleted
    expect(cache.has(key)).toBe(false);
  });

  it('evicts oldest entry when cache is full', () => {
    const MAX = (StealthSearchProvider as any).SEARCH_CACHE_MAX; // 50
    // Fill the cache
    for (let i = 0; i < MAX; i++) {
      provider.setCachedSearch(`query-${i}`, 10, [
        { title: `R${i}`, url: `https://${i}.com`, snippet: `s${i}` },
      ]);
    }
    expect((StealthSearchProvider as any).searchCache.size).toBe(MAX);

    // Add one more — should evict the first
    provider.setCachedSearch('new-query', 10, [
      { title: 'New', url: 'https://new.com', snippet: 'new' },
    ]);
    expect((StealthSearchProvider as any).searchCache.size).toBe(MAX);
    // First entry should be gone
    expect(provider.getCachedSearch('query-0', 10)).toBeNull();
    // New entry should exist
    expect(provider.getCachedSearch('new-query', 10)).toHaveLength(1);
  });
});
