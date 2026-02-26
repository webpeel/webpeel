// ============================================================
// @webpeel/sdk — Type Definitions
// ============================================================

// --------------- Shared ---------------

export interface RequestOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Per-request timeout in milliseconds (overrides client default) */
  timeout?: number;
}

// --------------- Fetch ---------------

export interface FetchOptions extends RequestOptions {
  /**
   * Token budget limit — stops fetching once this many tokens are consumed.
   * Default: unlimited.
   */
  budget?: number;
  /**
   * Ask a question about the page. Returns a concise `answer` field in the result.
   */
  question?: string;
  /**
   * Use a headless browser to render JavaScript before extracting content.
   * Required for SPAs and pages that lazy-load content.
   */
  render?: boolean;
  /**
   * Enable stealth mode to bypass bot-detection measures.
   */
  stealth?: boolean;
  /**
   * Output format for the page content.
   * @default "markdown"
   */
  format?: 'markdown' | 'text' | 'html' | 'json';
  /**
   * CSS selector to wait for before extracting content (requires render: true).
   */
  waitFor?: string;
  /**
   * Maximum number of milliseconds to wait for the page to load (requires render: true).
   */
  waitMs?: number;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
  wordCount?: number;
  language?: string;
  siteName?: string;
  favicon?: string;
  ogImage?: string;
  canonical?: string;
}

export interface FetchResult {
  /** The URL that was fetched (may differ from input after redirects) */
  url: string;
  /** Extracted page content in the requested format (default: markdown) */
  content: string;
  /** Page metadata */
  metadata: PageMetadata;
  /** Answer to the question (only present when `question` was provided) */
  answer?: string;
  /** HTTP status code of the final response */
  statusCode?: number;
  /** Content-Type of the fetched page */
  contentType?: string;
  /** Unique request ID for debugging */
  requestId?: string;
}

// --------------- Search ---------------

export interface SearchOptions extends RequestOptions {
  /**
   * Maximum number of results to return.
   * @default 10
   */
  limit?: number;
  /**
   * Country code for localized results (e.g. "US", "GB").
   */
  country?: string;
  /**
   * Language for results (e.g. "en", "fr").
   */
  language?: string;
  /**
   * Whether to include the page content in results (costs more credits).
   */
  includeContent?: boolean;
}

export interface SearchResult {
  /** Result title */
  title: string;
  /** Result URL */
  url: string;
  /** Short description or snippet */
  description?: string;
  /** Fetched page content (only present when includeContent: true) */
  content?: string;
  /** Result rank (1-based) */
  rank: number;
}

// --------------- Screenshot ---------------

export interface ScreenshotOptions extends RequestOptions {
  /**
   * Output format.
   * @default "png"
   */
  format?: 'png' | 'jpeg' | 'webp';
  /**
   * Image quality 0-100 (JPEG/WebP only).
   * @default 80
   */
  quality?: number;
  /**
   * Capture the full scrollable page.
   * @default false
   */
  fullPage?: boolean;
  /**
   * Viewport width in pixels.
   * @default 1280
   */
  width?: number;
  /**
   * Viewport height in pixels.
   * @default 720
   */
  height?: number;
  /**
   * CSS selector of element to screenshot.
   */
  selector?: string;
  /**
   * Wait for network idle before screenshotting.
   * @default false
   */
  waitForNetworkIdle?: boolean;
}

export interface ScreenshotResult {
  /** The URL that was screenshotted */
  url: string;
  /** Base64-encoded image data */
  imageData: string;
  /** MIME type (e.g. "image/png") */
  mimeType: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Unique request ID for debugging */
  requestId?: string;
}

// --------------- Crawl ---------------

export interface CrawlOptions extends RequestOptions {
  /**
   * Maximum crawl depth from the start URL.
   * @default 1
   */
  depth?: number;
  /**
   * Maximum number of pages to crawl.
   * @default 100
   */
  limit?: number;
  /**
   * URL patterns (glob or regex) to include. Defaults to same domain.
   */
  include?: string[];
  /**
   * URL patterns (glob or regex) to exclude.
   */
  exclude?: string[];
  /**
   * Callback invoked for each crawled page.
   */
  onPage?: (page: CrawledPage) => void | Promise<void>;
  /**
   * Enable JavaScript rendering for all pages.
   */
  render?: boolean;
}

