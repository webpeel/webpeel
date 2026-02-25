/**
 * Synonym expansion for query broadening.
 *
 * Provides stemmed synonym groups and a function to expand a set of stemmed
 * query tokens with related synonyms (at a lower weight).
 *
 * Usage:
 *   const queryTerms = tokenizeQuestion(question); // already stemmed
 *   const expanded = expandWithSynonyms(queryTerms);
 *   // expanded includes originals (weight=1.0) + synonyms (weight=0.5)
 */

import { stem } from './stemmer.js';

// ---------------------------------------------------------------------------
// Synonym groups (raw, unstemmed)
// ---------------------------------------------------------------------------

/**
 * Raw synonym groups. Each group is a set of words with equivalent or near-
 * equivalent meaning in the context of software/web documentation queries.
 *
 * These are stored in unstemmed form for readability; the build process stems
 * them into STEMMED_SYNONYM_GROUPS and builds an index.
 */
export const SYNONYM_GROUPS: string[][] = [
  // Price/cost
  ['price', 'cost', 'fee', 'charge', 'rate', 'pricing', 'subscription', 'plan'],
  // Create/build
  ['create', 'build', 'make', 'develop', 'construct', 'design', 'author', 'write', 'conceive'],
  // Fast/quick
  ['fast', 'quick', 'rapid', 'speedy', 'swift', 'performant', 'efficient'],
  // Big/large
  ['big', 'large', 'huge', 'enormous', 'massive', 'significant', 'substantial'],
  // Small/tiny
  ['small', 'tiny', 'little', 'minor', 'minimal', 'compact', 'lightweight'],
  // Error/bug
  ['error', 'bug', 'issue', 'problem', 'fault', 'defect', 'failure', 'crash'],
  // Start/begin
  ['start', 'begin', 'launch', 'initiate', 'commence', 'found', 'establish', 'release', 'introduce'],
  // Stop/end
  ['stop', 'end', 'finish', 'terminate', 'halt', 'cease', 'conclude'],
  // Use/utilize
  ['use', 'utilize', 'employ', 'leverage', 'apply', 'adopt'],
  // Help/assist
  ['help', 'assist', 'support', 'aid', 'guide', 'facilitate'],
  // Show/display
  ['show', 'display', 'render', 'present', 'exhibit', 'demonstrate'],
  // Get/obtain
  ['get', 'obtain', 'acquire', 'retrieve', 'fetch', 'receive', 'gain'],
  // Send/transmit
  ['send', 'transmit', 'deliver', 'dispatch', 'forward', 'emit'],
  // Change/modify
  ['change', 'modify', 'alter', 'update', 'revise', 'adjust', 'edit'],
  // Delete/remove
  ['delete', 'remove', 'eliminate', 'erase', 'clear', 'purge', 'drop'],
  // Allow/permit
  ['allow', 'permit', 'enable', 'authorize', 'grant', 'let'],
  // Prevent/block
  ['prevent', 'block', 'prohibit', 'restrict', 'deny', 'forbid', 'disable'],
  // Location/place
  ['location', 'place', 'position', 'site', 'area', 'region', 'spot'],
  // Person/individual
  ['person', 'individual', 'user', 'member', 'participant', 'developer'],
  // Feature/capability
  ['feature', 'capability', 'functionality', 'ability', 'function', 'capacity'],
  // Limit/restrict
  ['limit', 'restrict', 'constrain', 'cap', 'bound', 'throttle'],
  // Install/setup
  ['install', 'setup', 'configure', 'deploy', 'provision'],
  // Compare/contrast
  ['compare', 'contrast', 'versus', 'differ', 'distinction', 'difference'],
  // Require/need
  ['require', 'need', 'demand', 'necessitate', 'depend'],
  // Advantage/benefit/feature
  ['advantage', 'benefit', 'pro', 'strength', 'upside', 'merit', 'feature', 'perk'],
  // Disadvantage/drawback
  ['disadvantage', 'drawback', 'con', 'weakness', 'downside', 'limitation'],
  // Learn/study
  ['learn', 'study', 'understand', 'explore', 'discover', 'research'],
  // Test/verify
  ['test', 'verify', 'validate', 'check', 'confirm', 'inspect'],
  // Connect/integrate
  ['connect', 'integrate', 'link', 'combine', 'join', 'merge', 'attach'],
  // Document/describe
  ['document', 'describe', 'explain', 'detail', 'outline', 'specify'],
  // Improve/optimize
  ['improve', 'optimize', 'enhance', 'upgrade', 'refine', 'boost'],
  // Location state (where questions)
  ['base', 'headquarter', 'locate', 'situate'],
  // Software referents (helps with coreference)
  ['platform', 'service', 'product', 'tool', 'application', 'system', 'software'],
  // Movement/direction
  ['move', 'transfer', 'migrate', 'shift', 'relocate', 'transition'],
  // Exist/available
  ['exist', 'available', 'present', 'accessible', 'offered'],

  // Medical/health
  ['symptom', 'sign', 'indication', 'manifestation'],
  ['treatment', 'therapy', 'cure', 'remedy', 'medication', 'medicine'],
  ['diagnosis', 'assessment', 'evaluation', 'examination'],
  ['disease', 'illness', 'condition', 'disorder', 'ailment', 'sickness'],

  // Financial/business
  ['revenue', 'income', 'earnings', 'sales', 'turnover'],
  ['expense', 'cost', 'spending', 'expenditure', 'outlay'],
  ['profit', 'gain', 'return', 'margin', 'surplus'],
  ['invest', 'fund', 'finance', 'capitalize', 'back'],

  // Importance/significance
  ['important', 'significant', 'crucial', 'critical', 'vital', 'essential', 'key'],
  ['minor', 'trivial', 'negligible', 'insignificant', 'marginal'],

  // Communication
  ['say', 'state', 'declare', 'announce', 'claim', 'assert', 'mention'],
  ['ask', 'question', 'inquire', 'query', 'request'],
  ['answer', 'reply', 'respond', 'response'],

  // Think/believe
  ['think', 'believe', 'consider', 'regard', 'view', 'deem'],
  ['decide', 'determine', 'conclude', 'resolve', 'settle'],

  // Outcome/result
  ['result', 'outcome', 'consequence', 'effect', 'impact', 'aftermath'],
  ['cause', 'reason', 'factor', 'trigger', 'source', 'origin'],

  // Amount/quantity
  ['many', 'numerous', 'several', 'multiple', 'various', 'countless'],
  ['few', 'scarce', 'rare', 'limited', 'sparse'],

  // Time
  ['before', 'prior', 'previous', 'preceding', 'earlier', 'former'],
  ['after', 'subsequent', 'following', 'later', 'next', 'succeeding'],
  ['recent', 'latest', 'newest', 'current', 'contemporary', 'modern'],
  ['old', 'ancient', 'historical', 'legacy', 'outdated', 'obsolete'],
];

