/**
 * Screenshot helper (Playwright)
 *
 * Returns a base64-encoded screenshot for a given URL.
 */

import type { PageAction } from '../types.js';
import { browserScreenshot, browserFilmstrip, browserDiff } from './fetcher.js';

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
  scrollThrough?: boolean;
  selector?: string;
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
    scrollThrough: options.scrollThrough,
    selector: options.selector,
  });

  return {
    url: finalUrl,
    format,
    contentType: format === 'png' ? 'image/png' : 'image/jpeg',
    screenshot: buffer.toString('base64'),
  };
}

// ── Filmstrip ─────────────────────────────────────────────────────────────────

export interface FilmstripOptions {
  frames?: number;
  width?: number;
  height?: number;
  /** png | jpeg | jpg (jpg is treated as jpeg) */
  format?: 'png' | 'jpeg' | 'jpg';
  quality?: number;
  waitFor?: number;
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  stealth?: boolean;
}

export interface FilmstripResult {
  url: string;
  format: ScreenshotFormat;
  contentType: string;
  /** Array of base64-encoded screenshots (no data: prefix) */
  frames: string[];
  frameCount: number;
}

export async function takeFilmstrip(url: string, options: FilmstripOptions = {}): Promise<FilmstripResult> {
  const format: ScreenshotFormat = (options.format === 'jpg' ? 'jpeg' : (options.format || 'png')) as ScreenshotFormat;

  const { frames, finalUrl } = await browserFilmstrip(url, {
    frames: options.frames,
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
  });

  return {
    url: finalUrl,
    format,
    contentType: format === 'png' ? 'image/png' : 'image/jpeg',
    frames: frames.map(f => f.toString('base64')),
    frameCount: frames.length,
  };
}

// ── Visual Diff ───────────────────────────────────────────────────────────────

export interface ScreenshotDiffOptions {
  width?: number;
  height?: number;
  fullPage?: boolean;
  threshold?: number;
  format?: 'png' | 'jpeg' | 'jpg';
  quality?: number;
  stealth?: boolean;
  waitFor?: number;
  timeout?: number;
}

export interface ScreenshotDiffResult {
  diff: string; // base64-encoded PNG diff image
  diffPixels: number;
  totalPixels: number;
  diffPercent: number;
  dimensions: { width: number; height: number };
}

export async function takeScreenshotDiff(
  url1: string,
  url2: string,
  options: ScreenshotDiffOptions = {}
): Promise<ScreenshotDiffResult> {
  const { diffBuffer, diffPixels, totalPixels, diffPercent, dimensions } = await browserDiff(url1, url2, {
    width: options.width,
    height: options.height,
    fullPage: options.fullPage,
    threshold: options.threshold,
    stealth: options.stealth,
    waitMs: options.waitFor,
    timeoutMs: options.timeout,
  });

  return {
    diff: diffBuffer.toString('base64'),
    diffPixels,
    totalPixels,
    diffPercent,
    dimensions,
  };
}

// ── Audit ─────────────────────────────────────────────────────────────────────

import { browserAudit, browserAnimationCapture, browserViewports, browserDesignAudit, browserDesignAnalysis } from './fetcher.js';
export type { DesignAuditResult, DesignAnalysis, EffectInstance } from './fetcher.js';
import type { DesignAnalysis } from './fetcher.js';

export interface AuditOptions {
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg' | 'jpg';
  quality?: number;
  selector?: string;
  waitFor?: number;
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  stealth?: boolean;
  scrollThrough?: boolean;
}

export interface AuditSection {
  index: number;
  tag: string;
  id: string;
  className: string;
  top: number;
  height: number;
  screenshot: string; // base64
}

export interface AuditResult {
  url: string;
  format: ScreenshotFormat;
  sections: AuditSection[];
}

export async function takeAuditScreenshots(url: string, options: AuditOptions = {}): Promise<AuditResult> {
  const format: ScreenshotFormat = (options.format === 'jpg' ? 'jpeg' : (options.format || 'jpeg')) as ScreenshotFormat;

  const { frames, finalUrl } = await browserAudit(url, {
    width: options.width,
    height: options.height,
    format,
    quality: options.quality,
    selector: options.selector,
    waitMs: options.waitFor,
    timeoutMs: options.timeout,
    userAgent: options.userAgent,
    headers: options.headers,
    cookies: options.cookies,
    stealth: options.stealth,
    scrollThrough: options.scrollThrough,
  });

  return {
    url: finalUrl,
    format,
    sections: frames.map(f => ({
      index: f.index,
      tag: f.tag,
      id: f.id,
      className: f.className,
      top: f.top,
      height: f.height,
      screenshot: f.buffer.toString('base64'),
    })),
  };
}