export interface CrawledPage {
  url: string;
  content: string;
  metadata: PageMetadata;
  depth: number;
  statusCode?: number;
  error?: string;
}

export interface CrawlResult {
  /** Starting URL */
  url: string;
  /** All crawled pages */
  pages: CrawledPage[];
  /** Total pages crawled */
  totalPages: number;
  /** Pages that failed */
  failedPages: number;
}

// --------------- Batch ---------------

export interface BatchOptions extends RequestOptions {
  /**
   * Maximum concurrent requests.
   * @default 5
   */
  concurrency?: number;
  /**
   * Callback invoked when each URL completes (success or failure).
   */
  onResult?: (result: BatchItemResult) => void | Promise<void>;
  /**
   * Options applied to each individual fetch.
   */
  fetchOptions?: Omit<FetchOptions, 'signal' | 'timeout'>;
}

export interface BatchItemResult {
  url: string;
  result?: FetchResult;
  error?: string;
  success: boolean;
}

export interface BatchResult {
  /** All results (both successful and failed) */
  results: BatchItemResult[];
  /** Number of successful fetches */
  succeeded: number;
  /** Number of failed fetches */
  failed: number;
}

// --------------- Agent ---------------

/** Steps the agent can perform, in order. */
export type AgentStep = 'search' | 'fetch' | 'extract' | 'summarize';

export interface AgentParams extends RequestOptions {
  /**
   * URL to start from (for fetch/extract-focused runs).
   * Provide either `url` or `query`, not both.
   */
  url?: string;
  /**
   * Search query (for search-focused runs).
   * Provide either `url` or `query`, not both.
   */
  query?: string;
  /**
   * Ordered list of steps the agent should perform.
   * @default ["search", "fetch", "summarize"]
   */
  steps?: AgentStep[];
  /**
   * Your LLM API key, forwarded to the agent's underlying model calls.
   * Only required if you want to use your own key/quota.
   */
  llmApiKey?: string;
  /**
   * Webhook URL to receive the completed result via HTTP POST.
   * Only applicable when called via `runAsync`.
   */
  webhookUrl?: string;
}

export interface AgentResult {
  /** Natural-language output produced by the agent */
  output: string;
  /** Structured data extracted during the run (if an extract step was included) */
  data?: Record<string, unknown>;
  /** Pages the agent fetched or searched */
  sources?: string[];
  /** Total steps executed */
  stepsCompleted: number;
  /** Unique request ID for debugging */
  requestId?: string;
}

export interface AgentAsyncResult {
  /** Job ID — use with `client.jobs.waitForCompletion(jobId)` */
  jobId: string;
  /** Current status immediately after submission */
  status: 'pending' | 'running';
  /** Estimated time to completion in seconds (if available) */
  estimatedSeconds?: number;
  /** Unique request ID for debugging */
  requestId?: string;
}

