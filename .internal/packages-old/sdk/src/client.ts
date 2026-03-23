// ============================================================
// @webpeel/sdk — WebPeelClient
// ============================================================

import { createApiError, NetworkError, TimeoutError, RateLimitError } from './errors.js';
import { FetchResource } from './resources/fetch.js';
import { SearchResource } from './resources/search.js';
import { ScreenshotResource } from './resources/screenshot.js';
import { CrawlResource } from './resources/crawl.js';
import { BatchResource } from './resources/batch.js';
import { AgentResource } from './resources/agent.js';
import { ExtractResource } from './resources/extract.js';
import { AnswerResource } from './resources/answer.js';
import { DeepFetchResource } from './resources/deepFetch.js';
import { YoutubeResource } from './resources/youtube.js';
import { WatchResource } from './resources/watch.js';
import { JobsResource } from './resources/jobs.js';
import type { RequestCallOptions } from './resources/base.js';
import type {
  FetchOptions,
  FetchResult,
  SearchOptions,
  SearchResult,
  ScreenshotOptions,
  ScreenshotResult,
  CrawlOptions,
  CrawlResult,
  BatchOptions,
  BatchResult,
} from './types.js';

export interface WebPeelOptions {
  /** Your WebPeel API key (starts with "wp_") */
  apiKey: string;
  /**
   * Base URL for the WebPeel API.
   * @default "https://api.webpeel.dev"
   */
  baseUrl?: string;
  /**
   * Default request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;
  /**
   * Maximum number of automatic retries on 429 and 5xx responses.
   * @default 2
   */
  maxRetries?: number;
}

const DEFAULT_BASE_URL = 'https://api.webpeel.dev';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

/**
 * The main WebPeel API client.
 *
 * @example
 * ```typescript
 * import WebPeel from '@webpeel/sdk';
 *
 * const client = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY! });
 * const result = await client.fetch('https://example.com');
 * console.log(result.content);
 * ```
 */
