/**
 * Core types for WebPeel
 */

export interface PageAction {
  type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';

  /** CSS selector for element-targeted actions */
  selector?: string;

  /**
   * Value/text payload for actions like type/fill/select.
   * Accepts Firecrawl-style `text` too (normalized internally).
   */
  value?: string;
  text?: string;

  /** Keyboard key for press actions (e.g., "Enter") */
  key?: string;

  /** Wait duration for wait actions (ms). Firecrawl uses `milliseconds`. */
  ms?: number;
  milliseconds?: number;

  /**
   * Scroll target (absolute) — legacy/internal.
   * Use direction+amount for relative scrolling.
   */
  to?: 'top' | 'bottom' | number;

  /** Relative scroll direction (Firecrawl-style) */
  direction?: 'up' | 'down' | 'left' | 'right';

  /** Relative scroll amount in pixels (Firecrawl-style) */
  amount?: number;

  /** Per-action timeout override (ms) */
  timeout?: number;
}

export interface ExtractOptions {
  /** JSON Schema for structured output */
  schema?: Record<string, any>;
  /** CSS selectors mapped to field names */
  selectors?: Record<string, string>;
  /** Natural language prompt describing what to extract */
  prompt?: string;
  /** API key for LLM-powered extraction (OpenAI-compatible) */
  llmApiKey?: string;
  /** LLM model to use (default: gpt-4o-mini) */
  llmModel?: string;
  /** LLM API base URL (default: https://api.openai.com/v1) */
  llmBaseUrl?: string;
}

/**
 * Inline structured extraction options (BYOK, multi-provider).
 * Used with /v1/fetch POST, /v2/scrape, and /v1/scrape (Firecrawl compat).
 */
export interface InlineExtractParam {
  /** JSON Schema describing the desired output structure */
  schema?: Record<string, any>;
  /** Natural language prompt describing what to extract */
  prompt?: string;
}

/** LLM provider for BYOK inline extraction */
export type InlineLLMProvider = 'openai' | 'anthropic' | 'google';

