// ============================================================
// @webpeel/sdk — Batch Resource
// ============================================================

import type { BatchOptions, BatchResult, BatchItemResult, FetchResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class BatchResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Fetch multiple URLs concurrently.
   *
   * @example
   * const result = await client.batch(['https://a.com', 'https://b.com'], {
   *   concurrency: 3,
   *   onResult: (r) => console.log(r.success ? `✓ ${r.url}` : `✗ ${r.url}`),
   * });
   * console.log(`${result.succeeded}/${result.results.length} succeeded`);
   */
  async batch(urls: string[], options: BatchOptions = {}): Promise<BatchResult> {
    const { signal, timeout, onResult, concurrency = 5, fetchOptions = {} } = options;

    const results: BatchItemResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process in chunks respecting concurrency
    for (let i = 0; i < urls.length; i += concurrency) {
      const chunk = urls.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((url) => this._fetchOne(url, { signal, timeout, fetchOptions })),
      );

      for (const item of chunkResults) {
        results.push(item);
        if (item.success) {
          succeeded++;
        } else {
          failed++;
        }
        if (onResult) {
          await onResult(item);
        }
      }
    }

    return { results, succeeded, failed };
  }

  private async _fetchOne(
    url: string,
    options: {
      signal?: AbortSignal;
      timeout?: number;
      fetchOptions: Record<string, unknown>;
    },
  ): Promise<BatchItemResult> {
    try {
      const p = new URLSearchParams({ url });
      for (const [k, v] of Object.entries(options.fetchOptions)) {
        if (v !== undefined && v !== null) {
          p.set(k, String(v));
        }
      }
      const result = await this._request<FetchResult>(`/v1/fetch?${p.toString()}`, {
        signal: options.signal,
        timeout: options.timeout,
      });
      return { url, result, success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { url, error: message, success: false };
    }
  }
}
