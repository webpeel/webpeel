/**
 * Unit tests for src/core/cookie-cache.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cacheCookies,
  getCachedCookies,
  getCookieHeader,
  cacheCookiesForUrl,
  invalidateCookies,
  getCacheSize,
  clearCookieCache,
} from '../core/cookie-cache.js';

describe('cookie-cache', () => {
  beforeEach(() => {
    clearCookieCache();
  });

  afterEach(() => {
    clearCookieCache();
  });

  // ── cacheCookies / getCachedCookies ──────────────────────────────────────

  it('stores and retrieves cookies by domain', () => {
    cacheCookies('example.com', ['cf_clearance=abc123; Path=/; Secure']);
    const result = getCachedCookies('example.com');
    expect(result).not.toBeNull();
    expect(result!.cookies).toContain('cf_clearance=abc123; Path=/; Secure');
  });

  it('normalizes www. prefix', () => {
    cacheCookies('www.example.com', ['session=xyz; Path=/']);
    const result = getCachedCookies('example.com');
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('example.com');
  });

  it('normalizes www. prefix on lookup', () => {
    cacheCookies('example.com', ['session=xyz; Path=/']);
    const result = getCachedCookies('www.example.com');
    expect(result).not.toBeNull();
  });

  it('returns null for unknown domain', () => {
    const result = getCachedCookies('unknown.com');
    expect(result).toBeNull();
  });

  it('returns null for expired entries', () => {
    cacheCookies('example.com', ['cf_clearance=abc; Path=/'], 1); // 1ms TTL
    // Wait a tick for expiry
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const result = getCachedCookies('example.com');
        expect(result).toBeNull();
        resolve();
      }, 10);
    });
  });

  // ── cookieHeader ──────────────────────────────────────────────────────────

  it('builds a proper cookie header', () => {
    cacheCookies('example.com', [
      'cf_clearance=abc123; Path=/; Secure',
      '__cf_bm=xyz; Path=/; HttpOnly',
    ]);
    const result = getCachedCookies('example.com');
    expect(result!.cookieHeader).toBe('cf_clearance=abc123; __cf_bm=xyz');
  });

  it('getCookieHeader returns header string for valid URL', () => {
    cacheCookies('example.com', ['cf_clearance=test; Path=/']);
    const header = getCookieHeader('https://example.com/page');
    expect(header).toBe('cf_clearance=test');
  });

  it('getCookieHeader returns undefined for unknown URL', () => {
    const header = getCookieHeader('https://unknown.com/page');
    expect(header).toBeUndefined();
  });

  it('getCookieHeader handles invalid URL gracefully', () => {
    const header = getCookieHeader('not-a-url');
    expect(header).toBeUndefined();
  });

  // ── cacheCookiesForUrl ────────────────────────────────────────────────────

  it('caches cookies from URL', () => {
    cacheCookiesForUrl('https://sub.example.com/path', ['session=abc; Path=/']);
    const result = getCachedCookies('sub.example.com');
    expect(result).not.toBeNull();
    expect(result!.cookieHeader).toBe('session=abc');
  });

  it('ignores invalid URL in cacheCookiesForUrl', () => {
    // Should not throw
    expect(() => cacheCookiesForUrl('not-a-url', ['session=abc'])).not.toThrow();
  });

  // ── Parent domain fallback ────────────────────────────────────────────────

  it('falls back to parent domain cookies', () => {
    cacheCookies('example.com', ['cf_clearance=parent; Path=/']);
    // Look up a subdomain — should find the parent domain entry
    const result = getCachedCookies('sub.example.com');
    expect(result).not.toBeNull();
    expect(result!.cookieHeader).toContain('cf_clearance=parent');
  });

  it('prefers exact domain match over parent', () => {
    cacheCookies('example.com', ['cf_clearance=parent; Path=/']);
    cacheCookies('sub.example.com', ['cf_clearance=sub; Path=/']);
    const result = getCachedCookies('sub.example.com');
    expect(result!.cookieHeader).toBe('cf_clearance=sub');
  });

  // ── invalidateCookies ─────────────────────────────────────────────────────

  it('removes domain entry on invalidate', () => {
    cacheCookies('example.com', ['session=abc; Path=/']);
    invalidateCookies('example.com');
    expect(getCachedCookies('example.com')).toBeNull();
  });

  // ── getCacheSize ──────────────────────────────────────────────────────────

  it('tracks cache size', () => {
    expect(getCacheSize()).toBe(0);
    cacheCookies('a.com', ['c=1']);
    cacheCookies('b.com', ['c=2']);
    expect(getCacheSize()).toBe(2);
  });

  it('clears cache on clearCookieCache', () => {
    cacheCookies('a.com', ['c=1']);
    cacheCookies('b.com', ['c=2']);
    clearCookieCache();
    expect(getCacheSize()).toBe(0);
    expect(getCachedCookies('a.com')).toBeNull();
  });

  // ── Empty cookies ─────────────────────────────────────────────────────────

  it('ignores empty cookie arrays', () => {
    cacheCookies('example.com', []);
    expect(getCachedCookies('example.com')).toBeNull();
  });

  // ── Multiple cookies ─────────────────────────────────────────────────────

  it('handles multiple cookies correctly', () => {
    cacheCookies('example.com', [
      'cf_clearance=abc; Path=/; Secure; Max-Age=1800',
      '__cf_bm=def; Path=/; HttpOnly; SameSite=None',
      '__utma=ghi; Path=/',
    ]);
    const result = getCachedCookies('example.com');
    expect(result!.cookies).toHaveLength(3);
    expect(result!.cookieHeader).toBe('cf_clearance=abc; __cf_bm=def; __utma=ghi');
  });
});
