/**
 * Search provider abstraction
 *
 * WebPeel supports multiple web search backends. DuckDuckGo is the default
 * (no API key required). The StealthSearchProvider uses WebPeel's own stealth
 * browser to scrape multiple search engines in parallel — fully self-hosted,
 * no external API keys required.
 *
 * Provider fallback chain (DDG):
 *   DDG HTTP → DDG Lite → Brave (if key) → StealthSearchProvider (Bing + Ecosia)
 *
 * In production with no API keys configured, getBestSearchProvider() returns
 * StealthSearchProvider since DDG HTTP is often blocked on datacenter IPs.
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { load } from 'cheerio';
import { getStealthBrowser, getRandomUserAgent, applyStealthScripts } from './browser-pool.js';
import { getWebshareProxy, getWebshareProxyUrl } from './proxy-config.js';
import { createLogger } from './logger.js';
import { searchViaSearXNG } from './searxng-provider.js';

const log = createLogger('search');

export type SearchProviderId = 'duckduckgo' | 'brave' | 'stealth' | 'google';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Relevance score (0–1) based on keyword overlap with query. Added by filterRelevantResults. */
  relevanceScore?: number;
  /** Thumbnail/image URL from SearXNG results (img_src or thumbnail field). */
  imageUrl?: string;
}

export interface WebSearchOptions {
  /** Number of results (1-10) */
  count: number;
  /** Provider API key (required for some providers, e.g. Brave) */
  apiKey?: string;
  /** Time filter (DuckDuckGo: df param) */
  tbs?: string;
  /** Country code for geo-targeting */
  country?: string;
  /** Location/region for geo-targeting */
  location?: string;
  /** Optional AbortSignal */
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: SearchProviderId;
  readonly requiresApiKey: boolean;

  searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
}

function decodeHtmlEntities(input: string): string {
  // Cheerio usually decodes entities when using `.text()`, but keep this as a
  // safety net since DuckDuckGo snippets sometimes leak encoded entities.
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const cp = Number.parseInt(String(hex), 16);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return _m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return _m;
      }
    })
    .replace(/&#(\d+);/g, (_m, num) => {
      const cp = Number.parseInt(String(num), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return _m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return _m;
      }
    });
}

function cleanText(
  input: string,
  opts: {
    maxLen: number;
    stripEllipsisPadding?: boolean;
  },
): string {
  let s = decodeHtmlEntities(input);
  s = s.replace(/\s+/g, ' ').trim();

  if (opts.stripEllipsisPadding) {
    // Remove leading/trailing "..." or Unicode ellipsis padding.
    s = s
      .replace(/^(?:\.{3,}|…)+\s*/g, '')
      .replace(/\s*(?:\.{3,}|…)+$/g, '')
      .trim();
  }

  if (s.length > opts.maxLen) s = s.slice(0, opts.maxLen);
  return s;
}

/** Decode DuckDuckGo redirect URLs to their final destination */
function decodeDdgUrl(rawUrl: string): string {
  try {
    // Handle //duckduckgo.com/l/?uddg=... format
    const urlStr = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
    const parsed = new URL(urlStr);

    if (parsed.hostname === 'duckduckgo.com' && parsed.pathname === '/l/') {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return uddg; // Already decoded by URL parser
    }

    // Filter out DDG internal URLs (including ad redirects like /y.js)
    if (parsed.hostname === 'duckduckgo.com') return '';

    return rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
  } catch {
    return rawUrl;
  }
}

/** Returns true if a URL looks like a DuckDuckGo ad or tracking link */
function isDdgAdUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // DDG-internal ad redirect paths
    if (parsed.hostname === 'duckduckgo.com') return true;
    // URLs with known ad tracking query params
    if (
      parsed.searchParams.has('ad_domain') ||
      parsed.searchParams.has('ad_provider') ||
      parsed.searchParams.has('ad_type')
    ) return true;
    return false;
  } catch {
    return false;
  }
}

/** Returns true if a snippet is a DuckDuckGo ad snippet */
function isDdgAdSnippet(snippet: string): boolean {
  return snippet.includes('Ad ·') ||
    snippet.includes('Ad Viewing ads is privacy protected by DuckDuckGo') ||
    snippet.toLowerCase().startsWith('ad ·');
}

// ============================================================
// ProviderStatsTracker
// Tracks per-source success/failure rates over a sliding window.
// Sources that fail >= FAIL_THRESHOLD of the time (min MIN_SAMPLES
// attempts) are "skipped" by the DuckDuckGo fallback chain until
// they start succeeding again.
// ============================================================

interface _AttemptRecord {
  success: boolean;
  ts: number; // timestamp ms — used for decay (failures older than decayMs are ignored)
}

class ProviderStatsTracker {
  private readonly history = new Map<string, _AttemptRecord[]>();
  private readonly windowSize: number;
  private readonly failThreshold: number;
  private readonly minSamples: number;
  private readonly decayMs: number; // failures older than this are ignored

  constructor(windowSize = 10, failThreshold = 0.8, minSamples = 5, decayMs = 5 * 60 * 1000) {
    this.windowSize = windowSize;
    this.failThreshold = failThreshold;
    this.minSamples = minSamples;
    this.decayMs = decayMs; // default 5 minutes: old failures don't permanently lock a provider
  }

  /** Record the outcome of a single attempt for the given source. */
  record(sourceId: string, success: boolean): void {
    const arr = this.history.get(sourceId) ?? [];
    arr.push({ success, ts: Date.now() });
    if (arr.length > this.windowSize) arr.splice(0, arr.length - this.windowSize);
    this.history.set(sourceId, arr);
  }

  /**
   * Returns the failure rate (0–1) for the given source based on
   * the sliding window of recorded attempts.  Returns 0 if fewer
   * than minSamples have been recorded, or if all samples are older
   * than decayMs (failures expire so cold-start blips don't permanently
   * lock out a provider).
   */
  getFailureRate(sourceId: string): number {
    const arr = this.history.get(sourceId);
    if (!arr || arr.length < this.minSamples) return 0;
    const cutoff = Date.now() - this.decayMs;
    const recent = arr.filter(a => a.ts >= cutoff);
    if (recent.length < this.minSamples) return 0; // not enough recent samples
    const failures = recent.filter(a => !a.success).length;
    return failures / recent.length;
  }

  /**
   * Returns true when the source should be skipped (failure rate >=
   * failThreshold with at least minSamples recent recorded).
   */
  shouldSkip(sourceId: string): boolean {
    return this.getFailureRate(sourceId) >= this.failThreshold;
  }

