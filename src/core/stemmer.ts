/**
 * Porter Stemmer — Lightweight implementation of the Porter stemming algorithm.
 *
 * Based on: Martin Porter, "An algorithm for suffix stripping", 1980.
 * Reference: https://tartarus.org/martin/PorterStemmer/
 *
 * This is a well-tested, deterministic implementation with no external dependencies.
 * It correctly handles all standard Porter stemmer rules including steps 1a-5b.
 */

// ---------------------------------------------------------------------------
// Vowel / consonant helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if character at position i in word is a vowel.
 * 'y' is treated as a vowel when preceded by a consonant.
 */
function isVowelAt(word: string, i: number): boolean {
  const c = word[i];
  if ('aeiou'.includes(c)) return true;
  if (c === 'y' && i > 0 && !isVowelAt(word, i - 1)) return true;
  return false;
}

/**
 * Compute the "measure" m of a string stem.
 * m = number of VC (vowel-then-consonant) transitions.
 * The pattern is: [C](VC)^m[V]
 */
function getMeasure(stem: string): number {
  let m = 0;
  let inVowel = false;
  for (let i = 0; i < stem.length; i++) {
    const v = isVowelAt(stem, i);
    if (inVowel && !v) {
      m++;
      inVowel = false;
    } else if (!inVowel && v) {
      inVowel = true;
    }
  }
  return m;
}

/** Returns true if the stem contains at least one vowel. */
function containsVowel(stem: string): boolean {
  for (let i = 0; i < stem.length; i++) {
    if (isVowelAt(stem, i)) return true;
  }
  return false;
}

/** Returns true if the stem ends in a double consonant (same consonant twice). */
function endsDoubleConsonant(stem: string): boolean {
  const n = stem.length;
  if (n < 2) return false;
  return stem[n - 1] === stem[n - 2] && !isVowelAt(stem, n - 1);
}

/**
 * Returns true if stem ends in CVC where the final C is not W, X, or Y.
 * This is the "*o" condition in Porter's paper.
 */
function endsCVC(stem: string): boolean {
  const n = stem.length;
  if (n < 3) return false;
  const c3 = stem[n - 1];
  return (
    !isVowelAt(stem, n - 1) &&
    isVowelAt(stem, n - 2) &&
    !isVowelAt(stem, n - 3) &&
    c3 !== 'w' && c3 !== 'x' && c3 !== 'y'
  );
}

// ---------------------------------------------------------------------------
// Step 1a — Plurals
// ---------------------------------------------------------------------------

function step1a(word: string): string {
  if (word.endsWith('sses')) {
    return word.slice(0, -2); // caresses → caress
  }
  if (word.endsWith('ies')) {
    return word.slice(0, -2); // ponies → poni
  }
  if (word.endsWith('ss')) {
    return word; // caress → caress (no change)
  }
  if (word.endsWith('s') && word.length > 1) {
    return word.slice(0, -1); // cats → cat
  }
  return word;
}

// ---------------------------------------------------------------------------
// Step 1b — Past tenses / gerunds
// ---------------------------------------------------------------------------

function step1bFixup(word: string): string {
  // AT → ATE
  if (word.endsWith('at')) return word + 'e'; // conflated → conflate
  // BL → BLE
  if (word.endsWith('bl')) return word + 'e'; // troubled → trouble
  // IZ → IZE
  if (word.endsWith('iz')) return word + 'e'; // sized → size

  // Double consonant (not L, S, Z) → remove one
  if (
    endsDoubleConsonant(word) &&
    !word.endsWith('ll') &&
    !word.endsWith('ss') &&
    !word.endsWith('zz')
  ) {
    return word.slice(0, -1); // hopping → hop, tapping → tap
  }

  // m=1 and CVC (*o) → add E
  if (getMeasure(word) === 1 && endsCVC(word)) {
    return word + 'e'; // failing → fail handled differently... wait
    // filing → file: after removing ING we get "fil" → m=1 and *o → add E → "file"
  }

  return word;
}

function step1b(word: string): string {
  // (m>0) EED → EE
  if (word.endsWith('eed')) {
    const stem = word.slice(0, -3);
    if (getMeasure(stem) > 0) {
      return word.slice(0, -1); // agreed → agre, feed → feed
    }
    return word;
  }

  // (*v*) ED → delete + fixup
  if (word.endsWith('ed')) {
    const stem = word.slice(0, -2);
    if (containsVowel(stem)) {
      return step1bFixup(stem);
    }
    return word;
  }

  // (*v*) ING → delete + fixup
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    if (containsVowel(stem)) {
      return step1bFixup(stem);
    }
    return word;
  }

  return word;
}

// ---------------------------------------------------------------------------
// Step 1c — y → i
// ---------------------------------------------------------------------------

