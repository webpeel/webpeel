#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * WebPeel Benchmark Suite
 *
 * Runs multiple scraping "runners" against a fixed corpus of URLs and produces
 * a blog-post-ready JSON report with per-URL metrics + summary stats.
 *
 * Usage:
 *   npx tsx benchmarks/run.ts --runner webpeel-local --urls all --output benchmarks/results.json
 */

import { Command } from 'commander';
import { fetch as undiciFetch } from 'undici';
import * as cheerio from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

import { peel, cleanup, type PeelResult } from '../src/index.js';

type TierId = 'static' | 'dynamic' | 'spa' | 'protected' | 'documents' | 'edge';

type MethodUsed = 'simple' | 'browser' | 'stealth' | 'unknown';

type RunnerId =
  | 'webpeel-local'
  | 'webpeel-api'
  | 'firecrawl'
  | 'tavily'
  | 'jina-reader'
  | 'scrapingbee'
  | 'exa'
  | 'linkup'
  | 'raw-fetch';

interface BenchmarkUrl {
  tier: TierId;
  url: string;
  expectedTitle?: string | RegExp;
}

interface BenchmarkResult {
  tier: TierId;
  url: string;

  latency_ms: number;
  success: boolean;
  status_code: number | null;
  content_length: number;
  token_count: number;
  has_title: boolean;
  has_metadata: boolean;
  link_count: number;
  content_quality: number;
  method_used: MethodUsed;
  error: string | null;

  // Extra fields useful for debugging/blog posts (non-required)
  title?: string;
}

interface RunnerSummary {
  total: number;
  success_count: number;
  success_rate: number;
  median_latency_ms: number;
  p95_latency_ms: number;
  avg_content_quality: number;
  avg_token_count: number;
  tier_success: Record<TierId, { total: number; success: number }>;
}

interface RunnerReport {
  runner: RunnerId;
  results: BenchmarkResult[];
  summary: RunnerSummary;
  skipped?: boolean;
  skip_reason?: string;
}

