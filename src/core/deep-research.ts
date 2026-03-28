/**
 * WebPeel Deep Research
 *
 * Multi-step search agent that turns one question into a comprehensive,
 * cited research report. Orchestrates:
 *
 *   1. Query Decomposition  — LLM breaks question into 3-5 sub-queries
 *   2. Parallel Multi-Search — All sub-queries across DDG + Stealth
 *   3. Source Fetching       — peel() on top results per sub-query
 *   4. Relevance Scoring     — BM25 against the original question
 *   5. Gap Detection         — LLM: "Is there enough info? What's missing?"
 *   6. Re-Search Loop        — Generate new queries if gaps found (max N rounds)
 *   7. Synthesis             — LLM generates final cited report
 */

import { peel } from '../index.js';
import { getSearchProvider, type WebSearchResult } from './search-provider.js';
import { scoreBM25, splitIntoBlocks } from './bm25-filter.js';
import {
  callLLM,
  getDefaultLLMConfig,
  isFreeTierLimitError,
  type LLMConfig,
  type LLMMessage,
} from './llm-provider.js';
import { sanitizeForLLM } from './prompt-guard.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressEventType =
  | 'decomposing'
  | 'searching'
  | 'fetching'
  | 'scoring'
  | 'gap_check'
  | 'quality_check'
  | 'researching'
  | 'verification'
  | 'synthesizing'
  | 'done'
  | 'error';

export interface DeepResearchProgressEvent {
  type: ProgressEventType;
  message: string;
  round?: number;
  data?: Record<string, unknown>;
}

export interface Citation {
  index: number;
  title: string;
  url: string;
  snippet: string;
  relevanceScore: number;
}

export interface DeepResearchRequest {
  question: string;
  llm?: LLMConfig;
  /** Maximum research rounds (default: 3) */
  maxRounds?: number;
  /** Maximum sources to consider (default: 20) */
  maxSources?: number;
  stream?: boolean;
  /** Called with incremental report text when stream=true */
  onChunk?: (text: string) => void;
  /** Called with progress updates */
  onProgress?: (event: DeepResearchProgressEvent) => void;
  signal?: AbortSignal;
}

export interface DeepResearchResponse {
  report: string;
  citations: Citation[];
  sourcesUsed: number;
  roundsCompleted: number;
  totalSearchQueries: number;
  llmProvider: string;
  tokensUsed: { input: number; output: number };
  elapsed: number;
  /** Overall research quality score (0-100), computed deterministically */
  qualityScore?: number;
  /** Breakdown of quality score by dimension */
  qualityBreakdown?: Record<string, number>;
  /** Conflicts found between sources during research */
  conflictsFound?: string[];
  /** Conflicts that were resolved by additional research */
  conflictsResolved?: string[];
}

/** Source credibility assessment */
export interface SourceCredibility {
  /** Credibility tier */
  tier: 'official' | 'verified' | 'general';
  /** Star rating (1–3) */
  stars: number;
  /** Human-readable label */
  label: string;
}

// Internal representation of a fetched source
interface FetchedSource {
  result: WebSearchResult;
  content: string;
  relevanceScore: number;
  subQuery: string;
  /** Credibility assessment (populated after fetchSources) */
  credibility?: SourceCredibility;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[Truncated]';
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = (u.pathname || '/').replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  }
}

/** Extract bare hostname (no www) from a URL, or return empty string on failure */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? '';
  }
}

// ---------------------------------------------------------------------------
// Source Credibility
// ---------------------------------------------------------------------------

/** Official TLDs and hostnames that indicate high-authority sources */
const OFFICIAL_TLDS = new Set(['.gov', '.edu', '.mil']);

const OFFICIAL_HOSTNAMES = new Set([
  // Academic / research
  'arxiv.org', 'scholar.google.com', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov',
  'jstor.org', 'nature.com', 'science.org', 'cell.com', 'nejm.org', 'bmj.com',
  'thelancet.com', 'plos.org', 'springer.com', 'elsevier.com',
  // International organisations
  'who.int', 'un.org', 'worldbank.org', 'imf.org', 'oecd.org', 'europa.eu',
  // Official tech documentation
  'docs.python.org', 'developer.mozilla.org', 'nodejs.org', 'rust-lang.org',
  'docs.microsoft.com', 'learn.microsoft.com', 'developer.apple.com',
  'developer.android.com', 'php.net', 'ruby-lang.org', 'golang.org', 'go.dev',
]);

const VERIFIED_HOSTNAMES = new Set([
  // Encyclopaedia / reference
  'wikipedia.org', 'en.wikipedia.org',
  // Reputable news agencies
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com',
  'washingtonpost.com', 'theguardian.com', 'economist.com', 'ft.com',
  // Developer resources
  'github.com', 'stackoverflow.com', 'npmjs.com', 'pypi.org',
  'crates.io', 'docs.rs', 'packagist.org',
  // Official cloud / vendor docs  
  'docs.aws.amazon.com', 'cloud.google.com', 'docs.github.com',
  'azure.microsoft.com', 'registry.terraform.io',
]);

