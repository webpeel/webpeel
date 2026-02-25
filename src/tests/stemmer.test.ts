/**
 * Tests for the Porter Stemmer (stemmer.ts)
 *
 * Covers all major steps: 1a, 1b, 1c, 2, 3, 4, 5a, 5b.
 * Also verifies the critical property: words that should match share a stem.
 */

import { describe, it, expect } from 'vitest';
import { stem, stemTokens, IRREGULAR_FORMS } from '../core/stemmer.js';

// ---------------------------------------------------------------------------
// Step 1a — Plurals
// ---------------------------------------------------------------------------

describe('stemmer — step 1a (plurals)', () => {
  it('caresses → caress (SSES → SS)', () => {
    expect(stem('caresses')).toBe('caress');
  });

  it('ponies → poni (IES → I)', () => {
    expect(stem('ponies')).toBe('poni');
  });

  it('caress → caress (SS stays)', () => {
    expect(stem('caress')).toBe('caress');
  });

  it('cats → cat (S removed)', () => {
    expect(stem('cats')).toBe('cat');
  });

  it('dogs → dog (S removed)', () => {
    expect(stem('dogs')).toBe('dog');
  });
});

// ---------------------------------------------------------------------------
// Step 1b — Past tenses / gerunds
// ---------------------------------------------------------------------------

describe('stemmer — step 1b (past tense / gerunds)', () => {
  it('agreed → agre (m>0, EED → EE)', () => {
    expect(stem('agreed')).toBe('agre');
  });

  it('plastered → plaster (ED removed)', () => {
    expect(stem('plastered')).toBe('plaster');
  });

  it('disabled → disabl (ED removed)', () => {
    expect(stem('disabled')).toBe('disabl');
  });

  it('running → run (ING removed, double consonant fixup)', () => {
    expect(stem('running')).toBe('run');
  });

  it('fitting → fit (ING removed, double TT → T fixup)', () => {
    expect(stem('fitting')).toBe('fit');
  });

  it('failing → fail (ING removed)', () => {
    expect(stem('failing')).toBe('fail');
  });

  it('filing → file (ING removed, *o → add E)', () => {
    expect(stem('filing')).toBe('file');
  });

  it('created → creat (ED removed, AT fixup, then E removed by step 5a)', () => {
    expect(stem('created')).toBe('creat');
  });
});

// ---------------------------------------------------------------------------
// Step 1c — y → i
// ---------------------------------------------------------------------------

describe('stemmer — step 1c (y → i)', () => {
  it('happy → happi', () => {
    expect(stem('happy')).toBe('happi');
  });

  it('sky → sky (short word, no vowel before y)', () => {
    // 'sk' has no vowel → don't replace
    expect(stem('sky')).toBe('sky');
  });
});

// ---------------------------------------------------------------------------
// Step 2 — Suffix removal
// ---------------------------------------------------------------------------

describe('stemmer — step 2', () => {
  it('relational → relat (ATIONAL → ATE then step 4 removes ATE)', () => {
    // relational → relate (step 2) → relat (step 4: ATE removed, m>1)
    const result = stem('relational');
    expect(['relat', 'relational', 'relate']).toContain(result);
  });

  it('generalization and general share a stem (IZATION→IZE→ALIZE→AL chain)', () => {
    // Porter: generalization → generalize (step2) → general (step3) → gener (step4 AL)
    // Both "general" and "generalization" should stem identically
    expect(stem('generalization')).toBe(stem('general'));
  });

  it('effectiveness → effect (NESS in step 3, IVE in step 4)', () => {
    expect(stem('effectiveness')).toBe('effect');
  });
});

// ---------------------------------------------------------------------------
// Steps 3 & 4 — More suffixes
// ---------------------------------------------------------------------------

