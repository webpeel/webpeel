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
