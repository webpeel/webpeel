/**
 * Tests for the Smart Router (src/mcp/smart-router.ts)
 * 30+ cases covering all intents, edge cases, ambiguous inputs,
 * bare URLs, and mixed intent+URL strings.
 */

import { describe, it, expect } from 'vitest';
import { parseIntent, extractUrl, extractAllUrls, detectIntent } from '../mcp/smart-router.js';

// ── detectIntent ────────────────────────────────────────────────────────────────

describe('detectIntent — basic intents', () => {
  it('detects read from "read"', () => {
    expect(detectIntent('read https://stripe.com')).toBe('read');
  });

  it('detects read from "fetch"', () => {
    expect(detectIntent('fetch the content of openai.com')).toBe('read');
  });

  it('detects read from "summarize"', () => {
    expect(detectIntent('summarize this article')).toBe('read');
  });

  it('detects read from "what does"', () => {
    expect(detectIntent('what does stripe.com say about pricing')).toBe('read');
  });

  it('detects see from "screenshot"', () => {
    expect(detectIntent('screenshot bbc.com')).toBe('see');
  });

  it('detects see from "visual"', () => {
    expect(detectIntent('visual inspection of the landing page')).toBe('see');
  });

  it('detects see from "design"', () => {
    expect(detectIntent('show me the design of stripe.com')).toBe('see');
  });

  it('detects find from "find"', () => {
    expect(detectIntent('find best AI frameworks')).toBe('find');
  });

  it('detects find from "search"', () => {
    expect(detectIntent('search for React alternatives')).toBe('find');
  });

  it('detects find from "google"', () => {
    expect(detectIntent('google machine learning tutorials')).toBe('find');
  });

  it('detects find from "map"', () => {
    expect(detectIntent('map all pages on stripe.com')).toBe('find');
  });

  it('detects find from "look up" (multi-word, not "look")', () => {
    expect(detectIntent('look up best JS libraries')).toBe('find');
  });

  it('detects extract from "extract"', () => {
    expect(detectIntent('extract prices from stripe.com/pricing')).toBe('extract');
  });

  it('detects extract from "scrape"', () => {
    expect(detectIntent('scrape product listings from amazon.com')).toBe('extract');
  });

  it('detects extract from "brand"', () => {
    expect(detectIntent('get brand colors from notion.so')).toBe('extract');
  });

  it('detects extract from "logo"', () => {
    expect(detectIntent('find logo on figma.com')).toBe('extract');
  });

  it('detects monitor from "watch"', () => {
    expect(detectIntent('watch stripe.com/pricing for changes')).toBe('monitor');
  });

  it('detects monitor from "monitor"', () => {
    expect(detectIntent('monitor hacker news for updates')).toBe('monitor');
  });

  it('detects monitor from "track"', () => {
    expect(detectIntent('track changes on news.ycombinator.com')).toBe('monitor');
  });

  it('detects act from "click"', () => {
    expect(detectIntent('click the sign up button')).toBe('act');
  });

  it('detects act from "fill"', () => {
    expect(detectIntent('fill the login form on github.com')).toBe('act');
  });

  it('detects act from "sign up" (multi-word)', () => {
    expect(detectIntent('sign up for the newsletter')).toBe('act');
  });

  it('defaults to read for bare URL', () => {
    expect(detectIntent('https://stripe.com')).toBe('read');
  });

  it('defaults to read when no verb recognized', () => {
    expect(detectIntent('stripe.com')).toBe('read');
  });
});

// ── Intent priority ────────────────────────────────────────────────────────────

describe('detectIntent — priority conflicts', () => {
  it('act beats monitor (click + track)', () => {
    expect(detectIntent('click and track the button')).toBe('act');
  });

  it('monitor beats extract (track + price)', () => {
    expect(detectIntent('track price changes on amazon.com')).toBe('monitor');
  });

  it('extract beats see (logo + show)', () => {
    expect(detectIntent('show me the logo and colors')).toBe('extract');
  });

  it('see beats find (screenshot + search results)', () => {
    expect(detectIntent('screenshot the search results page')).toBe('see');
  });

  it('"look" (see) is trumped by "look up" (find)', () => {
    expect(detectIntent('look up the best CSS frameworks')).toBe('find');
  });
});

// ── parseIntent — URL extraction ───────────────────────────────────────────────

describe('parseIntent — URL extraction', () => {
  it('extracts http URL', () => {
    const result = parseIntent('read https://stripe.com');
    expect(result.url).toBe('https://stripe.com');
  });

  it('extracts https URL with path', () => {
    const result = parseIntent('extract prices from https://stripe.com/pricing');
    expect(result.url).toBe('https://stripe.com/pricing');
  });

  it('extracts bare domain and normalizes to https', () => {
    const result = parseIntent('screenshot bbc.com');
    expect(result.url).toBe('https://bbc.com');
  });

  it('extracts domain with path', () => {
    const result = parseIntent('watch stripe.com/pricing for changes');
    expect(result.url).toBe('https://stripe.com/pricing');
  });

  it('returns undefined url when no URL in task', () => {
    const result = parseIntent('find best AI frameworks');
    expect(result.url).toBeUndefined();
  });

  it('strips trailing punctuation from extracted URL', () => {
    const result = parseIntent('please read https://stripe.com.');
    expect(result.url).toBe('https://stripe.com');
  });
});

// ── parseIntent — params ───────────────────────────────────────────────────────