const URLS: BenchmarkUrl[] = [
  // Tier 1 — Static HTML (easy)
  { tier: 'static', url: 'https://en.wikipedia.org/wiki/Web_scraping', expectedTitle: /web\s*scraping/i },
  { tier: 'static', url: 'https://news.ycombinator.com', expectedTitle: /hacker\s*news/i },
  { tier: 'static', url: 'https://httpbin.org/html', expectedTitle: /httpbin/i },
  { tier: 'static', url: 'https://example.com', expectedTitle: /example\s*domain/i },
  { tier: 'static', url: 'https://www.paulgraham.com/articles.html', expectedTitle: /paul\s*graham|articles/i },

  // Tier 2 — Dynamic content (medium)
  { tier: 'dynamic', url: 'https://github.com/anthropics/anthropic-sdk-python', expectedTitle: /anthropic\s*-?\s*sdk|github/i },
  { tier: 'dynamic', url: 'https://docs.python.org/3/tutorial/index.html', expectedTitle: /python\s*tutorial/i },
  { tier: 'dynamic', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', expectedTitle: /javascript|mdn/i },
  { tier: 'dynamic', url: 'https://stackoverflow.com/questions/tagged/javascript', expectedTitle: /javascript\s*questions|stack\s*overflow/i },
  { tier: 'dynamic', url: 'https://www.npmjs.com/package/express', expectedTitle: /express\s*-\s*npm|express/i },

  // Tier 3 — JS-heavy / SPA (hard)
  { tier: 'spa', url: 'https://react.dev', expectedTitle: /react/i },
  { tier: 'spa', url: 'https://nextjs.org/docs', expectedTitle: /next\.js|nextjs/i },
  { tier: 'spa', url: 'https://vercel.com/templates', expectedTitle: /templates|vercel/i },
  { tier: 'spa', url: 'https://tailwindcss.com/docs/installation', expectedTitle: /tailwind|installation/i },
  { tier: 'spa', url: 'https://supabase.com/docs', expectedTitle: /supabase|docs/i },

  // Tier 4 — Protected / Anti-bot (hardest)
  { tier: 'protected', url: 'https://www.cloudflare.com/learning/what-is-cloudflare/', expectedTitle: /what\s*is\s*cloudflare|cloudflare/i },
  { tier: 'protected', url: 'https://linkedin.com/company/anthropic', expectedTitle: /anthropic|linkedin/i },
  { tier: 'protected', url: 'https://medium.com/@anthropic/introducing-claude-3-5-sonnet-a53f88e9e9ae', expectedTitle: /claude\s*3\.?5|sonnet|medium/i },
  { tier: 'protected', url: 'https://www.bloomberg.com/technology', expectedTitle: /bloomberg|technology/i },
  { tier: 'protected', url: 'https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm', expectedTitle: /anthropic|glassdoor/i },

  // Tier 5 — Documents & Special content
  { tier: 'documents', url: 'https://arxiv.org/abs/2303.08774', expectedTitle: /arxiv|2303\.08774/i },
  { tier: 'documents', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm', expectedTitle: /apple|aapl|form\s*10-k|sec/i },
  { tier: 'documents', url: 'https://www.w3.org/TR/html52/', expectedTitle: /html\s*5\.2|w3c|html52/i },
  { tier: 'documents', url: 'https://tools.ietf.org/html/rfc7231', expectedTitle: /rfc\s*7231|ietf/i },
  { tier: 'documents', url: 'https://unicode.org/reports/tr9/', expectedTitle: /unicode|tr9|bidirectional/i },

  // Tier 6 — International / Edge cases
  { tier: 'edge', url: 'https://ja.wikipedia.org/wiki/%E4%BA%BA%E5%B7%A5%E7%9F%A5%E8%83%BD', expectedTitle: /人工知能|wikipedia/i },
  { tier: 'edge', url: 'https://www.bbc.com/news', expectedTitle: /bbc\s*news|news/i },
  { tier: 'edge', url: 'https://www.reddit.com/r/programming/top/?t=month', expectedTitle: /programming|reddit/i },
  { tier: 'edge', url: 'https://news.google.com', expectedTitle: /google\s*news|news/i },
  { tier: 'edge', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expectedTitle: /youtube|rick\s*astley|never\s*gonna\s*give\s*you\s*up/i },
];

function nowIso(): string {
  return new Date().toISOString();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function estimateTokensBySpec(content: string): number {
  return Math.max(0, Math.round(content.length / 4));
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function hasMeaningfulText(content: string): boolean {
  const text = normalizeText(content);
  if (text.length < 100) return false;

  // crude heuristic: needs some word diversity
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const unique = new Set(words);
  const diversity = unique.size / Math.max(1, words.length);
  return unique.size >= 30 && diversity > 0.15;
}

function looksLikeBlockOrError(content: string): boolean {
  const hay = content.toLowerCase();
  const patterns = [
    'access denied',
    'request blocked',
    'forbidden',
    'service unavailable',
    'unusual traffic',
    'verify you are a human',
    'captcha',
    'cloudflare',
    'attention required',
    'enable javascript',
    'bot detection',
    'temporarily unavailable',
  ];
  return patterns.some(p => hay.includes(p));
}

function titleMatchesExpected(title: string, expected?: string | RegExp): boolean {
  if (!expected) return true; // no expectation provided
  if (!title) return false;
  if (expected instanceof RegExp) return expected.test(title);
  return title.toLowerCase().includes(expected.toLowerCase());
}

function computeContentQuality(params: {
  content: string;
  title: string;
  expectedTitle?: string | RegExp;
  hasMetadata: boolean;
  linkCount: number;
}): number {
  const { content, title, expectedTitle, hasMetadata, linkCount } = params;

  let score = 0;

  const text = normalizeText(content);
  const hasTitle = !!normalizeText(title);

  if (text.length > 100) score += 0.35;
  else if (text.length > 20) score += 0.1;

  if (hasMeaningfulText(text)) score += 0.25;

  if (hasTitle) score += 0.15;

  if (titleMatchesExpected(title, expectedTitle)) score += 0.15;

  if (hasMetadata) score += 0.05;

  if (linkCount > 5) score += 0.05;

  if (looksLikeBlockOrError(text) || looksLikeBlockOrError(title)) score -= 0.5;

  score = Math.max(0, Math.min(1, score));
  return Math.round(score * 1000) / 1000;
}

function computeHasMetadata(metadata: any): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  for (const v of Object.values(metadata)) {
    if (typeof v === 'string' && v.trim().length > 0) return true;
    if (typeof v === 'number' && Number.isFinite(v)) return true;
    if (Array.isArray(v) && v.length > 0) return true;
    if (v && typeof v === 'object' && Object.keys(v).length > 0) return true;
  }
  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // @ts-expect-error - undici types vs lib.dom can disagree in TS configs
    return await undiciFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function stderrLine(line: string): void {
  process.stderr.write(line.endsWith('\n') ? line : line + '\n');
}

/**
 * Run an array of async tasks with bounded concurrency.
 * concurrency=1 means strictly serial (one at a time).
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  if (concurrency <= 1) {
    // Strictly serial — run one by one
    const results: T[] = [];
    for (const task of tasks) {
      results.push(await task());
    }
    return results;
  }

  // Parallel with bounded concurrency
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]!();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ------------------------------------------------------------
// Runner implementations
// ------------------------------------------------------------

async function runWebPeelLocal(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const result: PeelResult & { statusCode?: number } = await peel(target.url, {
    timeout: timeoutMs,
  });

  return {
    statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
    title: result.title || '',
    content: result.content || '',
    links: result.links || [],
    metadata: result.metadata || {},
    method: (result.method as MethodUsed) || 'unknown',
  };
}

async function runWebPeelApi(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const apiKey = process.env.WEBPEEL_API_KEY || process.env.WEBPEEL_API_TOKEN || '';
  const u = new URL('https://api.webpeel.dev/v1/fetch');
  u.searchParams.set('url', target.url);

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const resp = await fetchWithTimeout(u.toString(), { method: 'GET', headers }, timeoutMs);
  const statusCode = resp.status;

  let data: any;
  try {
    data = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    throw new Error(`Non-JSON response (${statusCode}): ${text.slice(0, 200)}`);
  }

  if (!resp.ok) {
    const msg = data?.message || data?.error || `HTTP ${statusCode}`;
    throw new Error(String(msg));
  }

  return {
    statusCode,
    title: data?.title || '',
    content: data?.content || '',
    links: Array.isArray(data?.links) ? data.links : [],
    metadata: data?.metadata || {},
    method: (data?.method as MethodUsed) || 'unknown',
  };
}

async function runFirecrawl(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY not set');

  const body = {
    url: target.url,
    formats: ['markdown'],
  };

  const resp = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'x-api-key': key,
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const statusCode = resp.status;
  const data = await resp.json().catch(async () => ({
    success: false,
    error: await resp.text().catch(() => ''),
  }));

  if (!resp.ok || data?.success === false) {
    const msg = data?.error || data?.message || `HTTP ${statusCode}`;
    throw new Error(String(msg));
  }

  const payload = data?.data ?? data;
  const content = payload?.markdown || payload?.content || '';
  const metadata = payload?.metadata || {};

  const links: string[] = Array.isArray(payload?.links)
    ? payload.links
    : [];

  return {
    statusCode,
    title: metadata?.title || payload?.title || '',
    content,
    links,
    metadata,
    method: 'unknown',
  };
}

async function runTavily(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY not set');

  const body: any = {
    api_key: key,
    urls: [target.url],
  };

  const resp = await fetchWithTimeout('https://api.tavily.com/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const statusCode = resp.status;
  const data = await resp.json().catch(async () => ({
    error: await resp.text().catch(() => ''),
  }));

  if (!resp.ok) {
    const msg = data?.error || data?.message || `HTTP ${statusCode}`;
    throw new Error(String(msg));
  }

  // Tavily often returns: { results: [{ url, content, raw_content, title, ... }] }
  const first = Array.isArray(data?.results) ? data.results[0] : (Array.isArray(data) ? data[0] : null);
  if (!first) {
    throw new Error('Tavily: missing results');
  }

  const content = first?.content || first?.raw_content || '';
  const title = first?.title || '';

  // Links are not always provided; attempt a cheap extraction from raw_content if it looks like HTML.
  const links: string[] = [];
  try {
    if (typeof first?.raw_content === 'string' && first.raw_content.trimStart().startsWith('<')) {
      const $ = cheerio.load(first.raw_content);
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) links.push(href);
      });
    }
  } catch {
    // ignore
  }

  return {
    statusCode,
    title,
    content,
    links: [...new Set(links)],
    metadata: {},
    method: 'unknown',
  };
}

async function runRawFetch(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const resp = await fetchWithTimeout(target.url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WebPeelBench/1.0; +https://webpeel.dev)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }, timeoutMs);

  const statusCode = resp.status;
  const html = await resp.text();

  const $ = cheerio.load(html);
  const title = normalizeText($('title').first().text());

  const metadata: Record<string, any> = {};
  const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content');
  if (desc) metadata.description = normalizeText(desc);
  const author = $('meta[name="author"]').attr('content');
  if (author) metadata.author = normalizeText(author);

  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const abs = new URL(href, target.url).toString();
      links.push(abs);
    } catch {
      // ignore
    }
  });

  // Baseline "content" extraction: prefer <main>, else <article>, else body.
  // Strip scripts/styles to reduce noise.
  $('script, style, noscript').remove();

  const main = $('main');
  const article = $('article');
  const contentRoot = main.length ? main : (article.length ? article : $('body'));
  const content = normalizeText(contentRoot.text());

  return {
    statusCode,
    title,
    content,
    links: [...new Set(links)],
    metadata,
    method: 'simple',
  };
}

async function runJinaReader(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const key = process.env.JINA_API_KEY || '';
  const jinaUrl = `https://r.jina.ai/${target.url}`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-Return-Format': 'markdown',
  };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const resp = await fetchWithTimeout(jinaUrl, { method: 'GET', headers }, timeoutMs);
  const statusCode = resp.status;

  let data: any;
  try {
    data = await resp.json();
  } catch {
    // Jina may return plain markdown without JSON wrapper
    const text = await resp.text().catch(() => '');
    if (!resp.ok) throw new Error(`HTTP ${statusCode}: ${text.slice(0, 200)}`);
    // Parse title from first markdown heading
    const headingMatch = text.match(/^#\s+(.+)/m);
    return {
      statusCode,
      title: headingMatch?.[1] || '',
      content: text,
      links: [],
      metadata: {},
      method: 'unknown',
    };
  }

  if (!resp.ok) {
    const msg = data?.message || data?.error || `HTTP ${statusCode}`;
    throw new Error(String(msg));
  }

  const content = data?.data?.content || data?.content || '';
  const title = data?.data?.title || data?.title || '';
  const description = data?.data?.description || data?.description || '';

  // Extract links from data if available
  const links: string[] = [];
  if (Array.isArray(data?.data?.links)) {
    links.push(...data.data.links);
  }

  return {
    statusCode,
    title,
    content,
    links: [...new Set(links)],
    metadata: { description },
    method: 'unknown',
  };
}

async function runScrapingBee(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error('SCRAPINGBEE_API_KEY not set');

  const u = new URL('https://app.scrapingbee.com/api/v1/');
  u.searchParams.set('api_key', key);
  u.searchParams.set('url', target.url);
  u.searchParams.set('render_js', 'false');
  u.searchParams.set('extract_rules', JSON.stringify({ title: 'title', body: 'body' }));

  const resp = await fetchWithTimeout(u.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  }, timeoutMs);

  const statusCode = resp.status;

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${statusCode}: ${text.slice(0, 200)}`);
  }

  let data: any;
  const rawText = await resp.text();

  try {
    data = JSON.parse(rawText);
  } catch {
    // ScrapingBee may return raw HTML when extract_rules aren't applicable
    const $ = cheerio.load(rawText);
    const title = normalizeText($('title').first().text());
    $('script, style, noscript').remove();
    const main = $('main');
    const article = $('article');
    const contentRoot = main.length ? main : (article.length ? article : $('body'));
    const content = normalizeText(contentRoot.text());
    const links: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try { links.push(new URL(href, target.url).toString()); } catch { /* ignore */ }
      }
    });
    const desc = $('meta[name="description"]').attr('content') || '';
    return {
      statusCode,
      title,
      content,
      links: [...new Set(links)],
      metadata: desc ? { description: normalizeText(desc) } : {},
      method: 'unknown',
    };
  }

  // If we got JSON extract_rules response
  const title = typeof data?.title === 'string' ? normalizeText(data.title) : '';
  const body = typeof data?.body === 'string' ? data.body : '';

  // Parse body HTML for content and links
  const $ = cheerio.load(body || '<body></body>');
  $('script, style, noscript').remove();
  const content = normalizeText($('body').text());
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      try { links.push(new URL(href, target.url).toString()); } catch { /* ignore */ }
    }
  });

  return {
    statusCode,
    title,
    content,
    links: [...new Set(links)],
    metadata: {},
    method: 'unknown',
  };
}

