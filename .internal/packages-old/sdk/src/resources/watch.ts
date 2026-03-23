// ============================================================
// @webpeel/sdk — Watch Resource
// ============================================================

import type { WatchCheckParams, WatchCheckResult, WatchCreateParams, WatchCreateResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class WatchResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Check the current state of a watched URL.
   *
   * Returns whether the page has changed since the last check,
   * along with a diff summary if changes were detected.
   *
   * @example
   * const status = await client.watch.check({ url: 'https://example.com/pricing' });
   * if (status.changed) {
   *   console.log('Page changed!', status.diff);
   * }
   */
  async check(params: WatchCheckParams): Promise<WatchCheckResult> {
    const { signal, timeout, ...rest } = params;
    const query = buildWatchQuery(rest);
    return this._request<WatchCheckResult>(`/v1/watch?${query}`, { signal, timeout });
  }

  /**
   * Create a new watch monitor for a URL.
   *
   * WebPeel will check the page on the given `interval` and POST a notification
   * to your `webhookUrl` whenever a change is detected.
   *
   * @example
   * const watcher = await client.watch.create({
   *   url: 'https://example.com/pricing',
   *   interval: 3600,  // Check every hour
   *   webhookUrl: 'https://my-server.example.com/webhook',
   * });
   * console.log(watcher.watchId); // Unique watcher ID
   */
  async create(params: WatchCreateParams): Promise<WatchCreateResult> {
    const { signal, timeout, ...body } = params;
    return this._request<WatchCreateResult>('/v1/watch', {
      method: 'POST',
      body,
      signal,
      timeout,
    });
  }
}

function buildWatchQuery(params: Omit<WatchCheckParams, 'signal' | 'timeout'>): string {
  const p = new URLSearchParams({ url: params.url });
  return p.toString();
}