export interface PeelOptions {
  /** Use headless browser instead of simple HTTP fetch */
  render?: boolean;
  /** Use stealth mode to bypass bot detection (requires render=true, auto-enables if not set) */
  stealth?: boolean;
  /** Wait time in milliseconds after page load (only with render=true) */
  wait?: number;
  /** Output format */
  format?: 'markdown' | 'text' | 'html';
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Prepare streaming responses (API plumbing only; full SSE/chunked stream not yet implemented) */
  stream?: boolean;
  /** Custom user agent */
  userAgent?: string;
  /** Capture a screenshot of the page */
  screenshot?: boolean;
  /** Full-page screenshot (default: viewport only) */
  screenshotFullPage?: boolean;
  /** CSS selector to extract specific content (e.g., "article", ".main-content", "#post") */
  selector?: string;
  /** CSS selectors to exclude from content (e.g., [".sidebar", ".ads"]) */
  exclude?: string[];
  /** Only include content from these HTML elements (e.g., ['article', 'main', '.content']) */
  includeTags?: string[];
  /** Remove these HTML elements (e.g., ['nav', 'footer', 'header', '.sidebar']) */
  excludeTags?: string[];
  /** Custom HTTP headers to send */
  headers?: Record<string, string>;
  /** Cookies to set (key=value pairs) */
  cookies?: string[];
  /** Skip smart content extraction — return full page without stripping boilerplate */
  raw?: boolean;
  /** Page actions to execute before extraction (auto-enables render) */
  actions?: PageAction[];
  /** Extract structured data using a JSON schema or CSS selectors */
  extract?: ExtractOptions;
  /** Maximum token count for output (truncate intelligently if exceeded) */
  maxTokens?: number;
  /** Track content changes (stores local snapshots) */
  changeTracking?: boolean;
  /** Extract branding/design system (requires render=true) */
  branding?: boolean;
  /** Generate AI summary of content */
  summary?: boolean | { prompt?: string; maxLength?: number };
  /** LLM configuration for AI features (extraction, summary) */
  llm?: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
  };
  /** Extract images from the page */
  images?: boolean;
  /** Location and language preferences for browser rendering */
  location?: {
    /** ISO 3166-1 alpha-2 country code (e.g., 'US', 'DE', 'JP') */
    country?: string;
    /** Language preferences (e.g., ['en-US', 'de']) */
    languages?: string[];
  };
  /**
   * Smart token budget — intelligently distill content to fit within N tokens.
   * Uses heuristic compression (not LLM): strips boilerplate, compresses tables,
   * removes low-density paragraphs. No API key required.
   * Different from maxTokens (simple truncation) — this is smart compression.
   */
  budget?: number;
  /**
   * Proxy URL for routing requests through a proxy server.
   * Supports HTTP, HTTPS, and SOCKS5 proxies.
   * Format: protocol://[user:pass@]host:port
   * Examples:
   *   'http://proxy.example.com:8080'
   *   'http://user:pass@proxy.example.com:8080'
   *   'socks5://user:pass@proxy.example.com:1080'
   */
  proxy?: string;
  /**
   * Path to a persistent Chrome user-data-dir directory.
   * When set, cookies, history, and login sessions survive between fetch calls
   * in the same process. Each unique profileDir gets its own browser instance.
   *
   * Tip: use `--headed` first to log in, then run headless for automation.
   */
  profileDir?: string;
  /**
   * Launch the browser in headed (visible) mode.
   * Useful for setting up a profile (logging in) before running headless automation.
   * Only meaningful when `render` or `stealth` is true.
   */
  headed?: boolean;
  /**
   * Playwright storage state (cookies + localStorage) to inject into the browser context.
   * Loaded from a named profile's `storage-state.json` by the CLI profile system.
   * More reliable than `--user-data-dir` for session injection.
   */
  storageState?: any;
  /**
   * Enable agent-friendly defaults:
   * - budget: 4000 tokens (unless already set)
   * - format: 'markdown' (unless already set)
   *
   * Mirrors the CLI `--agent` flag for programmatic use.
   */
  agentMode?: boolean;
  /**
   * Disable content pruning and return the full page content.
   * By default, WebPeel automatically removes low-value blocks (sidebars,
   * footers, navigation, ads) using content density scoring.
   * Set to true to opt out and receive the complete page.
   */
  fullPage?: boolean;
  /**
   * Reader mode — extract only the main article content, strip all noise.
   * Like browser Reader Mode / Pocket / Instapaper but deterministic and fast.
   * Returns clean markdown with metadata header (title, author, date, reading time).
   * When enabled, readability metadata is included in result.readability.
   */
  readable?: boolean;
  /**
   * Intelligently scroll the page to load all lazy/infinite-scroll content
   * before extracting. Set to `true` for default settings or an object to
   * configure scroll behavior. Auto-enables browser rendering.
   *
   * @example
   * // Simple (use defaults: up to 20 scrolls, 30s timeout)
   * { autoScroll: true }
   *
   * // Customized
   * { autoScroll: { maxScrolls: 10, scrollDelay: 2000, timeout: 60000 } }
   */
  autoScroll?: boolean | import('./core/actions.js').AutoScrollOptions;
  /** Ask a question about the page content. Uses BM25 to find relevant passages — no LLM key needed. */
  question?: string;
}

export interface ImageInfo {
  /** Absolute URL of the image */
  src: string;
  /** Alt text */
  alt: string;
  /** Title attribute */
  title?: string;
  /** Width if specified */
  width?: number;
  /** Height if specified */
  height?: number;
}

