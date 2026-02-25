// ============================================================
// @webpeel/sdk — Fetch Resource
// ============================================================

import type { FetchOptions, FetchResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class FetchResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Fetch a URL and return clean content.
   *
   * @example
   * const result = await client.fetch('https://example.com');
   * console.log(result.content);    // Markdown
   * console.log(result.metadata);   // { title, author, ... }
   */
  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const { signal, timeout, ...params } = options;
    const query = buildFetchQuery(url, params);
    return this._request<FetchResult>(`/v1/fetch?${query}`, { signal, timeout });
  }
}

function buildFetchQuery(url: string, params: Omit<FetchOptions, 'signal' | 'timeout'>): string {
  const p = new URLSearchParams({ url });
  if (params.budget !== undefined) p.set('budget', String(params.budget));
  if (params.question) p.set('question', params.question);
  if (params.render) p.set('render', 'true');
  if (params.stealth) p.set('stealth', 'true');
  if (params.format) p.set('format', params.format);
  if (params.waitFor) p.set('waitFor', params.waitFor);
  if (params.waitMs !== undefined) p.set('waitMs', String(params.waitMs));
  return p.toString();
}