  /** Debug snapshot for a source. */
  getStats(sourceId: string): { attempts: number; failures: number; failureRate: number; skipRecommended: boolean } {
    const arr = this.history.get(sourceId) ?? [];
    const failures = arr.filter(a => !a.success).length;
    const failureRate = arr.length === 0 ? 0 : failures / arr.length;
    return { attempts: arr.length, failures, failureRate, skipRecommended: this.shouldSkip(sourceId) };
  }

  /** Clear history — useful in tests. */
  reset(sourceId?: string): void {
    if (sourceId !== undefined) this.history.delete(sourceId);
    else this.history.clear();
  }
}

/**
 * Module-level singleton. Exported so callers can inspect or reset stats
 * (e.g. in tests) and to log diagnostics.
 */
export const providerStats = new ProviderStatsTracker();

/**
 * Build a combined AbortSignal that fires after `timeoutMs` OR when the
 * optional `parent` signal is aborted — whichever comes first.
 */
function createTimeoutSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const ts = AbortSignal.timeout(timeoutMs);
  if (!parent) return ts;
  // AbortSignal.any available in Node.js ≥ 20.3
  return (AbortSignal as unknown as { any(signals: AbortSignal[]): AbortSignal }).any([parent, ts]);
}

function normalizeUrlForDedupe(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname || '/';
    path = path.replace(/\/+$/g, '');
    return `${host}${path}`;
  } catch {
    return rawUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/g, '');
  }
}

/**
 * Merge results from multiple sources, deduplicating by normalized URL.
 * Preserves original order (first occurrence wins) and limits to maxCount.
 */
export function mergeSearchResults(results: WebSearchResult[], maxCount: number): WebSearchResult[] {
  const seen = new Set<string>();
  const merged: WebSearchResult[] = [];
  for (const r of results) {
    if (merged.length >= maxCount) break;
    const key = normalizeUrlForDedupe(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged;
}

// ============================================================
// Result Relevance Filtering
// Lightweight keyword-overlap scoring — no external deps.
// Applied after fetching raw results to remove completely off-
// topic hits (e.g., a grammar article returned for "used cars").
// ============================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'how', 'what', 'where', 'when', 'why', 'best', 'top', 'most',
  'and', 'or', 'but', 'not', 'do', 'does', 'did', 'be', 'been', 'have', 'has',
  'buy', 'get', 'find', 'about', 'from', 'by', 'its', 'it', 'this', 'that',
  'much', 'very', 'can', 'will', 'would', 'could', 'should', 'per', 'than',
  'some', 'just', 'also', 'more', 'like', 'make', 'any', 'each', 'all', 'my',
  'your', 'our', 'their', 'me', 'us', 'them', 'so', 'if', 'then', 'here',
]);

/**
 * Extract meaningful keywords from a search query by stripping stop words and
 * short tokens.  Returns lowercase tokens, deduped.
 */
function extractKeywords(query: string): string[] {
  const seen = new Set<string>();
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w))
    .filter(w => {
      if (seen.has(w)) return false;
      seen.add(w);
      return true;
    });
}

/**
 * Compute a [0, 1] relevance score for a single result against extracted keywords.
 * Weights: title 0.5, URL 0.3, snippet 0.2.
 */
function scoreResult(result: WebSearchResult, keywords: string[]): number {
  if (keywords.length === 0) return 1;

  const titleLower   = (result.title   || '').toLowerCase();
  const urlLower     = (result.url     || '').toLowerCase();
  const snippetLower = (result.snippet || '').toLowerCase();

  let titleHits   = 0;
  let urlHits     = 0;
  let snippetHits = 0;

  for (const kw of keywords) {
    if (titleLower.includes(kw))   titleHits++;
    if (urlLower.includes(kw))     urlHits++;
    if (snippetLower.includes(kw)) snippetHits++;
  }

  const titleScore   = titleHits   / keywords.length;
  const urlScore     = urlHits     / keywords.length;
  const snippetScore = snippetHits / keywords.length;

  return titleScore * 0.5 + urlScore * 0.3 + snippetScore * 0.2;
}

/**
 * Filter and rank results by relevance to the original query.
 *
 * 1. Extract meaningful keywords from the query (remove stop words).
 * 2. Score each result by keyword overlap with title + URL + snippet.
 * 3. Remove results with zero overlap (completely irrelevant).
 * 4. Sort descending by score, keeping original index as tiebreaker.
 * 5. Attach `relevanceScore` (0–1) to each surviving result.
 *
 * Results without any scores (query produced no keywords) are returned as-is.
 */
export function filterRelevantResults(
  results: WebSearchResult[],
  query: string,
): WebSearchResult[] {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return results; // no keywords to filter on

  const scored = results.map((r, idx) => ({
    result: r,
    score: scoreResult(r, keywords),
    idx,
  }));

  // Drop results with insufficient overlap — require ≥15% keyword match
  // to filter out dictionary/definition pages that match on a single common word
  const minScore = keywords.length >= 3 ? 0.15 : 0.01;
  const relevant = scored.filter(s => s.score >= minScore);

  // Sort by score descending, original order as tiebreaker
  relevant.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx));

  return relevant.map(s => ({
    ...s.result,
    relevanceScore: Math.min(1, s.score),
  }));
}

/**
 * StealthSearchProvider — self-hosted multi-engine search
 *
 * Uses WebPeel's own stealth browser (rebrowser-playwright with anti-detection)
 * to scrape DuckDuckGo, Bing, and Ecosia in parallel. No external API keys
 * required. Results are deduplicated by normalized URL before returning.
 *
 * Timeout: 15s per engine, 20s total.
 */
export class StealthSearchProvider implements SearchProvider {
  readonly id: SearchProviderId = 'stealth';
  readonly requiresApiKey = false;

