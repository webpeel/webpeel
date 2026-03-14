/**
 * Source Scoring — intelligent ranking for /v1/ask results
 *
 * Ranks search results using:
 * 1. Primary source detection (entity name in domain, official docs paths)
 * 2. Domain authority scoring (tiered: official → institutional → major → general)
 * 3. Freshness scoring (from page metadata — publishDate, published, lastModified)
 * 4. Domain deduplication (max 2 results per domain)
 * 5. Combined score: bm25*0.4 + authority*0.25 + freshness*0.2 + primary*0.15
 *    (for factual/pricing queries, freshness weight is doubled)
 *
 * No external dependencies — pure TypeScript.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface PageMetadataForScoring {
  published?: string;
  publishDate?: string;
  [key: string]: unknown;
}

export interface FreshnessData {
  lastModified?: string;
  fetchedAt?: string;
}

/** Authority tier label for the response payload */
export type AuthorityLabel = 'official' | 'institutional' | 'major' | 'general';

/** Freshness tier label for the response payload */
export type FreshnessLabel = 'recent' | 'this-month' | 'this-year' | 'older';

/** Public-facing scored source (returned in API response) */
export interface ScoredSource {
  url: string;
  title: string;
  snippet: string;
  confidence: number;
  authority: AuthorityLabel;
  freshness: FreshnessLabel;
  isPrimarySource: boolean;
}

/** Internal scored source (includes all raw component scores) */
export interface ScoredSourceInternal extends ScoredSource {
  bm25Score: number;
  authorityScore: number;
  freshnessScore: number;
  primarySourceScore: number;
  finalScore: number;
}

// ---------------------------------------------------------------------------
// Authority tiers
// ---------------------------------------------------------------------------

interface AuthorityTier {
  pattern: string | RegExp;
  score: number;
}

const AUTHORITY_TIERS: AuthorityTier[] = [
  // -----------------------------------------------------------------------
  // Specific known domains — checked FIRST (most precise)
  // -----------------------------------------------------------------------
  // High-quality reference/code (0.85-0.9)
  { pattern: 'github.com', score: 0.9 },
  { pattern: 'arxiv.org', score: 0.9 },
  { pattern: 'stackoverflow.com', score: 0.85 },
  { pattern: 'wikipedia.org', score: 0.85 },
  // Major news/institutional (0.7-0.8)
  { pattern: 'reuters.com', score: 0.8 },
  { pattern: 'apnews.com', score: 0.8 },
  { pattern: 'bloomberg.com', score: 0.8 },
  { pattern: 'wsj.com', score: 0.8 },
  { pattern: 'ft.com', score: 0.8 },
  { pattern: 'nytimes.com', score: 0.8 },
  { pattern: 'bbc.com', score: 0.8 },
  { pattern: 'bbc.co.uk', score: 0.8 },
  { pattern: 'techcrunch.com', score: 0.75 },
  { pattern: 'arstechnica.com', score: 0.75 },
  { pattern: 'theverge.com', score: 0.75 },
  { pattern: 'wired.com', score: 0.75 },
  { pattern: 'zdnet.com', score: 0.7 },
  { pattern: 'cnn.com', score: 0.75 },
  // -----------------------------------------------------------------------
  // Subdomain patterns — regex, checked after specific domains
  // -----------------------------------------------------------------------
  { pattern: /^docs\./, score: 0.9 },
  { pattern: /^developer\./, score: 0.9 },
  { pattern: /^developers\./, score: 0.9 },
  { pattern: /^api\./, score: 0.85 },
  { pattern: /^support\./, score: 0.8 },
  { pattern: /^help\./, score: 0.8 },
  // -----------------------------------------------------------------------
  // Broad TLD patterns — checked LAST (most general)
  // These must come after specific domain rules to avoid overriding them.
  // e.g. wikipedia.org should score 0.85 (specific), not 0.9 (.org TLD)
  // -----------------------------------------------------------------------
  { pattern: '.gov', score: 1.0 },
  { pattern: '.edu', score: 0.95 },
  { pattern: '.org', score: 0.9 },
  // Default for everything else: 0.5
];

const AUTHORITY_DEFAULT = 0.5;

// ---------------------------------------------------------------------------
// Stopwords (for entity extraction)
// ---------------------------------------------------------------------------