// ── Animation Capture ─────────────────────────────────────────────────────────

export interface AnimationCaptureOptions {
  frames?: number;
  intervalMs?: number;
  scrollTo?: number;
  selector?: string;
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg' | 'jpg';
  quality?: number;
  waitFor?: number;
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  stealth?: boolean;
}

export interface AnimationFrame {
  index: number;
  timestampMs: number;
  screenshot: string; // base64
}

export interface AnimationCaptureResult {
  url: string;
  format: ScreenshotFormat;
  frames: AnimationFrame[];
  frameCount: number;
}

export async function takeAnimationCapture(url: string, options: AnimationCaptureOptions = {}): Promise<AnimationCaptureResult> {
  const format: ScreenshotFormat = (options.format === 'jpg' ? 'jpeg' : (options.format || 'jpeg')) as ScreenshotFormat;

  const { frames, finalUrl } = await browserAnimationCapture(url, {
    frames: options.frames,
    intervalMs: options.intervalMs,
    scrollTo: options.scrollTo,
    selector: options.selector,
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
  });

  return {
    url: finalUrl,
    format,
    frames: frames.map(f => ({
      index: f.index,
      timestampMs: f.timestampMs,
      screenshot: f.buffer.toString('base64'),
    })),
    frameCount: frames.length,
  };
}

// ── Multi-Viewport Batch ──────────────────────────────────────────────────────

export interface ViewportSpec {
  width: number;
  height: number;
  label?: string;
}

export interface ViewportsBatchOptions {
  viewports: ViewportSpec[];
  fullPage?: boolean;
  format?: 'png' | 'jpeg' | 'jpg';
  quality?: number;
  waitFor?: number;
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  stealth?: boolean;
  scrollThrough?: boolean;
}

export interface ViewportResult {
  width: number;
  height: number;
  label: string;
  screenshot: string; // base64
}

export interface ViewportsBatchResult {
  url: string;
  format: ScreenshotFormat;
  viewports: ViewportResult[];
}

export async function takeViewportsBatch(url: string, options: ViewportsBatchOptions): Promise<ViewportsBatchResult> {
  const format: ScreenshotFormat = (options.format === 'jpg' ? 'jpeg' : (options.format || 'jpeg')) as ScreenshotFormat;

  const { frames, finalUrl } = await browserViewports(url, {
    viewports: options.viewports,
    fullPage: options.fullPage,
    format,
    quality: options.quality,
    waitMs: options.waitFor,
    timeoutMs: options.timeout,
    userAgent: options.userAgent,
    headers: options.headers,
    cookies: options.cookies,
    stealth: options.stealth,
    scrollThrough: options.scrollThrough,
  });

  return {
    url: finalUrl,
    format,
    viewports: frames.map(f => ({
      width: f.width,
      height: f.height,
      label: f.label,
      screenshot: f.buffer.toString('base64'),
    })),
  };
}

// ── Design Audit ──────────────────────────────────────────────────────────────

export interface DesignAuditOptions {
  rules?: {
    spacingGrid?: number;
    minTouchTarget?: number;
    minContrast?: number;
  };
  selector?: string;
  width?: number;
  height?: number;
  waitFor?: number;
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  stealth?: boolean;
}

export interface DesignAuditSummaryResult {
  url: string;
  audit: import('./fetcher.js').DesignAuditResult;
}

export async function takeDesignAudit(url: string, options: DesignAuditOptions = {}): Promise<DesignAuditSummaryResult> {
  const { audit, finalUrl } = await browserDesignAudit(url, {
    rules: options.rules,
    selector: options.selector,
    width: options.width,
    height: options.height,
    waitMs: options.waitFor,
    timeoutMs: options.timeout,
    userAgent: options.userAgent,
    headers: options.headers,
    cookies: options.cookies,
    stealth: options.stealth,
  });

  return { url: finalUrl, audit };
}

// ── Design Analysis ────────────────────────────────────────────────────────────

export interface DesignAnalysisOptions {
  selector?: string;
  width?: number;
  height?: number;
  waitFor?: number;
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string[];
  stealth?: boolean;
}

export interface DesignAnalysisSummaryResult {
  url: string;
  analysis: DesignAnalysis;
}

export async function takeDesignAnalysis(url: string, options: DesignAnalysisOptions = {}): Promise<DesignAnalysisSummaryResult> {
  const { analysis, finalUrl } = await browserDesignAnalysis(url, {
    selector: options.selector,
    width: options.width,
    height: options.height,
    waitMs: options.waitFor,
    timeoutMs: options.timeout,
    userAgent: options.userAgent,
    headers: options.headers,
    cookies: options.cookies,
    stealth: options.stealth,
  });

  return { url: finalUrl, analysis };
}