/**
 * Assess the credibility of a source URL.
 *
 * Returns:
 *   - tier: 'official' | 'verified' | 'general'
 *   - stars: 3 / 2 / 1
 *   - label: human-readable string for the synthesis prompt
 */
export function getSourceCredibility(url: string): SourceCredibility {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');

    // Check official TLDs
    for (const tld of OFFICIAL_TLDS) {
      if (hostname.endsWith(tld)) {
        return { tier: 'official', stars: 3, label: 'OFFICIAL SOURCE' };
      }
    }

    // Check known official hostnames
    if (OFFICIAL_HOSTNAMES.has(hostname)) {
      return { tier: 'official', stars: 3, label: 'OFFICIAL SOURCE' };
    }

    // Check known verified hostnames
    if (VERIFIED_HOSTNAMES.has(hostname)) {
      return { tier: 'verified', stars: 2, label: 'VERIFIED' };
    }

    // Everything else
    return { tier: 'general', stars: 1, label: 'UNVERIFIED' };
  } catch {
    return { tier: 'general', stars: 1, label: 'UNVERIFIED' };
  }
}

/** Render stars string for a credibility tier */
export function starsString(stars: number): string {
  if (stars >= 3) return '★★★';
  if (stars >= 2) return '★★☆';
  return '★☆☆';
}

// ---------------------------------------------------------------------------
// LLM call with merged token tracking
// ---------------------------------------------------------------------------

async function callWithTracking(
  config: LLMConfig,
  messages: LLMMessage[],
  tokenAccumulator: { input: number; output: number },
  opts: { stream?: boolean; onChunk?: (text: string) => void; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  const result = await callLLM(config, {
    messages,
    stream: opts.stream,
    onChunk: opts.onChunk,
    signal: opts.signal,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: 0.3,
  });
  tokenAccumulator.input += result.usage.input;
  tokenAccumulator.output += result.usage.output;
  return result.text;
}

// ---------------------------------------------------------------------------
// Step 1: Query Decomposition
// ---------------------------------------------------------------------------

async function decomposeQuery(
  question: string,
  config: LLMConfig,
  tokens: { input: number; output: number },
  signal?: AbortSignal,
): Promise<string[]> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        'You are a research assistant that helps decompose complex questions.',
        'Given a research question, generate 3-5 specific search sub-queries that together would provide comprehensive coverage of the topic.',
        'Each sub-query should target a different aspect of the question.',
        'Output ONLY the sub-queries, one per line, no numbering, no explanation.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Research question: "${question}"\n\nGenerate 3-5 focused search sub-queries:`,
    },
  ];

  const text = await callWithTracking(config, messages, tokens, {
    signal,
    maxTokens: 500,
  });

  // Parse lines, filter empties and numbering
  const queries = text
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^[-*•]\s*/, '')
        .trim(),
    )
    .filter((line) => line.length > 5 && line.length < 300);

  // Ensure the original question is always in the mix
  const all = [question, ...queries];

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of all) {
    const key = q.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(q);
    }
  }

  // Return at most 6 queries (1 original + up to 5 generated)
  return deduped.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Step 2: Parallel Multi-Search
// ---------------------------------------------------------------------------

async function searchAll(
  queries: string[],
  signal?: AbortSignal,
): Promise<Map<string, WebSearchResult[]>> {
  const resultsMap = new Map<string, WebSearchResult[]>();

  const searchWithDDG = async (query: string): Promise<WebSearchResult[]> => {
    try {
      const provider = getSearchProvider('duckduckgo');
      return await provider.searchWeb(query, {
        count: 5,
        signal,
      });
    } catch {
      return [];
    }
  };

  // Run all queries in parallel
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const results = await searchWithDDG(query);
      return { query, results };
    }),
  );

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      resultsMap.set(outcome.value.query, outcome.value.results);
    }
  }

  return resultsMap;
}

// ---------------------------------------------------------------------------
// Step 3: Source Fetching
// ---------------------------------------------------------------------------