function step1c(word: string): string {
  if (word.endsWith('y') && word.length > 2) {
    const stem = word.slice(0, -1);
    if (containsVowel(stem)) {
      return stem + 'i'; // happy → happi
    }
  }
  return word;
}

// ---------------------------------------------------------------------------
// Step 2 — Suffix removal (m > 0)
// ---------------------------------------------------------------------------

const STEP2_RULES: Array<[string, string]> = [
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['izer', 'ize'],
  ['abli', 'able'],
  ['alli', 'al'],
  ['entli', 'ent'],
  ['eli', 'e'],
  ['ousli', 'ous'],
  ['ization', 'ize'],
  ['ation', 'ate'],
  ['ator', 'ate'],
  ['alism', 'al'],
  ['iveness', 'ive'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['biliti', 'ble'],
];

function step2(word: string): string {
  for (const [suffix, replacement] of STEP2_RULES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (getMeasure(stem) > 0) {
        return stem + replacement;
      }
      return word;
    }
  }
  return word;
}

// ---------------------------------------------------------------------------
// Step 3 — Suffix removal (m > 0)
// ---------------------------------------------------------------------------

const STEP3_RULES: Array<[string, string]> = [
  ['icate', 'ic'],
  ['ative', ''],
  ['alize', 'al'],
  ['iciti', 'ic'],
  ['ical', 'ic'],
  ['ful', ''],
  ['ness', ''],
];

function step3(word: string): string {
  for (const [suffix, replacement] of STEP3_RULES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (getMeasure(stem) > 0) {
        return stem + replacement;
      }
      return word;
    }
  }
  return word;
}

// ---------------------------------------------------------------------------
// Step 4 — Suffix removal (m > 1)
// ---------------------------------------------------------------------------

const STEP4_RULES: Array<[string, string]> = [
  ['ement', ''],
  ['ment', ''],
  ['ance', ''],
  ['ence', ''],
  ['able', ''],
  ['ible', ''],
  ['ism', ''],
  ['ate', ''],
  ['iti', ''],
  ['ous', ''],
  ['ive', ''],
  ['ize', ''],
  ['ant', ''],
  ['ent', ''],
  ['al', ''],
  ['er', ''],
  ['ic', ''],
  ['ou', ''],
];

function step4(word: string): string {
  // Special case: ION — stem must end in S or T
  if (word.endsWith('ion')) {
    const stem = word.slice(0, -3);
    if (getMeasure(stem) > 1 && (stem.endsWith('s') || stem.endsWith('t'))) {
      return stem;
    }
    return word;
  }

  for (const [suffix, replacement] of STEP4_RULES) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (getMeasure(stem) > 1) {
        return stem + replacement;
      }
      return word;
    }
  }
  return word;
}

// ---------------------------------------------------------------------------
// Step 5a — Final E removal
// ---------------------------------------------------------------------------

function step5a(word: string): string {
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1);
    const m = getMeasure(stem);
    if (m > 1) return stem;
    if (m === 1 && !endsCVC(stem)) return stem;
  }
  return word;
}

// ---------------------------------------------------------------------------
// Step 5b — Double L removal
// ---------------------------------------------------------------------------

function step5b(word: string): string {
  if (word.endsWith('ll') && getMeasure(word) > 1) {
    return word.slice(0, -1);
  }
  return word;
}

// ---------------------------------------------------------------------------
// Irregular verb forms table
// ---------------------------------------------------------------------------

/**
 * Irregular verb forms → base form.
 * Porter stemmer only handles regular morphology (-ed, -ing, -s).
 * English has ~200 irregular verbs; we cover the most common ones.
 * This table normalizes irregular forms before stemming so that
 * "built" → "build" → stem("build") = "build" matches stem("build").
 *
 * Ambiguous words are intentionally excluded:
 *   "found"  — could be find (past) OR establish (base form "found a company")
 *   "left"   — could be leave (past) OR direction
 *   "bore"/"borne"/"born" — could be bear (past) OR bore=boring OR born=birth
 *   "bound"  — could be bind (past) OR boundary (noun)
 */