const ENTITY_STOPWORDS = new Set([
  'what', 'is', 'the', 'how', 'do', 'a', 'an', 'where', 'when', 'why',
  'which', 'can', 'does', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might',
  'shall', 'must', 'did', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'of', 'in', 'on', 'at', 'by', 'for',
  'with', 'about', 'into', 'to', 'from', 'up', 'out', 'and', 'or', 'but',
  'if', 'so', 'as', 'not', 'no', 'than', 'then', 'also', 'get', 'use',
  'list', 'find', 'tell', 'show', 'give', 'make', 'need', 'want', 'know',
  'free', 'best', 'good', 'new', 'all', 'any', 'some', 'more', 'most',
  'vs', 'versus', 'compare', 'difference', 'between', 'using', 'used',
  'many', 'much', 'long', 'does', 'cost', 'price', 'limit', 'rate',
]);

// Factual query keywords — freshness is doubled for these
const FACTUAL_QUERY_PATTERN =
  /\b(price|pricing|cost|costs|limit|limits|rate|rates|quota|tier|plan|plans|fee|fees|subscription|deprecat|latest|current|version|update)\b/i;

// Official path patterns — indicates docs/pricing/help pages
const OFFICIAL_PATH_PATTERN =
  /\/(docs|api|pricing|help|support|documentation|reference|guide|faq|changelog|release|releases|download|downloads|getting-started|quickstart)\b/i;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Extract the hostname from a URL (e.g. "docs.cerebras.ai").
 */
export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    const match = url.match(/^https?:\/\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : '';
  }
}

/**
 * Extract the registered domain (e.g. "cerebras.ai" from "docs.cerebras.ai").
 * Handles common multi-part TLDs like .co.uk, .com.au, etc.
 */
export function extractRegisteredDomain(url: string): string {
  const hostname = extractHostname(url);
  if (!hostname) return '';

  const MULTI_TLD = /\.(co|com|net|org|gov|edu)\.[a-z]{2}$/i;
  if (MULTI_TLD.test(hostname)) {
    const parts = hostname.split('.');
    return parts.slice(-3).join('.');
  }

  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

/**
 * Extract the URL path from a URL string.
 */
function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const match = url.match(/^https?:\/\/[^/?#]+(\/[^?#]*)?/i);
    return match?.[1] ?? '';
  }
}

// ---------------------------------------------------------------------------
// 1. Primary source detection
// ---------------------------------------------------------------------------

/**
 * Extract entity candidates from a query.
 * Returns non-stopword tokens of length >= 3.
 * e.g. "what are cerebras free tier limits" → ["cerebras", "tier", "limits"]
 */
export function extractEntityCandidates(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !ENTITY_STOPWORDS.has(t));
}

/**
 * Score a URL as a primary source for a given query.
 * Returns a score in [0, 1.0].
 *
 * Factors:
 * - Domain contains entity name → +0.3
 * - URL path matches official docs/pricing patterns → +0.2
 */
export function scorePrimarySource(url: string, query: string): number {
  const hostname = extractHostname(url);
  const entities = extractEntityCandidates(query);

  let score = 0;

  // Check if any entity appears as a whole word in the domain.
  // Split hostname on delimiters (., -, _) and check for exact segment match.
  // This prevents partial matches like 'random' matching 'randomblog.io'.
  const domainSegments = hostname.split(/[.\-_]/);
  const domainMatch = entities.some(entity =>
    domainSegments.includes(entity),
  );
  if (domainMatch) {
    score += 0.3;
  }

  // Check for official docs/pricing patterns in the path
  const path = extractPath(url);
  if (OFFICIAL_PATH_PATTERN.test(path)) {
    score += 0.2;
  }

  return Math.min(1.0, score);
}

/**
 * Returns true if the URL is a primary source for the query.
 */
export function isPrimarySource(url: string, query: string): boolean {
  return scorePrimarySource(url, query) > 0;
}

// ---------------------------------------------------------------------------
// 2. Domain authority scoring
// ---------------------------------------------------------------------------

/**
 * Score domain authority for a URL.
 * Returns a score in [0, 1].
 */
