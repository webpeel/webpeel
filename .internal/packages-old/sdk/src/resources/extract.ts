// ============================================================
// @webpeel/sdk — Extract Resource
// ============================================================

import type { ExtractParams, ExtractResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class ExtractResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Extract structured data from a URL using a prompt and/or schema.
   *
   * Provide a natural-language `prompt` describing what to extract,
   * an optional JSON `schema` for typed output, and optional CSS `selectors`
   * to target specific page regions.
   *
   * @example
   * const data = await client.extract.extract({
   *   url: 'https://example.com/product',
   *   prompt: 'Extract product name, price, and availability',
   *   schema: {
   *     type: 'object',
   *     properties: {
   *       name: { type: 'string' },
   *       price: { type: 'number' },
   *       available: { type: 'boolean' },
   *     },
   *   },
   * });
   * console.log(data.data); // { name: '...', price: 9.99, available: true }
   */
  async extract(params: ExtractParams): Promise<ExtractResult> {
    const { signal, timeout, ...body } = params;
    return this._request<ExtractResult>('/v1/extract', {
      method: 'POST',
      body,
      signal,
      timeout,
    });
  }
}
