/**
 * Quick Answer — LLM-free question answering using BM25 + heuristics
 *
 * Answers a question about page content without any API key.
 * Uses BM25 relevance scoring + answer-signal boosting to surface
 * the most relevant sentences.
 *
 * v2: Added Porter stemming, synonym expansion, and sliding window scoring.
 */

import { scoreBM25 } from './bm25-filter.js';
import { stem } from './stemmer.js';
import { expandWithSynonyms } from './synonyms.js';

export interface QuickAnswerOptions {
  question: string;
  content: string;       // markdown or text content from a fetched page
  maxPassages?: number;  // how many passages to return (default: 3)
  maxChars?: number;     // max total characters (default: 2000)
  url?: string;          // source URL for attribution
}

export interface QuickAnswerResult {
  question: string;
  answer: string;        // the best passage that answers the question
  confidence: number;    // 0-1 based on BM25 score relative to content
  passages: Array<{
    text: string;
    score: number;
    context: string;     // surrounding sentence(s) for context
  }>;
  source: string;        // URL
  method: 'bm25';        // always bm25 (no LLM)
}

// ---------------------------------------------------------------------------
// Stopwords — removed from question before BM25 scoring
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'what', 'is', 'the', 'how', 'do', 'a', 'an', 'where', 'when', 'why',
  'which', 'can', 'does', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might',
  'shall', 'must', 'do', 'did', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'of', 'in', 'on', 'at', 'by', 'for',
  'with', 'about', 'into', 'to', 'from', 'up', 'out', 'and', 'or', 'but',
  'if', 'so', 'as', 'not', 'no', 'than', 'then', 'also',
]);

// ---------------------------------------------------------------------------
// Question type detection
// ---------------------------------------------------------------------------

// Fix #1: Added 'how' type. Fix #11: Added 'yes_no' type.
type QuestionType = 'what' | 'how_many' | 'how_much' | 'how' | 'when' | 'where' | 'why' | 'who' | 'yes_no' | 'other';

function detectQuestionType(question: string): QuestionType {
  const q = question.toLowerCase().trim();
  // Fix #1: Distinguish "how many/much/long" (quantity/duration) from "how do/does/can/to/is" (process/explanation)
  if (/how\s+many|how\s+much|how\s+long|what\s+price|what\s+cost|pricing/.test(q)) return 'how_many';
  // Fix #11: Yes/no questions (starts with auxiliary verb)
  if (/^(is|does|can|will|are|has|do|did|was|were|could|should|would)\b/i.test(q)) return 'yes_no';
  if (/when\b/.test(q)) return 'when';
  if (/where\b/.test(q)) return 'where';
  if (/why\b/.test(q)) return 'why';
  if (/who\b/.test(q)) return 'who';
  // "what company/person/team/group/organization" → treat as who
  if (/what\s+(?:company|person|people|team|group|organization|organisation|developer|author|creator|founder)\b/.test(q)) return 'who';
  if (/what\b/.test(q)) return 'what';
  // Fix #1: "how do/does/can/to/is" → 'how' (process/explanation), bare 'how' → 'how' (not 'how_many')
  if (/how\s+(?:do|does|can|to|is|are|was|were|will|would|could|should)\b/.test(q)) return 'how';
  if (/how\b/.test(q)) return 'how';
  return 'other';
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Tokenize and stem text. Used for BM25 scoring — both query and content
 * go through the same stemming pipeline so "limitations" matches "limit".
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .map(t => stem(t));
}

/**
 * Tokenize WITHOUT stemming. Used for regex pattern building in
 * tryDirectExtraction so that exact text patterns still match.
 */
