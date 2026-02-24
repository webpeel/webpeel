/**
 * Deep Fetch — Web Intelligence Module
 *
 * Transforms "search + fetch" into "search + fetch + synthesize + structure".
 * No LLM required — pure heuristic signal extraction, BM25 relevance scoring,
 * deduplication, entity/number extraction, and comparison detection.
 */

import { peelBatch } from '../index.js';
import { computeRelevanceScore } from './bm25-filter.js';
import { getBestSearchProvider } from './search-provider.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeepFetchOptions {
  query: string;
  /** Number of sources to fetch (default: 5, max: 10) */
  count?: number;
  /** Output format (default: 'merged') */
  format?: 'merged' | 'structured' | 'comparison';
  /** Approximate max characters in merged output (default: 32000 ≈ 8k tokens) */
  maxChars?: number;
  /** Minimum BM25 relevance score (0-1) to include a source (default: 0.05) */
  relevanceThreshold?: number;
}

export interface SourceResult {
  url: string;
  title: string;
  relevanceScore: number;
  keyPoints: string[];
  fetchedAt: string;
}

export interface StructuredData {
  facts: string[];
  entities: string[];
  dates: string[];
  numbers: Record<string, string>;
}

export interface ComparisonData {
  columns: string[];
  rows: Record<string, Record<string, string>>;
}

export interface DeepFetchResult {
  query: string;
  format: string;
  sources: SourceResult[];
  merged: string;
  structured?: StructuredData;
  comparison?: ComparisonData;
  elapsed: number;
}

// ---------------------------------------------------------------------------
// Key-point extraction
// ---------------------------------------------------------------------------

const SIGNAL_WORDS = new Set([
  'announced', 'launched', 'released', 'costs', 'requires', 'supports',
  'offers', 'provides', 'includes', 'features', 'enables', 'allows',
  'introduces', 'reveals', 'claims', 'states', 'reports', 'shows',
  'found', 'discovered', 'improved', 'updated', 'deprecated', 'removed',
  'increased', 'decreased', 'grew', 'declined', 'reached', 'exceeded',
]);

/** Split text into sentences (rough but fast — no NLP library needed). */
function splitSentences(text: string): string[] {
  // Strip markdown formatting
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[.*?\]\(.*?\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split on sentence-ending punctuation followed by space + capital
  return plain
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 500);
}

/** Extract first sentence of each paragraph (topic sentences). */
function topicSentences(content: string): string[] {
  const paragraphs = content.split(/\n{2,}/);
  const result: string[] = [];
  for (const para of paragraphs) {
    const sentences = splitSentences(para);
    if (sentences.length > 0) {
      result.push(sentences[0]);
    }
  }
  return result;
}

/** Score a sentence for "key point" worthiness. Higher = more useful. */
function sentenceScore(sentence: string, queryTerms: Set<string>): number {
  const lower = sentence.toLowerCase();
  const words = lower.split(/\s+/);

  let score = 0;

  // Query term overlap
  let queryHits = 0;
  for (const term of queryTerms) {
    if (lower.includes(term)) queryHits++;
  }
  score += (queryHits / Math.max(queryTerms.size, 1)) * 3;

  // Numbers / statistics
  const numberMatches = sentence.match(/\b\d[\d,.]*\b|\$[\d,.]+|[\d.]+%/g);
  if (numberMatches) score += Math.min(numberMatches.length * 0.5, 2);

  // Signal words
  for (const word of words) {
    if (SIGNAL_WORDS.has(word)) {
      score += 1;
      break;
    }
  }

  // Prefer medium-length sentences
  if (sentence.length > 60 && sentence.length < 300) score += 0.5;

  return score;
}

/**
 * Extract up to `maxPoints` key points from content, ranked by signal value.
 */