async function fetchSources(
  searchResults: Map<string, WebSearchResult[]>,
  maxSources: number,
  signal?: AbortSignal,
): Promise<FetchedSource[]> {
  // Collect top 3 per sub-query, deduplicated by URL
  const seen = new Set<string>();
  const toFetch: Array<{ result: WebSearchResult; subQuery: string }> = [];

  for (const [subQuery, results] of searchResults) {
    let count = 0;
    for (const result of results) {
      if (count >= 3) break;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      toFetch.push({ result, subQuery });
      count++;
      if (toFetch.length >= maxSources) break;
    }
    if (toFetch.length >= maxSources) break;
  }

  // Fetch in parallel batches of 5
  const BATCH_SIZE = 5;
  const fetched: FetchedSource[] = [];

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = toFetch.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map(async ({ result, subQuery }) => {
        try {
          const pr = await peel(result.url, {
            format: 'markdown',
            maxTokens: 2000,
            timeout: 25_000,
            render: false,
          });
          return { result, content: pr.content || '', subQuery };
        } catch (err) {
          return {
            result,
            content: result.snippet || '',
            subQuery,
          };
        }
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const src = outcome.value;
        fetched.push({
          ...src,
          relevanceScore: 0, // filled in step 4
          credibility: getSourceCredibility(src.result.url),
        });
      }
    }
  }

  return fetched;
}

// ---------------------------------------------------------------------------
// Step 4: Relevance Scoring
// ---------------------------------------------------------------------------

function scoreSources(
  sources: FetchedSource[],
  question: string,
): FetchedSource[] {
  const queryTerms = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  return sources.map((source) => {
    const content = source.content;
    if (!content || queryTerms.length === 0) {
      return { ...source, relevanceScore: 0 };
    }

    const blocks = splitIntoBlocks(content);
    if (blocks.length === 0) {
      return { ...source, relevanceScore: 0 };
    }

    const scores = scoreBM25(blocks, queryTerms);

    // Weighted average by block length
    const blockLens = blocks.map((b) => b.raw.length);
    const totalLen = blockLens.reduce((s, l) => s + l, 0) || 1;
    let weightedSum = 0;
    for (let i = 0; i < scores.length; i++) {
      weightedSum += scores[i] * (blockLens[i] / totalLen);
    }

    // Normalize to 0-1 using sigmoid
    const perTerm = weightedSum / (queryTerms.length || 1);
    const normalized = Math.max(0, Math.min(1, 2 / (1 + Math.exp(-perTerm * 8)) - 1));

    return { ...source, relevanceScore: normalized };
  });
}

// ---------------------------------------------------------------------------
// Step 5: Gap Detection
// ---------------------------------------------------------------------------

interface GapDetectionResult {
  hasEnoughInfo: boolean;
  gaps: string[];
  additionalQueries: string[];
  /** Detected source conflicts (optional, from LLM analysis) */
  conflicts?: string[];
  /** Overall confidence level based on source quality */
  confidence?: 'high' | 'medium' | 'low';
  /** Conflicts that were addressed/resolved in subsequent rounds */
  conflictsResolved?: string[];
}

async function detectGaps(
  question: string,
  sources: FetchedSource[],
  config: LLMConfig,
  tokens: { input: number; output: number },
  signal?: AbortSignal,
): Promise<GapDetectionResult> {
  // ── Heuristic pre-checks (no LLM call needed) ──────────────────────────

  if (sources.length >= 3) {
    // Heuristic 1: All sources from the same domain → need diversity
    const domains = sources.map((s) => extractDomain(s.result.url));
    const uniqueDomains = new Set(domains.filter((d) => d.length > 0));
    if (uniqueDomains.size === 1) {
      const soloDomain = [...uniqueDomains][0];
      return {
        hasEnoughInfo: false,
        gaps: [
          `All ${sources.length} sources are from the same domain (${soloDomain}). Diverse sources needed for reliable research.`,
        ],
        additionalQueries: [
          `${question} alternative perspectives`,
          `${question} overview explanation`,
        ],
        conflicts: [],
        confidence: 'low',
      };
    }

    // Heuristic 2: Question implies need for official docs but no official sources found
    const hasOfficialSource = sources.some(
      (s) => (s.credibility || getSourceCredibility(s.result.url)).tier === 'official',
    );
    const questionWantsOfficial =
      /\b(official|documentation|docs|policy|government|authority|academic|standards?|specification|rfc)\b/i.test(
        question,
      );
    if (!hasOfficialSource && questionWantsOfficial) {
      return {
        hasEnoughInfo: false,
        gaps: ['No official or academic sources found. The question requires authoritative documentation.'],
        additionalQueries: [
          `${question} site:.gov OR site:.edu`,
          `${question} official documentation`,
        ],
        conflicts: [],
        confidence: 'low',
      };
    }
  }

  // ── LLM-based gap + conflict detection ─────────────────────────────────

  const topSources = sources
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 8);

  const contextSummary = topSources
    .map((s, i) => {
      const snippet = truncate(s.content || s.result.snippet || '', 800);
      return `[${i + 1}] ${s.result.title}\nURL: ${s.result.url}\n${snippet}`;
    })
    .join('\n\n---\n\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        'You are a research quality assessor. Given a question and the sources collected so far,',
        'determine if there is sufficient information to write a comprehensive answer.',
        'Also detect any factual conflicts between sources.',
        '',
        'Respond in this EXACT JSON format (no markdown, no code blocks):',
        '{',
        '  "hasEnoughInfo": boolean,',
        '  "gaps": ["gap1", "gap2"],',
        '  "additionalQueries": ["query1", "query2"],',
        '  "conflicts": ["Source A says X while Source B says Y"],',
        '  "confidence": "high" | "medium" | "low"',
        '}',
        '',
        '"gaps" should be 0-3 specific aspects not covered by the sources.',
        '"additionalQueries" should be 0-3 new search queries to fill those gaps.',
        '"conflicts" should be 0-3 factual disagreements found between sources.',
        '"confidence": high = consistent official sources, medium = mixed, low = conflicting or poor sources.',
        'If hasEnoughInfo is true, set gaps and additionalQueries to empty arrays.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Question: "${question}"\n\nSources collected:\n\n${contextSummary}\n\nAnalyze coverage, gaps, and conflicts:`,
    },
  ];

  let text: string;
  try {
    text = await callWithTracking(config, messages, tokens, {
      signal,
      maxTokens: 700,
    });
  } catch (err) {
    if (isFreeTierLimitError(err)) throw err;
    // On LLM failure, assume we have enough info
    return { hasEnoughInfo: true, gaps: [], additionalQueries: [], conflicts: [], confidence: 'medium' };
  }

  // Parse JSON response
  try {
    const cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const json = JSON.parse(cleaned) as GapDetectionResult;
    return {
      hasEnoughInfo: Boolean(json.hasEnoughInfo),
      gaps: Array.isArray(json.gaps) ? json.gaps.slice(0, 3) : [],
      additionalQueries: Array.isArray(json.additionalQueries)
        ? json.additionalQueries.slice(0, 3)
        : [],
      conflicts: Array.isArray(json.conflicts) ? json.conflicts.slice(0, 3) : [],
      confidence: ['high', 'medium', 'low'].includes(String(json.confidence))
        ? (json.confidence as 'high' | 'medium' | 'low')
        : 'medium',
    };
  } catch {
    return { hasEnoughInfo: true, gaps: [], additionalQueries: [], conflicts: [], confidence: 'medium' };
  }
}

