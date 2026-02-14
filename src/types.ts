/**
 * Core types for WebPeel
 */

export interface PageAction {
  type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';
  selector?: string;
  value?: string;
  key?: string;
  ms?: number;
  to?: 'top' | 'bottom' | number;
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
  /** Extracted structured data (when extract option is used) */
  extracted?: Record<string, any>;
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