export function scoreDomainAuthority(url: string): number {
  const hostname = extractHostname(url);
  if (!hostname) return AUTHORITY_DEFAULT;

  for (const tier of AUTHORITY_TIERS) {
    if (typeof tier.pattern === 'string') {
      if (tier.pattern.startsWith('.')) {
        // TLD check: ".gov" → hostname ends with ".gov"
        if (hostname.endsWith(tier.pattern)) return tier.score;
      } else {
        // Domain check: exact match or subdomain
        if (hostname === tier.pattern || hostname.endsWith('.' + tier.pattern)) {
          return tier.score;
        }
      }
    } else {
      // RegExp: test against the full hostname
      if (tier.pattern.test(hostname)) return tier.score;
    }
  }

  return AUTHORITY_DEFAULT;
}

/**
 * Map an authority score to a label.
 */
export function authorityLabel(score: number): AuthorityLabel {
  if (score >= 0.9) return 'official';       // .gov, .edu, github, arxiv, docs.*
  if (score >= 0.8) return 'institutional';  // .org, reuters, nytimes, bbc
  if (score >= 0.7) return 'major';          // techcrunch, arstechnica, etc.
  return 'general';
}

// ---------------------------------------------------------------------------
// 3. Freshness scoring
// ---------------------------------------------------------------------------

/**
 * Extract a publish/modification date from page metadata.
 * Tries multiple metadata fields in order of preference.
 */
export function extractPageDate(
  metadata?: PageMetadataForScoring,
  freshness?: FreshnessData,
): Date | null {
  const candidates: Array<string | undefined> = [
    metadata?.publishDate,
    metadata?.published,
    metadata?.['article:published_time'] as string | undefined,
    metadata?.['og:article:published_time'] as string | undefined,
    metadata?.['datePublished'] as string | undefined,
    metadata?.['modified'] as string | undefined,
    metadata?.['dateModified'] as string | undefined,
    freshness?.lastModified,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const d = new Date(candidate);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() <= new Date().getFullYear() + 1) {
      return d;
    }
  }

  return null;
}

/**
 * Score freshness based on page date.
 * Returns a score in [0, 1]:
 *   - No date known → 0.5 (neutral)
 *   - last 7 days   → 1.0
 *   - last 30 days  → 0.9
 *   - last 90 days  → 0.8
 *   - last year     → 0.6
 *   - older         → 0.4
 */
export function scoreFreshness(
  metadata?: PageMetadataForScoring,
  freshnessData?: FreshnessData,
): number {
  const pageDate = extractPageDate(metadata, freshnessData);
  if (!pageDate) return 0.5; // neutral when unknown

  const ageDays = (Date.now() - pageDate.getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays <= 7) return 1.0;
  if (ageDays <= 30) return 0.9;
  if (ageDays <= 90) return 0.8;
  if (ageDays <= 365) return 0.6;
  return 0.4;
}

/**
 * Map freshness metadata to a label.
 */
export function freshnessLabel(
  metadata?: PageMetadataForScoring,
  freshnessData?: FreshnessData,
): FreshnessLabel {
  const score = scoreFreshness(metadata, freshnessData);
  if (score >= 0.85) return 'recent';      // last 30 days
  if (score >= 0.75) return 'this-month';  // last 90 days
  if (score >= 0.45) return 'this-year';   // last year or unknown
  return 'older';
}

// ---------------------------------------------------------------------------
// 4. Factual query detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the query is about pricing, limits, rates, or other
 * time-sensitive factual data where freshness is critical.
 */
export function isFactualQuery(query: string): boolean {
  return FACTUAL_QUERY_PATTERN.test(query);
}

// ---------------------------------------------------------------------------
// 5. Combined scoring
// ---------------------------------------------------------------------------

/**
 * Compute the combined final score for a source.
 *
 * Standard weights:
 *   finalScore = bm25*0.40 + authority*0.25 + freshness*0.20 + primary*0.15
 *
 * Factual/pricing query weights (freshness doubled at expense of authority):
 *   finalScore = bm25*0.35 + authority*0.15 + freshness*0.35 + primary*0.15
 */
export function computeFinalScore(
  bm25Score: number,
  authorityScore: number,
  freshnessScore: number,
  primarySourceScore: number,
  factual: boolean,
): number {
  if (factual) {
    return bm25Score * 0.35 + authorityScore * 0.15 + freshnessScore * 0.35 + primarySourceScore * 0.15;
  }
  return bm25Score * 0.40 + authorityScore * 0.25 + freshnessScore * 0.20 + primarySourceScore * 0.15;
}

