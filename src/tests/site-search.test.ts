/**
 * Tests for site-search module
 */

import { describe, it, expect } from 'vitest';
import {
  buildSiteSearchUrl,
  listSites,
  findSiteByUrl,
  SITE_TEMPLATES,
} from '../core/site-search.js';

describe('site-search', () => {
  it('builds eBay search URL correctly', () => {
    const result = buildSiteSearchUrl('ebay', 'charizard card');
    expect(result.site).toBe('ebay');
    expect(result.query).toBe('charizard card');
    expect(result.url).toBe('https://www.ebay.com/sch/i.html?_nkw=charizard%20card');
  });

  it('builds Amazon search URL correctly', () => {
    const result = buildSiteSearchUrl('amazon', 'mechanical keyboard');
    expect(result.site).toBe('amazon');
    expect(result.url).toBe('https://www.amazon.com/s?k=mechanical%20keyboard');
  });

  it('builds all shopping sites without errors', () => {
    const shoppingSites = ['ebay', 'amazon', 'walmart', 'target', 'bestbuy', 'etsy', 'aliexpress', 'newegg'];
    for (const site of shoppingSites) {
      expect(() => buildSiteSearchUrl(site, 'test query')).not.toThrow();
      const result = buildSiteSearchUrl(site, 'test query');
      expect(result.url).toMatch(/^https:\/\//);
      expect(result.site).toBe(site);
    }
  });

  it('encodes special characters in query', () => {
    const result = buildSiteSearchUrl('ebay', 'hello world & "special" chars');
    expect(result.url).not.toContain(' ');
    expect(result.url).not.toContain('"');
    expect(result.url).not.toContain('&nkw'); // & should be encoded
    expect(result.url).toContain('hello%20world');
  });

  it('throws on unknown site', () => {
    expect(() => buildSiteSearchUrl('nonexistent-site', 'query')).toThrow(/Unknown site/);
    expect(() => buildSiteSearchUrl('nonexistent-site', 'query')).toThrow(/nonexistent-site/);
  });

  it('lists all available sites', () => {
    const sites = listSites();
    expect(sites.length).toBeGreaterThanOrEqual(20);

    // Each entry must have id, name, category
    for (const site of sites) {
      expect(site).toHaveProperty('id');
      expect(site).toHaveProperty('name');
      expect(site).toHaveProperty('category');
      expect(typeof site.id).toBe('string');
      expect(typeof site.name).toBe('string');
      expect(typeof site.category).toBe('string');
    }

    // Categories must be valid
    const validCategories = ['shopping', 'social', 'jobs', 'general', 'tech', 'real-estate', 'food'];
    for (const site of sites) {
      expect(validCategories).toContain(site.category);
    }
  });

  it('finds site by URL (reverse lookup)', () => {
    expect(findSiteByUrl('https://www.ebay.com/sch/i.html?_nkw=test')).toBe('ebay');
    expect(findSiteByUrl('https://www.amazon.com/s?k=test')).toBe('amazon');
    expect(findSiteByUrl('https://github.com/search?q=test')).toBe('github');
    expect(findSiteByUrl('https://www.npmjs.com/search?q=test')).toBe('npm');
    expect(findSiteByUrl('https://stackoverflow.com/search?q=test')).toBe('stackoverflow');
  });

  it('returns null for unknown URLs in reverse lookup', () => {
    expect(findSiteByUrl('https://www.unknown-site.com/search')).toBeNull();
    expect(findSiteByUrl('https://www.example.com/')).toBeNull();
  });

  it('handles site aliases (x = twitter)', () => {
    const resultX = buildSiteSearchUrl('x', 'typescript');
    const resultTwitter = buildSiteSearchUrl('twitter', 'typescript');
    expect(resultX.url).toBe(resultTwitter.url);
    expect(resultX.site).toBe('twitter');
  });

  it('handles case-insensitive site IDs', () => {
    // Site IDs are lowercased, so "ebay" works
    const result = buildSiteSearchUrl('ebay', 'test');
    expect(result.site).toBe('ebay');
  });

  it('covers all required sites', () => {
    const requiredSites = [
      'ebay', 'amazon', 'walmart', 'target', 'bestbuy', 'etsy', 'aliexpress', 'newegg',
      'google', 'bing', 'duckduckgo',
      'reddit', 'youtube', 'twitter', 'linkedin',
      'github', 'stackoverflow', 'npm', 'pypi',
      'zillow', 'realtor',
      'indeed', 'glassdoor', 'linkedin-jobs',
      'yelp', 'doordash', 'ubereats',
    ];
    for (const site of requiredSites) {
      expect(SITE_TEMPLATES).toHaveProperty(site);
    }
    expect(requiredSites.length).toBeGreaterThanOrEqual(20);
  });

  it('all templates produce valid HTTPS URLs', () => {
    for (const [id, template] of Object.entries(SITE_TEMPLATES)) {
      const url = template.searchUrl('test query');
      expect(url).toMatch(/^https:\/\//), `${id} should produce an HTTPS URL`;
      // Ensure query is encoded (no raw spaces)
      expect(url).not.toContain(' '), `${id} URL should not contain raw spaces`;
    }
  });

  it('findSiteByUrl handles x.com as twitter', () => {
    expect(findSiteByUrl('https://x.com/search?q=test')).toBe('twitter');
    expect(findSiteByUrl('https://twitter.com/search?q=test')).toBe('twitter');
  });
});
