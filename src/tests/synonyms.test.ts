/**
 * Tests for the synonym expansion module (synonyms.ts)
 */

import { describe, it, expect } from 'vitest';
import { expandWithSynonyms, SYNONYM_GROUPS, STEMMED_SYNONYM_GROUPS } from '../core/synonyms.js';
import { stem } from '../core/stemmer.js';

// ---------------------------------------------------------------------------
// SYNONYM_GROUPS structure
// ---------------------------------------------------------------------------

describe('SYNONYM_GROUPS', () => {
  it('exports a non-empty array', () => {
    expect(SYNONYM_GROUPS.length).toBeGreaterThan(10);
  });

  it('each group has at least 2 words', () => {
    for (const group of SYNONYM_GROUPS) {
      expect(group.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('STEMMED_SYNONYM_GROUPS has same length as SYNONYM_GROUPS', () => {
    expect(STEMMED_SYNONYM_GROUPS.length).toBe(SYNONYM_GROUPS.length);
  });

  it('STEMMED_SYNONYM_GROUPS words are lowercase', () => {
    for (const group of STEMMED_SYNONYM_GROUPS) {
      for (const word of group) {
        expect(word).toBe(word.toLowerCase());
      }
    }
  });
});

// ---------------------------------------------------------------------------
// expandWithSynonyms — basic behavior
// ---------------------------------------------------------------------------

describe('expandWithSynonyms — basic behavior', () => {
  it('returns original terms with weight=1.0 and isOriginal=true', () => {
    const result = expandWithSynonyms(['price']);
    const original = result.find(e => e.isOriginal);
    expect(original).toBeDefined();
    expect(original!.weight).toBe(1.0);
    expect(original!.isOriginal).toBe(true);
  });

  it('returns synonym terms with weight=0.5 and isOriginal=false', () => {
    const result = expandWithSynonyms(['price']);
    const synonyms = result.filter(e => !e.isOriginal);
    expect(synonyms.length).toBeGreaterThan(0);
    for (const syn of synonyms) {
      expect(syn.weight).toBe(0.5);
      expect(syn.isOriginal).toBe(false);
    }
  });

  it('always includes original terms in output', () => {
    const terms = ['price', 'build'];
    const result = expandWithSynonyms(terms);
    const resultTerms = result.map(e => e.term);
    for (const t of terms) {
      expect(resultTerms).toContain(t);
    }
  });

  it('no duplicate terms in output', () => {
    const result = expandWithSynonyms(['price', 'cost']);
    const terms = result.map(e => e.term);
    const unique = [...new Set(terms)];
    expect(terms.length).toBe(unique.length);
  });

  it('handles empty input', () => {
    const result = expandWithSynonyms([]);
    expect(result).toEqual([]);
  });

  it('handles unknown terms (no synonyms) — returns just the original', () => {
    const result = expandWithSynonyms(['xyzunknown']);
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe('xyzunknown');
    expect(result[0].isOriginal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Synonym expansion — specific synonym groups
// ---------------------------------------------------------------------------

describe('expandWithSynonyms — synonym group expansion', () => {
  it('"cost" (stemmed) expands to include price-related terms', () => {
    const costStem = stem('cost');
    const result = expandWithSynonyms([costStem]);
    const terms = result.map(e => e.term);
    // Should include other price-related stems (price, fee, etc.)
    const priceStem = stem('price');
    const feeStem = stem('fee');
    // At least one of these should appear
    const hasRelated = terms.includes(priceStem) || terms.includes(feeStem) || terms.includes(stem('rate'));
    expect(hasRelated).toBe(true);
  });

  it('"install" and "setup" are in the same synonym group', () => {
    const installStem = stem('install');
    const setupStem = stem('setup');
    const result = expandWithSynonyms([installStem]);
    const terms = result.map(e => e.term);
    expect(terms).toContain(setupStem);
  });

  it('"advantage" and "benefit" are in the same synonym group', () => {
    const advantageStem = stem('advantage');
    const benefitStem = stem('benefit');
    const resultA = expandWithSynonyms([advantageStem]);
    const termsA = resultA.map(e => e.term);
    expect(termsA).toContain(benefitStem);
  });

  it('"error" and "bug" are synonyms', () => {
    const errorStem = stem('error');
    const bugStem = stem('bug');
    const result = expandWithSynonyms([errorStem]);
    const terms = result.map(e => e.term);
    expect(terms).toContain(bugStem);
  });

  it('multiple input terms expand their respective synonym sets', () => {
    const terms = [stem('price'), stem('install')];
    const result = expandWithSynonyms(terms);
    const expanded = result.map(e => e.term);

    // Should contain price synonyms
    expect(expanded).toContain(stem('cost'));

    // Should contain install synonyms
    expect(expanded).toContain(stem('setup'));
  });
});

// ---------------------------------------------------------------------------
// Stemmed synonym lookup roundtrip
// ---------------------------------------------------------------------------

describe('expandWithSynonyms — stemmed roundtrip', () => {
  it('stemming "pricing" finds same synonyms as stemming "price"', () => {
    const pricingStem = stem('pricing');
    const priceStem = stem('price');
    // They should have the same stem
    expect(pricingStem).toBe(priceStem);
    // And both should expand the same way
    const r1 = expandWithSynonyms([pricingStem]).map(e => e.term).sort();
    const r2 = expandWithSynonyms([priceStem]).map(e => e.term).sort();
    expect(r1).toEqual(r2);
  });
});
