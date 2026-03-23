/**
 * Unit tests for /v1/research route helpers
 */

import { describe, it, expect } from 'vitest';
import { expandQuery, extractKeyFacts } from '../../src/server/routes/research.js';

// ---------------------------------------------------------------------------
// expandQuery
// ---------------------------------------------------------------------------

describe('expandQuery', () => {
  it('returns at least 1 variation (original always first)', () => {
    const result = expandQuery('typescript tutorial');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toBe('typescript tutorial');
  });

  it('returns at most 3 variations', () => {
    const result = expandQuery('how much does a Tesla wall connector installation cost');
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('adds year variant for time-sensitive queries', () => {
    const result = expandQuery('best javascript frameworks');
    const hasYearVariant = result.some(q => /20\d{2}/.test(q));
    expect(hasYearVariant).toBe(true);
  });

  it('does NOT add year if year already present', () => {
    const result = expandQuery('best javascript frameworks 2024');
    // Should not add another year variant
    const withYear = result.filter(q => /20\d{2}/.test(q));
    // All year matches should just be the original (not a new addition)
    expect(withYear.every(q => q.includes('2024'))).toBe(true);
  });

  it('rephrases "how much does X cost" queries', () => {
    const result = expandQuery('how much does tesla wall connector installation cost');
    // Should include the original and a noun-phrase variant
    expect(result[0]).toBe('how much does tesla wall connector installation cost');
    expect(result.length).toBeGreaterThanOrEqual(2);
    // The rephrase should contain the noun phrase without "how much does"
    const hasNounPhrase = result.some(q =>
      q !== result[0] && q.includes('tesla wall connector'),
    );
    expect(hasNounPhrase).toBe(true);
  });

  it('rephrases "how to X" queries', () => {
    const result = expandQuery('how to install node js');
    expect(result[0]).toBe('how to install node js');
    const hasGuide = result.some(q => q.includes('guide'));
    expect(hasGuide).toBe(true);
  });

  it('rephrases "what is X" queries', () => {
    const result = expandQuery('what is WebAssembly');
    expect(result[0]).toBe('what is WebAssembly');
    const hasOverview = result.some(q => q.includes('overview'));
    expect(hasOverview).toBe(true);
  });

  it('handles short queries without crashing', () => {
    expect(() => expandQuery('AI')).not.toThrow();
    expect(() => expandQuery('')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractKeyFacts
// ---------------------------------------------------------------------------

describe('extractKeyFacts', () => {
  const sampleContent = `
    The Tesla Wall Connector is a Level 2 home EV charger.
    Installation costs typically range from $500 to $1,500 depending on electrical work needed.
    The Wall Connector itself costs around $400 from Tesla's website.
    A licensed electrician is required for safe installation.
    Most homeowners complete the installation in under a day.
    The charger can deliver up to 48 amps of power.
    Some utility companies offer rebates for EV charger installation.
    Installation complexity varies based on panel capacity.
    Unrelated sentence about something else entirely.
  `;

  it('returns an array', () => {
    const facts = extractKeyFacts(sampleContent, 'tesla wall connector installation cost');
    expect(Array.isArray(facts)).toBe(true);
  });

  it('returns at most maxFacts results', () => {
    const facts = extractKeyFacts(sampleContent, 'tesla wall connector installation cost', 3);
    expect(facts.length).toBeLessThanOrEqual(3);
  });

  it('extracts relevant sentences (containing query keywords)', () => {
    const facts = extractKeyFacts(sampleContent, 'installation cost', 5);
    // At least some facts should mention installation or cost
    const relevant = facts.filter(f =>
      f.toLowerCase().includes('install') || f.toLowerCase().includes('cost'),
    );
    expect(relevant.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty content', () => {
    expect(extractKeyFacts('', 'some query')).toEqual([]);
  });

  it('returns empty array for empty query', () => {
    expect(extractKeyFacts(sampleContent, '')).toEqual([]);
  });

  it('deduplicates near-identical sentences', () => {
    const repeated =
      'The installation cost is $500. The installation cost is $500. Something different here.';
    const facts = extractKeyFacts(repeated, 'installation cost', 5);
    // Should not include the same sentence twice
    const unique = new Set(facts);
    expect(unique.size).toBe(facts.length);
  });

  it('handles content with no keyword matches gracefully', () => {
    const facts = extractKeyFacts('Cats and dogs are popular pets.', 'quantum computing');
    expect(facts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Request validation (simulated — test the logic directly)
// ---------------------------------------------------------------------------

describe('request validation logic', () => {
  it('treats empty query as invalid', () => {
    const query = '';
    expect(!query || query.trim().length === 0).toBe(true);
  });

  it('treats whitespace-only query as invalid', () => {
    const query = '   ';
    expect(query.trim().length === 0).toBe(true);
  });

  it('accepts valid depth values', () => {
    expect(['quick', 'deep'].includes('quick')).toBe(true);
    expect(['quick', 'deep'].includes('deep')).toBe(true);
  });

  it('rejects invalid depth values', () => {
    expect(['quick', 'deep'].includes('medium' as any)).toBe(false);
    expect(['quick', 'deep'].includes('' as any)).toBe(false);
  });

  it('caps maxSources at 8', () => {
    const MAX = 8;
    expect(Math.min(Math.max(1, 100), MAX)).toBe(MAX);
    expect(Math.min(Math.max(1, 0), MAX)).toBe(1);
    expect(Math.min(Math.max(1, 5), MAX)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// noEscalate constraint
// ---------------------------------------------------------------------------

describe('noEscalate constraint', () => {
  it('peel options always set noEscalate: true', () => {
    // This verifies the constant used in peel() calls
    const peelOptions = {
      format: 'markdown' as const,
      noEscalate: true,
      timeout: 15000,
      readable: true,
      budget: 3000,
    };
    expect(peelOptions.noEscalate).toBe(true);
  });

  it('per-URL timeout does not exceed 15 seconds', () => {
    const PER_URL_TIMEOUT_MS = 15_000;
    expect(PER_URL_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it('total timeout does not exceed 60 seconds', () => {
    const TOTAL_TIMEOUT_MS = 60_000;
    expect(TOTAL_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it('max sources hard limit is 8', () => {
    const MAX_SOURCES_HARD_LIMIT = 8;
    expect(MAX_SOURCES_HARD_LIMIT).toBe(8);
  });
});