export const IRREGULAR_FORMS: Record<string, string> = {
  // build
  'built': 'build',
  // run
  'ran': 'run',
  // make
  'made': 'make',
  // write
  'wrote': 'write', 'written': 'write',
  // begin
  'began': 'begin', 'begun': 'begin',
  // give
  'gave': 'give', 'given': 'give',
  // take
  'took': 'take', 'taken': 'take',
  // go
  'went': 'go', 'gone': 'go',
  // come
  'came': 'come',
  // see
  'saw': 'see', 'seen': 'see',
  // know
  'knew': 'know', 'known': 'know',
  // think
  'thought': 'think',
  // tell
  'told': 'tell',
  // say
  'said': 'say',
  // get
  'got': 'get', 'gotten': 'get',
  // buy
  'bought': 'buy',
  // bring
  'brought': 'bring',
  // send
  'sent': 'send',
  // spend
  'spent': 'spend',
  // keep
  'kept': 'keep',
  // hold
  'held': 'hold',
  // stand
  'stood': 'stand',
  // lose
  'lost': 'lose',
  // pay
  'paid': 'pay',
  // meet
  'met': 'meet',
  // lead
  'led': 'lead',
  // grow
  'grew': 'grow', 'grown': 'grow',
  // draw
  'drew': 'draw', 'drawn': 'draw',
  // break
  'broke': 'break', 'broken': 'break',
  // speak
  'spoke': 'speak', 'spoken': 'speak',
  // choose
  'chose': 'choose', 'chosen': 'choose',
  // fall
  'fell': 'fall', 'fallen': 'fall',
  // drive
  'drove': 'drive', 'driven': 'drive',
  // rise
  'rose': 'rise', 'risen': 'rise',
  // fly
  'flew': 'fly', 'flown': 'fly',
  // throw
  'threw': 'throw', 'thrown': 'throw',
  // wear
  'wore': 'wear', 'worn': 'wear',
  // hide
  'hid': 'hide', 'hidden': 'hide',
  // sit
  'sat': 'sit',
  // swim
  'swam': 'swim', 'swum': 'swim',
  // sing
  'sang': 'sing', 'sung': 'sing',
  // ring
  'rang': 'ring', 'rung': 'ring',
  // drink
  'drank': 'drink', 'drunk': 'drink',
  // wake
  'woke': 'wake', 'woken': 'wake',
  // freeze
  'froze': 'freeze', 'frozen': 'freeze',
  // steal
  'stole': 'steal', 'stolen': 'steal',
  // tear
  'tore': 'tear', 'torn': 'tear',
  // shake
  'shook': 'shake', 'shaken': 'shake',
  // forgive
  'forgave': 'forgive', 'forgiven': 'forgive',
  // forget
  'forgot': 'forget', 'forgotten': 'forget',
  // bite
  'bit': 'bite', 'bitten': 'bite',
  // blow
  'blew': 'blow', 'blown': 'blow',
  // catch
  'caught': 'catch',
  // teach
  'taught': 'teach',
  // fight
  'fought': 'fight',
  // seek
  'sought': 'seek',
  // sell
  'sold': 'sell',
  // win
  'won': 'win',
  // feed
  'fed': 'feed',
  // feel
  'felt': 'feel',
  // mean
  'meant': 'mean',
  // lend
  'lent': 'lend',
  // bend
  'bent': 'bend',
  // dig
  'dug': 'dig',
  // stick
  'stuck': 'stick',
  // strike
  'struck': 'strike', 'stricken': 'strike',
  // swear
  'swore': 'swear', 'sworn': 'swear',
  // spin
  'spun': 'spin',
  // hang
  'hung': 'hang',
  // slide
  'slid': 'slide',
  // shine
  'shone': 'shine',
  // shoot
  'shot': 'shoot',
  // sleep
  'slept': 'sleep',
  // sweep
  'swept': 'sweep',
  // creep
  'crept': 'creep',
  // weep
  'wept': 'weep',
  // deal
  'dealt': 'deal',
  // dream (irregular British)
  'dreamt': 'dream',
  // learn (irregular British)
  'learnt': 'learn',
  // burn (irregular British)
  'burnt': 'burn',
  // lean
  'leant': 'lean',
  // leap
  'leapt': 'leap',
  // spell
  'spelt': 'spell',
  // spill
  'spilt': 'spill',
};

// ---------------------------------------------------------------------------
// Main stem function
// ---------------------------------------------------------------------------

/**
 * Stem a single word using the Porter stemming algorithm.
 *
 * Returns the stemmed word (lowercase). Input is also lowercased.
 * Words shorter than 3 characters are returned as-is.
 *
 * Irregular verb forms (e.g. "built", "ran", "spoke") are first normalized
 * to their base form before Porter steps are applied, ensuring that
 * stem("built") === stem("build"), stem("spoke") === stem("speak"), etc.
 */
export function stem(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();

  // Short words: don't stem
  if (lower.length <= 2) return lower;

  // Normalize irregular verb forms to base before stemming
  const normalized = IRREGULAR_FORMS[lower] ?? lower;

  let w = normalized;
  w = step1a(w);
  w = step1b(w);
  w = step1c(w);
  w = step2(w);
  w = step3(w);
  w = step4(w);
  w = step5a(w);
  w = step5b(w);

  return w;
}

/**
 * Stem an array of tokens.
 */
export function stemTokens(tokens: string[]): string[] {
  return tokens.map(stem);
}