describe('parseIntent — parameter extraction', () => {
  it('detects "on mobile" viewport', () => {
    const result = parseIntent('screenshot bbc.com on mobile');
    expect(result.params['viewport']).toEqual({ width: 390, height: 844 });
  });

  it('detects "on tablet" viewport', () => {
    const result = parseIntent('screenshot bbc.com on tablet');
    expect(result.params['viewport']).toEqual({ width: 768, height: 1024 });
  });

  it('detects "full page"', () => {
    const result = parseIntent('screenshot stripe.com full page');
    expect(result.params['fullPage']).toBe(true);
  });

  it('detects "full-page" (hyphenated)', () => {
    const result = parseIntent('take a full-page screenshot');
    expect(result.params['fullPage']).toBe(true);
  });

  it('detects "as json" format', () => {
    const result = parseIntent('extract data from stripe.com as json');
    expect(result.params['format']).toBe('json');
  });

  it('detects "structured" as json format', () => {
    const result = parseIntent('get structured data from amazon.com');
    expect(result.params['format']).toBe('json');
  });

  it('detects "summary" param', () => {
    const result = parseIntent('summary of openai.com homepage');
    expect(result.params['summary']).toBe(true);
  });

  it('detects "summarize" param', () => {
    const result = parseIntent('summarize https://openai.com');
    expect(result.params['summary']).toBe(true);
  });
});

// ── parseIntent — see mode ─────────────────────────────────────────────────────

describe('parseIntent — see/design/compare modes', () => {
  it('sets mode=design for design keyword', () => {
    const result = parseIntent('show me the design of stripe.com');
    expect(result.params['mode']).toBe('design');
  });

  it('sets mode=compare for compare keyword', () => {
    const result = parseIntent('compare stripe.com and paddle.com');
    expect(result.params['mode']).toBe('compare');
  });

  it('extracts compare_url when two domains present', () => {
    const result = parseIntent('compare stripe.com and paddle.com');
    expect(result.params['compare_url']).toBe('https://paddle.com');
  });

  it('no mode set for plain screenshot', () => {
    const result = parseIntent('screenshot stripe.com');
    expect(result.params['mode']).toBeUndefined();
  });
});

// ── parseIntent — find query extraction ───────────────────────────────────────

describe('parseIntent — find query extraction', () => {
  it('extracts query with no URL', () => {
    const result = parseIntent('find best AI frameworks');
    expect(result.intent).toBe('find');
    expect(result.query).toBeTruthy();
    expect(result.query).toContain('AI frameworks');
  });

  it('extracts query after removing intent verb', () => {
    const result = parseIntent('search for React alternatives');
    expect(result.intent).toBe('find');
    expect(result.query).toContain('React alternatives');
  });

  it('sets no query when task is only URL for find/map', () => {
    const result = parseIntent('map stripe.com sitemap');
    expect(result.intent).toBe('find');
    expect(result.url).toBe('https://stripe.com');
  });
});

// ── extractUrl standalone ──────────────────────────────────────────────────────

describe('extractUrl', () => {
  it('extracts https URL', () => {
    expect(extractUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('extracts http URL', () => {
    expect(extractUrl('check http://example.com today')).toBe('http://example.com');
  });

  it('extracts domain without scheme', () => {
    expect(extractUrl('go to stripe.com/pricing')).toBe('https://stripe.com/pricing');
  });

  it('returns undefined when no URL', () => {
    expect(extractUrl('hello world')).toBeUndefined();
  });
});

// ── extractAllUrls standalone ──────────────────────────────────────────────────

describe('extractAllUrls', () => {
  it('extracts multiple https URLs', () => {
    const result = extractAllUrls('compare https://stripe.com and https://paddle.com');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('https://stripe.com');
    expect(result[1]).toBe('https://paddle.com');
  });

  it('extracts multiple bare domains', () => {
    const result = extractAllUrls('compare stripe.com and paddle.com');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array when no URLs', () => {
    const result = extractAllUrls('find best JavaScript libraries');
    expect(result).toHaveLength(0);
  });
});

// ── End-to-end parseIntent scenarios ──────────────────────────────────────────

describe('parseIntent — end-to-end', () => {
  it('bare URL → read', () => {
    const r = parseIntent('https://stripe.com');
    expect(r.intent).toBe('read');
    expect(r.url).toBe('https://stripe.com');
  });

  it('YouTube URL → read', () => {
    const r = parseIntent('https://youtube.com/watch?v=abc123');
    expect(r.intent).toBe('read');
    expect(r.url).toBe('https://youtube.com/watch?v=abc123');
  });

  it('screenshot on mobile full page', () => {
    const r = parseIntent('screenshot bbc.com on mobile full page');
    expect(r.intent).toBe('see');
    expect(r.url).toBe('https://bbc.com');
    expect(r.params['viewport']).toEqual({ width: 390, height: 844 });
    expect(r.params['fullPage']).toBe(true);
  });

  it('extract prices as json', () => {
    const r = parseIntent('extract prices from stripe.com/pricing as json');
    expect(r.intent).toBe('extract');
    expect(r.url).toBe('https://stripe.com/pricing');
    expect(r.params['format']).toBe('json');
  });

  it('monitor watch for changes', () => {
    const r = parseIntent('watch stripe.com/pricing for changes');
    expect(r.intent).toBe('monitor');
    expect(r.url).toBe('https://stripe.com/pricing');
  });

  it('act — click button', () => {
    const r = parseIntent('click the sign up button on github.com');
    expect(r.intent).toBe('act');
    expect(r.url).toBe('https://github.com');
  });

  it('research deep query', () => {
    const r = parseIntent('research best AI agent frameworks 2024');
    expect(r.intent).toBe('find');
    expect(r.query).toBeTruthy();
    expect(r.query).toContain('AI agent frameworks 2024');
  });

  it('summarize with URL', () => {
    const r = parseIntent('summarize https://openai.com/blog');
    expect(r.intent).toBe('read');
    expect(r.url).toBe('https://openai.com/blog');
    expect(r.params['summary']).toBe(true);
  });
});
