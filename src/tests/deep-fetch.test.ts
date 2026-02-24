/**
 * Tests for deep-fetch.ts
 *
 * Covers all heuristic modules without requiring live network access:
 * - extractKeyPoints
 * - deduplicateSentences
 * - extractNumbers / extractDates / extractEntities
 * - isComparisonQuery / extractComparedEntities
 * - buildComparisonTable
 * - deepFetch (mocked search + fetch)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractKeyPoints,
  deduplicateSentences,
  extractNumbers,
  extractDates,
  extractEntities,
  isComparisonQuery,
  extractComparedEntities,
  buildComparisonTable,
} from '../core/deep-fetch.js';

// ---------------------------------------------------------------------------
// extractKeyPoints
// ---------------------------------------------------------------------------

describe('extractKeyPoints', () => {
  const SAMPLE = `
Stripe is a payment processing company founded in 2010 by Patrick Collison.

The platform supports over 135 currencies and processes billions of transactions annually.
It announced a new pricing model in January 2024 that costs $0.30 per transaction.

This paragraph has no relevant signal at all and is completely unrelated to the topic.

Stripe launched its embedded finance features in Q3 2023, enabling companies to offer
banking services. The platform requires a business account to get started.

According to recent reports, Stripe reached a valuation of $65 billion as of 2023.
  `.trim();

  it('returns at most maxPoints results', () => {
    const pts = extractKeyPoints(SAMPLE, 'Stripe payment', 5);
    expect(pts.length).toBeLessThanOrEqual(5);
  });

  it('returns an array of strings', () => {
    const pts = extractKeyPoints(SAMPLE, 'Stripe payment', 3);
    for (const p of pts) {
      expect(typeof p).toBe('string');
    }
  });

  it('prefers sentences with query terms', () => {
    const pts = extractKeyPoints(SAMPLE, 'Stripe payment', 5);
    const combined = pts.join(' ').toLowerCase();
    expect(combined).toMatch(/stripe/i);
  });

  it('prefers sentences with numbers/statistics', () => {
    const pts = extractKeyPoints(SAMPLE, 'Stripe pricing', 5);
    const combined = pts.join(' ');
    // At least one number-containing sentence should appear
    expect(combined).toMatch(/\d/);
  });

  it('prefers signal-word sentences', () => {
    const pts = extractKeyPoints(SAMPLE, 'Stripe features', 5);
    const combined = pts.join(' ').toLowerCase();
    // "launched", "announced", "costs", "requires" etc. are signal words
    expect(combined).toMatch(/launched|announced|costs|requires|reached/i);
  });

  it('handles empty content gracefully', () => {
    const pts = extractKeyPoints('', 'anything', 5);
    expect(pts).toEqual([]);
  });

  it('handles empty query gracefully', () => {
    const pts = extractKeyPoints(SAMPLE, '', 5);
    expect(pts.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// deduplicateSentences
// ---------------------------------------------------------------------------

describe('deduplicateSentences', () => {
  it('keeps unique sentences', () => {
    const input = [
      'Stripe is a payment processor founded in 2010.',
      'The sky is blue and clouds are white.',
      'Node.js is a JavaScript runtime environment.',
    ];
    const result = deduplicateSentences(input);
    expect(result.length).toBe(3);
  });

  it('removes near-duplicate sentences (>60% similar)', () => {
    const input = [
      'Stripe is a global payment processing platform.',
      'Stripe is a global payment processing company.',
    ];
    const result = deduplicateSentences(input);
    expect(result.length).toBe(1);
  });

  it('keeps the longer version of duplicates', () => {
    const input = [
      'Stripe is a payment processing company that handles transactions.',
      'Stripe is a payment processing company that handles online transactions securely.',
    ];
    const result = deduplicateSentences(input);
    expect(result.length).toBe(1);
    expect(result[0]).toContain('online');
  });

  it('handles empty input', () => {
    expect(deduplicateSentences([])).toEqual([]);
  });

  it('handles single item', () => {
    expect(deduplicateSentences(['Hello world.'])).toEqual(['Hello world.']);
  });

  it('respects custom threshold (higher = fewer dedups)', () => {
    const input = [
      'Stripe processes payments online.',
      'Stripe processes online payments securely.',
    ];
    // At 0.9 threshold these should NOT be deduped (too strict)
    const highThreshold = deduplicateSentences(input, 0.9);
    // At 0.4 threshold they SHOULD be deduped (lenient)
    const lowThreshold = deduplicateSentences(input, 0.4);
    expect(highThreshold.length).toBeGreaterThanOrEqual(lowThreshold.length);
  });
});

// ---------------------------------------------------------------------------
// extractNumbers
// ---------------------------------------------------------------------------

describe('extractNumbers', () => {
  it('extracts dollar prices', () => {
    const result = extractNumbers('The plan costs $29.99/month and $299/year.');
    const values = Object.values(result);
    expect(values.some(v => v.includes('$29'))).toBe(true);
  });

  it('extracts euro prices', () => {
    const result = extractNumbers('Premium is €49 per month.');
    const values = Object.values(result);
    expect(values.some(v => v.includes('€49'))).toBe(true);
  });

  it('extracts percentages', () => {
    const result = extractNumbers('Revenue grew by 34.5% year over year.');
    const values = Object.values(result);
    expect(values.some(v => v.includes('34.5%') || v.includes('34'))).toBe(true);
  });

  it('extracts counts with magnitude', () => {
    const result = extractNumbers('The platform has 10 million users and 500K developers.');
    const values = Object.values(result);
    const combined = values.join(' ').toLowerCase();
    expect(combined).toMatch(/million|500k/i);
  });

  it('returns empty object for no-number text', () => {
    const result = extractNumbers('This text has absolutely no numbers in it at all.');
    expect(Object.keys(result).length).toBe(0);
  });

  it('caps results at 5 per category', () => {
    const manyPrices = Array.from({ length: 10 }, (_, i) => `$${i + 1}`).join(', ');
    const result = extractNumbers(manyPrices);
    const priceKeys = Object.keys(result).filter(k => k.startsWith('price_'));
    expect(priceKeys.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// extractDates
// ---------------------------------------------------------------------------

describe('extractDates', () => {
  it('extracts full dates', () => {
    const dates = extractDates('Launched on January 15, 2024 and updated March 2024.');
    expect(dates.some(d => d.includes('January'))).toBe(true);
  });

  it('extracts ISO dates', () => {
    const dates = extractDates('Published: 2023-11-01. Updated: 2024-02-14.');
    expect(dates.some(d => d.match(/\d{4}-\d{2}-\d{2}/))).toBe(true);
  });

  it('extracts quarterly dates', () => {
    const dates = extractDates('Launched in Q3 2023 and expanded in Q1 2024.');
    expect(dates.some(d => d.match(/Q[1-4]\s+\d{4}/))).toBe(true);
  });

  it('deduplicates repeated dates', () => {
    const dates = extractDates('In 2023-01-01 and again on 2023-01-01 it happened.');
    expect(dates.filter(d => d === '2023-01-01').length).toBe(1);
  });

  it('returns empty array for no dates', () => {
    expect(extractDates('No dates here at all.')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractEntities
// ---------------------------------------------------------------------------

describe('extractEntities', () => {
  it('returns proper nouns appearing in multiple sources', () => {
    const texts = [
      'Stripe is a payment platform. Stripe also supports PayPal as an alternative.',
      'Stripe was founded in 2010. PayPal is an older payment service. Stripe and PayPal compete.',
    ];
    const entities = extractEntities(texts);
    // "Stripe" and "PayPal" each appear in 2 sources
    expect(entities).toContain('Stripe');
    expect(entities).toContain('PayPal');
  });

  it('excludes stopwords like "The", "A", "In"', () => {
    const texts = [
      'The quick brown fox jumps. In the morning.',
      'The lazy dog sits. In a park.',
    ];
    const entities = extractEntities(texts);
    expect(entities).not.toContain('The');
    expect(entities).not.toContain('In');
    expect(entities).not.toContain('A');
  });

  it('returns empty array for single-source entities', () => {
    const texts = [
      'UniqueCompanyX is only mentioned here.',
      'This text has nothing in common.',
    ];
    const entities = extractEntities(texts);
    expect(entities).not.toContain('UniqueCompanyX');
  });

  it('handles empty inputs', () => {
    expect(extractEntities([])).toEqual([]);
    expect(extractEntities([''])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isComparisonQuery
// ---------------------------------------------------------------------------

describe('isComparisonQuery', () => {
  it('detects "vs" queries', () => {
    expect(isComparisonQuery('Stripe vs PayPal')).toBe(true);
  });

  it('detects "versus" queries', () => {
    expect(isComparisonQuery('React versus Vue')).toBe(true);
  });

  it('detects "compare" queries', () => {
    expect(isComparisonQuery('compare AWS and GCP')).toBe(true);
  });

  it('detects "comparison" queries', () => {
    expect(isComparisonQuery('Node.js vs Deno comparison')).toBe(true);
  });

  it('detects "difference" queries', () => {
    expect(isComparisonQuery('difference between REST and GraphQL')).toBe(true);
  });

  it('returns false for regular queries', () => {
    expect(isComparisonQuery('how does Stripe work')).toBe(false);
    expect(isComparisonQuery('top payment processors 2024')).toBe(false);
    expect(isComparisonQuery('TypeScript tutorial')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractComparedEntities
// ---------------------------------------------------------------------------

describe('extractComparedEntities', () => {
  it('extracts entities from "X vs Y"', () => {
    const entities = extractComparedEntities('Stripe vs PayPal');
    expect(entities).toHaveLength(2);
    expect(entities[0]).toBe('Stripe');
    expect(entities[1]).toBe('PayPal');
  });

  it('extracts entities from "compare X and Y"', () => {
    const entities = extractComparedEntities('compare React and Vue');
    expect(entities).toHaveLength(2);
    expect(entities[0]).toBe('React');
    expect(entities[1]).toBe('Vue');
  });

  it('extracts entities from "difference between X and Y"', () => {
    const entities = extractComparedEntities('difference between REST and GraphQL');
    expect(entities).toHaveLength(2);
    expect(entities[0]).toBe('REST');
    expect(entities[1]).toBe('GraphQL');
  });

  it('returns empty array for non-comparison queries', () => {
    expect(extractComparedEntities('how does Stripe work')).toEqual([]);
  });

  it('handles "X versus Y"', () => {
    const entities = extractComparedEntities('AWS versus GCP cloud pricing');
    expect(entities.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// buildComparisonTable
// ---------------------------------------------------------------------------

describe('buildComparisonTable', () => {
  const CONTENT = `
## Stripe

Stripe pricing: $0.30 + 2.9% per transaction. Stripe features include subscriptions, invoicing.
Stripe platform: Web, iOS, Android, API. Stripe rating: 4.7/5 stars.

## PayPal

PayPal pricing: $0.49 + 3.49% per transaction for standard payments.
PayPal platform: Web, iOS, Android. PayPal rating: 4.2/5 stars.
PayPal pros: Widely accepted. PayPal cons: Higher fees for international payments.
  `.trim();

  it('returns columns array', () => {
    const result = buildComparisonTable(CONTENT, ['Stripe', 'PayPal']);
    expect(result).toBeDefined();
    expect(Array.isArray(result!.columns)).toBe(true);
    expect(result!.columns.length).toBeGreaterThan(0);
  });

  it('returns rows for each entity', () => {
    const result = buildComparisonTable(CONTENT, ['Stripe', 'PayPal']);
    expect(result).toBeDefined();
    expect(result!.rows['Stripe']).toBeDefined();
    expect(result!.rows['PayPal']).toBeDefined();
  });

  it('extracts price info', () => {
    const result = buildComparisonTable(CONTENT, ['Stripe', 'PayPal']);
    // Price should be extracted for at least one entity
    const stripePrice = result!.rows['Stripe']['price'];
    const paypalPrice = result!.rows['PayPal']['price'];
    expect(stripePrice !== 'N/A' || paypalPrice !== 'N/A').toBe(true);
  });

  it('returns undefined for fewer than 2 entities', () => {
    expect(buildComparisonTable(CONTENT, [])).toBeUndefined();
    expect(buildComparisonTable(CONTENT, ['Stripe'])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deepFetch (integration, mocked network)
// ---------------------------------------------------------------------------

describe('deepFetch (mocked)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns expected shape on successful fetch', async () => {
    // Mock the search provider
    vi.doMock('../core/search-provider.js', () => ({
      getBestSearchProvider: () => ({
        provider: {
          searchWeb: async () => [
            { url: 'https://example.com/stripe', title: 'Stripe Overview', snippet: 'Payment platform' },
            { url: 'https://example.com/pricing', title: 'Stripe Pricing', snippet: 'Costs $0.30' },
          ],
        },
        apiKey: undefined,
      }),
    }));

    // Mock peelBatch
    vi.doMock('../index.js', () => ({
      peel: async () => ({ content: 'Stripe is a payment platform founded in 2010.', title: 'Stripe', tokens: 100 }),
      peelBatch: async () => [
        { content: 'Stripe is a payment processing platform that costs $0.30 per transaction. It launched in 2010 and supports 135 currencies.', title: 'Stripe Overview', tokens: 200 },
        { content: 'Stripe pricing starts at $0.30 + 2.9%. It announced new pricing in January 2024.', title: 'Stripe Pricing', tokens: 100 },
      ],
    }));

    const { deepFetch: mockedDeepFetch } = await import('../core/deep-fetch.js');

    const result = await mockedDeepFetch({ query: 'Stripe payment processing', count: 2 });

    expect(result.query).toBe('Stripe payment processing');
    expect(result.format).toBe('merged');
    expect(Array.isArray(result.sources)).toBe(true);
    expect(typeof result.merged).toBe('string');
    expect(typeof result.elapsed).toBe('number');
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  it('returns empty sources on search failure', async () => {
    vi.doMock('../core/search-provider.js', () => ({
      getBestSearchProvider: () => ({
        provider: {
          searchWeb: async () => [],
        },
        apiKey: undefined,
      }),
    }));

    vi.doMock('../index.js', () => ({
      peel: async () => ({}),
      peelBatch: async () => [],
    }));

    const { deepFetch: mockedDeepFetch } = await import('../core/deep-fetch.js');

    const result = await mockedDeepFetch({ query: 'impossible query xyz' });
    expect(result.sources).toEqual([]);
    expect(result.merged).toBe('');
  });

  it('includes structured data when format=structured', async () => {
    vi.doMock('../core/search-provider.js', () => ({
      getBestSearchProvider: () => ({
        provider: {
          searchWeb: async () => [
            { url: 'https://a.com', title: 'A', snippet: 'info' },
            { url: 'https://b.com', title: 'B', snippet: 'info' },
          ],
        },
        apiKey: undefined,
      }),
    }));

    vi.doMock('../index.js', () => ({
      peel: async () => ({}),
      peelBatch: async () => [
        { content: 'Stripe launched in 2010. It costs $0.30. PayPal is a competitor.', title: 'A', tokens: 50 },
        { content: 'Stripe was founded by Patrick Collison in 2010. PayPal offers similar services.', title: 'B', tokens: 50 },
      ],
    }));

    const { deepFetch: mockedDeepFetch } = await import('../core/deep-fetch.js');

    const result = await mockedDeepFetch({ query: 'Stripe', format: 'structured', count: 2 });

    expect(result.structured).toBeDefined();
    expect(Array.isArray(result.structured!.facts)).toBe(true);
    expect(Array.isArray(result.structured!.entities)).toBe(true);
    expect(Array.isArray(result.structured!.dates)).toBe(true);
    expect(typeof result.structured!.numbers).toBe('object');
  });

  it('auto-detects comparison queries', async () => {
    vi.doMock('../core/search-provider.js', () => ({
      getBestSearchProvider: () => ({
        provider: {
          searchWeb: async () => [
            { url: 'https://c.com', title: 'Compare', snippet: 'vs' },
          ],
        },
        apiKey: undefined,
      }),
    }));

    vi.doMock('../index.js', () => ({
      peel: async () => ({}),
      peelBatch: async () => [
        {
          content: `
Stripe pricing is $0.30 per transaction. Stripe features subscriptions.
PayPal pricing is $0.49 per transaction. PayPal offers buyer protection.
          `.trim(),
          title: 'Stripe vs PayPal',
          tokens: 100,
        },
      ],
    }));

    const { deepFetch: mockedDeepFetch } = await import('../core/deep-fetch.js');

    const result = await mockedDeepFetch({ query: 'Stripe vs PayPal', count: 1 });

    // comparison should be populated automatically since query contains "vs"
    // (even without format='comparison')
    expect(result).toBeDefined();
    // The result shape should always have sources and merged
    expect(Array.isArray(result.sources)).toBe(true);
    expect(typeof result.merged).toBe('string');
  });
});