async function runExa(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error('EXA_API_KEY not set');

  const resp = await fetchWithTimeout('https://api.exa.ai/contents', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      urls: [target.url],
      text: true,
      livecrawl: 'auto',
    }),
  }, timeoutMs);

  const statusCode = resp.status;
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${statusCode}: ${text.slice(0, 200)}`);
  }

  const data: any = await resp.json();
  const result = data?.results?.[0];
  if (!result) throw new Error('Exa: no results returned');

  const title = normalizeText(result.title || '');
  const content = normalizeText(result.text || '');
  const links: string[] = [];

  return {
    statusCode,
    title,
    content,
    links,
    metadata: { author: result.author || null },
    method: 'unknown',
  };
}

async function runLinkUp(target: BenchmarkUrl, timeoutMs: number): Promise<{
  statusCode: number | null;
  title: string;
  content: string;
  links: string[];
  metadata: any;
  method: MethodUsed;
}> {
  const key = process.env.LINKUP_API_KEY;
  if (!key) throw new Error('LINKUP_API_KEY not set');

  const resp = await fetchWithTimeout('https://api.linkup.so/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      q: target.url,
      depth: 'standard',
      outputType: 'sourcedAnswer',
    }),
  }, timeoutMs);

  const statusCode = resp.status;
  let data: any;

  try {
    data = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    if (!resp.ok) throw new Error(`HTTP ${statusCode}: ${text.slice(0, 200)}`);
    data = { answer: text };
  }

  if (!resp.ok) {
    const msg = data?.message || data?.error || `HTTP ${statusCode}`;
    throw new Error(String(msg));
  }

  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const links = [...new Set(
    sources
      .map((s: any) => (typeof s?.url === 'string' ? s.url : ''))
      .filter(Boolean),
  )];

  const answer = typeof data?.answer === 'string' ? data.answer : '';
  const snippets = sources
    .map((s: any) => (typeof s?.snippet === 'string' ? s.snippet : ''))
    .filter(Boolean)
    .join('\n\n');

  const content = normalizeText([answer, snippets].filter(Boolean).join('\n\n'));
  const title = normalizeText(typeof sources[0]?.name === 'string' ? sources[0].name : '');

  return {
    statusCode,
    title,
    content,
    links,
    metadata: { source_count: sources.length },
    method: 'unknown',
  };
}

function getRunner(runner: RunnerId) {
  switch (runner) {
    case 'webpeel-local':
      return runWebPeelLocal;
    case 'webpeel-api':
      return runWebPeelApi;
    case 'firecrawl':
      return runFirecrawl;
    case 'tavily':
      return runTavily;
    case 'jina-reader':
      return runJinaReader;
    case 'scrapingbee':
      return runScrapingBee;
    case 'exa':
      return runExa;
    case 'linkup':
      return runLinkUp;
    case 'raw-fetch':
      return runRawFetch;
    default: {
      const _exhaustive: never = runner;
      throw new Error(`Unknown runner: ${_exhaustive}`);
    }
  }
}

function summarize(results: BenchmarkResult[]): RunnerSummary {
  const total = results.length;
  const successResults = results.filter(r => r.success);
  const success_count = successResults.length;
  const success_rate = total === 0 ? 0 : success_count / total;

  const latencies = results.map(r => r.latency_ms).sort((a, b) => a - b);
  const median_latency_ms = median(latencies);
  const p95_latency_ms = percentile(latencies, 95);

  const avg_content_quality = mean(results.map(r => r.content_quality));
  const avg_token_count = mean(results.map(r => r.token_count));

  const tier_success: RunnerSummary['tier_success'] = {
    static: { total: 0, success: 0 },
    dynamic: { total: 0, success: 0 },
    spa: { total: 0, success: 0 },
    protected: { total: 0, success: 0 },
    documents: { total: 0, success: 0 },
    edge: { total: 0, success: 0 },
  };

  for (const r of results) {
    tier_success[r.tier].total++;
    if (r.success) tier_success[r.tier].success++;
  }

  return {
    total,
    success_count,
    success_rate: Math.round(success_rate * 1000) / 1000,
    median_latency_ms,
    p95_latency_ms,
    avg_content_quality: Math.round(avg_content_quality * 1000) / 1000,
    avg_token_count: Math.round(avg_token_count),
    tier_success,
  };
}

async function runOneRunner(params: {
  runner: RunnerId;
  targets: BenchmarkUrl[];
  concurrency: number;
  timeoutMs: number;
}): Promise<RunnerReport> {
  const { runner, targets, concurrency, timeoutMs } = params;

  // Optional runners: if missing key, mark as skipped.
  if (runner === 'firecrawl' && !process.env.FIRECRAWL_API_KEY) {
    return {
      runner,
      results: [],
      summary: summarize([]),
      skipped: true,
      skip_reason: 'FIRECRAWL_API_KEY not set',
    };
  }

  if (runner === 'tavily' && !process.env.TAVILY_API_KEY) {
    return {
      runner,
      results: [],
      summary: summarize([]),
      skipped: true,
      skip_reason: 'TAVILY_API_KEY not set',
    };
  }

  if (runner === 'scrapingbee' && !process.env.SCRAPINGBEE_API_KEY) {
    return {
      runner,
      results: [],
      summary: summarize([]),
      skipped: true,
      skip_reason: 'SCRAPINGBEE_API_KEY not set',
    };
  }

  if (runner === 'exa' && !process.env.EXA_API_KEY) {
    return {
      runner,
      results: [],
      summary: summarize([]),
      skipped: true,
      skip_reason: 'EXA_API_KEY not set',
    };
  }

  if (runner === 'linkup' && !process.env.LINKUP_API_KEY) {
    return {
      runner,
      results: [],
      summary: summarize([]),
      skipped: true,
      skip_reason: 'LINKUP_API_KEY not set',
    };
  }

  // Jina Reader works without a key (free tier) but rate-limited; key is optional.

  const impl = getRunner(runner);
  const total = targets.length;

  // Build task array — each task fetches one URL and returns a BenchmarkResult
  const tasks = targets.map((target, taskIdx) => async (): Promise<BenchmarkResult> => {
    const idx = taskIdx + 1;
    const start = Date.now();

    try {
      const out = await impl(target, timeoutMs);
      const latency_ms = Date.now() - start;

      const title = out.title || '';
      const content = out.content || '';
      const linkCount = Array.isArray(out.links) ? out.links.length : 0;
      const hasTitle = normalizeText(title).length > 0;
      const hasMetadata = computeHasMetadata(out.metadata);

      const content_length = Buffer.byteLength(content, 'utf8');
      const token_count = estimateTokensBySpec(content);

      const content_quality = computeContentQuality({
        content,
        title,
        expectedTitle: target.expectedTitle,
        hasMetadata,
        linkCount,
      });

      const status_code = typeof out.statusCode === 'number' ? out.statusCode : null;

      const success =
        (status_code === null || (status_code >= 200 && status_code < 400)) &&
        content_length > 0 &&
        content_quality >= 0.2;

      stderrLine(
        `[${idx}/${total}] ${runner} ${target.tier} OK ${latency_ms}ms method=${out.method} status=${status_code ?? 'n/a'} quality=${content_quality} tokens=${token_count} url=${target.url}`
      );

      return {
        tier: target.tier,
        url: target.url,
        latency_ms,
        success,
        status_code,
        content_length,
        token_count,
        has_title: hasTitle,
        has_metadata: hasMetadata,
        link_count: linkCount,
        content_quality,
        method_used: out.method || 'unknown',
        error: null,
        title: hasTitle ? title : undefined,
      };
    } catch (err) {
      const latency_ms = Date.now() - start;
      const msg = toErrorMessage(err);

      stderrLine(
        `[${idx}/${total}] ${runner} ${target.tier} FAIL ${latency_ms}ms error=${JSON.stringify(msg)} url=${target.url}`
      );

      return {
        tier: target.tier,
        url: target.url,
        latency_ms,
        success: false,
        status_code: null,
        content_length: 0,
        token_count: 0,
        has_title: false,
        has_metadata: false,
        link_count: 0,
        content_quality: 0,
        method_used: 'unknown',
        error: msg,
      };
    }
  });

  const results = await runWithConcurrency(tasks, concurrency);

  return {
    runner,
    results,
    summary: summarize(results),
  };
}

function parseRunnerList(input: string): RunnerId[] {
  const trimmed = input.trim();
  if (trimmed === 'all') {
    return ['webpeel-local', 'webpeel-api', 'raw-fetch', 'firecrawl', 'tavily', 'jina-reader', 'scrapingbee', 'exa', 'linkup'];
  }
  return trimmed
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const allowed: RunnerId[] = ['webpeel-local', 'webpeel-api', 'raw-fetch', 'firecrawl', 'tavily', 'jina-reader', 'scrapingbee', 'exa', 'linkup'];
      if (!allowed.includes(s as RunnerId)) {
        throw new Error(`Invalid --runner ${JSON.stringify(s)}. Allowed: ${allowed.join(', ')}, all`);
      }
      return s as RunnerId;
    });
}

function parseTierList(input?: string): TierId[] | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === 'all') return null;
  const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
  const allowed: TierId[] = ['static', 'dynamic', 'spa', 'protected', 'documents', 'edge'];
  for (const p of parts) {
    if (!allowed.includes(p as TierId)) {
      throw new Error(`Invalid --tier ${JSON.stringify(p)}. Allowed: ${allowed.join(', ')}, all`);
    }
  }
  return parts as TierId[];
}

async function main() {
  const program = new Command();
  program
    .name('webpeel-bench')
    .description('Benchmark web scraping runners across a fixed set of URLs')
    .option('--runner <id>', 'Runner to use: webpeel-local | webpeel-api | raw-fetch | firecrawl | tavily | jina-reader | scrapingbee | exa | linkup | all', 'webpeel-local')
    .option('--urls <preset>', 'URL set to run (currently only: all)', 'all')
    .option('--tier <tiers>', 'Comma-separated tier filter: static,dynamic,spa,protected,documents,edge (or all)', '')
    .option('--concurrency <n>', 'Concurrency per runner (default: 1)', '1')
    .option('--timeout <ms>', 'Timeout per URL in ms (default: 30000)', '30000')
    .option('--output <path>', 'Output JSON path', 'benchmarks/results.json');

  program.parse(process.argv);
  const opts = program.opts();

  if (opts.urls !== 'all') {
    throw new Error(`Only --urls all is supported right now (got ${JSON.stringify(opts.urls)})`);
  }

  const runners = parseRunnerList(String(opts.runner));
  const concurrency = Math.max(1, Number.parseInt(String(opts.concurrency), 10) || 1);
  const timeoutMs = Math.max(1, Number.parseInt(String(opts.timeout), 10) || 30000);

  const tierFilter = parseTierList(String(opts.tier || '').trim() || undefined);
  const targets = tierFilter ? URLS.filter(u => tierFilter.includes(u.tier)) : URLS;

  stderrLine(`WebPeel Bench — ${nowIso()}`);
  stderrLine(`Runners: ${runners.join(', ')} | URLs: ${targets.length} | concurrency=${concurrency} | timeoutMs=${timeoutMs}`);
  if (tierFilter) stderrLine(`Tier filter: ${tierFilter.join(', ')}`);

  const runnersReport: Record<string, any> = {};

  for (const runner of runners) {
    stderrLine(`\n=== Runner: ${runner} ===`);
    const report = await runOneRunner({ runner, targets, concurrency, timeoutMs });
    runnersReport[runner] = {
      results: report.results,
      summary: report.summary,
      ...(report.skipped ? { skipped: true, skip_reason: report.skip_reason } : {}),
    };

    // Runner-level cleanup for local playwright resources.
    if (runner === 'webpeel-local') {
      await cleanup().catch(() => {});
    }
  }

  const outputPath = String(opts.output);
  await mkdir(dirname(outputPath), { recursive: true });

  const report = {
    timestamp: nowIso(),
    runners: runnersReport,
  };

  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  stderrLine(`\nWrote ${outputPath}`);

  // Print a quick summary table to stderr
  for (const [name, data] of Object.entries(runnersReport)) {
    const s = data.summary;
    if (data.skipped) {
      stderrLine(`\n${name}: SKIPPED (${data.skip_reason})`);
      continue;
    }
    stderrLine(`\n┌── ${name} ──────────────────────────────────────`);
    stderrLine(`│ Success: ${s.success_count}/${s.total} (${(s.success_rate * 100).toFixed(1)}%)`);
    stderrLine(`│ Latency: median=${s.median_latency_ms}ms  p95=${s.p95_latency_ms}ms`);
    stderrLine(`│ Quality: avg=${s.avg_content_quality}  tokens/page=${s.avg_token_count}`);
    for (const [tier, ts] of Object.entries(s.tier_success)) {
      const pct = ts.total > 0 ? ((ts.success / ts.total) * 100).toFixed(0) : '0';
      stderrLine(`│   ${tier.padEnd(10)} ${ts.success}/${ts.total} (${pct}%)`);
    }
    stderrLine(`└───────────────────────────────────────────────`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