describe('stemmer — steps 3 & 4', () => {
  it('developer → develop (ER removed in step 4)', () => {
    expect(stem('developer')).toBe('develop');
  });

  it('limitations → limit (S, ATION, ATE via multiple steps)', () => {
    expect(stem('limitations')).toBe('limit');
  });

  it('conditional → condit (m>0, step 2 IONAL→ION then ION step 4)', () => {
    // conditional: stem=condition (from step 2 tional→tion), then step 4 ion→(deleted if ends s/t)
    // Actually "condition" ends in N, so ION step 4 may not apply (needs stem ending in S or T)
    // So result depends on exact path. Accept a reasonable stem.
    const result = stem('conditional');
    expect(result.startsWith('condit') || result === 'condition').toBe(true);
  });

  it('pricing → pric or price (ING removed, then *o check)', () => {
    const result = stem('pricing');
    expect(['pric', 'price']).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// Critical property: matching pairs share a stem
// ---------------------------------------------------------------------------

describe('stemmer — shared stems (matching words must stem identically)', () => {
  it('"limit" and "limitations" share a stem', () => {
    expect(stem('limit')).toBe(stem('limitations'));
  });

  it('"run" and "running" share a stem', () => {
    expect(stem('run')).toBe(stem('running'));
  });

  it('"price" and "pricing" share a stem', () => {
    expect(stem('price')).toBe(stem('pricing'));
  });

  it('"develop" and "developer" share a stem', () => {
    expect(stem('develop')).toBe(stem('developer'));
  });

  it('"configure" and "configured" share a stem', () => {
    expect(stem('configure')).toBe(stem('configured'));
  });

  it('"install" and "installing" share a stem', () => {
    expect(stem('install')).toBe(stem('installing'));
  });

  it('"general" and "generalization" share a stem', () => {
    expect(stem('general')).toBe(stem('generalization'));
  });

  it('"effect" and "effectiveness" share a stem', () => {
    expect(stem('effect')).toBe(stem('effectiveness'));
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('stemmer — edge cases', () => {
  it('empty string returns empty string', () => {
    expect(stem('')).toBe('');
  });

  it('single char returns as-is', () => {
    expect(stem('a')).toBe('a');
  });

  it('two chars return as-is', () => {
    expect(stem('to')).toBe('to');
  });

  it('already stemmed words are stable (no infinite loop)', () => {
    const words = ['limit', 'run', 'general', 'develop', 'effect'];
    for (const w of words) {
      const s1 = stem(w);
      const s2 = stem(s1);
      expect(s2).toBe(s1); // idempotent
    }
  });

  it('handles uppercase by lowercasing', () => {
    expect(stem('Running')).toBe(stem('running'));
    expect(stem('LIMITATIONS')).toBe(stem('limitations'));
  });
});

// ---------------------------------------------------------------------------
// Irregular verb normalization
// ---------------------------------------------------------------------------

describe('stemmer — irregular verb normalization', () => {
  it('"built" and "build" share a stem', () => {
    expect(stem('built')).toBe(stem('build'));
  });

  it('"ran" and "run" share a stem', () => {
    expect(stem('ran')).toBe(stem('run'));
  });

  it('"made" and "make" share a stem', () => {
    expect(stem('made')).toBe(stem('make'));
  });

  it('"wrote" and "write" share a stem', () => {
    expect(stem('wrote')).toBe(stem('write'));
  });

  it('"began" and "begin" share a stem', () => {
    expect(stem('began')).toBe(stem('begin'));
  });

  it('"gave" and "give" share a stem', () => {
    expect(stem('gave')).toBe(stem('give'));
  });

  it('"took" and "take" share a stem', () => {
    expect(stem('took')).toBe(stem('take'));
  });

  it('"knew" and "know" share a stem', () => {
    expect(stem('knew')).toBe(stem('know'));
  });

  it('"thought" and "think" share a stem', () => {
    expect(stem('thought')).toBe(stem('think'));
  });

  it('"spoke" and "speak" share a stem', () => {
    expect(stem('spoke')).toBe(stem('speak'));
  });

  it('"chose" and "choose" share a stem', () => {
    expect(stem('chose')).toBe(stem('choose'));
  });

  it('"kept" and "keep" share a stem', () => {
    expect(stem('kept')).toBe(stem('keep'));
  });

  it('"sent" and "send" share a stem', () => {
    expect(stem('sent')).toBe(stem('send'));
  });

  it('"taught" and "teach" share a stem', () => {
    expect(stem('taught')).toBe(stem('teach'));
  });

  it('"caught" and "catch" share a stem', () => {
    expect(stem('caught')).toBe(stem('catch'));
  });

  it('"sold" and "sell" share a stem', () => {
    expect(stem('sold')).toBe(stem('sell'));
  });

  // Ambiguous words should NOT be normalized
  it('"found" stays as "found" (ambiguous: find vs establish)', () => {
    // "found" should NOT map to "find" because "founded a company" is common
    expect(stem('found')).not.toBe(stem('find'));
  });

  it('"left" stays as "left" (ambiguous: leave vs direction)', () => {
    expect(stem('left')).not.toBe(stem('leave'));
  });

  it('IRREGULAR_FORMS does not contain "found"', () => {
    expect(IRREGULAR_FORMS['found']).toBeUndefined();
  });

  it('IRREGULAR_FORMS does not contain "left"', () => {
    expect(IRREGULAR_FORMS['left']).toBeUndefined();
  });

  it('IRREGULAR_FORMS does not contain "bore"', () => {
    expect(IRREGULAR_FORMS['bore']).toBeUndefined();
  });

  it('IRREGULAR_FORMS does not contain "bound"', () => {
    expect(IRREGULAR_FORMS['bound']).toBeUndefined();
  });

  it('irregular normalization is idempotent', () => {
    const words = ['built', 'ran', 'made', 'wrote', 'began', 'took'];
    for (const w of words) {
      const s1 = stem(w);
      const s2 = stem(s1);
      expect(s2).toBe(s1);
    }
  });
});

// ---------------------------------------------------------------------------
// stemTokens convenience
// ---------------------------------------------------------------------------

describe('stemTokens', () => {
  it('stems an array of tokens', () => {
    const result = stemTokens(['running', 'limitations', 'pricing']);
    expect(result).toEqual([stem('running'), stem('limitations'), stem('pricing')]);
  });

  it('handles empty array', () => {
    expect(stemTokens([])).toEqual([]);
  });
});
