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
  // Agent
  AgentStep,
  AgentParams,
  AgentResult,
  AgentAsyncResult,
  AgentStreamEvent,
  // Extract
  ExtractParams,
  ExtractResult,
  // Answer
  AnswerParams,
  AnswerResult,
  // Deep Fetch
  DeepFetchParams,
  DeepFetchResult,
  DeepFetchPage,
  // YouTube
  YoutubeTranscriptParams,
  YoutubeTranscriptResult,
  YoutubeTranscriptSegment,
  // Watch
  WatchCheckParams,
  WatchCheckResult,
  WatchCreateParams,
  WatchCreateResult,
  // Jobs
  JobStatus,
  JobResult,
  JobListParams,
  JobListResult,
} from './types.js';

// Resource classes (for custom DI / testing)
export { FetchResource } from './resources/fetch.js';
export { SearchResource } from './resources/search.js';
export { ScreenshotResource } from './resources/screenshot.js';
export { CrawlResource } from './resources/crawl.js';
export { BatchResource } from './resources/batch.js';
export { AgentResource } from './resources/agent.js';
export { ExtractResource } from './resources/extract.js';
export { AnswerResource } from './resources/answer.js';
export { DeepFetchResource } from './resources/deepFetch.js';
export { YoutubeResource } from './resources/youtube.js';
export { WatchResource } from './resources/watch.js';
export { JobsResource } from './resources/jobs.js';

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