/** A single event emitted during an agent stream run. */
export type AgentStreamEvent =
  | { type: 'step'; step: AgentStep; message: string }
  | { type: 'data'; data: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done'; result?: AgentResult };

// --------------- Extract ---------------

export interface ExtractParams extends RequestOptions {
  /** URL of the page to extract data from */
  url: string;
  /**
   * Natural-language prompt describing what to extract.
   * E.g. "Extract the product name, price, and stock status."
   */
  prompt?: string;
  /**
   * JSON Schema describing the shape of the data to extract.
   * When provided, the response `data` field will conform to this schema.
   */
  schema?: Record<string, unknown>;
  /**
   * CSS selectors to focus extraction on specific page regions.
   */
  selectors?: string[];
  /**
   * Your LLM API key, forwarded to the extraction model.
   */
  llmApiKey?: string;
}

export interface ExtractResult {
  /** The URL that was extracted from */
  url: string;
  /** Extracted data, shaped according to `schema` if provided */
  data: Record<string, unknown>;
  /** Raw text extracted from the targeted regions */
  rawText?: string;
  /** Unique request ID for debugging */
  requestId?: string;
}

// --------------- Answer ---------------

export interface AnswerParams extends RequestOptions {
  /** URL of the page to answer the question from */
  url: string;
  /** Question to answer */
  question: string;
}

export interface AnswerResult {
  /** The URL that was queried */
  url: string;
  /** Concise answer to the question */
  answer: string;
  /**
   * Confidence score between 0 and 1.
   * Higher values indicate more certainty.
   */
  confidence: number;
  /** The source text snippet the answer was derived from */
  source?: string;
  /** Unique request ID for debugging */
  requestId?: string;
}

// --------------- Deep Fetch ---------------

export interface DeepFetchParams extends RequestOptions {
  /** Starting URL */
  url: string;
  /**
   * Maximum link-follow depth from the start URL.
   * @default 2
   */
  depth?: number;
  /**
   * Maximum total pages to fetch across all depths.
   * @default 20
   */
  maxPages?: number;
}

export interface DeepFetchPage {
  url: string;
  content: string;
  metadata: PageMetadata;
  depth: number;
  statusCode?: number;
  error?: string;
}

export interface DeepFetchResult {
  /** Starting URL */
  url: string;
  /** All fetched pages */
  pages: DeepFetchPage[];
  /** Aggregated content from all pages */
  content: string;
  /** Total pages fetched */
  totalPages: number;
  /** Pages that failed */
  failedPages: number;
  /** Unique request ID for debugging */
  requestId?: string;
}

// --------------- YouTube ---------------

export interface YoutubeTranscriptParams extends RequestOptions {
  /**
   * Full YouTube video URL.
   * Provide either `url` or `videoId`, not both.
   */
  url?: string;
  /**
   * YouTube video ID (e.g. "dQw4w9WgXcQ").
   * Provide either `url` or `videoId`, not both.
   */
  videoId?: string;
}

export interface YoutubeTranscriptSegment {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Transcript text for this segment */
  text: string;
}

export interface YoutubeTranscriptResult {
  /** Video ID */
  videoId: string;
  /** Full video URL */
  url: string;
  /** Complete transcript as a single string */
  text: string;
  /** Individual timed transcript segments */
  segments: YoutubeTranscriptSegment[];
  /** Video title (if available) */
  title?: string;
  /** Video duration in seconds (if available) */
  durationSeconds?: number;
  /** Language of the transcript */
  language?: string;
  /** Unique request ID for debugging */
  requestId?: string;
}

// --------------- Watch ---------------

export interface WatchCheckParams extends RequestOptions {
  /** URL to check for changes */
  url: string;
}

export interface WatchCheckResult {
  /** The URL that was checked */
  url: string;
  /** Whether the page has changed since the last check */
  changed: boolean;
  /** Summary of detected changes (only present when `changed: true`) */
  diff?: string;
  /** Timestamp of the most recent check (ISO 8601) */
  checkedAt: string;
  /** Timestamp of the previous check (ISO 8601), if any */
  previousCheckedAt?: string;
  /** Unique request ID for debugging */
  requestId?: string;
}

export interface WatchCreateParams extends RequestOptions {
  /** URL to monitor */
  url: string;
  /**
   * Check interval in seconds.
   * @default 3600 (1 hour)
   */
  interval?: number;
  /**
   * Webhook URL to notify when a change is detected.
   * WebPeel will POST a `WatchCheckResult` payload to this URL.
   */
  webhookUrl?: string;
}

export interface WatchCreateResult {
  /** Unique watcher ID — use this to manage or remove the watcher */
  watchId: string;
  /** URL being monitored */
  url: string;
  /** Check interval in seconds */
  interval: number;
  /** Webhook URL (if provided) */
  webhookUrl?: string;
  /** Timestamp when the watcher was created (ISO 8601) */
  createdAt: string;
  /** Unique request ID for debugging */
  requestId?: string;
}

// --------------- Jobs ---------------

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobResult {
  /** Unique job ID */
  jobId: string;
  /** Current job status */
  status: JobStatus;
  /** Job output (only present when `status: "completed"`) */
  output?: unknown;
  /** Error message (only present when `status: "failed"`) */
  error?: string;
  /** Timestamp when the job was created (ISO 8601) */
  createdAt: string;
  /** Timestamp when the job finished (ISO 8601, if applicable) */
  completedAt?: string;
  /** Unique request ID for debugging */
  requestId?: string;
}

export interface JobListParams extends RequestOptions {
  /** Filter by job status */
  status?: JobStatus;
  /**
   * Maximum number of jobs to return.
   * @default 20
   */
  limit?: number;
  /**
   * Offset for pagination.
   * @default 0
   */
  offset?: number;
}

export interface JobListResult {
  jobs: JobResult[];
  total: number;
  limit: number;
  offset: number;
}