  /** Validate and normalize a URL; returns null if invalid/non-http or a DDG ad URL */
  private validateUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      // Filter all DuckDuckGo URLs (internal links, ad redirects, etc.)
      if (parsed.hostname === 'duckduckgo.com') return null;
      // Filter URLs with ad tracking query params
      if (
        parsed.searchParams.has('ad_domain') ||
        parsed.searchParams.has('ad_provider') ||
        parsed.searchParams.has('ad_type')
      ) return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  /**
   * Scrape DuckDuckGo HTML endpoint with stealth browser.
   * Uses the warm shared stealth browser (new context per call) for speed.
   */
  private async scrapeDDG(query: string, count: number): Promise<WebSearchResult[]> {
    let ctx: import('playwright').BrowserContext | undefined;
    try {
      const browser = await getStealthBrowser();
      const params = new URLSearchParams({ q: query });
      const url = `https://html.duckduckgo.com/html/?${params.toString()}`;

      const proxy = getWebshareProxy();
      ctx = await browser.newContext({
        userAgent: getRandomUserAgent(),
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
      });

      const page = await ctx.newPage();
      await applyStealthScripts(page);

      await Promise.race([
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DDG stealth timeout')), 15_000),
        ),
      ]);

      await page.waitForTimeout(3000);
      const html = await page.content();
      if (!html) return [];

      const $ = load(html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      $('.result').each((_i, elem) => {
        if (results.length >= count) return;
        const $r = $(elem);
        const titleRaw = $r.find('.result__title').text() || $r.find('.result__a').text();
        const rawUrl = $r.find('.result__a').attr('href') || '';
        const snippetRaw = $r.find('.result__snippet').text();

        const title = cleanText(titleRaw, { maxLen: 200 });
        const snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });
        if (!title || !rawUrl) return;

        // Filter ad snippets
        if (isDdgAdSnippet(snippet)) return;

        // Extract real URL from DDG redirect param
        const finalUrl = decodeDdgUrl(rawUrl);
        if (!finalUrl) return; // filtered out (DDG internal link)

        // Filter ad URLs
        if (isDdgAdUrl(finalUrl)) return;

        const validated = this.validateUrl(finalUrl);
        if (!validated) return;

        const key = normalizeUrlForDedupe(validated);
        if (seen.has(key)) return;
        seen.add(key);

        results.push({ title, url: validated, snippet });
      });