function tokenizeRaw(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function tokenizeQuestion(question: string): string[] {
  // Filter stopwords on raw tokens (before stemming), then stem
  return tokenizeRaw(question)
    .filter(t => !STOPWORDS.has(t))
    .map(t => stem(t));
}

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/**
 * Split text into sentences. Handles common abbreviations to avoid false splits.
 * Returns an array of sentences with their start position (index in original text).
 * Also extracts list items (markdown bullets/numbers) as pseudo-sentences.
 */
function splitIntoSentences(content: string): Array<{ text: string; start: number }> {
  // Strip markdown formatting while preserving positions is complex;
  // Instead work on the raw content but filter sentences by quality later.
  const sentences: Array<{ text: string; start: number }> = [];

  // Protect common abbreviations and URLs from being split
  // Replace them with placeholders, split, then restore
  const PLACEHOLDER_MAP: Map<string, string> = new Map();
  let placeholderIdx = 0;

  // Protect URLs (http://... or https://...)
  let protected_ = content.replace(/https?:\/\/[^\s)>]+/g, (m) => {
    const ph = `\x00URL${placeholderIdx++}\x00`;
    PLACEHOLDER_MAP.set(ph, m);
    return ph;
  });

  // Protect common abbreviations: Mr. Mrs. Dr. St. vs. etc. e.g. i.e. U.S. U.K.
  const ABBREVS = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|No|Vol|pp)\./g;
  protected_ = protected_.replace(ABBREVS, (m) => {
    const ph = `\x00ABBR${placeholderIdx++}\x00`;
    PLACEHOLDER_MAP.set(ph, m);
    return ph;
  });

  // Protect version numbers with multiple dots (e.g., 0.9.0, 1.2.3, 3.11.4)
  // Must run BEFORE the decimal number protection to avoid partial replacement
  protected_ = protected_.replace(/\b(\d+\.\d+(?:\.\d+)+)/g, (m) => {
    const ph = `\x00VER${placeholderIdx++}\x00`;
    PLACEHOLDER_MAP.set(ph, m);
    return ph;
  });

  // Protect decimal numbers (e.g., 3.14, $29.99)
  protected_ = protected_.replace(/\b(\d+)\.(\d+)/g, (_m, a, b) => {
    const ph = `\x00NUM${placeholderIdx++}\x00`;
    PLACEHOLDER_MAP.set(ph, `${a}.${b}`);
    return ph;
  });

  // Split on sentence-ending punctuation followed by whitespace or end of string
  // Using a regex that splits AFTER the punctuation
  const sentencePattern = /[.!?]+(?:\s+|\n+|$)/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = sentencePattern.exec(protected_)) !== null) {
    const end = match.index + match[0].length;
    let sentence = protected_.slice(lastEnd, end).trim();
    lastEnd = end;

    // Restore placeholders
    for (const [ph, orig] of PLACEHOLDER_MAP.entries()) {
      sentence = sentence.split(ph).join(orig);
    }

    if (sentence) {
      sentences.push({ text: sentence, start: match.index });
    }
  }

  // Add any remaining text after the last sentence boundary
  if (lastEnd < protected_.length) {
    let remaining = protected_.slice(lastEnd).trim();
    if (remaining) {
      for (const [ph, orig] of PLACEHOLDER_MAP.entries()) {
        remaining = remaining.split(ph).join(orig);
      }
      sentences.push({ text: remaining, start: lastEnd });
    }
  }

  // Fix #12: Also extract list items (markdown bullets/numbers) as "sentences"
  const listPattern = /^[\s]*[-*+]\s+(.+)$/gm;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = listPattern.exec(content)) !== null) {
    const item = listMatch[1].trim();
    if (item.length >= 10 && item.length <= 800) {
      // Only add if not already captured by sentence splitting
      const isDuplicate = sentences.some(s => s.text.includes(item) || item.includes(s.text));
      if (!isDuplicate) {
        sentences.push({ text: item, start: listMatch.index });
      }
    }
  }

  // Fix #7: Increase max sentence length from 500 to 800 chars
  return sentences.filter(s => {
    const len = s.text.length;
    return len >= 10 && len <= 800;
  });
}

// ---------------------------------------------------------------------------
// Answer-signal boosting
// ---------------------------------------------------------------------------

function computeBoost(sentence: string, questionType: QuestionType, isTopicSentence: boolean): number {
  let boost = 0;
  const s = sentence.toLowerCase();

  if (isTopicSentence) {
    boost += 0.1;
  }

  switch (questionType) {
    case 'how_many': {
      // Contains a number or price or duration
      if (/\$[\d,.]+|\d+[,.]?\d*\s*(per|\/|month|year|week|day|request|api|call|token|user|minute|second|hour|degree|meter|mile|kg|lb)/i.test(sentence)) {
        boost += 0.3;
      } else if (/\b\d+\b/.test(sentence)) {
        boost += 0.15;
      }
      break;
    }
    // Fix #1: New 'how' (process/explanation) boost
    case 'how': {
      // Process/explanation sentences
      if (/\b(by using|through|works by|in order to|step|first|then|next|finally|process|method|approach|technique|way to|can be done)\b/i.test(s)) {
        boost += 0.4;
      }
      // Instructional patterns
      if (/\b(install|run|execute|configure|set up|use|import|require|enable|disable|create|build|deploy)\b/i.test(s)) {
        boost += 0.2;
      }
      break;
    }
    case 'when': {
      // Contains a date
      if (/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|\d+\s*(days?|weeks?|months?|years?))\b/i.test(sentence)) {
        boost += 0.3;
      }
      // Contains "released/launched/etc. in/on <year>"
      if (/\b(released|launched|published|introduced|created|started|began|founded|established|invented)\s+(in|on|at|around)?\s*\d/i.test(sentence)) {
        boost += 0.4;
      }
      break;
    }
    // Fix #4: Use more specific location indicators
    case 'where': {
      // Primary location signal — strong indicator (located/headquartered/based in + geographic proper noun)
      if (/\b(located|headquartered|based|founded|established)\s+(in|at)\b/i.test(s) ||
          /\b(?:in|at)\s+(?:the\s+)?[A-Z][a-z]+(?:(?:\s+[A-Z][a-z]+)*|(?:,\s+[A-Z][a-z]+)*)\b/.test(sentence) ||
          /\b(city|country|state|region|continent|capital|office|campus|location|address)\b/i.test(s)) {
        boost += 0.6;
      }
      // Specific geographic indicators including country names
      if (/\b(street|avenue|boulevard|road|highway|route|district|province|county|netherlands|amsterdam|berlin|london|paris|tokyo|beijing|moscow|france|germany|japan|china|india|canada|australia|san francisco|new york|los angeles|seattle|chicago|boston|austin|miami)\b/i.test(s)) {
        boost += 0.4;
      }
      // Birth/origin patterns
      if (/\b(born|raised|grew up|native|hometown|birthplace|originally from)\b/i.test(s)) {
        boost += 0.4;
      }
      break;
    }
    case 'what': {
      // Definition sentence
      if (/\b(is a|is an|are a|refers to|means|defined as|known as)\b/.test(s)) {
        boost += 0.5;
      }
      break;
    }
    case 'why': {
      // Causal sentence
      if (/\b(because|due to|reason|therefore|since|as a result|consequently|thus)\b/.test(s)) {
        boost += 0.4;
      }
      // Purpose/goal sentences ("as a successor to", "in order to", "to allow", "to provide")
      if (/\b(as a successor|successor to|in order to|so that|to allow|to provide|to enable|to support|to replace|to improve|to address|to solve)\b/i.test(s)) {
        boost += 0.4;
      }
      break;
    }
    case 'who': {
      // Pattern: "[topic] was created/designed/developed by [Person]"
      // Or: "[Person] created/designed/developed [topic]"
      if (/\b(created|designed|developed|built|invented|founded|authored|introduced|proposed|conceived|released|launched|established)\s+(?:\w+\s+){0,4}by\b/i.test(s) ||
          /\b[A-Z][a-z]+\s+(?:[A-Z][a-z]+\s+)?(?:created|designed|developed|built|invented|founded|authored|introduced|conceived|began)\b/.test(sentence)) {
        boost += 0.5;
      }
      // Also boost if contains person names (capitalized words that aren't sentence starters)
      const namePattern = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/;
      if (namePattern.test(sentence) && !/^(The|A|An|In|On|At)\b/.test(sentence)) {
        boost += 0.2;
      }
      // Existing title check
      if (/\b(ceo|cto|founder|president|director|manager|team|company|organization|engineer|professor|researcher)\b/i.test(s)) {
        boost += 0.2;
      }
      break;
    }
    // Fix #11: Yes/no question boost
    case 'yes_no': {
      if (/\b(yes|no|not|does not|doesn't|cannot|can't|isn't|aren't|won't|supports?|enables?|allows?|provides?|includes?)\b/i.test(s)) {
        boost += 0.3;
      }
      break;
    }
  }

  return boost;
}

