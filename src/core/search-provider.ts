/**
 * Search provider abstraction
 *
 * WebPeel supports multiple web search backends. DuckDuckGo is the default
 * (no API key required). The StealthSearchProvider uses WebPeel's own stealth
 * browser to scrape multiple search engines in parallel — fully self-hosted,
 * no external API keys required.
 *
 * Provider fallback chain (DDG):
 *   DDG HTTP → DDG Lite → Brave (if key) → StealthSearchProvider (multi-engine)
 *
 * In production with no API keys configured, getBestSearchProvider() returns
 * StealthSearchProvider since DDG HTTP is often blocked on datacenter IPs.
 */

import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';

export type SearchProviderId = 'duckduckgo' | 'brave' | 'stealth' | 'google';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
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

  /** Validate and normalize a URL; returns null if invalid/non-http */
  private validateUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  /**
   * Scrape DuckDuckGo HTML endpoint with stealth browser.
   * Uses the same HTML endpoint as DuckDuckGoProvider for consistent parsing.
   */
  private async scrapeDDG(query: string, count: number): Promise<WebSearchResult[]> {
    try {
      const { peel } = await import('../index.js');
      const params = new URLSearchParams({ q: query });
      const url = `https://html.duckduckgo.com/html/?${params.toString()}`;

      const result = await Promise.race([
        peel(url, { render: true, stealth: true, format: 'html', wait: 3000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DDG stealth timeout')), 15_000),
        ),
      ]);

      const html = (result as any).content || '';
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

        // Extract real URL from DDG redirect param
        let finalUrl = rawUrl;
        try {
          const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
          const uddg = ddgUrl.searchParams.get('uddg');
          if (uddg) finalUrl = decodeURIComponent(uddg);
        } catch { /* use raw */ }

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
    }
  }

  /**
   * Scrape Bing web search with stealth browser.
   * Selectors: li.b_algo for result containers.
   */
  private async scrapeBing(query: string, count: number): Promise<WebSearchResult[]> {
    try {
      const { peel } = await import('../index.js');
      const params = new URLSearchParams({ q: query });
      const url = `https://www.bing.com/search?${params.toString()}`;

      const result = await Promise.race([
        peel(url, { render: true, stealth: true, format: 'html', wait: 2000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Bing stealth timeout')), 15_000),
        ),
      ]);

      const html = (result as any).content || '';
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

        const validated = this.validateUrl(rawUrl);
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
    }
  }

  /**
   * Scrape Ecosia web search with stealth browser.
   * Tries multiple selector patterns since Ecosia updates their HTML frequently.
   */
  private async scrapeEcosia(query: string, count: number): Promise<WebSearchResult[]> {
    try {
      const { peel } = await import('../index.js');
      const params = new URLSearchParams({ q: query });
      const url = `https://www.ecosia.org/search?${params.toString()}`;

      const result = await Promise.race([
        peel(url, { render: true, stealth: true, format: 'html', wait: 2000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Ecosia stealth timeout')), 15_000),
        ),
      ]);

      const html = (result as any).content || '';
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

    return deduped;
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
    // 2) quoted query
    // 3) query site:*
    attempts.push(q);
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

  /**
   * Scrape DuckDuckGo with Firefox — different browser fingerprint bypasses
   * cloud IP bot detection that specifically targets Chromium fingerprints.
   * Used when Chromium-based HTTP/stealth requests return 0 results from cloud IPs.
   */
  private async scrapeDDGFirefox(query: string, count: number): Promise<WebSearchResult[]> {
    let browser: import('playwright').Browser | undefined;
    try {
      const { firefox } = await import('playwright');
      const params = new URLSearchParams({ q: query });
      const url = `https://html.duckduckgo.com/html/?${params.toString()}`;

      browser = await firefox.launch({
        headless: true,
        firefoxUserPrefs: {
          'general.useragent.override': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
        },
      });

      const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Upgrade-Insecure-Requests': '1',
        },
      });

      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const html = await page.content();

      const { load } = await import('cheerio');
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

        // Extract real URL from DDG redirect param
        let finalUrl = rawUrl;
        try {
          const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
          const uddg = ddgUrl.searchParams.get('uddg');
          if (uddg) finalUrl = decodeURIComponent(uddg);
        } catch { /* use raw */ }

        // SECURITY: only allow HTTP/HTTPS URLs
        try {
          const parsed = new URL(finalUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) return;
          finalUrl = parsed.href;
        } catch { return; }

        const key = normalizeUrlForDedupe(finalUrl);
        if (seen.has(key)) return;
        seen.add(key);

        results.push({ title, url: finalUrl, snippet });
      });

      return results;
    } catch (e) {
      console.log('[webpeel:search] Firefox DDG failed:', e instanceof Error ? e.message : e);
      return [];
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  private async searchOnce(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, signal } = options;

    const searchUrl = this.buildSearchUrl(query, options);

    // Use realistic browser headers to avoid DDG bot detection on datacenter IPs
    const response = await undiciFetch(searchUrl, {
      headers: {
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
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status}`);
    }

    const html = await response.text();
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

      // Extract actual URL from DuckDuckGo redirect
      let url = rawUrl;
      try {
        const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
        const uddg = ddgUrl.searchParams.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'ddg url parse failed:', e instanceof Error ? e.message : e);
      }

      // SECURITY: Validate and sanitize results — only allow HTTP/HTTPS URLs
      try {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          // Handle protocol-relative or relative URLs (rare but possible)
          parsed = new URL(url, 'https://duckduckgo.com');
        }
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

    const response = await undiciFetch(`https://lite.duckduckgo.com/lite/?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://lite.duckduckgo.com/',
      },
      signal,
    });

    if (!response.ok) return [];

    const html = await response.text();
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

      // Extract actual URL from DDG redirect
      try {
        const ddgUrl = new URL(url, 'https://lite.duckduckgo.com');
        const uddg = ddgUrl.searchParams.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } catch { /* use raw */ }

      // Validate URL
      try {
        const parsed = new URL(url);
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

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const attempts = this.buildQueryAttempts(query);

    // Retry only when DDG returns 0 results.
    for (const q of attempts) {
      const results = await this.searchOnce(q, options);
      if (results.length > 0) return results;
    }

    // Fallback: try DDG Lite endpoint (different HTML, sometimes bypasses blocks)
    console.log('[webpeel:search] DDG HTML returned 0 results, trying DDG Lite...');
    try {
      const liteResults = await this.searchLite(query, options);
      if (liteResults.length > 0) {
        console.log(`[webpeel:search] DDG Lite returned ${liteResults.length} results`);
        return liteResults;
      }
      console.log('[webpeel:search] DDG Lite also returned 0 results');
    } catch (e) {
      console.log('[webpeel:search] DDG Lite failed:', e instanceof Error ? e.message : e);
    }

    // Fallback: try DDG with Firefox — different browser fingerprint bypasses
    // cloud IP detection that specifically targets Chromium
    console.log('[webpeel:search] Trying Firefox DDG (different browser fingerprint)...');
    try {
      const firefoxResults = await this.scrapeDDGFirefox(query, options.count);
      if (firefoxResults.length > 0) {
        console.log(`[webpeel:search] Firefox DDG returned ${firefoxResults.length} results ✓`);
        return firefoxResults;
      }
      console.log('[webpeel:search] Firefox DDG also returned 0 results');
    } catch (e) {
      console.log('[webpeel:search] Firefox DDG failed:', e instanceof Error ? e.message : e);
    }

    // Fallback: try Brave Search API if key is configured
    const braveKey = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
    if (braveKey) {
      try {
        const braveProvider = new BraveSearchProvider();
        const braveResults = await braveProvider.searchWeb(query, { ...options, apiKey: braveKey });
        if (braveResults.length > 0) return braveResults;
      } catch (e) {
        console.log('[webpeel:search] Brave search failed:', e instanceof Error ? e.message : e);
      }
    }

    // Last resort: stealth multi-engine search (DDG + Bing + Ecosia via stealth browser)
    // Bypasses bot detection on datacenter IPs where HTTP scraping fails.
    console.log('[webpeel:search] Trying stealth browser search (DDG + Bing + Ecosia)...');
    try {
      const stealthProvider = new StealthSearchProvider();
      const stealthResults = await stealthProvider.searchWeb(query, options);
      if (stealthResults.length > 0) {
        console.log(`[webpeel:search] Stealth search returned ${stealthResults.length} results`);
        return stealthResults;
      }
      console.log('[webpeel:search] Stealth search returned 0 results');
    } catch (e) {
      console.log('[webpeel:search] Stealth search failed:', e instanceof Error ? e.message : e);
    }

    return [];
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

  /** Validate URL; returns null if invalid/non-http */
  private validateUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
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
      if (process.env.DEBUG) {
        console.debug('[webpeel] Google stealth (peel) error:', (e as Error).message);
      }
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
      if (process.env.DEBUG) {
        console.debug('[webpeel] Google stealth (playwright) error:', (e as Error).message);
      }
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
 *   4. DuckDuckGo with full fallback chain (DDG HTTP → DDG Lite → stealth multi-engine)
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
  // (DDG HTTP → DDG Lite → Firefox browser → stealth multi-engine)
  // Firefox fallback bypasses cloud IP bot detection targeting Chromium fingerprints.
  return { provider: new DuckDuckGoProvider() };
}
