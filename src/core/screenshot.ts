/**
 * Screenshot helper (Playwright)
 *
 * Returns a base64-encoded screenshot for a given URL.
 */

import type { PageAction } from '../types.js';
import { browserScreenshot } from './fetcher.js';

export type ScreenshotFormat = 'png' | 'jpeg';

export interface ScreenshotOptions {
  fullPage?: boolean;
  width?: number;
  height?: number;
  /** png | jpeg | jpg (jpg is treated as jpeg) */
  format?: 'png' | 'jpeg' | 'jpg';
  /** JPEG quality (1-100). Ignored for PNG. */
  quality?: number;
  /** Wait in ms after page load (domcontentloaded) */
  waitFor?: number;
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  stealth?: boolean;
  actions?: PageAction[];
}

export interface ScreenshotResult {
  url: string;
  format: ScreenshotFormat;
  contentType: string;
  /** Base64-encoded image bytes (no data: prefix) */
  screenshot: string;
}

export async function takeScreenshot(url: string, options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const format: ScreenshotFormat = (options.format === 'jpg' ? 'jpeg' : (options.format || 'png')) as ScreenshotFormat;

  const { buffer, finalUrl } = await browserScreenshot(url, {
    fullPage: options.fullPage || false,
    width: options.width,
    height: options.height,
    format,
    quality: options.quality,
    waitMs: options.waitFor,
    timeoutMs: options.timeout,
    userAgent: options.userAgent,
    headers: options.headers,
    cookies: options.cookies,
    stealth: options.stealth,
    actions: options.actions,
  });

  return {
    url: finalUrl,
    format,
    contentType: format === 'png' ? 'image/png' : 'image/jpeg',
    screenshot: buffer.toString('base64'),
  };
}
