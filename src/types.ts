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
  /** Word count (set for documents like PDF/DOCX) */
  wordCount?: number;
  /** Page count (set for PDF documents) */
  pages?: number;
  /** Allow additional document-specific metadata */
  [key: string]: any;
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