// ---------------------------------------------------------------------------
// Build stemmed synonym index
// ---------------------------------------------------------------------------

/**
 * Stemmed synonym groups.
 * Each word in each group has been run through the Porter stemmer.
 * Duplicate stems within a group are deduplicated.
 */
export const STEMMED_SYNONYM_GROUPS: string[][] = SYNONYM_GROUPS.map(group => {
  const stemmed = group.map(w => stem(w));
  // Deduplicate (multiple words may stem to the same root)
  return [...new Set(stemmed)];
});

/**
 * Index: stemmed_word → set of other stemmed words in the same group.
 * A word may appear in only one group (first match wins if duplicates exist).
 */
const synonymIndex: Map<string, Set<string>> = new Map();

for (const group of STEMMED_SYNONYM_GROUPS) {
  for (const word of group) {
    if (!synonymIndex.has(word)) {
      // Store all OTHER words in the group as synonyms
      const others = new Set(group.filter(w => w !== word));
      synonymIndex.set(word, others);
    }
  }
}

// ---------------------------------------------------------------------------
// Exported types and function
// ---------------------------------------------------------------------------

export interface ExpandedTerm {
  /** The stemmed term */
  term: string;
  /** 1.0 for original query terms, 0.5 for synonym expansions */
  weight: number;
  /** True if this term came from the original query */
  isOriginal: boolean;
}

/**
 * Expand a list of stemmed query tokens with their synonyms.
 *
 * @param terms - Already-stemmed tokens from the query
 * @returns Array of ExpandedTerm objects. Original terms have weight=1.0,
 *          synonym expansions have weight=0.5.
 *          The returned array preserves originals first, then synonyms.
 */
export function expandWithSynonyms(terms: string[]): ExpandedTerm[] {
  const result: ExpandedTerm[] = [];
  const seen = new Set<string>();

  // Add all original terms first
  for (const term of terms) {
    if (!seen.has(term)) {
      seen.add(term);
      result.push({ term, weight: 1.0, isOriginal: true });
    }
  }

  // Add synonyms for each original term
  for (const term of terms) {
    const synonyms = synonymIndex.get(term);
    if (!synonyms) continue;

    for (const syn of synonyms) {
      if (!seen.has(syn)) {
        seen.add(syn);
        result.push({ term: syn, weight: 0.5, isOriginal: false });
      }
    }
  }

  return result;
}
