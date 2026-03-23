// ============================================================
// @webpeel/sdk — Deep Fetch Resource
// ============================================================

import type { DeepFetchParams, DeepFetchResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class DeepFetchResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Perform a deep recursive fetch starting from a URL.
   *
   * Unlike a standard crawl, deep-fetch is optimized for extracting comprehensive
   * knowledge from a topic or documentation site by following the most relevant
   * links up to the specified `depth` and `maxPages` limits.
   *
   * @example
   * const result = await client.deepFetch.deepFetch({
   *   url: 'https://docs.example.com',
   *   depth: 3,
   *   maxPages: 50,
   * });
   * console.log(result.pages.length); // Number of pages fetched
   * console.log(result.content);      // Aggregated content
   */
  async deepFetch(params: DeepFetchParams): Promise<DeepFetchResult> {
    const { signal, timeout, ...body } = params;
    return this._request<DeepFetchResult>('/v1/deep-fetch', {
      method: 'POST',
      body,
      signal,
      timeout,
    });
  }
}