// ---------------------------------------------------------------------------
// Direct pattern extraction — bypasses BM25 for structured content
// ---------------------------------------------------------------------------

interface DirectResult {
  text: string;
  context: string;
  confidence: number;
}

// Fix #9: Remove unused `_question` parameter
// NOTE: topicTerms must be RAW (unstemmed) for correct regex pattern building
function tryDirectExtraction(
  content: string,
  questionType: QuestionType,
  topicTerms: string[],
): DirectResult | null {
  if (topicTerms.length === 0) return null;

  // Build a regex pattern that matches any topic term (case-insensitive)
  const topicPattern = topicTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // --- Tiered 'who' infobox extraction ---
  // Wikipedia infobox entries appear as list items like:
  //   "-   Founders · Sam AltmanElon Musk..."
  // We search for the field pattern directly (no topic prefix required) since
  // "Founders ·" is specific enough to avoid false positives.
  // Split into two tiers: creator fields (always try first) vs. developer/maintainer fields
  // (skip for creation questions so we don't return "The Rust Team" for "Who created Rust?")
  if (questionType === 'who') {
    // Detect if question is about creation/origin.
    // These are stem prefixes (e.g. "creat" from "created"), so use leading \b only —
    // no trailing \b, since the stem appears INSIDE the full word.
    const isCreationQuestion = /\b(?:creat|built|invent|found|design|start|conceiv|originat|develop|made|wrote|began)\w*/i.test(
      topicTerms.join(' ')
    );

    // Tier 1: Original creator fields (always try first) — search directly without topic prefix
    const creatorFields = /(?:Original\s+author|Creator|Inventor|Designed\s+by|Created\s+by|Founded\s+by|Founders)\s*[·:]\s*(.+)/i;
    const creatorMatch = content.match(creatorFields);
    if (creatorMatch?.[1]) {
      const value = creatorMatch[1].split('\n')[0].trim().slice(0, 300);
      if (value.length > 2) {
        return { text: value, context: creatorMatch[0].split('\n')[0].trim().slice(0, 500), confidence: 0.92 };
      }
    }

    // Tier 2: General developer fields (skip for creation questions — let BM25 find the original creator)
    if (!isCreationQuestion) {
      const devFields = /(?:Developers|Developer|Maintainer|Author)\s*[·:]\s*(.+)/i;
      const devMatch = content.match(devFields);
      if (devMatch?.[1]) {
        const value = devMatch[1].split('\n')[0].trim().slice(0, 300);
        if (value.length > 2) {
          return { text: value, context: devMatch[0].split('\n')[0].trim().slice(0, 500), confidence: 0.92 };
        }
      }
    }
  }

  // --- Infobox patterns (Wikipedia-style: "Topic: Field · Value") ---
  // Note: Wikipedia uses \u00A0 (NBSP) in infobox fields, so we use \\s+ (which matches NBSP) instead of literal spaces
  const infoboxPatterns: Array<{ type: QuestionType[]; field: RegExp }> = [
    { type: ['when'], field: new RegExp(`(?:${topicPattern}).*?(?:First\\s+appeared|Released|Founded|Established|Created|Launch\\s+date|Initial\\s+release)\\s*[·:]\\s*(.+)`, 'i') },
    { type: ['what'], field: new RegExp(`(?:${topicPattern}).*?(?:Type|Genre|Category|Classification)\\s*[·:]\\s*(.+)`, 'i') },
    { type: ['where'], field: /(?:Headquarters|Headquartered|Location|Address|HQ|Head\s+office|Based\s+in)\s*[·:]\s*(.+)/i },
  ];

  for (const pat of infoboxPatterns) {
    if (!pat.type.includes(questionType)) continue;
    const match = content.match(pat.field);
    if (match?.[1]) {
      const value = match[1].split('\n')[0].trim().slice(0, 300);
      if (value.length > 2) {
        return {
          text: value,
          context: match[0].split('\n')[0].trim().slice(0, 500),
          confidence: 0.92,
        };
      }
    }
  }

  // --- Definition sentence patterns (e.g. "X is a Y developed by Z") ---
  if (questionType === 'who') {
    // "developed/designed/created by [Name]" in first 20% of content
    const first20 = content.slice(0, Math.max(500, Math.floor(content.length * 0.2)));
    // Use case-insensitive for verbs, but validate name casing separately
    const byPattern = /(?:developed|designed|created|built|invented|founded|authored|introduced|coined|conceived|released|started|launched|begun|proposed|established)\s+(?:\w+\s+){0,4}by\s+(\S+(?:\s+\S+){0,3})/i;
    const byMatch = first20.match(byPattern);
    if (byMatch?.[1]) {
      const candidateName = byMatch[1].trim();
      // Validate: first word must start with uppercase (proper noun, not "generative AI software")
      const firstWord = candidateName.split(/\s+/)[0];
      const isProperNoun = /^[A-Z]/.test(firstWord) && !/^(The|A|An|This|That|Its|Their|Our|Some|Many|Most|All|Each|Every)$/.test(firstWord);
      if (isProperNoun) {
        // Find the full sentence containing this match
        const idx = first20.indexOf(byMatch[0]);
        const sentStart = Math.max(0, first20.lastIndexOf('.', idx) + 1);
        const sentEnd = first20.indexOf('.', idx + byMatch[0].length);
        const fullSentence = first20.slice(sentStart, sentEnd > 0 ? sentEnd + 1 : undefined).trim();
        return {
          text: fullSentence || byMatch[0],
          context: fullSentence,
          confidence: 0.88,
        };
      }
    }
  }

  if (questionType === 'when') {
    // Look for a date near topic terms in first 30% of content
    const first30 = content.slice(0, Math.max(600, Math.floor(content.length * 0.3)));
    // Note: "began"/"started" are intentionally excluded — they can match
    // construction/start events that don't answer the specific question
    // (e.g. "When did X fall?" should NOT match "began on Aug 13, 1961").
    const datePattern = /(?:released|launched|first appeared|founded|established|created|introduced|conceived|opened|invented)\s+(?:\w+\s+){0,2}(?:in|on)\s+(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|\d{4})/i;
    const dateMatch = first30.match(datePattern);
    if (dateMatch) {
      const idx = first30.indexOf(dateMatch[0]);
      const sentStart = Math.max(0, first30.lastIndexOf('.', idx) + 1);
      const sentEnd = first30.indexOf('.', idx + dateMatch[0].length);
      const fullSentence = first30.slice(sentStart, sentEnd > 0 ? sentEnd + 1 : undefined).trim();
      return {
        text: fullSentence || dateMatch[0],
        context: fullSentence,
        confidence: 0.88,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entity extraction — for who/when questions answered by BM25
// ---------------------------------------------------------------------------

/**
 * Try to extract a specific entity (person name, date) from a BM25-selected passage.
 * Returns the entity string if found, or null.
 */
function extractEntity(passage: string, questionType: QuestionType): string | null {
  if (questionType === 'who') {
    // Try: "by [Name Name]"
    const byMatch = passage.match(/\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/);
    if (byMatch) return byMatch[1];
    // Try: "[Name Name] created/founded/..."
    const nameVerbMatch = passage.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:created|founded|designed|developed|built|invented|authored|introduced)/);
    if (nameVerbMatch) return nameVerbMatch[1];
    return null;
  }
  if (questionType === 'when') {
    const dateMatch = passage.match(/\b(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|\d{4})\b/);
    if (dateMatch) return dateMatch[1];
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entity type check for confidence formula
// ---------------------------------------------------------------------------

function hasExpectedEntityType(text: string, questionType: QuestionType): boolean {
  switch (questionType) {
    case 'who':
      return /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text);
    case 'when':
      return /\b\d{4}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text);
    case 'how_many':
    case 'how_much':
      return /\b\d+\b/.test(text);
    case 'where':
      return /\b(in|at|near|located|based|headquarter)\b/i.test(text);
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Content cleaning — strip citation/reference noise before BM25 scoring
// ---------------------------------------------------------------------------

/**
 * Strip citation/reference noise from content before BM25 scoring.
 * Wikipedia and academic pages contain citation metadata that BM25
 * scores highly due to unique terms (CS1_maint, arXiv, doi, etc.)
 */
function cleanContentForQA(content: string): string {
  let cleaned = content;

  // Strip markdown formatting to get clean text for BM25 scoring
  // Images: ![alt](url) → remove entirely
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Links: [text](url "title") → text (keep link text, remove URL and title)
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Bold/italic: ***text***, **text**, *text* → text
  cleaned = cleaned.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  // Inline code: `text` → text
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  // Heading markers: ## Heading → Heading
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  // Horizontal rules
  cleaned = cleaned.replace(/^---+$/gm, '');
  // HTML entities
  cleaned = cleaned.replace(/&amp;/g, '&');
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&#\d+;/g, '');

  // Remove Wikipedia citation metadata (CS1_maint, Category:, etc.)
  cleaned = cleaned.replace(/CS1[_\s]\w+[:\s][^\n]*/gi, '');
  cleaned = cleaned.replace(/Category:[^\n]*/gi, '');

  // Remove reference number markers [1], [2], [309], etc.
  cleaned = cleaned.replace(/\[\d{1,4}\]/g, '');

  // Remove academic citation noise (arXiv, doi, ISBN, ISSN, Bibcode, PMID, S2CID)
  cleaned = cleaned.replace(/\b(arXiv|doi|ISBN|ISSN|Bibcode|PMID|S2CID|JSTOR|OCLC)\s*[:=]\s*\S+/gi, '');

  // Remove bare URLs on their own line (often in reference sections)
  cleaned = cleaned.replace(/^https?:\/\/\S+$/gm, '');

  // Remove "Retrieved DATE" and "Archived from the original" patterns
  cleaned = cleaned.replace(/\b(retrieved|archived from the original)\b[^\n]{0,100}/gi, '');

  // Remove "External links" and everything after (usually just URLs)
  cleaned = cleaned.replace(/^#{1,3}\s*External\s+links[\s\S]*$/im, '');

  // Fix #8: Remove entire "See also", "Notes", "Further reading" sections
  // (heading + all content until the next heading)
  cleaned = cleaned.replace(/^#{1,3}\s*(?:See\s+also|Notes|Further\s+reading)\s*\n(?:(?!^#{1,3}\s).*\n?)*/gim, '');

  // Remove "References" heading only (keep nearby content that may be relevant)
  cleaned = cleaned.replace(/^#{1,3}\s*References\s*$/im, '');

  // Remove lines that are mostly citation-like (very short with lots of punctuation/numbers)
  cleaned = cleaned.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines
    // Remove lines that look like citation entries:
    // - Start with "^" (Wikipedia footnote)
    if (trimmed.startsWith('^')) return false;
    if (trimmed.length < 10) return true; // keep very short real lines
    // If more than 60% of chars are non-alphabetic, likely a citation
    const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    if (trimmed.length > 30 && alphaCount / trimmed.length < 0.4) return false;
    return true;
  }).join('\n');

  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned;
}

// ---------------------------------------------------------------------------
// Main quickAnswer function
// ---------------------------------------------------------------------------

/**
 * Answer a question about fetched page content using BM25 + heuristics.
 *
 * This is a fully offline, LLM-free approach. It:
 * 1. Cleans the content (strips Wikipedia citations, reference noise, etc.)
 * 2. Tries direct pattern extraction for structured content (infoboxes, definitions)
 * 3. Falls back to BM25 sentence scoring with question-type-aware boosting
 * 4. Uses sliding windows (1-3 sentences) to capture multi-sentence answers
 * 5. Expands query terms with synonyms for broader matching
 * 6. Returns the top passages with scores and surrounding context
 *
 * @param options - Question, content, and optional tuning parameters
 * @returns A result object with answer text, confidence score, and ranked passages
 *
 * @example
 * ```ts
 * const result = await quickAnswer({
 *   question: 'What is the pricing?',
 *   content: pageMarkdown,
 *   url: 'https://example.com/pricing',
 * });
 * console.log(result.answer, result.confidence);
 * ```
 */
export function quickAnswer(options: QuickAnswerOptions): QuickAnswerResult {
  const {
    question,
    content,
    maxPassages = 3,
    maxChars = 2000,
    url = '',
  } = options;

  const emptyResult: QuickAnswerResult = {
    question,
    answer: '',
    confidence: 0,
    passages: [],
    source: url,
    method: 'bm25',
  };

  if (!content || !content.trim()) return emptyResult;
  if (!question || !question.trim()) return emptyResult;

  // Clean content to remove citation/reference noise before BM25 scoring
  const cleanedContent = cleanContentForQA(content);

  // For very long content, focus on the most relevant portion.
  // Wikipedia article tails contain references, tangential details, and noise.
  const MAX_QA_CHARS = 20000;
  let qaContent = cleanedContent;
  if (qaContent.length > MAX_QA_CHARS) {
    // Keep the first 70% — definitions, key facts, and main content
    // are almost always in the first 2/3 of the article
    qaContent = qaContent.slice(0, Math.floor(qaContent.length * 0.7));
  }

  // Step 0: Direct pattern extraction — try to find structured answers before BM25
  // This catches infobox patterns (e.g. "TypeScript: Designed by · Anders Hejlsberg")
  // and definition sentences (e.g. "TypeScript is ... developed by Microsoft")
  const questionType = detectQuestionType(question);

  // RAW (unstemmed) topic terms for tryDirectExtraction regex patterns
  const topicTermsRaw = tokenizeRaw(question).filter(t => !STOPWORDS.has(t));
  // Fix #9: Remove the unused `question` argument from the call site
  const directAnswer = tryDirectExtraction(cleanedContent, questionType, topicTermsRaw);
  if (directAnswer) {
    return {
      question,
      answer: directAnswer.text.length > maxChars ? directAnswer.text.slice(0, maxChars) + '…' : directAnswer.text,
      confidence: directAnswer.confidence,
      passages: [{ text: directAnswer.text, score: directAnswer.confidence, context: directAnswer.context }],
      source: url,
      method: 'bm25',
    };
  }

  // Step 1: Split into sentences (use qaContent — truncated for long articles)
  const sentences = splitIntoSentences(qaContent);
  if (sentences.length === 0) return emptyResult;

  // Step 2: Tokenize question (remove stopwords, then stem)
  const queryTerms = tokenizeQuestion(question);
  if (queryTerms.length === 0) {
    // Fall back to all stemmed tokens if all were stopwords
    const fallback = tokenize(question);
    if (fallback.length === 0) return emptyResult;
    queryTerms.push(...fallback);
  }

  // Expand query with synonyms for broader matching
  const expanded = expandWithSynonyms(queryTerms);
  // Use all expanded terms for BM25 (IDF naturally downweights common synonyms)
  const uniqueQueryTerms = [...new Set(expanded.map(e => e.term))];

  // Step 3: Create stemmed scoring blocks for each sentence.
  // We pass stemmed text to scoreBM25 so that its internal tokenizer gets stemmed tokens,
  // matching the stemmed queryTerms. The original sentence text is preserved for display.
  const scoringBlocks = sentences.map((s, index) => ({
    raw: tokenize(s.text).join(' '), // pre-stemmed text for BM25 scoring
    index,
  }));

  // ---------------------------------------------------------------------------
  // Step 3.5: Lightweight topic propagation (coreference approximation)
  // ---------------------------------------------------------------------------
  // When a sentence uses a referent phrase like "The platform" or "The company"
  // instead of the topic entity name, BM25 can't match it. We inject stemmed
  // topic terms into scoring blocks of nearby referent sentences so BM25 has
  // something to work with.
  //
  // Only active for question types where coreference resolution helps:
  // where, who, when — NOT for what/how/yes_no/how_many (no entity tracking needed).
  //
  // Heuristic: A sentence gets topic injection if:
  // 1. It contains a common referent pattern (the platform/company/service/etc.)
  // 2. It is within PROXIMITY_WINDOW sentences of a sentence containing the topic
  // 3. OR the content has fewer than SMALL_CONTENT_THRESHOLD sentences AND
  //    the topic is actually mentioned somewhere in the content (topicSentenceIndices non-empty)

  if (questionType === 'where' || questionType === 'who' || questionType === 'when') {
    const REFERENT_PATTERNS = /\b(?:the\s+)?(?:platform|company|service|product|tool|application|system|framework|library|project|organization|software|language|program|site|website|app|api|sdk|package|module|engine|firm|startup|corporation)\b|^(?:It|They|He|She)\s/im;
    const PROXIMITY_WINDOW = 5;
    const SMALL_CONTENT_THRESHOLD = 15;

    // Find which sentences contain at least one topic term
    const topicSentenceIndices = new Set<number>();
    for (let i = 0; i < sentences.length; i++) {
      const stemmedSentence = scoringBlocks[i].raw;
      if (queryTerms.some(t => stemmedSentence.includes(t))) {
        topicSentenceIndices.add(i);
      }
    }

    // Only inject if the topic is actually mentioned somewhere (non-empty topicSentenceIndices)
    if (topicSentenceIndices.size > 0) {
      // Inject topic terms into referent sentences that are near topic sentences
      const topicInjection = ' ' + queryTerms.join(' ');
      for (let i = 0; i < sentences.length; i++) {
        if (topicSentenceIndices.has(i)) continue; // already has topic terms

        const hasReferent = REFERENT_PATTERNS.test(sentences[i].text);
        if (!hasReferent) continue;

        // Check proximity: is this sentence within PROXIMITY_WINDOW of a topic sentence?
        const isNearTopic = sentences.length < SMALL_CONTENT_THRESHOLD ||
          [...topicSentenceIndices].some(j => Math.abs(i - j) <= PROXIMITY_WINDOW);

        if (isNearTopic) {
          scoringBlocks[i].raw += topicInjection;
        }
      }
    }
  }

  // Step 4: Score sentences with BM25
  const bm25Scores = scoreBM25(scoringBlocks, uniqueQueryTerms);

  // Step 5: Compute max possible score for normalization
  const maxPossibleScore = Math.max(...bm25Scores, 0.001);

  // Step 6: Apply boosts (position bias, question type, definition patterns)
  const totalSentences = sentences.length;
  const sentenceScores = sentences.map((s, i) => {
    const isTopicSentence = i === 0 || qaContent.slice(Math.max(0, s.start - 2), s.start).includes('\n');

    const base = bm25Scores[i];
    const boost = computeBoost(s.text, questionType, isTopicSentence);

    // Fix #3: Position bias — reduce for 'why' and 'how' (answers can be anywhere)
    const maxPositionBoost = (questionType === 'why' || questionType === 'how') ? 0.15 : 0.4;
    const positionRatio = i / totalSentences;
    // Fix position bias: scale by how many query terms THIS sentence matches.
    // A sentence matching only 1/3 query terms (e.g., just "python") gets 1/3 of the
    // position boost — prevents the first sentence from winning on position alone.
    const sentTokens = tokenize(s.text);
    const sentTermMatches = uniqueQueryTerms.filter(t => sentTokens.includes(t)).length;
    const sentTermCoverage = uniqueQueryTerms.length > 0
      ? sentTermMatches / Math.min(uniqueQueryTerms.length, 5)
      : 0;
    const rawPositionBoost = positionRatio < 0.1 ? maxPositionBoost
      : positionRatio < 0.5 ? maxPositionBoost * (1 - (positionRatio - 0.1) / 0.4)
      : 0;
    const positionBoost = rawPositionBoost * sentTermCoverage;

    // Fix #2: Only apply definitionBoost for 'what' and 'other' question types.
    const sl = s.text.toLowerCase();
    const definitionBoost = (questionType === 'what' || questionType === 'other') &&
      /\b(is a|is an|was a|are a|refers to|is the|was the)\b/.test(sl) ? 0.3 : 0;

    // Extra boost for definition sentences very early in the content (for 'what' questions)
    // This handles Wikipedia-style articles where the first sentence IS the answer
    const earlyDefinitionBoost = (
      questionType === 'what' &&
      positionRatio < 0.05 &&
      /\b(is a|is an|are a|refers to|means|defined as|known as)\b/.test(sl)
    ) ? 0.5 : 0;

    const total = base + (boost + positionBoost + definitionBoost + earlyDefinitionBoost) * maxPossibleScore;

    return { text: s.text, index: i, score: total, base };
  });

  // ---------------------------------------------------------------------------
  // Step 7: Build sliding windows (1, 2, 3 sentences) for multi-sentence answers
  // ---------------------------------------------------------------------------

  interface Window {
    text: string;
    indices: number[];
    startSentenceIdx: number;
    score: number;
  }

  const windows: Window[] = [];

  // Single-sentence windows (preserve existing behavior)
  for (let i = 0; i < sentences.length; i++) {
    const score = sentenceScores[i].score;
    const lengthPenalty = 0;
    windows.push({
      text: sentences[i].text,
      indices: [i],
      startSentenceIdx: i,
      score: score * (1 - lengthPenalty),
    });
  }

  // 2-sentence windows
  for (let i = 0; i < sentences.length - 1; i++) {
    const score = (sentenceScores[i].score + sentenceScores[i + 1].score) / 2;
    const lengthPenalty = 0.05;
    windows.push({
      text: sentences[i].text + ' ' + sentences[i + 1].text,
      indices: [i, i + 1],
      startSentenceIdx: i,
      score: score * (1 - lengthPenalty),
    });
  }

  // 3-sentence windows (only when content has enough sentences)
  if (sentences.length >= 5) {
    for (let i = 0; i < sentences.length - 2; i++) {
      const score = (sentenceScores[i].score + sentenceScores[i + 1].score + sentenceScores[i + 2].score) / 3;
      const lengthPenalty = 0.10;
      windows.push({
        text: sentences[i].text + ' ' + sentences[i + 1].text + ' ' + sentences[i + 2].text,
        indices: [i, i + 1, i + 2],
        startSentenceIdx: i,
        score: score * (1 - lengthPenalty),
      });
    }
  }

  // Step 8: Sort windows by score
  const sortedWindows = [...windows].sort((a, b) => b.score - a.score);

  // Step 9: Select top N non-overlapping windows
  const selectedPassages: Array<{ text: string; score: number; context: string; startIdx: number; indices: number[] }> = [];
  const usedSentenceIndices = new Set<number>();

  for (const win of sortedWindows) {
    if (selectedPassages.length >= maxPassages) break;

    // Skip if any sentence in this window was already used
    const hasOverlap = win.indices.some(i => usedSentenceIndices.has(i));
    if (hasOverlap) continue;

    // Mark all sentences in this window as used
    for (const i of win.indices) usedSentenceIndices.add(i);

    // Build context: include sentence before the window and after
    const firstIdx = win.indices[0];
    const lastIdx = win.indices[win.indices.length - 1];
    const contextParts: string[] = [];

    if (firstIdx > 0 && !usedSentenceIndices.has(firstIdx - 1)) {
      contextParts.push(sentences[firstIdx - 1].text);
    }
    contextParts.push(win.text);
    if (lastIdx < sentences.length - 1 && !usedSentenceIndices.has(lastIdx + 1)) {
      contextParts.push(sentences[lastIdx + 1].text);
    }

    // Mark surrounding context sentences as used to avoid overlap
    if (firstIdx > 0) usedSentenceIndices.add(firstIdx - 1);
    if (lastIdx < sentences.length - 1) usedSentenceIndices.add(lastIdx + 1);

    const context = contextParts.join(' ');
    selectedPassages.push({
      text: win.text,
      score: Math.min(1, parseFloat((win.score / (maxPossibleScore || 1)).toFixed(4))),
      context,
      startIdx: firstIdx,
      indices: win.indices,
    });
  }

  // ---------------------------------------------------------------------------
  // Step 10: Confidence computation — multi-signal formula
  // ---------------------------------------------------------------------------

  const topWindow = sortedWindows[0];
  const topBase = topWindow ? Math.max(...topWindow.indices.map(i => sentenceScores[i].base)) : 0;
  const meanScore = bm25Scores.reduce((a, b) => a + b, 0) / bm25Scores.length;

  // Signal 1: Score gap
  const scoreGap = maxPossibleScore > 0 ? (topBase - meanScore) / maxPossibleScore : 0;

  // Signal 2: Term coverage — what % of query terms appear in top window
  // Also count synonym-mediated matches (at 0.7 weight)
  const topWindowTokens = tokenize(topWindow?.text || '');
  const directMatches = queryTerms.filter(t => topWindowTokens.includes(t)).length;
  const matchedTerms = queryTerms.filter(t => {
    if (topWindowTokens.includes(t)) return true;
    // Check if any synonym of this term appears in the top window
    const synonymsForTerm = expandWithSynonyms([t]);
    return synonymsForTerm.some(e => !e.isOriginal && topWindowTokens.includes(e.term));
  });
  const synonymMatches = matchedTerms.length - directMatches;
  const effectiveCoverage = queryTerms.length > 0
    ? (directMatches + synonymMatches * 0.7) / queryTerms.length
    : 0;

  // Signal 3: Position signal — early in document is more reliable for factual Qs
  const positionSignal = (topWindow?.startSentenceIdx ?? 999) < sentences.length * 0.2 ? 0.1 : 0;

  // Signal 4: Answer type match — does the answer look like it answers the question type?
  const typeMatch = hasExpectedEntityType(topWindow?.text || '', questionType) ? 0.20 : 0;

  const rawConfidence = Math.min(1, Math.max(0,
    0.1 +                     // reduced baseline (was 0.2)
    scoreGap * 0.35 +
    effectiveCoverage * 0.25 + // synonym-aware term coverage (was 0.30)
    positionSignal +
    typeMatch,                  // 0.20 (was 0.15)
  ));

  // Penalty: noise/metadata in top answer reduces confidence
  const topAnswerText = (topWindow?.text || '').toLowerCase();
  const noisePenalty = (
    /\bcs1[_\s]/i.test(topAnswerText) ||
    /\bcategory:/i.test(topAnswerText) ||
    /\b(archived|retrieved)\s+(from|on)\b/i.test(topAnswerText) ||
    /\b(isbn|issn|doi|arxiv|bibcode|pmid)\b/i.test(topAnswerText) ||
    (topAnswerText.match(/https?:\/\//g) || []).length > 2
  ) ? 0.5 : 0;

  // Fix #13: Penalty for UI chrome / navigation elements
  const uiChromePenalty = (
    /\b(sign in|sign up|log in|log out|subscribe|newsletter|cookie|privacy policy|terms of service)\b/i.test(topAnswerText) ||
    /\b(skip to|main menu|navigation|sidebar|footer|header|breadcrumb)\b/i.test(topAnswerText)
  ) ? 0.3 : 0;

  const confidence = Math.max(0, rawConfidence - noisePenalty - uiChromePenalty);

  // ---------------------------------------------------------------------------
  // Step 11: Try entity extraction for who/when questions (BM25 fallback)
  // ---------------------------------------------------------------------------

  let answerText = selectedPassages[0]?.context || selectedPassages[0]?.text || '';

  // For who/when, try to surface a concise entity from the top passage
  if ((questionType === 'who' || questionType === 'when') && selectedPassages[0]) {
    const entity = extractEntity(selectedPassages[0].text, questionType);
    if (entity && selectedPassages[0].text.includes(entity)) {
      // Keep full passage text as answer (it contains the entity)
      answerText = selectedPassages[0].text;
    }
  }

  if (answerText.length > maxChars) {
    answerText = answerText.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
  }

  // Trim total passages content to maxChars
  let totalChars = 0;
  const finalPassages = selectedPassages.map(p => {
    const contextTrimmed = p.context.length + totalChars > maxChars
      ? p.context.slice(0, Math.max(0, maxChars - totalChars)).replace(/\s+\S*$/, '') + '…'
      : p.context;
    totalChars += contextTrimmed.length;
    return { text: p.text, score: p.score, context: contextTrimmed };
  });

  return {
    question,
    answer: answerText,
    confidence: parseFloat(confidence.toFixed(4)),
    passages: finalPassages,
    source: url,
    method: 'bm25',
  };
}
