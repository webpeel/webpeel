/**
 * SearXNG Search Provider
 *
 * Connects to a self-hosted SearXNG instance (running on Mac Mini with residential IP,
 * exposed via Cloudflare Tunnel). SearXNG aggregates Google, Bing, Brave, Startpage, etc.
 * and is not rate-limited or blocked since it runs on a residential IP.
 *
 * Config (env vars):
 *   SEARXNG_URL   — Base URL of SearXNG instance (e.g. https://search.webpeel.dev)
 *
 * Falls back gracefully if SEARXNG_URL is not set or instance is unreachable.
 */

import { fetch as undiciFetch } from 'undici';
import { createLogger } from './logger.js';

const log = createLogger('searxng');

interface SearXNGRawResult {
  title: string;
  url: string;
  content?: string;
  engine?: string;
  score?: number;
  publishedDate?: string;
}

interface SearXNGResponse {
  results: SearXNGRawResult[];
}

export interface SearXNGSearchResult {
  title: string;
  url: string;
  description?: string;
  publishedDate?: string;
  score?: number;
}

/**
 * Fetches search results from a SearXNG instance.
 * Returns results compatible with WebSearchResult interface in search-provider.ts.
 */
export async function searchViaSearXNG(
  query: string,
  options: {
    count?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    engines?: string;
    language?: string;
  } = {},
): Promise<SearXNGSearchResult[]> {
  const baseUrl = process.env.SEARXNG_URL;
  if (!baseUrl) return [];

  const {
    count = 10,
    signal,
    timeoutMs = 15000,
    engines = '',
    language = 'en',
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort());

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      language,
      safesearch: '0',
      categories: 'general',
    });
    if (engines) params.set('engines', engines);

    const url = `${baseUrl.replace(/\/$/, '')}/search?${params.toString()}`;

    const response = await undiciFetch(url, {
      signal: controller.signal as AbortSignal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WebPeel/1.0 (internal search aggregator)',
      },
    } as Parameters<typeof undiciFetch>[1]);

    if (!response.ok) {
      log.debug(`HTTP ${response.status}`);
      return [];
    }

    const data = (await response.json()) as SearXNGResponse;
    const results = data?.results ?? [];

    if (results.length === 0) {
      log.debug('0 results returned');
      return [];
    }

    const seen = new Set<string>();
    const output: SearXNGSearchResult[] = [];

    for (const r of results) {
      if (!r.url || !r.title) continue;
      const normalized = r.url.replace(/\/$/, '').toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      output.push({
        title: r.title,
        url: r.url,
        description: r.content ?? undefined,
        publishedDate: r.publishedDate ?? undefined,
        score: r.score ?? undefined,
      });

      if (output.length >= count) break;
    }

    log.debug(`${output.length} results for "${query.substring(0, 40)}"`);
    return output;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || msg.includes('timeout') || msg.includes('AbortError')) {
      log.debug(`timed out after ${timeoutMs}ms`);
    } else {
      log.debug('fetch error:', msg);
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Quick health check — true if SearXNG is reachable and returning results.
 */
export async function isSearXNGHealthy(): Promise<boolean> {
  try {
    const results = await searchViaSearXNG('test', { count: 1, timeoutMs: 10000 });
    return results.length > 0;
  } catch {
    return false;
  }
}
