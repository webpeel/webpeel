/**
 * Unit tests for HTTP stealth headers and proxy routing improvements.
 *
 * Tests:
 * 1. getRealisticUserAgent() returns varied Chrome UAs
 * 2. getHttpUA() returns varied UAs across browser types
 * 3. getStealthHeaders() returns different headers for Chrome vs Firefox vs Safari
 * 4. shouldUseProxy() matches known blocked domains
 * 5. shouldUseProxy() doesn't match unrelated domains
 * 6. Custom headers override stealth headers (existing behaviour preserved)
 */

import { describe, it, expect } from 'vitest';
import { getRealisticUserAgent, getHttpUA } from '../../src/core/user-agents.js';
import {
  getStealthHeaders,
  shouldUseProxy,
  PROXY_PREFERRED_DOMAINS,
} from '../../src/core/http-fetch.js';

// ── 1. getRealisticUserAgent() returns varied UAs ────────────────────────────

describe('getRealisticUserAgent', () => {
  it('returns varied UAs across 20 calls (>3 unique)', () => {
    const results = Array.from({ length: 20 }, () => getRealisticUserAgent());
    const unique = new Set(results);
    expect(unique.size).toBeGreaterThan(3);
  });

  it('always returns a non-empty string containing Mozilla', () => {
    for (let i = 0; i < 10; i++) {
      const ua = getRealisticUserAgent();
      expect(ua).toBeTruthy();
      expect(ua).toContain('Mozilla/5.0');
    }
  });

  it('returns only Chrome UAs (safe for browser contexts)', () => {
    for (let i = 0; i < 30; i++) {
      const ua = getRealisticUserAgent();
      expect(ua).toContain('Chrome/');
      expect(ua).not.toContain('Firefox');
    }
  });
});

// ── 2. getHttpUA() returns varied UAs including non-Chrome ───────────────────

describe('getHttpUA', () => {
  it('returns varied UAs across 20 calls (>3 unique)', () => {
    const results = Array.from({ length: 20 }, () => getHttpUA());
    const unique = new Set(results);
    expect(unique.size).toBeGreaterThan(3);
  });

  it('returns non-Chrome UAs occasionally (Firefox, Safari, or Edge) across 100 calls', () => {
    const results = Array.from({ length: 100 }, () => getHttpUA());
    const hasFirefox = results.some(ua => ua.includes('Firefox'));
    const hasSafari = results.some(ua => ua.includes('Safari') && !ua.includes('Chrome'));
    // At least one non-Chrome browser type should appear in 100 calls
    expect(hasFirefox || hasSafari).toBe(true);
  });

  it('always returns a non-empty string containing Mozilla', () => {
    for (let i = 0; i < 10; i++) {
      const ua = getHttpUA();
      expect(ua).toBeTruthy();
      expect(ua).toContain('Mozilla/5.0');
    }
  });
});

// ── 3. getStealthHeaders() adapts to UA type ─────────────────────────────────