export class WebPeelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  // Resources
  private readonly _fetchResource: FetchResource;
  private readonly _searchResource: SearchResource;
  private readonly _screenshotResource: ScreenshotResource;
  private readonly _crawlResource: CrawlResource;
  private readonly _batchResource: BatchResource;
  private readonly _agentResource: AgentResource;
  private readonly _extractResource: ExtractResource;
  private readonly _answerResource: AnswerResource;
  private readonly _deepFetchResource: DeepFetchResource;
  private readonly _youtubeResource: YoutubeResource;
  private readonly _watchResource: WatchResource;
  private readonly _jobsResource: JobsResource;

  constructor(options: WebPeelOptions) {
    if (!options.apiKey) {
      throw new Error('WebPeel API key is required. Pass it as { apiKey: "wp_..." }');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

    const boundRequest = this._request.bind(this);
    const boundRawFetch = this._rawFetch.bind(this);
    this._fetchResource = new FetchResource(boundRequest);
    this._searchResource = new SearchResource(boundRequest);
    this._screenshotResource = new ScreenshotResource(boundRequest);
    this._crawlResource = new CrawlResource(boundRequest);
    this._batchResource = new BatchResource(boundRequest);
    this._agentResource = new AgentResource(boundRequest, boundRawFetch);
    this._extractResource = new ExtractResource(boundRequest);
    this._answerResource = new AnswerResource(boundRequest);
    this._deepFetchResource = new DeepFetchResource(boundRequest);
    this._youtubeResource = new YoutubeResource(boundRequest);
    this._watchResource = new WatchResource(boundRequest);
    this._jobsResource = new JobsResource(boundRequest);
  }

  // ─── Resource accessors ────────────────────────────────────────────────────

  /** Agent resource — orchestrated multi-step AI runs */
  get agent(): AgentResource { return this._agentResource; }

  /** Extract resource — structured data extraction from URLs */
  get extract(): ExtractResource { return this._extractResource; }

  /** Answer resource — question answering from a URL */
  get answer(): AnswerResource { return this._answerResource; }

  /** Deep Fetch resource — recursive deep page fetching */
  get deepFetch(): DeepFetchResource { return this._deepFetchResource; }

  /** YouTube resource — video transcript retrieval */
  get youtube(): YoutubeResource { return this._youtubeResource; }

  /** Watch resource — page-change monitoring */
  get watch(): WatchResource { return this._watchResource; }

  /** Jobs resource — async job management and polling */
  get jobs(): JobsResource { return this._jobsResource; }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Fetch a URL and return clean, structured content.
   *
   * @param url - The URL to fetch
   * @param options - Fetch options (render, stealth, question, format, budget, ...)
   */
  async fetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    return this._fetchResource.fetch(url, options);
  }

  /**
   * Search the web and return structured results.
   *
   * @param query - Search query
   * @param options - Search options (limit, country, language, includeContent)
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return this._searchResource.search(query, options);
  }

  /**
   * Take a screenshot of a URL.
   *
   * @param url - The URL to screenshot
   * @param options - Screenshot options (format, quality, fullPage, width, height, ...)
   */
  async screenshot(url: string, options?: ScreenshotOptions): Promise<ScreenshotResult> {
    return this._screenshotResource.screenshot(url, options);
  }

  /**
   * Crawl a website starting from a URL.
   *
   * @param url - Start URL
   * @param options - Crawl options (depth, limit, include, exclude, onPage, ...)
   */
  async crawl(url: string, options?: CrawlOptions): Promise<CrawlResult> {
    return this._crawlResource.crawl(url, options);
  }

  /**
   * Fetch multiple URLs concurrently.
   *
   * @param urls - Array of URLs to fetch
   * @param options - Batch options (concurrency, onResult, fetchOptions)
   */
  async batch(urls: string[], options?: BatchOptions): Promise<BatchResult> {
    return this._batchResource.batch(urls, options);
  }

  // ─── Internal HTTP layer ────────────────────────────────────────────────────

  /**
   * @internal
   * Low-level method that returns the raw `Response` — used for SSE streaming.
   */
  async _rawFetch(path: string, options: RequestCallOptions = {}): Promise<Response> {
    const { signal, timeout: perRequestTimeout, method = 'POST', body } = options;
    const url = `${this.baseUrl}${path}`;
    const effectiveTimeout = perRequestTimeout ?? this.timeout;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new DOMException('Request aborted', 'AbortError');
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': '@webpeel/sdk/0.1.0',
    };

    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (!signal?.aborted) {
          throw new TimeoutError({ message: `Request timed out after ${effectiveTimeout}ms` });
        }
        throw err;
      }
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    }

    clearTimeout(timer);

    if (!response.ok) {
      let errorBody: Record<string, unknown> = {};
      try { errorBody = (await response.json()) as Record<string, unknown>; } catch { /* ignore */ }
      const requestId = response.headers.get('x-request-id') ?? undefined;
      throw createApiError(response.status, errorBody, requestId);
    }

    return response;
  }

  async _request<T>(path: string, options: RequestCallOptions = {}): Promise<T> {
    const { signal, timeout: perRequestTimeout, method = 'GET', body } = options;
    const url = `${this.baseUrl}${path}`;
    const effectiveTimeout = perRequestTimeout ?? this.timeout;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this._retryDelay(attempt, lastError);
        await sleep(delay);
      }

      try {
        const result = await this._executeRequest<T>(url, method, body, effectiveTimeout, signal);
        return result;
      } catch (err) {
        if (err instanceof Error) {
          lastError = err;
        } else {
          lastError = new Error(String(err));
        }

        // Abort / user cancellation — do not retry
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }

        // Don't retry client errors (4xx except 429)
        if (err instanceof RateLimitError || this._isServerError(err)) {
          if (attempt < this.maxRetries) continue;
        }

        if (!this._isRetryable(err)) {
          throw err;
        }

        if (attempt >= this.maxRetries) {
          throw err;
        }
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw lastError ?? new Error('Request failed after retries');
  }

  private async _executeRequest<T>(
    url: string,
    method: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Chain external signal with our timeout signal
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new DOMException('Request aborted', 'AbortError');
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': '@webpeel/sdk/0.1.0',
    };

    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Distinguish timeout from user cancellation
        if (!signal?.aborted) {
          throw new TimeoutError({
            message: `Request timed out after ${timeoutMs}ms`,
          });
        }
        throw err;
      }
      throw new NetworkError(
        err instanceof Error ? err.message : 'Network request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;

    if (!response.ok) {
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = (await response.json()) as Record<string, unknown>;
      } catch {
        // ignore parse errors
      }
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;

      const apiError = createApiError(response.status, errorBody, requestId);
      if (apiError instanceof RateLimitError && retryAfter) {
        // Attach retryAfter — create a new instance
        throw new RateLimitError({
          message: apiError.message,
          type: apiError.type,
          status: apiError.status,
          hint: apiError.hint,
          requestId: apiError.requestId,
          retryAfter,
        });
      }
      throw apiError;
    }

    const json = (await response.json()) as T;
    return json;
  }

  private _retryDelay(attempt: number, err?: Error): number {
    // Respect Retry-After header on rate limit errors
    if (err instanceof RateLimitError && err.retryAfter) {
      return err.retryAfter * 1000;
    }
    // Exponential backoff: 500ms, 1000ms, 2000ms, ...
    return BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  }

  private _isRetryable(err: unknown): boolean {
    return this._isServerError(err) || err instanceof RateLimitError;
  }

  private _isServerError(err: unknown): boolean {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const status = (err as { status: number }).status;
      return status >= 500;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
