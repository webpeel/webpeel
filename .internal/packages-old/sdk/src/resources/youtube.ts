// ============================================================
// @webpeel/sdk — YouTube Resource
// ============================================================

import type { YoutubeTranscriptParams, YoutubeTranscriptResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

export class YoutubeResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Fetch the transcript of a YouTube video.
   *
   * Provide either a full YouTube `url` or a bare `videoId`.
   * The transcript is returned as a list of timed segments and also
   * as a single concatenated `text` string.
   *
   * @example
   * // Via URL
   * const result = await client.youtube.transcript({
   *   url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
   * });
   *
   * // Via video ID
   * const result = await client.youtube.transcript({ videoId: 'dQw4w9WgXcQ' });
   * console.log(result.text);     // Full transcript as a string
   * console.log(result.segments); // [{ start, end, text }, ...]
   */
  async transcript(params: YoutubeTranscriptParams): Promise<YoutubeTranscriptResult> {
    const { signal, timeout, ...rest } = params;
    const query = buildYoutubeQuery(rest);
    return this._request<YoutubeTranscriptResult>(`/v1/youtube?${query}`, { signal, timeout });
  }
}

function buildYoutubeQuery(params: Omit<YoutubeTranscriptParams, 'signal' | 'timeout'>): string {
  const p = new URLSearchParams();
  if (params.url) p.set('url', params.url);
  if (params.videoId) p.set('videoId', params.videoId);
  return p.toString();
}
