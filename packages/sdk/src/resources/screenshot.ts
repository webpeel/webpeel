// ============================================================
// @webpeel/sdk — Screenshot Resource
// ============================================================

import type { ScreenshotOptions, ScreenshotResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class ScreenshotResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Take a screenshot of a URL.
   *
   * @example
   * const shot = await client.screenshot('https://example.com');
   * // shot.imageData is base64-encoded PNG
   * const buf = Buffer.from(shot.imageData, 'base64');
   */
  async screenshot(url: string, options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const { signal, timeout, ...params } = options;
    const query = buildQuery(url, params);
    return this._request<ScreenshotResult>(`/v1/screenshot?${query}`, { signal, timeout });
  }
}

function buildQuery(url: string, params: Omit<ScreenshotOptions, 'signal' | 'timeout'>): string {
  const p = new URLSearchParams({ url });
  if (params.format) p.set('format', params.format);
  if (params.quality !== undefined) p.set('quality', String(params.quality));
  if (params.fullPage) p.set('fullPage', 'true');
  if (params.width !== undefined) p.set('width', String(params.width));
  if (params.height !== undefined) p.set('height', String(params.height));
  if (params.selector) p.set('selector', params.selector);
  if (params.waitForNetworkIdle) p.set('waitForNetworkIdle', 'true');
  return p.toString();
}
