// ============================================================
// @webpeel/sdk — Crawl Resource
// ============================================================

import type { CrawlOptions, CrawlResult, CrawledPage } from '../types.js';
import type { RequestCallOptions } from './base.js';

interface CrawlApiResponse {
  url: string;
  pages: CrawledPage[];
  totalPages: number;
  failedPages: number;
}

export class CrawlResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Crawl a website starting from a URL.
   *
   * @example
   * const result = await client.crawl('https://example.com', {
   *   depth: 2,
   *   limit: 50,
   *   onPage: (page) => console.log(`Crawled: ${page.url}`),
   * });
   * console.log(`Total pages: ${result.totalPages}`);
   */
  async crawl(url: string, options: CrawlOptions = {}): Promise<CrawlResult> {
    const { signal, timeout, onPage, ...params } = options;

    const response = await this._request<CrawlApiResponse>('/v1/crawl', {
      method: 'POST',
      body: { url, ...params },
      signal,
      timeout,
    });

    // Fire onPage callbacks
    if (onPage && response.pages) {
      for (const page of response.pages) {
        await onPage(page);
      }
    }

    return {
      url: response.url,
      pages: response.pages ?? [],
      totalPages: response.totalPages ?? (response.pages?.length ?? 0),
      failedPages: response.failedPages ?? 0,
    };
  }
}