export interface PeelResult {
  /** Final URL (after redirects) */
  url: string;
  /** Page title */
  title: string;
  /** Page content in requested format */
  content: string;
  /** Extracted metadata */
  metadata: PageMetadata;
  /** All links found on the page (absolute URLs, deduplicated) */
  links: string[];
  /** Estimated token count (rough: content.length / 4) */
  tokens: number;
  /** Method used: 'simple' | 'browser' | 'stealth' */
  method: 'simple' | 'browser' | 'stealth';
  /** Time elapsed in milliseconds */
  elapsed: number;
  /** Base64-encoded screenshot (PNG), only if screenshot option was set */
  screenshot?: string;
  /** Content type detected (html, json, xml, text, rss, etc.) */
  contentType?: string;
  /** Content quality score 0-1 (how clean the extraction was) */
  quality?: number;
  /** SHA256 hash of content (first 16 chars) — for change detection */
  fingerprint?: string;
  /** Extracted structured data (when extract option is used — CSS/heuristic extraction) */
  extracted?: Record<string, any>;
  /** Structured JSON from inline LLM extraction (when extract + llmProvider is used) */
  json?: Record<string, any>;
  /** Branding/design system profile */
  branding?: import('./core/branding.js').BrandingProfile;
  /** Content change tracking result */
  changeTracking?: import('./core/change-tracking.js').ChangeResult;
  /** AI-generated summary */
  summary?: string;
  /** Extracted images (when images option is set) */
  images?: ImageInfo[];
  /** Percentage of HTML pruned by content density scoring (0-100). Only present when pruning was applied. */
  prunedPercent?: number;
  /**
   * Readability extraction result (when readable option is true).
   * Contains title, author, date, reading time, excerpt, and word count.
   */
  readability?: import('./core/readability.js').ReadabilityResult;
  /** Domain-aware structured data (Twitter, Reddit, GitHub, HN). Present when URL matches a known domain. */
  domainData?: import('./core/domain-extractors.js').DomainExtractResult;
  /** Quick answer result (when question option is set). BM25-powered, no LLM needed. */
  quickAnswer?: import('./core/quick-answer.js').QuickAnswerResult;
  /** Per-stage timing breakdown in milliseconds. */
  timing?: import('./core/timing.js').PipelineTiming;
  /** Number of unique links found on the page. Always present (cheaper than full links array). */
  linkCount?: number;
  /** Schema.org type extracted from JSON-LD (e.g., "Recipe", "Product", "Article") */
  jsonLdType?: string;
  /** Content freshness metadata from HTTP response headers */
  freshness?: {
    lastModified?: string;
    etag?: string;
    fetchedAt: string;
    cacheControl?: string;
  };
}

export interface PageMetadata {
  /** Meta description */
  description?: string;
  /** Author name */
  author?: string;
  /** Published date (ISO 8601) */
  published?: string;
  /** Open Graph image URL */
  image?: string;
  /** Canonical URL */
  canonical?: string;
  /** MIME content type (set for documents like PDF/DOCX) */
  contentType?: string;
  /** Word count (set for documents like PDF/DOCX, and HTML pages) */
  wordCount?: number;
  /** Page count (set for PDF documents) */
  pages?: number;
  /** Publish date extracted from rich meta sources (ISO 8601) */
  publishDate?: string;
  /** Page language (e.g. "en", "en-US") */
  language?: string;
  /** Allow additional document-specific metadata */
  [key: string]: any;
}

/**
 * Unified response envelope for JSON CLI output (--json flag).
 *
 * All JSON output paths use this schema regardless of which flags are
 * combined (--extract-all, --extract, --meta, etc.).  Existing PeelResult
 * fields are always preserved for backward compatibility — the envelope
 * adds a consistent set of required fields on top.
 */
export interface PeelEnvelope {
  /** Final URL (after redirects) */
  url: string;
  /** HTTP status code — always 200 for successful fetches */
  status: number;
  /** Page content in markdown/text format */
  content: string;
  /**
   * Structured data extracted by --extract-all or --extract.
   * Present only when extraction was requested.
   */
  structured?: Record<string, unknown>[];
  /** Page metadata (title, description, author, OG tags, etc.) */
  metadata: {
    title?: string;
    description?: string;
    author?: string;
    [key: string]: unknown;
  };
  /** Estimated token count of content (rough: content.length / 4) */
  tokens: number;
  /** Whether this result was served from the local cache */
  cached: boolean;
  /** Total time elapsed in milliseconds */
  elapsed: number;
  /**
   * True when --budget was applied and content was distilled to fit.
   * For listings: true when fewer items are returned than available.
   */
  truncated?: boolean;
  /**
   * Total items available before budget limiting (for listings only).
   * Present only when truncated=true and using --extract-all.
   */
  totalAvailable?: number;
}

export class WebPeelError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'WebPeelError';
  }
}

export class TimeoutError extends WebPeelError {
  constructor(message: string) {
    super(message, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class BlockedError extends WebPeelError {
  constructor(message: string) {
    super(message, 'BLOCKED');
    this.name = 'BlockedError';
  }
}

export class NetworkError extends WebPeelError {
  constructor(message: string) {
    super(message, 'NETWORK');
    this.name = 'NetworkError';
  }
}