      return results;
    } catch {
      return [];
    } finally {
      await ctx?.close().catch(() => {});
    }
  }

  /**
   * Scrape Bing web search with stealth browser.
   * Selectors: li.b_algo for result containers.
   */
  private async scrapeBing(query: string, count: number): Promise<WebSearchResult[]> {
    let ctx: import('playwright').BrowserContext | undefined;
    try {
      const browser = await getStealthBrowser();
      const params = new URLSearchParams({ q: query });
      const url = `https://www.bing.com/search?${params.toString()}`;

      const proxy = getWebshareProxy();
      ctx = await browser.newContext({
        userAgent: getRandomUserAgent(),
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
      });

      const page = await ctx.newPage();
      await applyStealthScripts(page);

      await Promise.race([
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Bing stealth timeout')), 15_000),
        ),
      ]);

      await page.waitForTimeout(2000);
      const html = await page.content();
      if (!html) return [];

      const $ = load(html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      $('li.b_algo').each((_i, elem) => {
        if (results.length >= count) return;
        const $r = $(elem);

        // Title + URL from h2 > a
        const $a = $r.find('h2 > a');
        const title = cleanText($a.text(), { maxLen: 200 });
        const rawUrl = $a.attr('href') || '';
        if (!title || !rawUrl) return;

        // Decode Bing redirect URLs: https://www.bing.com/ck/a?...&u=a1<base64url>&ntb=1
        // The `u` param is a base64url-encoded real URL prefixed with "a1"
        let finalUrl = rawUrl;
        try {
          const bingUrl = new URL(rawUrl);
          if (bingUrl.hostname.endsWith('bing.com') && bingUrl.pathname.startsWith('/ck/')) {
            const u = bingUrl.searchParams.get('u');
            if (u && u.startsWith('a1')) {
              const decoded = Buffer.from(u.slice(2), 'base64url').toString('utf-8');
              if (decoded.startsWith('http')) finalUrl = decoded;
            }
          }
        } catch { /* use raw */ }

        const validated = this.validateUrl(finalUrl);
        if (!validated) return;

        // Snippet: prefer .b_lineclamp2 > p, then div.b_caption > p
        const snippetRaw =
          $r.find('.b_lineclamp2 p').first().text() ||
          $r.find('div.b_caption > p').first().text() ||
          $r.find('.b_caption').text();
        const snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });

        const key = normalizeUrlForDedupe(validated);
        if (seen.has(key)) return;
        seen.add(key);

        results.push({ title, url: validated, snippet });
      });

      return results;
    } catch {
      return [];
    } finally {
      await ctx?.close().catch(() => {});
    }
  }

  /**
   * Scrape Ecosia web search with stealth browser.
   * Uses the warm shared stealth browser (new context per call) for speed.
   * Tries multiple selector patterns since Ecosia updates their HTML frequently.
   */
  private async scrapeEcosia(query: string, count: number): Promise<WebSearchResult[]> {
    let ctx: import('playwright').BrowserContext | undefined;
    try {
      const browser = await getStealthBrowser();
      const params = new URLSearchParams({ q: query });
      const url = `https://www.ecosia.org/search?${params.toString()}`;

      const proxy = getWebshareProxy();
      ctx = await browser.newContext({
        userAgent: getRandomUserAgent(),
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
      });

      const page = await ctx.newPage();
      await applyStealthScripts(page);

      await Promise.race([
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Ecosia stealth timeout')), 15_000),
        ),
      ]);

      await page.waitForTimeout(2000);
      const html = await page.content();
      if (!html) return [];

      const $ = load(html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      // Try multiple container selectors — Ecosia changes HTML periodically
      const containers = $('article.result, .result, [data-test-id="result"]');

      containers.each((_i, elem) => {
        if (results.length >= count) return;
        const $r = $(elem);

        // Title + URL: try multiple patterns
        let $a = $r.find('a.result-title').first();
        if (!$a.length) $a = $r.find('h2 > a').first();
        if (!$a.length) $a = $r.find('a[href]').first();

        const title = cleanText($a.text(), { maxLen: 200 });
        const rawUrl = $a.attr('href') || '';
        if (!title || !rawUrl) return;

        const validated = this.validateUrl(rawUrl);
        if (!validated) return;

        // Snippet: try multiple patterns
        const snippetRaw =
          $r.find('p.result-snippet').first().text() ||
          $r.find('.snippet').first().text() ||
          $r.find('p').first().text();
        const snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });

        const key = normalizeUrlForDedupe(validated);
        if (seen.has(key)) return;
        seen.add(key);

        results.push({ title, url: validated, snippet });
      });

      return results;
    } catch {
      return [];
    } finally {
      await ctx?.close().catch(() => {});
    }
  }

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count } = options;

    // Launch all three engines in parallel; ignore individual engine failures
    const [ddgOutcome, bingOutcome, ecosiaOutcome] = await Promise.allSettled([
      this.scrapeDDG(query, count),
      this.scrapeBing(query, count),
      this.scrapeEcosia(query, count),
    ]);

    const allResults: WebSearchResult[] = [];
    for (const outcome of [ddgOutcome, bingOutcome, ecosiaOutcome]) {
      if (outcome.status === 'fulfilled') {
        allResults.push(...outcome.value);
      }
    }

    // Deduplicate across engines by normalized URL
    const seen = new Set<string>();
    const deduped: WebSearchResult[] = [];
    for (const r of allResults) {
      const key = normalizeUrlForDedupe(r.url);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
      if (deduped.length >= count) break;
    }

    // Relevance filtering: remove completely off-topic results, score the rest
    const filtered = filterRelevantResults(deduped, query);
    // Respect the original count limit after filtering
    return filtered.slice(0, count);
  }
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly id: SearchProviderId = 'duckduckgo';
  readonly requiresApiKey = false;

  private buildQueryAttempts(originalQuery: string): string[] {
    const q = originalQuery.trim();
    if (!q) return [];

    const attempts: string[] = [];

    // Required retry strategy order:
    // 1) original query
    // 2) keywords-only (strip question words, articles, prepositions)
    // 3) quoted query
    // 4) query site:*
    attempts.push(q);

    // For long queries (>5 words), extract just the meaningful keywords
    // "how much does a used 2023 Tesla Model 3 cost per month" → "2023 Tesla Model 3 cost month"
    const words = q.split(/\s+/);
    if (words.length > 5) {
      const keywordsOnly = words
        .filter(w => !STOP_WORDS.has(w.toLowerCase()) && w.length >= 2)
        .join(' ');
      if (keywordsOnly && keywordsOnly !== q) {
        attempts.push(keywordsOnly);
      }
    }

    if (!/^".*"$/.test(q)) attempts.push(`"${q}"`);
    attempts.push(`${q} site:*`);

    // Single-word queries are disproportionately likely to return 0 results on
    // the DDG HTML endpoint (e.g. "openai" vs "open ai"). When the first three
    // attempts fail, try a few light-touch strategies that tend to coax the
    // parser into returning web results.
    const isSingleWord = !/\s/.test(q);
    const looksLikeUrlOrDomain = /[./]/.test(q) || /^https?:/i.test(q);

    if (isSingleWord && !looksLikeUrlOrDomain) {
      // Try splitting a common suffix (e.g. openai -> open ai)
      if (/^[a-z]{5,}ai$/i.test(q)) {
        attempts.push(`${q.slice(0, -2)} ai`);
      }

      // Common suffixes that often return at least the official domain
      attempts.push(`${q}.com`);
      attempts.push(`site:${q}.com`);
      attempts.push(`${q} website`);
    }

    // De-dupe attempts (case-insensitive)
    const seen = new Set<string>();
    return attempts
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s) => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private buildSearchUrl(query: string, options: WebSearchOptions): string {
    const { tbs, country, location } = options;

    const params = new URLSearchParams();
    params.set('q', query);

    // DuckDuckGo HTML endpoint supports some filtering
    if (tbs) {
      // DDG uses `df` for time filtering on html endpoint
      params.set('df', tbs);
    }

    if (country || location) {
      const region = (country || location || '').toLowerCase();
      if (region) params.set('kl', region);
    }

    return `https://html.duckduckgo.com/html/?${params.toString()}`;
  }

  private async searchOnce(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, signal } = options;

    const searchUrl = this.buildSearchUrl(query, options);

    // Use realistic browser headers to avoid DDG bot detection on datacenter IPs
    // Route through residential proxy when available (datacenter IPs are blocked)
    const proxyUrl = getWebshareProxyUrl();
    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://duckduckgo.com/',
    };

    // Try direct first, then proxy as fallback.
    // Webshare backbone IPs are blocked by DDG (returns empty results).
    // Render datacenter IPs work intermittently — direct has better odds.
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    let html: string;
    // let usedProxy = false;

    // Attempt 1: Direct fetch (no proxy)
    try {
      response = await undiciFetch(searchUrl, { headers: baseHeaders, signal });
      html = response.ok ? await response.text() : '';
    } catch (directErr) {
      log.debug('DDG direct fetch failed:', directErr instanceof Error ? directErr.message : directErr);
      html = '';
    }

    // Check if direct returned actual results (not empty/CAPTCHA)
    const hasResults = html.includes('class="result"') || html.includes('class="result ');
    if (!hasResults && proxyUrl) {
      // Attempt 2: Proxy fallback
      log.debug('DDG direct returned no results, trying proxy...');
      try {
        // usedProxy = true;
        const dispatcher = new ProxyAgent(proxyUrl);
        response = await undiciFetch(searchUrl, { headers: baseHeaders, signal, dispatcher } as any);
        if (response.ok) html = await response.text();
      } catch (proxyErr) {
        log.debug('DDG proxy also failed:', proxyErr instanceof Error ? proxyErr.message : proxyErr);
      }
    }

    const $ = load(html);

    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    $('.result').each((_i, elem) => {
      if (results.length >= count) return;

      const $result = $(elem);

      // Be resilient to markup variations: title can be in .result__title or
      // directly on the anchor.
      const titleRaw = $result.find('.result__title').text() || $result.find('.result__a').text();
      const rawUrl = $result.find('.result__a').attr('href') || '';
      const snippetRaw = $result.find('.result__snippet').text();

      let title = cleanText(titleRaw, { maxLen: 200 });
      let snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });

      if (!title || !rawUrl) return;

      // Filter ad snippets (DuckDuckGo injects ad labels into snippets)
      if (isDdgAdSnippet(snippet)) return;

      // Extract actual URL from DuckDuckGo redirect; filter DDG internal/ad URLs
      const decoded = decodeDdgUrl(rawUrl);
      if (!decoded) return; // filtered out (DDG internal link or ad redirect)

      // Filter ad URLs
      if (isDdgAdUrl(decoded)) return;

      // SECURITY: Validate and sanitize results — only allow HTTP/HTTPS URLs
      let url: string;
      try {
        const parsed = new URL(decoded);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return;
        }
        url = parsed.href;
      } catch {
        return;
      }

      // Deduplicate by normalized URL (strip query params, www, trailing slash)
      const dedupeKey = normalizeUrlForDedupe(url);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      results.push({ title, url, snippet });
    });

    return results;
  }

  /**
   * Fallback: DuckDuckGo Lite endpoint. Different HTML structure, sometimes
   * works when the main HTML endpoint is temporarily blocked on datacenter IPs.
   */
  private async searchLite(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, signal } = options;

    const params = new URLSearchParams();
    params.set('q', query);

    const liteProxyUrl = getWebshareProxyUrl();
    const liteHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://lite.duckduckgo.com/',
    };
    const liteUrl = `https://lite.duckduckgo.com/lite/?${params.toString()}`;
    // Direct first, proxy fallback (same reasoning as searchOnce — Webshare IPs blocked by DDG)
    let html = '';
    try {
      const resp = await undiciFetch(liteUrl, { headers: liteHeaders, signal });
      if (resp.ok) html = await resp.text();
    } catch { /* direct failed */ }

    if (!html.includes('result-link') && liteProxyUrl) {
      try {
        const dispatcher = new ProxyAgent(liteProxyUrl);
        const resp = await undiciFetch(liteUrl, { headers: liteHeaders, signal, dispatcher } as any);
        if (resp.ok) html = await resp.text();
      } catch { /* proxy also failed */ }
    }

    if (!html) return [];
    const $ = load(html);

    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    // DDG Lite uses a table-based layout with class="result-link" for links
    // and class="result-snippet" for snippets
    $('a.result-link').each((_i, elem) => {
      if (results.length >= count) return;

      const $a = $(elem);
      const title = cleanText($a.text(), { maxLen: 200 });
      let url = $a.attr('href') || '';

      if (!title || !url) return;

      // Extract actual URL from DDG redirect; filter DDG internal/ad URLs
      const decoded = decodeDdgUrl(url);
      if (!decoded) return; // filtered out (DDG internal link or ad redirect)

      // Validate URL
      try {
        const parsed = new URL(decoded);
        if (!['http:', 'https:'].includes(parsed.protocol)) return;
        url = parsed.href;
      } catch { return; }

      const dedupeKey = normalizeUrlForDedupe(url);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      // Lite snippets are in the next <td> with class result-snippet
      const snippet = cleanText(
        $a.closest('tr').next('tr').find('.result-snippet').text(),
        { maxLen: 500, stripEllipsisPadding: true },
      );

      results.push({ title, url, snippet });
    });

    return results;
  }

  /**
   * HTTP-only Bing scraping via undici + cheerio. No browser required.
   * Routes through Webshare proxy (proxy first, direct fallback).
   * Tracks stats via providerStats('bing-http').
   */
  // @ts-expect-error Disabled Stage 3.5 — kept for future re-enablement
  private async _searchBingHttp(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, signal } = options;

    const bingRate = providerStats.getFailureRate('bing-http');
    const timeoutMs = bingRate > 0.5 ? 3_000 : 8_000;
    const bingSignal = createTimeoutSignal(timeoutMs, signal);

    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    const proxyUrl = getWebshareProxyUrl();
    let response: Awaited<ReturnType<typeof undiciFetch>>;

    try {
      if (proxyUrl) {
        try {
          const dispatcher = new ProxyAgent(proxyUrl);
          response = await undiciFetch(url, { headers, signal: bingSignal, dispatcher } as any);
        } catch (proxyErr) {
          log.debug('Bing HTTP proxy failed, falling back to direct:', proxyErr instanceof Error ? proxyErr.message : proxyErr);
          response = await undiciFetch(url, { headers, signal: bingSignal });
        }
      } else {
        response = await undiciFetch(url, { headers, signal: bingSignal });
      }

      if (!response.ok) {
        providerStats.record('bing-http', false);
        return [];
      }

      const html = await response.text();
      const $ = load(html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      // Parse Bing organic results; skip ad containers
      $('li.b_algo').each((_i, elem) => {
        if (results.length >= count) return;
        const $r = $(elem);

        // Skip if inside a .b_ad block or is itself an ad container
        if ($r.hasClass('b_ad') || $r.closest('.b_ad').length > 0) return;

        const $a = $r.find('h2 > a').first();
        const title = cleanText($a.text(), { maxLen: 200 });
        const rawUrl = $a.attr('href') || '';
        if (!title || !rawUrl) return;

        // Decode Bing redirect URLs:
        //   Relative:  /ck/a?!&&p=...&u=a1<base64url>&ntb=1
        //   Absolute:  https://www.bing.com/ck/a?...&u=a1<base64url>&ntb=1
        let finalUrl = rawUrl;
        try {
          const base = rawUrl.startsWith('/') ? `https://www.bing.com${rawUrl}` : rawUrl;
          const ckUrl = new URL(base);
          if (ckUrl.hostname.endsWith('bing.com') && ckUrl.pathname.startsWith('/ck/')) {
            const u = ckUrl.searchParams.get('u');
            if (u && u.startsWith('a1')) {
              const decoded = Buffer.from(u.slice(2), 'base64url').toString('utf-8');
              if (decoded.startsWith('http')) finalUrl = decoded;
            }
          }
        } catch { /* use rawUrl as-is */ }

        // Validate: HTTP/HTTPS only
        try {
          const parsed = new URL(finalUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) return;
          finalUrl = parsed.href;
        } catch { return; }

        const key = normalizeUrlForDedupe(finalUrl);
        if (seen.has(key)) return;
        seen.add(key);

        const snippetRaw =
          $r.find('.b_caption p').first().text() ||
          $r.find('.b_caption').first().text();
        const snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });

        results.push({ title, url: finalUrl, snippet });
      });

      providerStats.record('bing-http', results.length > 0);
      return results;
    } catch (e) {
      log.debug('Bing HTTP search failed:', e instanceof Error ? e.message : e);
      providerStats.record('bing-http', false);
      return [];
    }
  }

  /**
   * HTTP-only Google scraping via undici + cheerio. No browser required.
   * Routes through Webshare proxy (proxy first, direct fallback).
   * Sends CONSENT cookie to bypass Google consent page.
   * Tracks stats via providerStats('google-http').
   */
  // @ts-expect-error Disabled Stage 3.5 — kept for future re-enablement
  private async _searchGoogleHttp(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, signal } = options;

    const googleRate = providerStats.getFailureRate('google-http');
    const timeoutMs = googleRate > 0.5 ? 3_000 : 8_000;
    const googleSignal = createTimeoutSignal(timeoutMs, signal);

    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      // Skip Google consent/cookie wall
      'Cookie': 'CONSENT=YES+; SOCS=CAESEwgDEgk0OTg3ODQ2NzMaAmVuIAEaBgiA0LqmBg',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    const proxyUrl = getWebshareProxyUrl();
    let response: Awaited<ReturnType<typeof undiciFetch>>;

    try {
      if (proxyUrl) {
        try {
          const dispatcher = new ProxyAgent(proxyUrl);
          response = await undiciFetch(url, { headers, signal: googleSignal, dispatcher } as any);
        } catch (proxyErr) {
          log.debug('Google HTTP proxy failed, falling back to direct:', proxyErr instanceof Error ? proxyErr.message : proxyErr);
          response = await undiciFetch(url, { headers, signal: googleSignal });
        }
      } else {
        response = await undiciFetch(url, { headers, signal: googleSignal });
      }

      if (!response.ok) {
        providerStats.record('google-http', false);
        return [];
      }

      const html = await response.text();
      const $ = load(html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      // Google organic results live in div.g blocks.
      // Skip ad blocks (data-text-ad attr), People Also Ask, and related searches.
      $('div.g').each((_i, elem) => {
        if (results.length >= count) return;
        const $r = $(elem);

        // Skip ad containers (data-text-ad may be on div.g itself or on a descendant)
        if ($r.attr('data-text-ad') !== undefined || $r.find('[data-text-ad]').length > 0) return;
        if ($r.closest('.commercial-unit-desktop-top, .ads-ad').length > 0) return;

        const $h3 = $r.find('h3').first();
        if (!$h3.length) return;

        // Find a valid external link (starts with http, not a Google domain)
        const $a = $r.find('a[href]').filter((_j, el) => {
          const href = $(el).attr('href') || '';
          return href.startsWith('http') && !href.includes('google.com/');
        }).first();

        if (!$a.length) return;

        const href = $a.attr('href') || '';

        // Validate URL
        let finalUrl: string;
        try {
          const parsed = new URL(href);
          if (!['http:', 'https:'].includes(parsed.protocol)) return;
          if (parsed.hostname.includes('google.com')) return;
          finalUrl = parsed.href;
        } catch { return; }

        const key = normalizeUrlForDedupe(finalUrl);
        if (seen.has(key)) return;
        seen.add(key);

        const title = cleanText($h3.text(), { maxLen: 200 });
        if (!title) return;

        // Snippet: try multiple known Google snippet CSS classes/attrs
        const snippetRaw =
          $r.find('.VwiC3b').first().text() ||
          $r.find('[data-sncf]').first().text() ||
          $r.find('[style*="-webkit-line-clamp"]').first().text() ||
          $r.find('.st').first().text() ||
          '';
        const snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });

        results.push({ title, url: finalUrl, snippet });
      });

      providerStats.record('google-http', results.length > 0);
      return results;
    } catch (e) {
      log.debug('Google HTTP search failed:', e instanceof Error ? e.message : e);
      providerStats.record('google-http', false);
      return [];
    }
  }

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const attempts = this.buildQueryAttempts(query);

    // -----------------------------------------------------------
    // Stage 0: SearXNG (self-hosted, residential IP — highest reliability)
    // Uses Mac Mini running SearXNG exposed via Cloudflare Tunnel.
    // Aggregates Google, Bing, Brave, Startpage — 30-40 results typical.
    // Env: SEARXNG_URL=https://search.webpeel.dev
    // -----------------------------------------------------------
    if (process.env.SEARXNG_URL) {
      try {
        const searxResults = await searchViaSearXNG(query, {
          count: options.count ?? 10,
          signal: options.signal,
          timeoutMs: 12000,
        });
        if (searxResults.length > 0) {
          providerStats.record('searxng', true);
          log.debug(`source=searxng returned ${searxResults.length} results`);
          // Map SearXNG results to WebSearchResult (description → snippet, imageUrl passthrough)
          const mapped: WebSearchResult[] = searxResults.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.description ?? '',
            imageUrl: r.imageUrl,
          }));
          const filtered = filterRelevantResults(mapped, query);
          return filtered.length > 0 ? filtered : mapped;
        }
        providerStats.record('searxng', false);
        log.debug('SearXNG returned 0 results, falling through to DDG');
      } catch (e) {
        providerStats.record('searxng', false);
        log.debug('SearXNG failed:', e instanceof Error ? e.message : e);
      }
    }

    // -----------------------------------------------------------
    // Stage 1: DDG HTTP
    // Skip entirely if the source has a ≥80% failure rate over the
    // last 10 attempts.  When elevated-but-not-skipped, cap the per-
    // request timeout at 2 s instead of the default 8 s so we fail
    // fast and get to a working fallback sooner.
    // -----------------------------------------------------------
    const ddgHttpRate = providerStats.getFailureRate('ddg-http');
    const skipDdgHttp = providerStats.shouldSkip('ddg-http');

    if (skipDdgHttp) {
      log.debug(`DDG HTTP skipped (failure rate ${Math.round(ddgHttpRate * 100)}% ≥ 80%)`);
    } else {
      const ddgTimeoutMs = ddgHttpRate > 0.5 ? 2_000 : 8_000;
      const ddgSignal = createTimeoutSignal(ddgTimeoutMs, options.signal);
      const ddgOptions: WebSearchOptions = { ...options, signal: ddgSignal };

      let ddgSucceeded = false;
      for (const q of attempts) {
        try {
          const results = await this.searchOnce(q, ddgOptions);
          if (results.length > 0) {
            providerStats.record('ddg-http', true);
            log.debug(`source=ddg-http returned ${results.length} results` +
              (ddgTimeoutMs < 8_000 ? ` (fast-timeout ${ddgTimeoutMs}ms)` : ''),
            );
            // Apply relevance filtering before returning
            const filtered = filterRelevantResults(results, query);
            return filtered.length > 0 ? filtered : results; // fallback to unfiltered if all removed
          }
          ddgSucceeded = true; // connected OK, just 0 results
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log.debug('DDG HTTP failed:', msg);
          break;
        }
      }
      // Record outcome: connected but empty = failure for our purposes
      providerStats.record('ddg-http', ddgSucceeded ? false : false);
      // (both paths are failures — we only record true above on a live hit)
    }

    // -----------------------------------------------------------
    // Stage 2: DDG Lite
    // Same skip/fast-timeout logic as DDG HTTP.
    // -----------------------------------------------------------
    const ddgLiteRate = providerStats.getFailureRate('ddg-lite');
    const skipDdgLite = providerStats.shouldSkip('ddg-lite');

    if (skipDdgLite) {
      log.debug(`DDG Lite skipped (failure rate ${Math.round(ddgLiteRate * 100)}% ≥ 80%)`);
    } else {
      log.debug('DDG returned 0 results, trying DDG Lite...');
      const liteTimeoutMs = ddgLiteRate > 0.5 ? 2_000 : 8_000;
      const liteSignal = createTimeoutSignal(liteTimeoutMs, options.signal);
      try {
        const liteResults = await this.searchLite(query, { ...options, signal: liteSignal });
        if (liteResults.length > 0) {
          providerStats.record('ddg-lite', true);
          log.debug(`source=ddg-lite returned ${liteResults.length} results` +
            (liteTimeoutMs < 8_000 ? ` (fast-timeout ${liteTimeoutMs}ms)` : ''));
          // Apply relevance filtering before returning
          const filteredLite = filterRelevantResults(liteResults, query);
          return filteredLite.length > 0 ? filteredLite : liteResults;
        }
        providerStats.record('ddg-lite', false);
        log.debug('DDG Lite also returned 0 results');
      } catch (e) {
        providerStats.record('ddg-lite', false);
        log.debug('DDG Lite failed:', e instanceof Error ? e.message : e);
      }
    }

    // -----------------------------------------------------------
    // Stage 3: Brave Search API (BYOK — instant if key configured)
    // -----------------------------------------------------------
    const braveKey = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
    if (braveKey) {
      try {
        const braveProvider = new BraveSearchProvider();
        const braveResults = await braveProvider.searchWeb(query, { ...options, apiKey: braveKey });
        if (braveResults.length > 0) {
          log.debug(`source=brave returned ${braveResults.length} results`);
          return braveResults;
        }
      } catch (e) {
        log.debug('Brave search failed:', e instanceof Error ? e.message : e);
      }
    }

    // -----------------------------------------------------------
    // Stage 3.5: HTTP-based Bing + Google (no browser, no API key)
    // DISABLED: Both Bing and Google detect non-browser HTTP clients and
    // serve different/irrelevant content (dictionary pages, random sites).
    // The scrapers are built (searchBingHttp, searchGoogleHttp) but need
    // further work on request fingerprinting to get real results.
    // TODO: Re-enable when fingerprinting is improved.
    // -----------------------------------------------------------
    // const skipBingHttp = providerStats.shouldSkip('bing-http');
    // const skipGoogleHttp = providerStats.shouldSkip('google-http');
    // if (!skipBingHttp || !skipGoogleHttp) { ... }

    // -----------------------------------------------------------
    // Stage 4: Stealth multi-engine (DDG + Bing + Ecosia in parallel)
    // Bypasses bot-detection on datacenter IPs. This is the reliable
    // last resort — but it spins up a browser so it takes a few seconds.
    // DISABLED on memory-constrained servers (512MB) — Playwright OOM kills.
    // Set NO_BROWSER_SEARCH=1 to skip this stage entirely.
    // -----------------------------------------------------------
    if (!process.env.NO_BROWSER_SEARCH) {
      log.debug('Trying stealth browser search (DDG + Bing + Ecosia)...');
      try {
        const stealthProvider = new StealthSearchProvider();
        // StealthSearchProvider already applies filterRelevantResults internally.
        const stealthResults = await stealthProvider.searchWeb(query, options);
        if (stealthResults.length > 0) {
          log.debug(`source=stealth returned ${stealthResults.length} results`);
          return stealthResults;
        }
        log.debug('Stealth search returned 0 results');
      } catch (e) {
        log.debug('Stealth search failed:', e instanceof Error ? e.message : e);
      }
    } else {
      log.debug('Stealth browser search skipped (NO_BROWSER_SEARCH=1)');
    }

    return [];
  }

  /**
   * Exposed for testing: score and filter a pre-fetched result list against a query.
   * Equivalent to calling filterRelevantResults() directly.
   */
  filterResults(results: WebSearchResult[], query: string): WebSearchResult[] {
    return filterRelevantResults(results, query);
  }
}

