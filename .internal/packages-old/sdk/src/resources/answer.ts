// ============================================================
// @webpeel/sdk — Answer Resource
// ============================================================

import type { AnswerParams, AnswerResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class AnswerResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Ask a question about a URL and receive a concise, direct answer.
   *
   * Returns the answer, a confidence score (0–1), and the source snippet
   * from which the answer was derived.
   *
   * @example
   * const result = await client.answer.answer({
   *   url: 'https://en.wikipedia.org/wiki/TypeScript',
   *   question: 'Who created TypeScript?',
   * });
   * console.log(result.answer);     // "Microsoft"
   * console.log(result.confidence); // 0.97
   * console.log(result.source);     // "TypeScript was developed by Microsoft..."
   */
  async answer(params: AnswerParams): Promise<AnswerResult> {
    const { signal, timeout, ...rest } = params;
    const query = buildAnswerQuery(rest);
    return this._request<AnswerResult>(`/v1/answer?${query}`, { signal, timeout });
  }
}

function buildAnswerQuery(params: Omit<AnswerParams, 'signal' | 'timeout'>): string {
  const p = new URLSearchParams({ url: params.url, question: params.question });
  return p.toString();
}