// ---------------------------------------------------------------------------
// Verification Summary
// ---------------------------------------------------------------------------

interface VerificationSummary {
  conflicts: string[];
  confidence: 'high' | 'medium' | 'low';
  sourceDiversity: boolean;
  officialCount: number;
  verifiedCount: number;
  generalCount: number;
}

/**
 * Compute a verification summary from fetched sources and optional gap detection result.
 * Used to emit the 'verification' progress event before synthesis.
 */
export function computeVerificationSummary(
  sources: FetchedSource[],
  gapResult?: GapDetectionResult,
): VerificationSummary {
  const credibilities = sources.map((s) => s.credibility || getSourceCredibility(s.result.url));

  const officialCount = credibilities.filter((c) => c.tier === 'official').length;
  const verifiedCount = credibilities.filter((c) => c.tier === 'verified').length;
  const generalCount = credibilities.filter((c) => c.tier === 'general').length;
  const total = sources.length || 1;

  // Source diversity: at least 3 unique domains (or all are diverse if < 3 sources)
  const domains = new Set(sources.map((s) => extractDomain(s.result.url)).filter((d) => d.length > 0));
  const sourceDiversity = domains.size >= Math.min(3, total);

  // Compute confidence from source quality
  let confidence: 'high' | 'medium' | 'low';
  if (gapResult?.confidence) {
    confidence = gapResult.confidence;
  } else {
    const highQualityRatio = (officialCount + verifiedCount) / total;
    if (officialCount >= 2 || highQualityRatio >= 0.5) {
      confidence = 'high';
    } else if (verifiedCount >= 1 || highQualityRatio >= 0.25) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
  }

  const conflicts = gapResult?.conflicts ?? [];

  return { conflicts, confidence, sourceDiversity, officialCount, verifiedCount, generalCount };
}

// ---------------------------------------------------------------------------
// Quality Scoring (deterministic, no LLM calls)
// ---------------------------------------------------------------------------

export interface QualityScoreResult {
  score: number;
  breakdown: Record<string, number>;
  suggestions: string[];
}

/**
 * Compute a deterministic 0-100 quality score for the current research state.
 *
 * Dimensions:
 *   - Source diversity   (0-20): unique domains vs total sources
 *   - Credibility mix    (0-25): weighted score from official/verified/general
 *   - Coverage breadth   (0-25): sub-queries with ≥2 relevant sources
 *   - Conflict resolution(0-15): whether conflicts are detected and addressed
 *   - Recency            (0-15): bonus for sources with recent year patterns
 */