export class BraveSearchProvider implements SearchProvider {
  readonly id: SearchProviderId = 'brave';
  readonly requiresApiKey = true;

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, apiKey, signal } = options;

    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Brave Search requires an API key');
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(count, 1), 10)));

    const response = await undiciFetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Brave Search failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
    }

    const data = await response.json() as any;
    const resultsArray: any[] = data?.web?.results;

    if (!Array.isArray(resultsArray)) {
      return [];
    }

    const results: WebSearchResult[] = [];

    for (const r of resultsArray) {
      if (results.length >= count) break;
      const title = typeof r?.title === 'string' ? r.title.trim() : '';
      const rawUrl = typeof r?.url === 'string' ? r.url.trim() : '';
      const snippet = typeof r?.description === 'string'
        ? r.description.trim()
        : typeof r?.snippet === 'string'
          ? r.snippet.trim()
          : '';

      if (!title || !rawUrl) continue;

      // SECURITY: Validate URL protocol
      try {
        const parsed = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      } catch {
        continue;
      }

      results.push({
        title: title.slice(0, 200),
        url: rawUrl,
        snippet: snippet.slice(0, 500),
      });
    }

    return results;
  }
}

/**
 * GoogleSearchProvider — Google Search via stealth browser or Custom Search JSON API
 *
 * Two modes:
 *   1. Custom Search JSON API (BYOK): set GOOGLE_SEARCH_KEY + GOOGLE_SEARCH_CX env vars.
 *      Reliable, structured, 100 free queries/day. Works from any IP.
 *   2. Stealth browser scraping (no API key): uses playwright-extra stealth plugin to
 *      scrape google.com/search directly. Works from datacenter IPs where DDG/Bing/Ecosia
 *      are blocked. Gracefully returns [] if Playwright is unavailable.
 *
 * Docs: https://developers.google.com/custom-search/v1/overview
 */