describe('getStealthHeaders', () => {
  const TEST_URL = 'https://example.com/page';

  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
  const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15';
  const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

  describe('Chrome headers', () => {
    it('includes Sec-CH-UA headers', () => {
      const headers = getStealthHeaders(TEST_URL, CHROME_UA);
      expect(headers['Sec-CH-UA']).toBeDefined();
      expect(headers['Sec-CH-UA-Mobile']).toBe('?0');
      expect(headers['Sec-CH-UA-Platform']).toBeDefined();
    });

    it('includes Sec-Fetch-* headers', () => {
      const headers = getStealthHeaders(TEST_URL, CHROME_UA);
      expect(headers['Sec-Fetch-Dest']).toBe('document');
      expect(headers['Sec-Fetch-Mode']).toBe('navigate');
      expect(headers['Sec-Fetch-Site']).toBe('none');
      expect(headers['Sec-Fetch-User']).toBe('?1');
    });

    it('sets User-Agent to the provided Chrome UA', () => {
      const headers = getStealthHeaders(TEST_URL, CHROME_UA);
      expect(headers['User-Agent']).toBe(CHROME_UA);
    });
  });

  describe('Firefox headers', () => {
    it('does NOT include Sec-CH-UA headers', () => {
      const headers = getStealthHeaders(TEST_URL, FIREFOX_UA);
      expect(headers['Sec-CH-UA']).toBeUndefined();
      expect(headers['Sec-CH-UA-Mobile']).toBeUndefined();
      expect(headers['Sec-CH-UA-Platform']).toBeUndefined();
    });

    it('includes TE: trailers (Firefox-specific)', () => {
      const headers = getStealthHeaders(TEST_URL, FIREFOX_UA);
      expect(headers['TE']).toBe('trailers');
    });

    it('omits Sec-Fetch-User (Firefox does not always send it)', () => {
      const headers = getStealthHeaders(TEST_URL, FIREFOX_UA);
      expect(headers['Sec-Fetch-User']).toBeUndefined();
    });

    it('uses Firefox Accept header format', () => {
      const headers = getStealthHeaders(TEST_URL, FIREFOX_UA);
      // Firefox uses */* without avif/apng tokens
      expect(headers['Accept']).toContain('*/*;q=0.8');
      expect(headers['Accept']).not.toContain('application/signed-exchange');
    });

    it('sets User-Agent to the provided Firefox UA', () => {
      const headers = getStealthHeaders(TEST_URL, FIREFOX_UA);
      expect(headers['User-Agent']).toBe(FIREFOX_UA);
    });
  });

  describe('Safari headers', () => {
    it('does NOT include Sec-CH-UA headers', () => {
      const headers = getStealthHeaders(TEST_URL, SAFARI_UA);
      expect(headers['Sec-CH-UA']).toBeUndefined();
      expect(headers['Sec-CH-UA-Mobile']).toBeUndefined();
    });

    it('does NOT include Sec-Fetch-* headers (Safari omits these)', () => {
      const headers = getStealthHeaders(TEST_URL, SAFARI_UA);
      expect(headers['Sec-Fetch-Dest']).toBeUndefined();
      expect(headers['Sec-Fetch-Mode']).toBeUndefined();
      expect(headers['Sec-Fetch-Site']).toBeUndefined();
      expect(headers['Sec-Fetch-User']).toBeUndefined();
    });

    it('sets User-Agent to the provided Safari UA', () => {
      const headers = getStealthHeaders(TEST_URL, SAFARI_UA);
      expect(headers['User-Agent']).toBe(SAFARI_UA);
    });
  });

  describe('Edge headers (treated as Chrome)', () => {
    it('includes Sec-CH-UA headers for Edge', () => {
      const headers = getStealthHeaders(TEST_URL, EDGE_UA);
      expect(headers['Sec-CH-UA']).toBeDefined();
      expect(headers['Sec-Fetch-Dest']).toBe('document');
    });
  });

  describe('Chrome vs Firefox headers are distinct', () => {
    it('produces different header sets for Chrome and Firefox', () => {
      const chromeHeaders = getStealthHeaders(TEST_URL, CHROME_UA);
      const firefoxHeaders = getStealthHeaders(TEST_URL, FIREFOX_UA);
      // Different Accept values
      expect(chromeHeaders['Accept']).not.toBe(firefoxHeaders['Accept']);
      // Chrome has Sec-CH-UA, Firefox does not
      expect(Object.keys(chromeHeaders)).toContain('Sec-CH-UA');
      expect(Object.keys(firefoxHeaders)).not.toContain('Sec-CH-UA');
    });
  });

  describe('Google Referer injection', () => {
    it('adds Referer for reddit.com', () => {
      const headers = getStealthHeaders('https://www.reddit.com/r/technology', CHROME_UA);
      expect(headers['Referer']).toBe('https://www.google.com/');
    });

    it('adds Referer for edmunds.com', () => {
      const headers = getStealthHeaders('https://www.edmunds.com/cars', CHROME_UA);
      expect(headers['Referer']).toBe('https://www.google.com/');
    });

    it('does NOT add Referer for unrelated domains', () => {
      const headers = getStealthHeaders('https://example.com/page', CHROME_UA);
      expect(headers['Referer']).toBeUndefined();
    });
  });

  describe('common headers always present', () => {
    const UAS = [CHROME_UA, FIREFOX_UA, SAFARI_UA, EDGE_UA];
    for (const ua of UAS) {
      it(`includes User-Agent, Accept, Accept-Language, DNT for ${ua.slice(0, 40)}...`, () => {
        const headers = getStealthHeaders(TEST_URL, ua);
        expect(headers['User-Agent']).toBe(ua);
        expect(headers['Accept']).toBeTruthy();
        expect(headers['Accept-Language']).toBeTruthy();
        expect(headers['DNT']).toBe('1');
        expect(headers['Upgrade-Insecure-Requests']).toBe('1');
      });
    }
  });
});

