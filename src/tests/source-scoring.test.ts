/**
 * Tests for source-scoring.ts
 *
 * Covers: primary source detection, domain authority, freshness scoring,
 * combined scoring, domain dedup, and edge cases.
 * All tests run offline — no network requests.
 */

import { describe, it, expect } from 'vitest';
import {
  extractEntityCandidates,
  scorePrimarySource,
  isPrimarySource,
  scoreDomainAuthority,
  authorityLabel,
  scoreFreshness,
  freshnessLabel,
  extractPageDate,
  computeFinalScore,
  isFactualQuery,
  deduplicateByDomain,
  rankSearchResults,
  scoreFetchedSources,
  extractHostname,
  extractRegisteredDomain,
  scoreSource,
} from '../core/source-scoring.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(url: string, title = 'Title', snippet = 'Snippet') {
  return { url, title, snippet };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

describe('extractHostname', () => {
  it('extracts hostname from https URL', () => {
    expect(extractHostname('https://docs.cerebras.ai/reference/api')).toBe('docs.cerebras.ai');
  });
  it('extracts hostname from http URL', () => {
    expect(extractHostname('http://github.com/user/repo')).toBe('github.com');
  });
  it('lowercases hostname', () => {
    expect(extractHostname('https://GITHUB.COM/repo')).toBe('github.com');
  });
  it('returns empty string for invalid URL', () => {
    expect(extractHostname('not-a-url')).toBe('');
  });
});