export function extractKeyPoints(content: string, query: string, maxPoints = 5): string[] {
  const queryTerms = new Set(
    query.toLowerCase().split(/\s+/).filter(t => t.length > 2),
  );

  const allSentences = splitSentences(content);
  const topics = topicSentences(content);

  // Combine and deduplicate
  const candidates = [...new Set([...allSentences, ...topics])];

  // Score and sort
  const scored = candidates.map(s => ({ s, score: sentenceScore(s, queryTerms) }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxPoints).map(x => x.s);
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/** Normalize a sentence for comparison. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Jaccard similarity on word sets (fast approximation). */
function similarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(' ').filter(w => w.length > 2));
  const wb = new Set(normalize(b).split(' ').filter(w => w.length > 2));
  if (wa.size === 0 && wb.size === 0) return 1;
  let intersection = 0;
  for (const w of wa) {
    if (wb.has(w)) intersection++;
  }
  const union = wa.size + wb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate a list of sentences.
 * When two sentences are >60% similar, keep the longer (more detailed) one.
 */
export function deduplicateSentences(sentences: string[], threshold = 0.6): string[] {
  const kept: string[] = [];

  for (const candidate of sentences) {
    let dominated = false;
    for (let i = 0; i < kept.length; i++) {
      const sim = similarity(candidate, kept[i]);
      if (sim >= threshold) {
        // Keep the longer one
        if (candidate.length > kept[i].length) {
          kept[i] = candidate;
        }
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      kept.push(candidate);
    }
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Number / entity extraction
// ---------------------------------------------------------------------------

const PRICE_RE = /(?:\$|€|£|¥)\s?[\d,]+(?:\.\d+)?(?:\s?(?:\/mo(?:nth)?|\/yr|\/year|\/user|\/month))?/gi;
const PERCENT_RE = /\d+(?:\.\d+)?\s?%/g;
const COUNT_RE = /\d+(?:\.\d+)?\s?(?:million|billion|thousand|M|B|K)\s?\+?(?:\s?(?:users?|customers?|downloads?|installs?))?/gi;
const DATE_RE = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|Q[1-4]\s+\d{4}/g;

/** Extract numbers, prices, percentages from text. */
export function extractNumbers(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  const prices = text.match(PRICE_RE);
  if (prices) {
    prices.slice(0, 5).forEach((p, i) => {
      result[`price_${i + 1}`] = p.trim();
    });
  }

  const percents = text.match(PERCENT_RE);
  if (percents) {
    percents.slice(0, 5).forEach((p, i) => {
      result[`percent_${i + 1}`] = p.trim();
    });
  }

  const counts = text.match(COUNT_RE);
  if (counts) {
    counts.slice(0, 5).forEach((c, i) => {
      result[`count_${i + 1}`] = c.trim();
    });
  }

  return result;
}

/** Extract dates from text. */
export function extractDates(text: string): string[] {
  const matches = text.match(DATE_RE) ?? [];
  return [...new Set(matches)].slice(0, 10);
}

/**
 * Extract named entities (proper nouns) that appear in at least 2 sources.
 * Simple heuristic: capitalized words/phrases not at sentence start.
 */
export function extractEntities(texts: string[]): string[] {
  // Collect capitalized words/phrases from each source.
  // Matches: standard proper nouns (New York), CamelCase brands (PayPal, GitHub),
  // and ALL-CAPS acronyms (AI, API) with length >= 2.
  const ENTITY_RE = /\b([A-Z][A-Za-z0-9]*(?:[A-Z][a-z0-9]+)*(?:\s+[A-Z][A-Za-z0-9]*(?:[A-Z][a-z0-9]+)*)*)\b/g;

  const termFreq = new Map<string, number>();

  for (const text of texts) {
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    ENTITY_RE.lastIndex = 0;
    while ((m = ENTITY_RE.exec(text)) !== null) {
      const term = m[1];
      if (term.length < 3) continue;
      // Skip common sentence starters / stopwords
      if (/^(The|A|An|In|On|At|To|For|Of|And|Or|But|This|That|These|Those|It|He|She|They|We|You|I)$/.test(term)) continue;
      if (!seen.has(term)) {
        seen.add(term);
        termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
      }
    }
  }

  // Only return entities that appear in 2+ sources
  return [...termFreq.entries()]
    .filter(([, freq]) => freq >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term]) => term);
}

// ---------------------------------------------------------------------------
// Comparison mode
// ---------------------------------------------------------------------------

const COMPARISON_TRIGGERS = ['vs', 'versus', 'compare', 'comparison', 'difference', 'differences', 'alternative', 'alternatives'];

/** Detect if the query is a comparison query. */
export function isComparisonQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return COMPARISON_TRIGGERS.some(t => lower.includes(t));
}

/**
 * Extract the entities being compared from a query.
 * Handles patterns like "A vs B", "compare A and B", "A or B".
 */
export function extractComparedEntities(query: string): string[] {
  const vsMatch = query.match(/(.+?)\s+(?:vs\.?|versus)\s+(.+)/i);
  if (vsMatch) {
    return [vsMatch[1].trim(), vsMatch[2].trim()].map(e =>
      e.replace(/^(?:compare|difference|between)\s+/i, '').trim(),
    );
  }

  const compareMatch = query.match(/compare\s+(.+?)\s+(?:and|to|with|vs)\s+(.+)/i);
  if (compareMatch) {
    return [compareMatch[1].trim(), compareMatch[2].trim()];
  }

  const diffMatch = query.match(/difference(?:s)?\s+between\s+(.+?)\s+and\s+(.+)/i);
  if (diffMatch) {
    return [diffMatch[1].trim(), diffMatch[2].trim()];
  }

  return [];
}

const COMPARISON_ATTRIBUTES = [
  { name: 'price', patterns: [/(?:price|cost|pricing|fee|subscription)[:\s]+([^.\n]+)/i, /(\$[\d,.]+(?:\/\w+)?)/] },
  { name: 'features', patterns: [/(?:features?|capabilities|supports?|includes?)[:\s]+([^.\n]+)/i] },
  { name: 'pros', patterns: [/(?:pros?|advantages?|benefits?|strengths?)[:\s]+([^.\n]+)/i] },
  { name: 'cons', patterns: [/(?:cons?|disadvantages?|drawbacks?|weaknesses?|limitations?)[:\s]+([^.\n]+)/i] },
  { name: 'platform', patterns: [/(?:platform|works?\s+(?:on|with)|available\s+(?:on|for))[:\s]+([^.\n]+)/i] },
  { name: 'rating', patterns: [/(?:rating|score|stars?)[:\s]+([^.\n]+)/i, /(\d+(?:\.\d+)?\s*\/\s*\d+\s*(?:stars?))/i] },
];

/**
 * Build a comparison table from merged content and entity names.
 */
export function buildComparisonTable(content: string, entities: string[]): ComparisonData | undefined {
  if (entities.length < 2) return undefined;

  const columns = COMPARISON_ATTRIBUTES.map(a => a.name);
  const rows: Record<string, Record<string, string>> = {};

  for (const entity of entities) {
    rows[entity] = {};
    // Find paragraphs mentioning this entity
    const lines = content.split(/\n+/);
    const relevant = lines.filter(l => l.toLowerCase().includes(entity.toLowerCase()));
    const entityText = relevant.join(' ');

    for (const attr of COMPARISON_ATTRIBUTES) {
      for (const pattern of attr.patterns) {
        const m = entityText.match(pattern);
        if (m && m[1]) {
          rows[entity][attr.name] = m[1].trim().slice(0, 120);
          break;
        }
      }
      if (!rows[entity][attr.name]) {
        rows[entity][attr.name] = 'N/A';
      }
    }
  }

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Smart content merging
// ---------------------------------------------------------------------------

/**
 * Merge content from multiple sources intelligently:
 * - Sort by relevance (most relevant first)
 * - Add source attribution
 * - Truncate to maxChars
 */
function mergeContent(
  pages: Array<{ content: string; title: string; url: string; relevanceScore: number }>,
  maxChars: number,
): string {
  // Sort most-relevant first
  const sorted = [...pages].sort((a, b) => b.relevanceScore - a.relevanceScore);

  const parts: string[] = [];
  let totalChars = 0;

  for (const page of sorted) {
    if (!page.content) continue;

    const header = `## [${page.title}](${page.url})\n\n`;
    const body = page.content;
    const section = `${header}${body}\n\n---\n\n`;

    if (totalChars + section.length > maxChars) {
      // Add truncated version
      const remaining = maxChars - totalChars - header.length - 20;
      if (remaining > 200) {
        parts.push(`${header}${body.slice(0, remaining)}...\n\n---\n\n`);
      }
      break;
    }

    parts.push(section);
    totalChars += section.length;
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Main deepFetch function
// ---------------------------------------------------------------------------

function timeout<T>(ms: number, label: string): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
}

export async function deepFetch(options: DeepFetchOptions): Promise<DeepFetchResult> {
  const {
    query,
    count = 5,
    format = 'merged',
    maxChars = 32000,
    relevanceThreshold = 0.05,
  } = options;

  const startTime = Date.now();
  const safeCount = Math.min(Math.max(count, 1), 10);

  // ── Step 1: Search ────────────────────────────────────────────────────────
  const { provider, apiKey } = getBestSearchProvider();
  const searchResults = await Promise.race([
    provider.searchWeb(query, { count: safeCount + 2, apiKey }), // fetch extras, filter low-relevance
    timeout<never>(30000, 'Search'),
  ]);

  const topResults = (Array.isArray(searchResults) ? searchResults : (searchResults as any)?.results ?? [])
    .slice(0, safeCount + 2);

  if (topResults.length === 0) {
    return {
      query,
      format,
      sources: [],
      merged: '',
      elapsed: Date.now() - startTime,
    };
  }

  // ── Step 2: Fetch all URLs in parallel ────────────────────────────────────
  const urls = topResults.map((r: any) => r.url).filter(Boolean);
  const pages = await Promise.race([
    peelBatch(urls, { concurrency: 5, format: 'markdown' }),
    timeout<never>(120000, 'Batch fetch'),
  ]);

  // ── Step 3: Score relevance and collect sources ───────────────────────────
  type PageData = {
    url: string;
    title: string;
    content: string;
    relevanceScore: number;
    keyPoints: string[];
    fetchedAt: string;
  };

  const scoredPages: PageData[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] as any;
    const searchResult = topResults[i] as any;
    const url = urls[i];

    if (!page || page.error) continue;

    const content: string = page.content || '';
    const title: string = page.title || searchResult?.title || url;

    const relevanceScore = computeRelevanceScore(content, query);

    if (relevanceScore < relevanceThreshold && scoredPages.length >= 2) {
      // Skip low-relevance if we already have enough
      continue;
    }

    const keyPoints = extractKeyPoints(content, query, 5);

    scoredPages.push({
      url,
      title,
      content,
      relevanceScore,
      keyPoints,
      fetchedAt: new Date().toISOString(),
    });

    if (scoredPages.length >= safeCount) break;
  }

  // ── Step 4: Merge content ─────────────────────────────────────────────────
  const mergedContent = mergeContent(scoredPages, maxChars);

  // ── Step 5: Build sources list ────────────────────────────────────────────
  const sources: SourceResult[] = scoredPages.map(p => ({
    url: p.url,
    title: p.title,
    relevanceScore: Math.round(p.relevanceScore * 1000) / 1000,
    keyPoints: p.keyPoints,
    fetchedAt: p.fetchedAt,
  }));

  const result: DeepFetchResult = {
    query,
    format,
    sources,
    merged: mergedContent,
    elapsed: Date.now() - startTime,
  };

  // ── Step 6: Structured extraction (optional) ──────────────────────────────
  if (format === 'structured' || format === 'comparison') {
    const allTexts = scoredPages.map(p => p.content);
    const allFacts = scoredPages.flatMap(p => p.keyPoints);
    const deduplicatedFacts = deduplicateSentences(allFacts);
    const entities = extractEntities(allTexts);
    const dates = extractDates(mergedContent);
    const numbers = extractNumbers(mergedContent);

    result.structured = {
      facts: deduplicatedFacts,
      entities,
      dates,
      numbers,
    };
  }

  // ── Step 7: Comparison table (optional) ───────────────────────────────────
  if (format === 'comparison' || isComparisonQuery(query)) {
    const comparedEntities = extractComparedEntities(query);
    if (comparedEntities.length >= 2) {
      result.comparison = buildComparisonTable(mergedContent, comparedEntities);
    }
  }

  return result;
}
