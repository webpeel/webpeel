/**
 * Core types for WebPeel
 */

export interface PeelOptions {
  /** Use headless browser instead of simple HTTP fetch */
  render?: boolean;
  /** Wait time in milliseconds after page load (only with render=true) */
  wait?: number;
  /** Output format */
  format?: 'markdown' | 'text' | 'html';
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom user agent */
  userAgent?: string;
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
  /** Method used: 'simple' | 'browser' */
  method: 'simple' | 'browser';
  /** Time elapsed in milliseconds */
  elapsed: number;
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