describe('extractRegisteredDomain', () => {
  it('extracts registered domain from subdomain URL', () => {
    expect(extractRegisteredDomain('https://docs.cerebras.ai/api')).toBe('cerebras.ai');
  });
  it('extracts domain from github.com URL', () => {
    expect(extractRegisteredDomain('https://github.com/user/repo')).toBe('github.com');
  });
  it('handles multi-part TLDs like .co.uk', () => {
    expect(extractRegisteredDomain('https://bbc.co.uk/news')).toBe('bbc.co.uk');
  });
  it('returns empty string for invalid URL', () => {
    expect(extractRegisteredDomain('not-a-url')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 1. Primary source detection — 10+ test cases
// ---------------------------------------------------------------------------

describe('extractEntityCandidates', () => {
  it('extracts entity from "what are cerebras free tier limits"', () => {
    const entities = extractEntityCandidates('what are cerebras free tier limits');
    expect(entities).toContain('cerebras');
  });

  it('filters out stopwords', () => {
    const entities = extractEntityCandidates('what is the openai api pricing');
    expect(entities).not.toContain('what');
    expect(entities).not.toContain('the');
    expect(entities).not.toContain('is');
  });

  it('extracts multiple entities from compound query', () => {
    const entities = extractEntityCandidates('anthropic claude model pricing');
    expect(entities).toContain('anthropic');
    expect(entities).toContain('claude');
    expect(entities).toContain('model');
  });

  it('filters tokens shorter than 3 chars', () => {
    const entities = extractEntityCandidates('is ai safe');
    expect(entities).not.toContain('ai');
    expect(entities).not.toContain('is');
  });

  it('handles empty query', () => {
    expect(extractEntityCandidates('')).toEqual([]);
  });

  it('lowercases all candidates', () => {
    const entities = extractEntityCandidates('OpenAI GPT-4 pricing');
    expect(entities).toContain('openai');
  });
});

describe('scorePrimarySource', () => {
  it('boosts cerebras.ai for cerebras query', () => {
    const score = scorePrimarySource('https://cerebras.ai/pricing', 'what are cerebras free tier limits');
    expect(score).toBeGreaterThan(0.3);
  });

  it('boosts docs.cerebras.ai even more (entity + docs path)', () => {
    const score = scorePrimarySource('https://docs.cerebras.ai/reference/api', 'cerebras api rate limits');
    expect(score).toBeGreaterThanOrEqual(0.5); // 0.3 entity + 0.2 docs path
  });

  it('does NOT boost unrelated domain', () => {
    const score = scorePrimarySource('https://reddit.com/r/programming', 'cerebras api limits');
    expect(score).toBe(0);
  });

  it('boosts /pricing path', () => {
    const score = scorePrimarySource('https://openai.com/pricing', 'gpt4 cost');
    expect(score).toBeGreaterThan(0); // /pricing path match
  });

  it('boosts /docs path', () => {
    const score = scorePrimarySource('https://openai.com/docs/api-reference', 'openai api');
    expect(score).toBeGreaterThanOrEqual(0.5); // entity + docs
  });

  it('boosts /help path', () => {
    const score = scorePrimarySource('https://stripe.com/help/overview', 'stripe payment help');
    expect(score).toBeGreaterThan(0);
  });

  it('caps score at 1.0', () => {
    const score = scorePrimarySource('https://cerebras.ai/docs/api/pricing', 'cerebras docs api pricing');
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('unrelated domain with docs path scores only for docs path', () => {
    const score = scorePrimarySource('https://example.com/docs/cerebras', 'groq api limits');
    // No entity match (groq not in example.com), but has /docs path
    expect(score).toBe(0.2);
  });
});

describe('isPrimarySource', () => {
  it('returns true for entity domain match', () => {
    expect(isPrimarySource('https://openai.com/api', 'openai gpt4')).toBe(true);
  });

  it('returns false for unrelated domain', () => {
    expect(isPrimarySource('https://medium.com/article', 'openai gpt4')).toBe(false);
  });

  it('returns true for docs path even without entity match', () => {
    expect(isPrimarySource('https://example.com/docs/guide', 'some query')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Domain authority scoring — all tiers
// ---------------------------------------------------------------------------

describe('scoreDomainAuthority', () => {
  it('scores .gov domains at 1.0', () => {
    expect(scoreDomainAuthority('https://cdc.gov/covid')).toBe(1.0);
    expect(scoreDomainAuthority('https://nasa.gov/missions')).toBe(1.0);
  });

  it('scores .edu domains at 0.95', () => {
    expect(scoreDomainAuthority('https://mit.edu/course')).toBe(0.95);
    expect(scoreDomainAuthority('https://cs.stanford.edu/research')).toBe(0.95);
  });

  it('scores .org domains at 0.9 (via TLD rule)', () => {
    // mozilla.org has no specific rule → hits .org TLD rule → 0.9
    expect(scoreDomainAuthority('https://mozilla.org/firefox')).toBe(0.9);
    // python.org has no specific rule → .org TLD → 0.9
    expect(scoreDomainAuthority('https://python.org/downloads')).toBe(0.9);
  });

  it('scores github.com at 0.9', () => {
    expect(scoreDomainAuthority('https://github.com/user/repo')).toBe(0.9);
  });

  it('scores arxiv.org at 0.9', () => {
    expect(scoreDomainAuthority('https://arxiv.org/abs/2301.00001')).toBe(0.9);
  });

  it('scores stackoverflow.com at 0.85', () => {
    expect(scoreDomainAuthority('https://stackoverflow.com/questions/123')).toBe(0.85);
  });

  it('scores wikipedia.org at 0.85', () => {
    expect(scoreDomainAuthority('https://en.wikipedia.org/wiki/AI')).toBe(0.85);
  });

  it('scores docs.* subdomain at 0.9', () => {
    expect(scoreDomainAuthority('https://docs.python.org/3/library')).toBe(0.9);
    expect(scoreDomainAuthority('https://docs.stripe.com/api')).toBe(0.9);
  });

  it('scores developer.* subdomain at 0.9', () => {
    expect(scoreDomainAuthority('https://developer.mozilla.org/en-US/docs')).toBe(0.9);
    expect(scoreDomainAuthority('https://developer.apple.com/documentation')).toBe(0.9);
  });

  it('scores reuters.com at 0.8', () => {
    expect(scoreDomainAuthority('https://reuters.com/technology/story')).toBe(0.8);
  });

  it('scores techcrunch.com at 0.75', () => {
    expect(scoreDomainAuthority('https://techcrunch.com/2024/01/01/ai')).toBe(0.75);
  });

  it('scores unknown domain at default 0.5', () => {
    expect(scoreDomainAuthority('https://randomblog.io/post')).toBe(0.5);
    expect(scoreDomainAuthority('https://medium.com/article')).toBe(0.5);
  });

  it('handles empty URL', () => {
    expect(scoreDomainAuthority('')).toBe(0.5);
  });
});

describe('authorityLabel', () => {
  it('maps >= 0.9 to official', () => {
    expect(authorityLabel(0.9)).toBe('official');
    expect(authorityLabel(1.0)).toBe('official');
  });

  it('maps >= 0.8 to institutional', () => {
    expect(authorityLabel(0.8)).toBe('institutional');
    expect(authorityLabel(0.85)).toBe('institutional');
  });

  it('maps >= 0.7 to major', () => {
    expect(authorityLabel(0.7)).toBe('major');
    expect(authorityLabel(0.75)).toBe('major');
  });

  it('maps < 0.7 to general', () => {
    expect(authorityLabel(0.5)).toBe('general');
    expect(authorityLabel(0.6)).toBe('general');
  });
});

// ---------------------------------------------------------------------------
// 3. Freshness scoring — all ranges
// ---------------------------------------------------------------------------

describe('extractPageDate', () => {
  it('extracts from publishDate', () => {
    const d = extractPageDate({ publishDate: '2024-01-15T00:00:00Z' });
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it('extracts from published', () => {
    const d = extractPageDate({ published: '2023-06-01' });
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2023);
  });

  it('extracts from lastModified in freshnessData', () => {
    // Use mid-year date to avoid timezone edge cases near Jan 1
    const d = extractPageDate(undefined, { lastModified: '2024-06-15T12:00:00Z' });
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2024);
  });

  it('returns null when no date metadata', () => {
    expect(extractPageDate({})).toBeNull();
    expect(extractPageDate(undefined, {})).toBeNull();
    expect(extractPageDate()).toBeNull();
  });

  it('rejects invalid date strings', () => {
    const d = extractPageDate({ publishDate: 'not-a-date' });
    expect(d).toBeNull();
  });

  it('extracts from article:published_time', () => {
    const d = extractPageDate({ 'article:published_time': '2024-03-01T12:00:00Z' });
    expect(d).not.toBeNull();
  });
});

describe('scoreFreshness', () => {
  it('returns 1.0 for content published 3 days ago', () => {
    expect(scoreFreshness({ publishDate: daysAgo(3) })).toBe(1.0);
  });

  it('returns 0.9 for content published 15 days ago', () => {
    expect(scoreFreshness({ publishDate: daysAgo(15) })).toBe(0.9);
  });

  it('returns 0.8 for content published 60 days ago', () => {
    expect(scoreFreshness({ publishDate: daysAgo(60) })).toBe(0.8);
  });

  it('returns 0.6 for content published 200 days ago', () => {
    expect(scoreFreshness({ publishDate: daysAgo(200) })).toBe(0.6);
  });

  it('returns 0.4 for content published over a year ago', () => {
    expect(scoreFreshness({ publishDate: daysAgo(400) })).toBe(0.4);
  });

  it('returns 0.5 (neutral) when no date is available', () => {
    expect(scoreFreshness()).toBe(0.5);
    expect(scoreFreshness({})).toBe(0.5);
    expect(scoreFreshness(undefined, {})).toBe(0.5);
  });

  it('uses lastModified from freshnessData as fallback', () => {
    const score = scoreFreshness(undefined, { lastModified: daysAgo(5) });
    expect(score).toBe(1.0);
  });
});

describe('freshnessLabel', () => {
  it('labels recent content as "recent"', () => {
    expect(freshnessLabel({ publishDate: daysAgo(3) })).toBe('recent');
    expect(freshnessLabel({ publishDate: daysAgo(25) })).toBe('recent');
  });

  it('labels 60-day-old content as "this-month"', () => {
    expect(freshnessLabel({ publishDate: daysAgo(60) })).toBe('this-month');
  });

  it('labels year-old content as "this-year"', () => {
    expect(freshnessLabel({ publishDate: daysAgo(300) })).toBe('this-year');
  });

  it('labels unknown date as "this-year" (neutral = 0.5)', () => {
    expect(freshnessLabel()).toBe('this-year');
  });

  it('labels very old content as "older"', () => {
    expect(freshnessLabel({ publishDate: daysAgo(500) })).toBe('older');
  });
});

// ---------------------------------------------------------------------------
// 4. Factual query detection
// ---------------------------------------------------------------------------

describe('isFactualQuery', () => {
  it('detects pricing queries', () => {
    expect(isFactualQuery('what are cerebras free tier limits')).toBe(true);
    expect(isFactualQuery('openai api pricing 2024')).toBe(true);
    expect(isFactualQuery('how much does gpt4 cost')).toBe(true);
  });

  it('detects rate/limit queries', () => {
    expect(isFactualQuery('groq rate limits')).toBe(true);
    expect(isFactualQuery('anthropic api limits')).toBe(true);
  });

  it('detects plan/subscription queries', () => {
    expect(isFactualQuery('stripe subscription plans')).toBe(true);
    expect(isFactualQuery('github pro plan fee')).toBe(true);
  });

  it('returns false for general queries', () => {
    expect(isFactualQuery('who invented python')).toBe(false);
    expect(isFactualQuery('how does machine learning work')).toBe(false);
    expect(isFactualQuery('history of the internet')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Combined scoring formula
// ---------------------------------------------------------------------------

describe('computeFinalScore', () => {
  it('uses standard weights for non-factual queries', () => {
    const score = computeFinalScore(0.8, 0.9, 0.9, 0.5, false);
    // 0.8*0.4 + 0.9*0.25 + 0.9*0.2 + 0.5*0.15
    const expected = 0.8 * 0.4 + 0.9 * 0.25 + 0.9 * 0.2 + 0.5 * 0.15;
    expect(score).toBeCloseTo(expected, 5);
  });

  it('uses freshness-doubled weights for factual queries', () => {
    const score = computeFinalScore(0.8, 0.9, 1.0, 0.5, true);
    // 0.8*0.35 + 0.9*0.15 + 1.0*0.35 + 0.5*0.15
    const expected = 0.8 * 0.35 + 0.9 * 0.15 + 1.0 * 0.35 + 0.5 * 0.15;
    expect(score).toBeCloseTo(expected, 5);
  });

  it('fresh primary source beats stale authority site for pricing queries', () => {
    // Recent official site vs old high-authority site
    const freshPrimary = computeFinalScore(0.7, 0.5, 1.0, 1.0, true);   // cerebras.ai, fresh
    const staleAuthority = computeFinalScore(0.7, 0.95, 0.4, 0.0, true); // .edu, old
    expect(freshPrimary).toBeGreaterThan(staleAuthority);
  });

  it('BM25 has higher marginal impact than any single other factor', () => {
    // +0.5 BM25 improvement vs +0.5 improvement in any other single factor
    const base = computeFinalScore(0.5, 0.5, 0.5, 0.5, false);
    const bm25Gain = computeFinalScore(1.0, 0.5, 0.5, 0.5, false) - base;
    const authorityGain = computeFinalScore(0.5, 1.0, 0.5, 0.5, false) - base;
    const freshnessGain = computeFinalScore(0.5, 0.5, 1.0, 0.5, false) - base;
    const primaryGain = computeFinalScore(0.5, 0.5, 0.5, 1.0, false) - base;
    expect(bm25Gain).toBeGreaterThan(authorityGain);
    expect(bm25Gain).toBeGreaterThan(freshnessGain);
    expect(bm25Gain).toBeGreaterThan(primaryGain);
  });

  it('weights sum to 1.0 for standard mode', () => {
    expect(0.40 + 0.25 + 0.20 + 0.15).toBeCloseTo(1.0, 10);
  });

  it('weights sum to 1.0 for factual mode', () => {
    expect(0.35 + 0.15 + 0.35 + 0.15).toBeCloseTo(1.0, 10);
  });
});

// ---------------------------------------------------------------------------
// 6. Domain deduplication
// ---------------------------------------------------------------------------

describe('deduplicateByDomain', () => {
  it('removes duplicate domains beyond max (default 2)', () => {
    const sources = [
      { url: 'https://example.com/a', finalScore: 0.9 },
      { url: 'https://example.com/b', finalScore: 0.8 },
      { url: 'https://example.com/c', finalScore: 0.7 },
      { url: 'https://other.com/x', finalScore: 0.6 },
    ];
    const result = deduplicateByDomain(sources);
    expect(result.length).toBe(3); // 2 from example.com + 1 from other.com
    const exampleUrls = result.filter(r => r.url.includes('example.com'));
    expect(exampleUrls.length).toBe(2);
  });

  it('keeps highest-scored results from each domain', () => {
    const sources = [
      { url: 'https://example.com/low', finalScore: 0.3 },
      { url: 'https://example.com/high', finalScore: 0.9 },
      { url: 'https://example.com/mid', finalScore: 0.6 },
    ];
    const result = deduplicateByDomain(sources, 1);
    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://example.com/high');
  });

  it('respects maxPerDomain=1', () => {
    const sources = [
      { url: 'https://github.com/repo1', finalScore: 0.8 },
      { url: 'https://github.com/repo2', finalScore: 0.7 },
      { url: 'https://stackoverflow.com/q/1', finalScore: 0.6 },
    ];
    const result = deduplicateByDomain(sources, 1);
    expect(result.length).toBe(2);
  });

  it('treats subdomains as same registered domain', () => {
    const sources = [
      { url: 'https://docs.example.com/api', finalScore: 0.9 },
      { url: 'https://support.example.com/faq', finalScore: 0.8 },
      { url: 'https://example.com/home', finalScore: 0.7 },
    ];
    const result = deduplicateByDomain(sources, 2);
    // All three have registered domain "example.com"
    expect(result.length).toBe(2); // max 2
  });

  it('returns all sources when no domain repeats', () => {
    const sources = [
      { url: 'https://alpha.com/', finalScore: 0.9 },
      { url: 'https://beta.com/', finalScore: 0.8 },
      { url: 'https://gamma.com/', finalScore: 0.7 },
    ];
    const result = deduplicateByDomain(sources);
    expect(result.length).toBe(3);
  });

  it('handles empty input', () => {
    expect(deduplicateByDomain([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Full scoreSource integration
// ---------------------------------------------------------------------------

describe('scoreSource', () => {
  it('returns all required fields', () => {
    const result = scoreSource({
      searchResult: makeResult('https://cerebras.ai/pricing'),
      query: 'cerebras free tier limits',
      bm25Score: 0.7,
      metadata: { publishDate: daysAgo(5) },
    });
    expect(result).toMatchObject({
      url: 'https://cerebras.ai/pricing',
      confidence: 0.7,
      isPrimarySource: true,
      authority: expect.any(String),
      freshness: expect.any(String),
      finalScore: expect.any(Number),
    });
  });

  it('official source + fresh + high BM25 yields high final score', () => {
    const result = scoreSource({
      searchResult: makeResult('https://docs.stripe.com/api/pricing'),
      query: 'stripe api pricing',
      bm25Score: 0.85,
      metadata: { publishDate: daysAgo(3) },
    });
    expect(result.finalScore).toBeGreaterThan(0.75);
    expect(result.isPrimarySource).toBe(true);
    expect(result.authority).toBe('official');
    expect(result.freshness).toBe('recent');
  });

  it('unknown domain with no date uses neutral defaults', () => {
    // Use a domain/query where no entity or path match can occur
    const result = scoreSource({
      searchResult: makeResult('https://techblog.io/post/1'),
      query: 'how does machine learning work',
      bm25Score: 0.5,
    });
    expect(result.authority).toBe('general');
    expect(result.freshness).toBe('this-year'); // neutral score 0.5 → this-year
    expect(result.isPrimarySource).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. rankSearchResults (pre-fetch ranking)
// ---------------------------------------------------------------------------

describe('rankSearchResults', () => {
  it('prioritizes high-authority sources', () => {
    const results = [
      makeResult('https://randomblog.io/post'),
      makeResult('https://github.com/openai/openai-python'),
      makeResult('https://medium.com/article'),
    ];
    const ranked = rankSearchResults(results, 'openai python sdk');
    expect(ranked[0].url).toBe('https://github.com/openai/openai-python');
  });

  it('deduplicates by domain', () => {
    const results = [
      makeResult('https://example.com/a'),
      makeResult('https://example.com/b'),
      makeResult('https://example.com/c'),
      makeResult('https://github.com/x'),
    ];
    const ranked = rankSearchResults(results, 'query');
    const exampleCount = ranked.filter(r => r.url.includes('example.com')).length;
    expect(exampleCount).toBeLessThanOrEqual(2);
  });

  it('handles empty results', () => {
    expect(rankSearchResults([], 'query')).toEqual([]);
  });

  it('preserves all result fields', () => {
    const results = [makeResult('https://docs.python.org/tutorial', 'Python Docs', 'Official docs')];
    const ranked = rankSearchResults(results, 'python tutorial');
    expect(ranked[0].title).toBe('Python Docs');
    expect(ranked[0].snippet).toBe('Official docs');
  });
});

// ---------------------------------------------------------------------------
// 9. scoreFetchedSources (post-BM25 scoring)
// ---------------------------------------------------------------------------

describe('scoreFetchedSources', () => {
  it('returns scored sources sorted by finalScore', () => {
    const sources = [
      { searchResult: makeResult('https://randomblog.io/'), bm25Score: 0.3 },
      { searchResult: makeResult('https://docs.openai.com/pricing'), bm25Score: 0.7,
        metadata: { publishDate: daysAgo(10) } },
    ];
    const scored = scoreFetchedSources(sources, 'openai pricing');
    expect(scored[0].finalScore).toBeGreaterThanOrEqual(scored[1].finalScore);
  });

  it('deduplicated results respect maxPerDomain', () => {
    const sources = [
      { searchResult: makeResult('https://example.com/a'), bm25Score: 0.8 },
      { searchResult: makeResult('https://example.com/b'), bm25Score: 0.7 },
      { searchResult: makeResult('https://example.com/c'), bm25Score: 0.6 },
    ];
    const scored = scoreFetchedSources(sources, 'example query', { maxPerDomain: 2 });
    const exampleCount = scored.filter(s => s.url.includes('example.com')).length;
    expect(exampleCount).toBeLessThanOrEqual(2);
  });

  it('all sources include required public fields', () => {
    const sources = [
      { searchResult: makeResult('https://github.com/repo'), bm25Score: 0.6 },
    ];
    const [result] = scoreFetchedSources(sources, 'github repo');
    expect(result).toMatchObject({
      url: expect.any(String),
      title: expect.any(String),
      snippet: expect.any(String),
      confidence: expect.any(Number),
      authority: expect.any(String),
      freshness: expect.any(String),
      isPrimarySource: expect.any(Boolean),
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles non-English entity names in primary source detection', () => {
    // Japanese company "Rakuten" — entity extraction should work
    const entities = extractEntityCandidates('rakuten mobile pricing japan');
    expect(entities).toContain('rakuten');
    const score = scorePrimarySource('https://rakuten.co.jp/mobile/pricing', 'rakuten mobile pricing japan');
    expect(score).toBeGreaterThan(0);
  });

  it('handles URLs with unusual ports', () => {
    const hostname = extractHostname('http://localhost:3000/api');
    expect(hostname).toBe('localhost');
  });

  it('handles URLs with query params in path detection', () => {
    const score = scorePrimarySource('https://example.com/docs?lang=en', 'some docs query');
    expect(score).toBeGreaterThan(0); // /docs path detected
  });

  it('handles missing/undefined metadata gracefully', () => {
    expect(() => scoreFreshness(undefined, undefined)).not.toThrow();
    expect(() => freshnessLabel(undefined, undefined)).not.toThrow();
    expect(() => extractPageDate(undefined, undefined)).not.toThrow();
  });

  it('handles URL with no path for authority scoring', () => {
    expect(() => scoreDomainAuthority('https://example.com')).not.toThrow();
    expect(scoreDomainAuthority('https://github.com')).toBe(0.9);
  });

  it('correctly identifies docs subdomain for unknown company', () => {
    const score = scoreDomainAuthority('https://docs.unknown-startup.io/reference');
    expect(score).toBe(0.9); // docs.* pattern
  });

  it('handles very old dates (pre-2000 rejects)', () => {
    const d = extractPageDate({ publishDate: '1990-01-01' });
    // 1990 should be rejected (> 1990 check)
    expect(d).toBeNull();
  });

  it('handles future dates (should not occur but must not crash)', () => {
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(() => scoreFreshness({ publishDate: futureDate })).not.toThrow();
  });
});
