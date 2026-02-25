// ============================================================
// @webpeel/sdk — Main Exports
// ============================================================

export { WebPeelClient } from './client.js';
export type { WebPeelOptions } from './client.js';

// Types
export type {
  // Shared
  RequestOptions,
  // Fetch
  FetchOptions,
  FetchResult,
  PageMetadata,
  // Search
  SearchOptions,
  SearchResult,
  // Screenshot
  ScreenshotOptions,
  ScreenshotResult,
  // Crawl
  CrawlOptions,
  CrawlResult,
  CrawledPage,
  // Batch
  BatchOptions,
  BatchResult,
  BatchItemResult,
} from './types.js';

// Errors
export {
  WebPeelError,
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  BlockedError,
  ValidationError,
  ServerError,
  NetworkError,
} from './errors.js';

// Default export — the main client class
export { WebPeelClient as default } from './client.js';
