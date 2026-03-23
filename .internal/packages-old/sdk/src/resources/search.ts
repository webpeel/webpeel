// ============================================================
// @webpeel/sdk — Search Resource
// ============================================================

import type { SearchOptions, SearchResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class SearchResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Search the web and return structured results.
   *
   * @example
   * const results = await client.search('best web scrapers 2026');
   * for (const r of results) {
   *   console.log(r.title, r.url);
   * }
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { signal, timeout, ...params } = options;
    const query_ = buildSearchQuery(query, params);
    return this._request<SearchResult[]>(`/v1/search?${query_}`, { signal, timeout });
  }
}

function buildSearchQuery(q: string, params: Omit<SearchOptions, 'signal' | 'timeout'>): string {
  const p = new URLSearchParams({ q });
  if (params.limit !== undefined) p.set('limit', String(params.limit));
  if (params.country) p.set('country', params.country);
  if (params.language) p.set('language', params.language);
  if (params.includeContent) p.set('includeContent', 'true');
  return p.toString();
}