export class GoogleSearchProvider implements SearchProvider {
  readonly id: SearchProviderId = 'google';
  /**
   * requiresApiKey is false: works without API keys via stealth browser fallback.
   */
  readonly requiresApiKey = false;

  /**
   * Map standard freshness values to Google's dateRestrict format.
   * Google dateRestrict: d[n]=past n days, w[n]=past n weeks,
   *                      m[n]=past n months, y[n]=past n years.
   */
  private mapFreshnessToDateRestrict(tbs: string | undefined): string | undefined {
    if (!tbs) return undefined;
    const map: Record<string, string> = {
      pd: 'd1',
      pw: 'w1',
      pm: 'm1',
      py: 'y1',
    };
    return map[tbs];
  }

  /** Validate URL; returns null if invalid/non-http or a DDG ad URL */
  private validateUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      // Filter all DuckDuckGo URLs (internal links, ad redirects, etc.)
      if (parsed.hostname === 'duckduckgo.com') return null;
      // Filter URLs with ad tracking query params
      if (
        parsed.searchParams.has('ad_domain') ||
        parsed.searchParams.has('ad_provider') ||
        parsed.searchParams.has('ad_type')
      ) return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  /**
   * Stealth browser scrape of google.com/search.
   * Used when no Custom Search API key is configured.
   * Strategy A: peel() with stealth rendering (consistent with StealthSearchProvider).
   * Strategy B: direct playwright-extra launch (if peel returns no results).
   */
  private async scrapeGoogleStealth(query: string, count: number): Promise<WebSearchResult[]> {
    // Strategy A: peel() + cheerio parse
    try {
      const { peel } = await import('../index.js');
      const params = new URLSearchParams({
        q: query,
        num: String(Math.min(count * 2, 20)),
        hl: 'en',
        gl: 'us',
      });
      const url = `https://www.google.com/search?${params.toString()}`;

      const result = await Promise.race([
        peel(url, { render: true, stealth: true, format: 'html', wait: 3000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Google stealth peel timeout')), 20_000),
        ),
      ]);

      const html = (result as any).content || '';
      if (html) {
        const $ = load(html);
        const results: WebSearchResult[] = [];
        const seen = new Set<string>();

        // Multiple selector patterns for resilience across Google HTML variants
        const resultBlocks = $('#search .g, #rso .g, [data-hveid] .g');

        resultBlocks.each((_i, elem) => {
          if (results.length >= count) return;
          const $r = $(elem);
          const $a = $r.find('a[href^="http"]').first();
          const $h3 = $r.find('h3').first();
          if (!$a.length || !$h3.length) return;

          const href = $a.attr('href') || '';
          if (
            href.includes('google.com/') ||
            href.includes('accounts.google') ||
            href.includes('/aclk') ||
            href.startsWith('#')
          ) return;

          const validated = this.validateUrl(href);
          if (!validated) return;

          const key = normalizeUrlForDedupe(validated);
          if (seen.has(key)) return;
          seen.add(key);

          const title = cleanText($h3.text(), { maxLen: 200 });
          if (!title) return;

          const snippetText =
            $r.find('[data-sncf]').first().text() ||
            $r.find('.VwiC3b').first().text() ||
            $r.find('[style*="-webkit-line-clamp"]').first().text() ||
            $r.find('.st').first().text() ||
            '';
          const snippet = cleanText(snippetText, { maxLen: 500, stripEllipsisPadding: true });

          results.push({ title, url: validated, snippet });
        });

        if (results.length > 0) return results.slice(0, count);
      }
    } catch (e) {
      log.debug('Google stealth (peel) error:', (e as Error).message);
    }

    // Strategy B: direct playwright-extra + stealth plugin
    let browser: import('playwright').Browser | undefined;
    let context: import('playwright').BrowserContext | undefined;
    let page: import('playwright').Page | undefined;
    try {
      const pwExtra = await import('playwright-extra');
      const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
      const stealthChromium = pwExtra.chromium as unknown as typeof import('playwright').chromium;
      (stealthChromium as any).use(StealthPlugin());

      const params = new URLSearchParams({
        q: query,
        num: String(Math.min(count * 2, 20)),
        hl: 'en',
        gl: 'us',
      });
      const url = `https://www.google.com/search?${params.toString()}`;

      browser = await stealthChromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
        ],
      });
      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
      });
      page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

      // Use page.content() + cheerio to avoid needing DOM lib types in tsconfig
      const html = await page.content();
      return this._parseGoogleHtml(html, count);
    } catch (e) {
      log.debug('Google stealth (playwright) error:', (e as Error).message);
      return [];
    } finally {
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }

  /** Parse Google search result HTML using cheerio. No DOM lib types required. */
  private _parseGoogleHtml(html: string, count: number): WebSearchResult[] {
    const $ = load(html);
    const results: WebSearchResult[] = [];
    const seen = new Set<string>();
    const resultBlocks = $('#search .g, #rso .g, [data-hveid] .g');

    resultBlocks.each((_i, elem) => {
      if (results.length >= count) return;
      const $r = $(elem);
      const $a = $r.find('a[href^="http"]').first();
      const $h3 = $r.find('h3').first();
      if (!$a.length || !$h3.length) return;

      const href = $a.attr('href') || '';
      if (
        href.includes('google.com/') ||
        href.includes('accounts.google') ||
        href.includes('/aclk') ||
        href.startsWith('#')
      ) return;

      const validated = this.validateUrl(href);
      if (!validated) return;

      const key = normalizeUrlForDedupe(validated);
      if (seen.has(key)) return;
      seen.add(key);

      const title = cleanText($h3.text(), { maxLen: 200 });
      if (!title) return;

      const snippetText =
        $r.find('[data-sncf]').first().text() ||
        $r.find('.VwiC3b').first().text() ||
        $r.find('[style*="-webkit-line-clamp"]').first().text() ||
        $r.find('.st').first().text() ||
        '';
      const snippet = cleanText(snippetText, { maxLen: 500, stripEllipsisPadding: true });
      results.push({ title, url: validated, snippet });
    });

    return results.slice(0, count);
  }

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, apiKey: optApiKey, tbs } = options;

    const apiKey = optApiKey || process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;

    // No API key — fall back to stealth browser scraping
    if (!apiKey || !cx) {
      return this.scrapeGoogleStealth(query, count);
    }

    // Custom Search JSON API path
    const params = new URLSearchParams({
      key: apiKey,
      cx: cx,
      q: query,
      num: String(Math.min(count, 10)), // Google CSE max is 10 per request
    });

    const dateRestrict = this.mapFreshnessToDateRestrict(tbs);
    if (dateRestrict) params.set('dateRestrict', dateRestrict);

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google search failed (${response.status}): ${text.substring(0, 200)}`);
    }

    const data = await response.json() as any;

    return ((data.items || []) as any[]).map((item: any) => ({
      url: item.link as string,
      title: item.title as string,
      snippet: (item.snippet as string) || '',
    }));
  }
}

export function getSearchProvider(id: SearchProviderId | undefined): SearchProvider {
  if (!id || id === 'duckduckgo') return new DuckDuckGoProvider();
  if (id === 'brave') return new BraveSearchProvider();
  if (id === 'stealth') return new StealthSearchProvider();
  if (id === 'google') return new GoogleSearchProvider();

  // Exhaustive fallback (should be unreachable due to typing)
  return new DuckDuckGoProvider();
}

/**
 /**
 * Get the best available search provider based on configured API keys and
 * available runtime dependencies.
 *
 * Priority:
 *   1. Google Custom Search JSON API (if GOOGLE_SEARCH_KEY + GOOGLE_SEARCH_CX set)
 *   2. Brave Search (if BRAVE_SEARCH_KEY is set)
 *   3. Google stealth browser scraping (works from datacenter IPs; no API key needed)
 *      — only when playwright-extra is available in node_modules
 *   4. DuckDuckGo with full fallback chain (DDG HTTP → DDG Lite → stealth multi-engine (Bing + Ecosia))
 */
export function getBestSearchProvider(): { provider: SearchProvider; apiKey?: string } {
  // 1. Google Custom Search JSON API (BYOK) — works from any IP
  const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;
  if (googleKey && googleCx) {
    return { provider: new GoogleSearchProvider(), apiKey: googleKey };
  }

  // 2. Brave Search (BYOK)
  const braveKey = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
  if (braveKey) {
    return { provider: new BraveSearchProvider(), apiKey: braveKey };
  }

  // 3. DuckDuckGo with full internal fallback chain
  // (DDG HTTP → DDG Lite → stealth multi-engine (Bing + Ecosia))
  return { provider: new DuckDuckGoProvider() };
}