// ── 4. shouldUseProxy() matches known blocked domains ────────────────────────

describe('shouldUseProxy', () => {
  it('matches all PROXY_PREFERRED_DOMAINS exactly', () => {
    for (const domain of PROXY_PREFERRED_DOMAINS) {
      expect(shouldUseProxy(`https://${domain}/path`)).toBe(true);
    }
  });

  it('matches www. subdomains of proxy-preferred domains', () => {
    expect(shouldUseProxy('https://www.reddit.com/r/news')).toBe(true);
    expect(shouldUseProxy('https://www.forbes.com/article')).toBe(true);
    expect(shouldUseProxy('https://www.cargurus.com/cars')).toBe(true);
    expect(shouldUseProxy('https://www.edmunds.com/used')).toBe(true);
    expect(shouldUseProxy('https://www.nerdwallet.com/loans')).toBe(true);
    expect(shouldUseProxy('https://www.tesla.com/model3')).toBe(true);
  });

  it('matches other subdomains of proxy-preferred domains', () => {
    expect(shouldUseProxy('https://old.reddit.com/r/news')).toBe(true);
    expect(shouldUseProxy('https://m.reddit.com/r/news')).toBe(true);
  });

  // ── 5. shouldUseProxy() doesn't match unrelated domains ──────────────────

  it('does NOT match unrelated domains', () => {
    expect(shouldUseProxy('https://example.com')).toBe(false);
    expect(shouldUseProxy('https://google.com')).toBe(false);
    expect(shouldUseProxy('https://github.com')).toBe(false);
    expect(shouldUseProxy('https://wikipedia.org')).toBe(false);
    expect(shouldUseProxy('https://kbb.com')).toBe(false);
  });

  it('does NOT match domains that merely contain a blocklisted name', () => {
    // "notreddit.com" should NOT match "reddit.com"
    expect(shouldUseProxy('https://notreddit.com')).toBe(false);
    expect(shouldUseProxy('https://myforbes.com')).toBe(false);
  });

  it('returns false for invalid URLs without throwing', () => {
    expect(shouldUseProxy('not-a-url')).toBe(false);
    expect(shouldUseProxy('')).toBe(false);
  });
});

// ── 6. Custom headers override stealth headers (backward compat) ─────────────

describe('getStealthHeaders — custom header override behaviour', () => {
  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  it('getStealthHeaders returns User-Agent equal to the provided UA', () => {
    const customUA = 'MyBot/1.0';
    const headers = getStealthHeaders('https://example.com', customUA);
    // User-Agent should always be exactly what we passed
    expect(headers['User-Agent']).toBe(customUA);
  });

  it('manual merge: custom headers override stealth defaults', () => {
    // Simulate what simpleFetch does: merge stealth + customHeaders
    const stealth = getStealthHeaders('https://example.com', CHROME_UA);
    const customHeaders = { 'Accept-Language': 'fr-FR,fr;q=0.9', 'X-Custom': 'value' };
    const merged = { ...stealth, ...customHeaders };

    expect(merged['Accept-Language']).toBe('fr-FR,fr;q=0.9');
    expect(merged['X-Custom']).toBe('value');
    // Stealth headers that weren't overridden are still present
    expect(merged['DNT']).toBe('1');
    expect(merged['Sec-Fetch-Dest']).toBe('document');
  });

  it('manual merge: custom User-Agent overrides stealth UA', () => {
    const stealth = getStealthHeaders('https://example.com', CHROME_UA);
    const customUA = 'CustomBot/2.0';
    const merged = { ...stealth, 'User-Agent': customUA };
    expect(merged['User-Agent']).toBe(customUA);
  });
});
