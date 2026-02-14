/**
 * Tests for local cache operations
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getCache, setCache, clearCache, parseTTL, cacheStats } from '../cache.js';
describe('cache operations', () => {
    beforeEach(() => {
        // Clear cache before each test
        clearCache(true);
    });
    describe('parseTTL', () => {
        it('parses seconds', () => {
            expect(parseTTL('30s')).toBe(30 * 1000);
            expect(parseTTL('1s')).toBe(1000);
        });
        it('parses minutes', () => {
            expect(parseTTL('5m')).toBe(5 * 60 * 1000);
            expect(parseTTL('1m')).toBe(60 * 1000);
        });
        it('parses hours', () => {
            expect(parseTTL('2h')).toBe(2 * 60 * 60 * 1000);
            expect(parseTTL('1h')).toBe(60 * 60 * 1000);
        });
        it('parses days', () => {
            expect(parseTTL('1d')).toBe(24 * 60 * 60 * 1000);
            expect(parseTTL('7d')).toBe(7 * 24 * 60 * 60 * 1000);
        });
        it('throws on invalid format', () => {
            expect(() => parseTTL('invalid')).toThrow();
            expect(() => parseTTL('5')).toThrow();
            expect(() => parseTTL('5x')).toThrow();
        });
    });
    describe('setCache and getCache', () => {
        it('stores and retrieves cached results', () => {
            const url = 'https://example.com/page1';
            const result = { content: 'Test content', title: 'Test' };
            const ttlMs = 60 * 1000; // 1 minute
            setCache(url, result, ttlMs);
            const cached = getCache(url);
            expect(cached).toEqual(result);
        });
        it('returns null for non-existent cache', () => {
            const cached = getCache('https://nonexistent.com/page');
            expect(cached).toBeNull();
        });
        it('respects cache options', () => {
            const url = 'https://example.com/page';
            const result1 = { content: 'Markdown' };
            const result2 = { content: 'Text' };
            const ttlMs = 60 * 1000;
            setCache(url, result1, ttlMs, { format: 'markdown' });
            setCache(url, result2, ttlMs, { format: 'text' });
            const cached1 = getCache(url, { format: 'markdown' });
            const cached2 = getCache(url, { format: 'text' });
            expect(cached1).toEqual(result1);
            expect(cached2).toEqual(result2);
        });
        it('expires cache after TTL', async () => {
            const url = 'https://example.com/page';
            const result = { content: 'Test' };
            const ttlMs = 50; // 50ms
            setCache(url, result, ttlMs);
            // Should be cached immediately
            expect(getCache(url)).toEqual(result);
            // Wait for TTL to expire
            await new Promise(resolve => setTimeout(resolve, 60));
            // Should be expired
            expect(getCache(url)).toBeNull();
        });
        it('handles different render options', () => {
            const url = 'https://example.com/page';
            const simpleResult = { method: 'simple' };
            const browserResult = { method: 'browser' };
            const ttlMs = 60 * 1000;
            setCache(url, simpleResult, ttlMs, { render: false });
            setCache(url, browserResult, ttlMs, { render: true });
            expect(getCache(url, { render: false })).toEqual(simpleResult);
            expect(getCache(url, { render: true })).toEqual(browserResult);
        });
        it('handles stealth option separately', () => {
            const url = 'https://example.com/page';
            const normalResult = { method: 'normal' };
            const stealthResult = { method: 'stealth' };
            const ttlMs = 60 * 1000;
            setCache(url, normalResult, ttlMs, { stealth: false });
            setCache(url, stealthResult, ttlMs, { stealth: true });
            expect(getCache(url, { stealth: false })).toEqual(normalResult);
            expect(getCache(url, { stealth: true })).toEqual(stealthResult);
        });
        it('caches selector results separately', () => {
            const url = 'https://example.com/page';
            const fullResult = { content: 'Full page' };
            const selectedResult = { content: 'Selected content' };
            const ttlMs = 60 * 1000;
            setCache(url, fullResult, ttlMs, { selector: null });
            setCache(url, selectedResult, ttlMs, { selector: '.content' });
            expect(getCache(url, { selector: null })).toEqual(fullResult);
            expect(getCache(url, { selector: '.content' })).toEqual(selectedResult);
        });
        it('overwrites existing cache entry', () => {
            const url = 'https://example.com/page';
            const result1 = { content: 'First' };
            const result2 = { content: 'Second' };
            const ttlMs = 60 * 1000;
            setCache(url, result1, ttlMs);
            setCache(url, result2, ttlMs);
            expect(getCache(url)).toEqual(result2);
        });
    });
    describe('clearCache', () => {
        it('clears all cache entries when all=true', () => {
            setCache('https://example.com/page1', { content: 'Test 1' }, 60000);
            setCache('https://example.com/page2', { content: 'Test 2' }, 60000);
            const cleared = clearCache(true);
            expect(cleared).toBe(2);
            expect(getCache('https://example.com/page1')).toBeNull();
            expect(getCache('https://example.com/page2')).toBeNull();
        });
        it('clears only expired entries when all=false', async () => {
            setCache('https://example.com/page1', { content: 'Test 1' }, 50); // 50ms TTL
            setCache('https://example.com/page2', { content: 'Test 2' }, 60000); // 1 minute TTL
            // Wait for first entry to expire
            await new Promise(resolve => setTimeout(resolve, 60));
            const cleared = clearCache(false);
            expect(cleared).toBe(1);
            expect(getCache('https://example.com/page1')).toBeNull();
            expect(getCache('https://example.com/page2')).toEqual({ content: 'Test 2' });
        });
        it('returns 0 when no entries to clear', () => {
            const cleared = clearCache(true);
            expect(cleared).toBe(0);
        });
    });
    describe('cacheStats', () => {
        it('returns correct entry count', () => {
            setCache('https://example.com/page1', { content: 'Test 1' }, 60000);
            setCache('https://example.com/page2', { content: 'Test 2' }, 60000);
            const stats = cacheStats();
            expect(stats.entries).toBe(2);
        });
        it('returns size in bytes', () => {
            setCache('https://example.com/page', { content: 'Test content' }, 60000);
            const stats = cacheStats();
            expect(stats.sizeBytes).toBeGreaterThan(0);
        });
        it('returns cache directory path', () => {
            const stats = cacheStats();
            expect(stats.dir).toContain('.webpeel');
            expect(stats.dir).toContain('cache');
        });
        it('returns zero stats for empty cache', () => {
            clearCache(true);
            const stats = cacheStats();
            expect(stats.entries).toBe(0);
            expect(stats.sizeBytes).toBe(0);
        });
        it('updates stats after adding entries', () => {
            clearCache(true);
            const stats1 = cacheStats();
            expect(stats1.entries).toBe(0);
            setCache('https://example.com/page', { content: 'Test' }, 60000);
            const stats2 = cacheStats();
            expect(stats2.entries).toBe(1);
            expect(stats2.sizeBytes).toBeGreaterThan(0);
        });
    });
    describe('cache key generation', () => {
        it('generates different keys for different URLs', () => {
            const result = { content: 'Test' };
            const ttlMs = 60000;
            setCache('https://example.com/page1', result, ttlMs);
            setCache('https://example.com/page2', result, ttlMs);
            const stats = cacheStats();
            expect(stats.entries).toBe(2);
        });
        it('generates different keys for different formats', () => {
            const url = 'https://example.com/page';
            const result = { content: 'Test' };
            const ttlMs = 60000;
            setCache(url, result, ttlMs, { format: 'markdown' });
            setCache(url, result, ttlMs, { format: 'text' });
            const stats = cacheStats();
            expect(stats.entries).toBe(2);
        });
        it('generates same key for equivalent options', () => {
            const url = 'https://example.com/page';
            const result1 = { content: 'First' };
            const result2 = { content: 'Second' };
            const ttlMs = 60000;
            setCache(url, result1, ttlMs, { format: 'markdown', render: false });
            setCache(url, result2, ttlMs, { format: 'markdown', render: false });
            // Should overwrite, so only 1 entry
            const stats = cacheStats();
            expect(stats.entries).toBe(1);
            expect(getCache(url, { format: 'markdown', render: false })).toEqual(result2);
        });
        it('ignores irrelevant options in key generation', () => {
            const url = 'https://example.com/page';
            const result = { content: 'Test' };
            const ttlMs = 60000;
            setCache(url, result, ttlMs, { format: 'markdown', timeout: 5000 });
            // Should retrieve even with different timeout (not part of cache key)
            const cached = getCache(url, { format: 'markdown', timeout: 10000 });
            expect(cached).toEqual(result);
        });
    });
    describe('edge cases', () => {
        it('handles very long TTL', () => {
            const url = 'https://example.com/page';
            const result = { content: 'Test' };
            const ttlMs = 365 * 24 * 60 * 60 * 1000; // 1 year
            setCache(url, result, ttlMs);
            const cached = getCache(url);
            expect(cached).toEqual(result);
        });
        it('handles zero TTL as immediately expired', async () => {
            const url = 'https://example.com/page';
            const result = { content: 'Test' };
            const ttlMs = 0;
            setCache(url, result, ttlMs);
            // Even with zero TTL, should be expired
            const cached = getCache(url);
            expect(cached).toBeNull();
        });
        it('handles large result objects', () => {
            const url = 'https://example.com/page';
            const largeResult = {
                content: 'x'.repeat(10000),
                metadata: { data: 'y'.repeat(5000) },
            };
            const ttlMs = 60000;
            setCache(url, largeResult, ttlMs);
            const cached = getCache(url);
            expect(cached).toEqual(largeResult);
        });
        it('handles special characters in URLs', () => {
            const url = 'https://example.com/page?foo=bar&baz=qux#section';
            const result = { content: 'Test' };
            const ttlMs = 60000;
            setCache(url, result, ttlMs);
            const cached = getCache(url);
            expect(cached).toEqual(result);
        });
        it('handles null and undefined in results', () => {
            const url = 'https://example.com/page';
            const result = { content: 'Test', metadata: null, extra: undefined };
            const ttlMs = 60000;
            setCache(url, result, ttlMs);
            const cached = getCache(url);
            expect(cached.content).toBe('Test');
            expect(cached.metadata).toBeNull();
        });
    });
});
//# sourceMappingURL=cache.test.js.map