// ---------------------------------------------------------------------------
// 6. Domain deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate sources by registered domain.
 * Keeps up to `maxPerDomain` (default: 2) highest-scored results per domain.
 * Input must already be sorted by finalScore descending for correct behavior.
 */
export function deduplicateByDomain<T extends { url: string; finalScore: number }>(
  sources: T[],
  maxPerDomain = 2,
): T[] {
  // Sort by finalScore descending to keep the best
  const sorted = [...sources].sort((a, b) => b.finalScore - a.finalScore);
  const domainCounts = new Map<string, number>();
  const result: T[] = [];

  for (const source of sorted) {
    const domain = extractRegisteredDomain(source.url);
    const count = domainCounts.get(domain) ?? 0;
    if (count < maxPerDomain) {
      result.push(source);
      domainCounts.set(domain, count + 1);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 7. Single source scoring
// ---------------------------------------------------------------------------

export interface ScoreSourceOptions {
  searchResult: SearchResult;
  query: string;
  /** BM25 confidence score from quickAnswer (0-1). Default: 0.5 (neutral pre-fetch) */
  bm25Score?: number;
  metadata?: PageMetadataForScoring;
  freshnessData?: FreshnessData;
  /** Override factual query detection */
  factualQuery?: boolean;
}

/**
 * Score a single source with all signals combined.
 */
export function scoreSource(options: ScoreSourceOptions): ScoredSourceInternal {
  const {
    searchResult,
    query,
    bm25Score = 0.5,
    metadata,
    freshnessData,
  } = options;

  const factualQuery = options.factualQuery ?? isFactualQuery(query);
  const authorityScore = scoreDomainAuthority(searchResult.url);
  const freshnessScore = scoreFreshness(metadata, freshnessData);
  const primarySourceScore = scorePrimarySource(searchResult.url, query);

  const finalScore = computeFinalScore(
    bm25Score,
    authorityScore,
    freshnessScore,
    primarySourceScore,
    factualQuery,
  );

  return {
    url: searchResult.url,
    title: searchResult.title,
    snippet: searchResult.snippet,
    confidence: bm25Score,
    authority: authorityLabel(authorityScore),
    freshness: freshnessLabel(metadata, freshnessData),
    isPrimarySource: primarySourceScore > 0,
    // Internal fields
    bm25Score,
    authorityScore,
    freshnessScore,
    primarySourceScore,
    finalScore,
  };
}

// ---------------------------------------------------------------------------
// 8. Batch ranking helpers (for ask.ts integration)
// ---------------------------------------------------------------------------

/**
 * Rank search results BEFORE fetching.
 * Uses authority + primary source scores (BM25 and freshness not yet available).
 * Returns deduplicated results sorted by pre-fetch score.
 *
 * Use this to prioritize which URLs to fetch.
 */
export function rankSearchResults(
  results: SearchResult[],
  query: string,
  options?: { maxPerDomain?: number },
): SearchResult[] {
  const factual = isFactualQuery(query);

  const scored = results.map(r => {
    const authorityScore = scoreDomainAuthority(r.url);
    const primarySourceScore = scorePrimarySource(r.url, query);
    // Pre-fetch: BM25 = 0.5 (neutral), freshness = 0.5 (unknown)
    const finalScore = computeFinalScore(0.5, authorityScore, 0.5, primarySourceScore, factual);
    return { ...r, finalScore };
  });

  const deduped = deduplicateByDomain(scored, options?.maxPerDomain ?? 2);
  // Return search results in ranked order (strip internal finalScore)
  return deduped.map(({ finalScore: _f, ...r }) => r);
}

/**
 * Score fetched sources AFTER BM25 scoring.
 * Computes the full combined score and returns deduplicated results sorted by finalScore.
 */
export function scoreFetchedSources(
  sources: Array<{
    searchResult: SearchResult;
    bm25Score: number;
    metadata?: PageMetadataForScoring;
    freshnessData?: FreshnessData;
  }>,
  query: string,
  options?: { maxPerDomain?: number },
): ScoredSourceInternal[] {
  const factual = isFactualQuery(query);

  const scored = sources.map(s =>
    scoreSource({
      searchResult: s.searchResult,
      query,
      bm25Score: s.bm25Score,
      metadata: s.metadata,
      freshnessData: s.freshnessData,
      factualQuery: factual,
    }),
  );

  return deduplicateByDomain(scored, options?.maxPerDomain ?? 2);
}