export function scoreResearchQuality(
  sources: FetchedSource[],
  _question: string,
  gapResult: GapDetectionResult,
): QualityScoreResult {
  const suggestions: string[] = [];

  if (sources.length === 0) {
    return {
      score: 0,
      breakdown: {
        sourceDiversity: 0,
        credibilityMix: 0,
        coverageBreadth: 0,
        conflictResolution: 0,
        recency: 0,
      },
      suggestions: ['No sources found — try broader search queries.'],
    };
  }

  // ── Source diversity (0-20) ─────────────────────────────────────────────
  const domains = new Set(
    sources.map((s) => extractDomain(s.result.url)).filter((d) => d.length > 0),
  );
  const uniqueDomainCount = domains.size;
  let sourceDiversity: number;
  if (uniqueDomainCount >= 5) {
    sourceDiversity = 20;
  } else if (uniqueDomainCount >= 4) {
    sourceDiversity = 16;
  } else if (uniqueDomainCount >= 3) {
    sourceDiversity = 12;
  } else if (uniqueDomainCount >= 2) {
    sourceDiversity = 8;
  } else {
    sourceDiversity = 5;
  }
  if (uniqueDomainCount < 3) {
    suggestions.push(`Low source diversity (${uniqueDomainCount} unique domains) — search for alternative perspectives.`);
  }

  // ── Credibility mix (0-25) ──────────────────────────────────────────────
  const credibilities = sources.map(
    (s) => s.credibility || getSourceCredibility(s.result.url),
  );
  const officialCount = credibilities.filter((c) => c.tier === 'official').length;
  const verifiedCount = credibilities.filter((c) => c.tier === 'verified').length;
  const generalCount = credibilities.filter((c) => c.tier === 'general').length;

  // Weighted score: official=25, verified=15, general=5, normalize to 0-25
  const rawCredScore =
    officialCount * 25 + verifiedCount * 15 + generalCount * 5;
  const maxPossibleCred = sources.length * 25;
  const credibilityMix = maxPossibleCred > 0
    ? Math.round((rawCredScore / maxPossibleCred) * 25)
    : 0;
  if (officialCount === 0) {
    suggestions.push('No official sources found — search for .gov, .edu, or official documentation.');
  }

  // ── Coverage breadth (0-25) ─────────────────────────────────────────────
  // Group sources by sub-query, count sub-queries with ≥2 relevant sources
  const subQueryMap = new Map<string, number>();
  for (const s of sources) {
    if (s.relevanceScore > 0.3) {
      const key = s.subQuery.toLowerCase();
      subQueryMap.set(key, (subQueryMap.get(key) || 0) + 1);
    }
  }
  const allSubQueries = new Set(sources.map((s) => s.subQuery.toLowerCase()));
  const totalSubQueries = allSubQueries.size || 1;
  const coveredSubQueries = [...subQueryMap.values()].filter((count) => count >= 2).length;
  const coverageBreadth = Math.round((coveredSubQueries / totalSubQueries) * 25);
  const uncoveredCount = totalSubQueries - coveredSubQueries;
  if (uncoveredCount > 0) {
    suggestions.push(`${uncoveredCount} sub-queries lack sufficient relevant sources — consider targeted searches.`);
  }

  // ── Conflict resolution (0-15) ──────────────────────────────────────────
  const conflicts = gapResult.conflicts ?? [];
  const resolvedConflicts = gapResult.conflictsResolved ?? [];
  let conflictResolution: number;
  if (conflicts.length === 0) {
    // No conflicts detected — neutral score
    conflictResolution = 10;
  } else if (resolvedConflicts.length >= conflicts.length) {
    // All conflicts addressed
    conflictResolution = 15;
  } else if (resolvedConflicts.length > 0) {
    // Some conflicts addressed
    conflictResolution = 10;
  } else {
    // Conflicts detected but none addressed
    conflictResolution = 5;
    suggestions.push(
      `${conflicts.length} source conflict(s) remain unresolved — search for fact-checking sources.`,
    );
  }

  // ── Recency (0-15) ─────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const recentYears = new Set([currentYear, currentYear - 1].map(String));
  let recentCount = 0;
  for (const s of sources) {
    const text = (s.content || '') + ' ' + (s.result.title || '') + ' ' + (s.result.snippet || '');
    // Check if any recent year pattern appears
    for (const year of recentYears) {
      if (text.includes(year)) {
        recentCount++;
        break;
      }
    }
  }
  const recentRatio = recentCount / sources.length;
  const recency = Math.round(recentRatio * 15);
  if (recentRatio < 0.3) {
    suggestions.push('Few recent sources found — consider adding date-specific search queries.');
  }

  const score = clamp(
    sourceDiversity + credibilityMix + coverageBreadth + conflictResolution + recency,
    0,
    100,
  );

  return {
    score,
    breakdown: {
      sourceDiversity,
      credibilityMix,
      coverageBreadth,
      conflictResolution,
      recency,
    },
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// Step 7: Synthesis
// ---------------------------------------------------------------------------

async function synthesizeReport(
  question: string,
  sources: FetchedSource[],
  config: LLMConfig,
  tokens: { input: number; output: number },
  opts: { stream?: boolean; onChunk?: (text: string) => void; signal?: AbortSignal },
): Promise<{ report: string; citations: Citation[] }> {
  // Sort by credibility tier first (official > verified > general), then by relevance
  const tierOrder: Record<string, number> = { official: 0, verified: 1, general: 2 };
  const topSources = sources
    .map((s) => ({ ...s, credibility: s.credibility || getSourceCredibility(s.result.url) }))
    .sort((a, b) => {
      const tierDiff = (tierOrder[a.credibility.tier] ?? 2) - (tierOrder[b.credibility.tier] ?? 2);
      if (tierDiff !== 0) return tierDiff;
      return b.relevanceScore - a.relevanceScore;
    })
    .slice(0, 15);

  // Build context with credibility labels
  const contextParts: string[] = [];
  const citations: Citation[] = [];

  topSources.forEach((source, i) => {
    const idx = i + 1;
    const cred = source.credibility;
    const stars = starsString(cred.stars);
    const sanitized = sanitizeForLLM(truncate(source.content || source.result.snippet || '', 3000));
    contextParts.push(
      [
        `SOURCE [${idx}] ${stars}`,
        `Title: ${source.result.title}`,
        `URL: ${source.result.url}`,
        `Credibility: ${cred.label}`,
        '',
        sanitized.content,
      ].join('\n'),
    );
    citations.push({
      index: idx,
      title: source.result.title,
      url: source.result.url,
      snippet: source.result.snippet || '',
      relevanceScore: source.relevanceScore,
    });
  });

  const context = contextParts.join('\n\n---\n\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        'You are a research analyst that writes comprehensive, well-cited reports.',
        'Each source is rated by credibility:',
        '  ★★★ = OFFICIAL SOURCE (government, academic, official docs) — highest authority',
        '  ★★☆ = VERIFIED (reputable news, Wikipedia, major developer platforms)',
        '  ★☆☆ = UNVERIFIED (blogs, forums, unknown sites) — use with caution',
        '',
        'Rules:',
        '  - Prioritize official sources [★★★] over unverified ones [★☆☆]',
        '  - If sources disagree, note the conflict and trust the higher-credibility source',
        '  - Cite every factual claim with [1], [2], etc.',
        '  - Use ONLY the provided sources — do not fabricate information or citations',
        '  - Structure your report with:',
        '      • Executive Summary',
        '      • Key Findings (with citations)',
        '      • Detailed Analysis',
        '      • Conclusion',
        '  - End with: **Confidence: HIGH/MEDIUM/LOW** based on source quality and agreement',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Research question: "${question}"\n\nSources (ranked by credibility):\n\n${context}\n\nWrite a comprehensive research report with citations:`,
    },
  ];

  const report = await callWithTracking(config, messages, tokens, {
    stream: opts.stream,
    onChunk: opts.onChunk,
    signal: opts.signal,
    maxTokens: 4096,
  });

  return { report, citations };
}

// ---------------------------------------------------------------------------
// Main: runDeepResearch
// ---------------------------------------------------------------------------

/**
 * Run a deep research session.
 *
 * Orchestrates query decomposition → multi-search → source fetching →
 * relevance scoring → gap detection → re-search loop → synthesis.
 */
export async function runDeepResearch(req: DeepResearchRequest): Promise<DeepResearchResponse> {
  const startTime = Date.now();

  const question = (req.question || '').trim();
  if (!question) throw new Error('Missing or invalid "question"');
  if (question.length > 5000) throw new Error('Question too long (max 5000 characters)');

  const maxRounds = clamp(req.maxRounds ?? 3, 1, 5);
  const maxSources = clamp(req.maxSources ?? 20, 5, 30);
  const config = req.llm ?? getDefaultLLMConfig();

  const tokens = { input: 0, output: 0 };
  let totalSearchQueries = 0;
  let roundsCompleted = 0;

  const progress = (event: DeepResearchProgressEvent) => {
    req.onProgress?.(event);
  };

  // ── Round tracking ────────────────────────────────────────────────────────
  // All fetched sources across all rounds, deduplicated by URL
  const allSources: FetchedSource[] = [];
  const seenUrls = new Set<string>();
  const usedQueries = new Set<string>();
  let lastGapResult: GapDetectionResult | undefined;
  let lastQualityScore: QualityScoreResult | undefined;

  // Track all conflicts found and resolved across rounds
  const allConflictsFound: string[] = [];
  const allConflictsResolved: string[] = [];

  // ── Round 0..maxRounds ────────────────────────────────────────────────────
  let currentQueries: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    if (req.signal?.aborted) break;

    if (round === 0) {
      // Step 1: Query Decomposition
      progress({ type: 'decomposing', message: 'Decomposing question into sub-queries…', round });

      try {
        currentQueries = await decomposeQuery(question, config, tokens, req.signal);
      } catch (err) {
        if (isFreeTierLimitError(err)) throw err;
        // Fallback: just use the original question
        currentQueries = [question];
      }
    }

    // Filter out already-used queries
    const newQueries = currentQueries.filter((q) => !usedQueries.has(q.toLowerCase()));
    if (newQueries.length === 0) break;

    for (const q of newQueries) {
      usedQueries.add(q.toLowerCase());
    }
    totalSearchQueries += newQueries.length;

    // Step 2: Multi-Search
    progress({
      type: 'searching',
      message: `Searching ${newQueries.length} queries (round ${round + 1})…`,
      round,
      data: { queries: newQueries },
    });

    const searchResults = await searchAll(newQueries, req.signal);

    // Step 3: Source Fetching
    const newResultCount = [...searchResults.values()].reduce((s, r) => s + r.length, 0);
    progress({
      type: 'fetching',
      message: `Fetching content from up to ${Math.min(newResultCount, maxSources)} sources…`,
      round,
    });

    const roundSources = await fetchSources(searchResults, maxSources, req.signal);

    // Deduplicate against already-fetched sources
    const newSources = roundSources.filter((s) => {
      const key = normalizeUrl(s.result.url);
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    });

    // Step 4: Relevance Scoring
    progress({ type: 'scoring', message: 'Scoring source relevance…', round });
    const scored = scoreSources(newSources, question);

    // ── Quality-aware keep/discard logic ──────────────────────────────────
    // Measure quality BEFORE adding new sources (baseline)
    const preScore = allSources.length > 0 && lastGapResult
      ? scoreResearchQuality(allSources, question, lastGapResult).score
      : 0;

    // Tentatively add new sources
    allSources.push(...scored);

    roundsCompleted = round + 1;

    // Don't do gap detection after the last round
    if (round >= maxRounds - 1) break;

    // Step 5: Gap Detection
    progress({
      type: 'gap_check',
      message: 'Checking research coverage for gaps…',
      round,
    });

    let gapResult: GapDetectionResult;
    try {
      gapResult = await detectGaps(question, allSources, config, tokens, req.signal);
    } catch (err) {
      if (isFreeTierLimitError(err)) throw err;
      break;
    }

    // Track conflicts across rounds
    if (gapResult.conflicts && gapResult.conflicts.length > 0) {
      for (const conflict of gapResult.conflicts) {
        if (!allConflictsFound.includes(conflict)) {
          allConflictsFound.push(conflict);
        }
      }
    }

    // Check if previous conflicts are now resolved (new sources address them)
    if (round > 0 && lastGapResult?.conflicts) {
      const previousConflicts = lastGapResult.conflicts;
      const currentConflicts = gapResult.conflicts ?? [];
      for (const prev of previousConflicts) {
        // A conflict is "resolved" if it no longer appears in the current round's conflicts
        if (!currentConflicts.includes(prev) && !allConflictsResolved.includes(prev)) {
          allConflictsResolved.push(prev);
        }
      }
    }

    // Propagate resolved conflicts into gap result for quality scoring
    gapResult.conflictsResolved = [...allConflictsResolved];
    lastGapResult = gapResult;

    // ── Quality scoring after gap detection ───────────────────────────────
    const qualityResult = scoreResearchQuality(allSources, question, gapResult);
    lastQualityScore = qualityResult;

    // Emit quality_check progress event
    progress({
      type: 'quality_check',
      message: `Round ${round + 1} quality: ${qualityResult.score}/100`,
      round,
      data: {
        score: qualityResult.score,
        breakdown: qualityResult.breakdown,
        suggestions: qualityResult.suggestions,
      },
    });

    // Keep/discard: if new sources DECREASED the quality score, discard them
    if (round > 0 && preScore > 0 && qualityResult.score < preScore && scored.length > 0) {
      // Remove the newly added sources
      for (const s of scored) {
        const idx = allSources.indexOf(s);
        if (idx !== -1) {
          allSources.splice(idx, 1);
          // Also remove from seenUrls so they could be re-fetched later if needed
          seenUrls.delete(normalizeUrl(s.result.url));
        }
      }
      // Re-score without the discarded sources and use as the authoritative score
      const reScored = scoreResearchQuality(allSources, question, gapResult);
      lastQualityScore = reScored;
      qualityResult.score = reScored.score;
      qualityResult.breakdown = reScored.breakdown;
      qualityResult.suggestions = reScored.suggestions;
    }

    // Early termination: score >= 85 AND hasEnoughInfo → stop
    if (qualityResult.score >= 85 && gapResult.hasEnoughInfo) {
      break;
    }

    if (gapResult.hasEnoughInfo || gapResult.additionalQueries.length === 0) {
      break;
    }

    // Step 6: Re-Search Loop — combine gap queries with quality suggestions
    // Generate conflict-specific fact-check queries
    const conflictQueries: string[] = [];
    if (gapResult.conflicts && gapResult.conflicts.length > 0) {
      for (const conflict of gapResult.conflicts) {
        // Extract the topic from the conflict description for a fact-check query
        const shortConflict = conflict.length > 80 ? conflict.slice(0, 80) : conflict;
        conflictQueries.push(`${question} fact check ${shortConflict}`);
      }
    }

    // Merge: gap detection queries + quality suggestions + conflict queries (deduplicated)
    const suggestionQueries = qualityResult.suggestions
      .filter((s) => s.includes('\u2014'))
      .map((s) => {
        // Convert suggestion like "No official sources found — search for .gov..." into a search query
        const afterDash = s.split('\u2014')[1]?.trim();
        if (afterDash && afterDash.length > 10 && afterDash.length < 200) {
          return `${question} ${afterDash.replace(/^search for\s*/i, '')}`;
        }
        return '';
      })
      .filter((q) => q.length > 0);

    const allFollowUpQueries = [
      ...gapResult.additionalQueries,
      ...conflictQueries.slice(0, 2),
      ...suggestionQueries.slice(0, 2),
    ];

    // Deduplicate
    const seenQ = new Set<string>();
    const dedupedFollowUp: string[] = [];
    for (const q of allFollowUpQueries) {
      const key = q.toLowerCase();
      if (!seenQ.has(key) && !usedQueries.has(key)) {
        seenQ.add(key);
        dedupedFollowUp.push(q);
      }
    }

    if (dedupedFollowUp.length === 0) break;

    progress({
      type: 'researching',
      message: `Found ${dedupedFollowUp.length} gaps — searching more…`,
      round,
      data: { additionalQueries: dedupedFollowUp },
    });

    currentQueries = dedupedFollowUp;
  }

  // ── Final quality score (compute if not yet available) ────────────────────
  const finalGap: GapDetectionResult = lastGapResult ?? {
    hasEnoughInfo: true,
    gaps: [],
    additionalQueries: [],
    conflicts: [],
    conflictsResolved: [...allConflictsResolved],
  };
  const finalQuality = lastQualityScore ?? scoreResearchQuality(allSources, question, finalGap);

  // Verification summary (emitted before synthesis so streaming clients can show status)
  const verifySummary = computeVerificationSummary(allSources, lastGapResult);
  progress({
    type: 'verification',
    message: `Verification complete — confidence: ${verifySummary.confidence.toUpperCase()}`,
    data: {
      conflicts: verifySummary.conflicts,
      confidence: verifySummary.confidence,
      sourceDiversity: verifySummary.sourceDiversity,
      officialCount: verifySummary.officialCount,
      verifiedCount: verifySummary.verifiedCount,
      generalCount: verifySummary.generalCount,
    },
  });

  // Step 7: Synthesis
  progress({ type: 'synthesizing', message: 'Synthesizing research report…' });

  // Sort all sources by relevance for synthesis
  const sortedSources = allSources.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const { report, citations } = await synthesizeReport(
    question,
    sortedSources,
    config,
    tokens,
    {
      stream: req.stream,
      onChunk: req.onChunk,
      signal: req.signal,
    },
  );

  // Quality floor warning: if score < 40, prepend a warning to the report
  let finalReport = report;
  if (finalQuality.score < 40) {
    const warning = [
      '> \u26A0\uFE0F **Low Research Quality Warning** (Score: ' + finalQuality.score + '/100)',
      '> The sources gathered for this report may be insufficient, lack credibility,',
      '> or have unresolved conflicts. Please verify key claims independently.',
      '',
      '',
    ].join('\n');
    finalReport = warning + report;
  }

  const elapsed = Date.now() - startTime;

  progress({
    type: 'done',
    message: `Research complete in ${(elapsed / 1000).toFixed(1)}s`,
    data: { sourcesUsed: citations.length, roundsCompleted, totalSearchQueries },
  });

  return {
    report: finalReport,
    citations,
    sourcesUsed: citations.length,
    roundsCompleted,
    totalSearchQueries,
    llmProvider: config.provider,
    tokensUsed: tokens,
    elapsed,
    qualityScore: finalQuality.score,
    qualityBreakdown: finalQuality.breakdown,
    conflictsFound: allConflictsFound.length > 0 ? allConflictsFound : undefined,
    conflictsResolved: allConflictsResolved.length > 0 ? allConflictsResolved : undefined,
  };
}
