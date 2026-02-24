/**
 * Quick Answer — LLM-free question answering using BM25 + heuristics
 *
 * Answers a question about page content without any API key.
 * Uses BM25 relevance scoring + answer-signal boosting to surface
 * the most relevant sentences.
 */

import { scoreBM25 } from './bm25-filter.js';

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

type QuestionType = 'what' | 'how_many' | 'how_much' | 'when' | 'where' | 'why' | 'who' | 'other';

function detectQuestionType(question: string): QuestionType {
  const q = question.toLowerCase().trim();
  if (/how\s+many|how\s+much|what\s+price|what\s+cost|pricing/.test(q)) return 'how_many';
  if (/when\b/.test(q)) return 'when';
  if (/where\b/.test(q)) return 'where';
  if (/why\b/.test(q)) return 'why';
  if (/who\b/.test(q)) return 'who';
  // "what company/person/team/group/organization" → treat as who
  if (/what\s+(?:company|person|people|team|group|organization|organisation|developer|author|creator|founder)\b/.test(q)) return 'who';
  if (/what\b/.test(q)) return 'what';
  if (/how\b/.test(q)) return 'how_many';
  return 'other';
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function tokenizeQuestion(question: string): string[] {
  return tokenize(question).filter(t => !STOPWORDS.has(t));
}

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/**
 * Split text into sentences. Handles common abbreviations to avoid false splits.
 * Returns an array of sentences with their start position (index in original text).
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

  // Filter: keep sentences between 10 and 500 chars
  return sentences.filter(s => {
    const len = s.text.length;
    return len >= 10 && len <= 500;
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
      // Contains a number or price
      if (/\$[\d,.]+|\d+[,.]?\d*\s*(per|\/|month|year|week|day|request|api|call|token|user)/i.test(sentence)) {
        boost += 0.3;
      } else if (/\b\d+\b/.test(sentence)) {
        boost += 0.15;
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
    case 'where': {
      // Contains a location hint (capitalized proper noun)
      if (/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/.test(sentence) && !/^(The|A|An|In|On|At|For)\b/.test(sentence)) {
        boost += 0.3;
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
      break;
    }
    case 'who': {
      // Pattern: "[topic] was created/designed/developed by [Person]"
      // Or: "[Person] created/designed/developed [topic]"
      if (/\b(created|designed|developed|built|invented|founded|authored|introduced|proposed|conceived)\s+by\b/i.test(s) ||
          /\b[A-Z][a-z]+\s+(?:[A-Z][a-z]+\s+)?(?:created|designed|developed|built|invented|founded|authored|introduced)\b/.test(sentence)) {
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

function tryDirectExtraction(
  content: string,
  questionType: QuestionType,
  topicTerms: string[],
  _question: string,
): DirectResult | null {
  if (topicTerms.length === 0) return null;

  // Build a regex pattern that matches any topic term (case-insensitive)
  const topicPattern = topicTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // --- Infobox patterns (Wikipedia-style: "Topic: Field · Value") ---
  // Note: Wikipedia uses \u00A0 (NBSP) in infobox fields, so we use \\s+ (which matches NBSP) instead of literal spaces
  const infoboxPatterns: Array<{ type: QuestionType[]; field: RegExp }> = [
    { type: ['who'], field: new RegExp(`(?:${topicPattern}).*?(?:Designed\\s+by|Created\\s+by|Developed\\s+by|Founded\\s+by|Original\\s+author|Developers|Developer|Maintainer|Author|Inventor|Creator)\\s*[·:]\\s*(.+)`, 'i') },
    { type: ['when'], field: new RegExp(`(?:${topicPattern}).*?(?:First\\s+appeared|Released|Founded|Established|Created|Launch\\s+date|Initial\\s+release)\\s*[·:]\\s*(.+)`, 'i') },
    { type: ['what'], field: new RegExp(`(?:${topicPattern}).*?(?:Type|Genre|Category|Classification)\\s*[·:]\\s*(.+)`, 'i') },
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
    const byPattern = /(?:developed|designed|created|built|invented|founded|authored|introduced|coined)\s+by\s+(\S+(?:\s+\S+){0,3})/i;
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
    const datePattern = /(?:released|launched|first appeared|founded|established|created|introduced|began|started)\s+(?:in|on)?\s*(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4}|\d{4})/i;
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
// Main quickAnswer function
// ---------------------------------------------------------------------------

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

  // Step 0: Direct pattern extraction — try to find structured answers before BM25
  // This catches infobox patterns (e.g. "TypeScript: Designed by · Anders Hejlsberg")
  // and definition sentences (e.g. "TypeScript is ... developed by Microsoft")
  const questionType = detectQuestionType(question);
  const topicTerms = tokenizeQuestion(question);
  const directAnswer = tryDirectExtraction(content, questionType, topicTerms, question as string);
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

  // Step 1: Split into sentences
  const sentences = splitIntoSentences(content);
  if (sentences.length === 0) return emptyResult;

  // Step 2: Tokenize question (remove stopwords)
  const queryTerms = tokenizeQuestion(question);
  if (queryTerms.length === 0) {
    // Fall back to all tokens if all were stopwords
    queryTerms.push(...tokenize(question));
  }
  if (queryTerms.length === 0) return emptyResult;

  // Step 3: Score sentences with BM25 (questionType already computed in Step 0)
  const blocks = sentences.map((s, index) => ({ raw: s.text, index }));
  const bm25Scores = scoreBM25(blocks, queryTerms);

  // Step 4: Compute max possible score for normalization
  // (the sentence with the highest BM25 score against itself as a reference)
  const maxPossibleScore = Math.max(...bm25Scores, 0.001);

  // Step 5: Apply boosts (including position bias — intro sentences are more likely to answer factual questions)
  const totalSentences = sentences.length;
  const sentenceScores = sentences.map((s, i) => {
    // A "topic sentence" is the first sentence in a paragraph/section
    // We detect this by checking if the previous character in the content is a newline
    const isTopicSentence = i === 0 || content.slice(Math.max(0, s.start - 2), s.start).includes('\n');

    const base = bm25Scores[i];
    const boost = computeBoost(s.text, questionType, isTopicSentence);

    // Position bias: early sentences get a boost (answers to factual questions
    // are typically in the intro paragraph, especially on Wikipedia/docs).
    // Decays linearly: first 10% of sentences get full boost (0.4), drops to 0 by 50%.
    const positionRatio = i / totalSentences;
    const positionBoost = positionRatio < 0.1 ? 0.4
      : positionRatio < 0.5 ? 0.4 * (1 - (positionRatio - 0.1) / 0.4)
      : 0;

    // Definition sentences anywhere get a boost (covers "X is a Y" patterns)
    const sl = s.text.toLowerCase();
    const definitionBoost = /\b(is a|is an|was a|are a|refers to|is the|was the)\b/.test(sl) ? 0.3 : 0;

    const total = base + (boost + positionBoost + definitionBoost) * maxPossibleScore;

    return { text: s.text, index: i, score: total, base };
  });

  // Step 6: Sort by score and select top N
  const sorted = [...sentenceScores].sort((a, b) => b.score - a.score);
  const topN = Math.min(maxPassages, sorted.length);
  const topSentences = sorted.slice(0, topN);

  // Step 7: For each top sentence, collect context (surrounding sentences)
  const selectedPassages: Array<{ text: string; score: number; context: string }> = [];
  const usedIndices = new Set<number>();

  for (const entry of topSentences) {
    if (usedIndices.has(entry.index)) continue;

    const i = entry.index;
    const contextParts: string[] = [];

    // Include sentence before
    if (i > 0 && !usedIndices.has(i - 1)) {
      contextParts.push(sentences[i - 1].text);
    }
    // The sentence itself
    contextParts.push(entry.text);
    // Include sentence after
    if (i < sentences.length - 1 && !usedIndices.has(i + 1)) {
      contextParts.push(sentences[i + 1].text);
    }

    // Mark all context indices as used to avoid overlap
    if (i > 0) usedIndices.add(i - 1);
    usedIndices.add(i);
    if (i < sentences.length - 1) usedIndices.add(i + 1);

    const context = contextParts.join(' ');
    selectedPassages.push({
      text: entry.text,
      score: parseFloat((entry.score / (maxPossibleScore || 1)).toFixed(4)),
      context,
    });
  }

  // Step 8: Compute confidence from how much the top BM25 score stands out vs. the mean
  const topScore = sorted[0]?.score ?? 0;
  const topBase = sorted[0]?.base ?? 0;
  const meanScore = bm25Scores.reduce((a, b) => a + b, 0) / bm25Scores.length;
  const scoreGap = maxPossibleScore > 0 ? (topBase - meanScore) / maxPossibleScore : 0;
  // 0.3 baseline (we found something), up to 1.0 if top answer dominates
  const confidence = Math.min(1, Math.max(0, 0.3 + scoreGap * 0.7));

  // Step 9: Build answer — best passage text, trimmed to maxChars
  let answerText = selectedPassages[0]?.context || selectedPassages[0]?.text || '';
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
    return { ...p, context: contextTrimmed };
  });

  void topScore; // consumed via sorted[0]

  return {
    question,
    answer: answerText,
    confidence: parseFloat(confidence.toFixed(4)),
    passages: finalPassages,
    source: url,
    method: 'bm25',
  };
}
