/**
 * WebPeel pipeline stages
 *
 * Each stage is an exported async function that reads from / writes to the
 * mutable PipelineContext.  The stages are called in order by peel().
 */

import { createHash } from 'crypto';
import { smartFetch } from './strategies.js';
import {
  htmlToMarkdown,
  htmlToText,
  cleanForAI,
  estimateTokens,
  selectContent,
  detectMainContent,
  calculateQuality,
  truncateToTokenBudget,
  filterByTags,
  cleanMarkdownNoise,
} from './markdown.js';
import { pruneContent, pruneMarkdown } from './content-pruner.js';
import { distillToBudget } from './budget.js';
import { extractMetadata, extractLinks, extractImages } from './metadata.js';
import { autoScroll as runAutoScroll, type AutoScrollOptions } from './actions.js';
import { extractStructured } from './extract.js';
import { isPdfContentType, isDocxContentType, extractDocumentToFormat } from './documents.js';
import { parseYouTubeUrl, getYouTubeTranscript } from './youtube.js';
import { type DomainExtractResult } from '../ee/domain-extractors.js';
import { extractDomainData, getDomainExtractor } from '../ee/domain-extractors.js';
import { getDomainExtractHook, getDomainExtractorHook, getSPADomainsHook, getSPAPatternsHook } from './strategy-hooks.js';
import { extractReadableContent, type ReadabilityResult } from './readability.js';
import { quickAnswer as runQuickAnswer, type QuickAnswerResult } from './quick-answer.js';
import { Timer } from './timing.js';
import { chunkContent, type ChunkOptions } from './chunker.js';
import type { PeelOptions, PeelResult, ImageInfo } from '../types.js';
import { BlockedError } from '../types.js';
import { sanitizeForLLM } from './prompt-guard.js';
import { getSourceCredibility } from './source-credibility.js';
import type { DomainVerification } from './domain-verify.js';
import type { BrandingProfile } from './branding.js';
import type { ChangeResult } from './change-tracking.js';
import type { DesignAnalysis } from './design-analysis.js';
import { createLogger } from './logger.js';
import type { SafeBrowsingResult } from './safe-browsing.js';

const log = createLogger('pipeline');

// ---------------------------------------------------------------------------
// Hook-aware wrappers — route through premium hooks, fall back to basic stubs
// ---------------------------------------------------------------------------

/**
 * Check if a URL has a domain extractor.
 * Priority: premium hook → ee/domain-extractors.
 */
function hasDomainExtractor(url: string): boolean {
  const hookFn = getDomainExtractorHook();
  if (hookFn) return hookFn(url) !== null;
  return getDomainExtractor(url) !== null;
}

/**
 * Run domain extraction on HTML/URL.
 * Priority: premium hook → ee/domain-extractors.
 */
async function runDomainExtract(html: string, url: string): Promise<DomainExtractResult | null> {
  const hookFn = getDomainExtractHook();
  if (hookFn) return hookFn(html, url);
  return extractDomainData(html, url);
}

/** Mutable context threaded through pipeline stages */
export interface PipelineContext {
  url: string;
  options: PeelOptions;
  timer: Timer;
  startTime: number;

  // ---- Normalized option fields (resolved from options + defaults) ----
  render: boolean;
  stealth: boolean;
  wait: number;
  format: 'markdown' | 'text' | 'html' | 'clean';
  timeout: number;
  userAgent?: string;
  screenshot: boolean;
  screenshotFullPage: boolean;
  selector?: string;
  exclude?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  headers?: Record<string, string>;
  cookies?: string[];
  raw: boolean;
  actions?: any[];
  extract?: any;
  maxTokens?: number;
  extractImagesFlag: boolean;
  profileDir?: string;
  headed: boolean;
  storageState?: any;
  proxy?: string;
  fullPage: boolean;
  autoScrollOpts?: AutoScrollOptions;

  // ---- Set by fetch ----
  fetchResult?: any; // FetchResult from strategies.ts

  // ---- Set by content type detection ----
  contentType: 'document' | 'html' | 'json' | 'xml' | 'text';

  // ---- Set by parsing ----
  content: string;
  title: string;
  metadata: any;
  links: string[];
  quality: number;
  prunedPercent?: number;

  // ---- Set by link extraction ----
  linkCount: number;

  // ---- Set by fetch (freshness headers) ----
  freshness?: {
    lastModified?: string;
    etag?: string;
    fetchedAt: string;
    cacheControl?: string;
  };

  // ---- Set by JSON-LD extraction ----
  jsonLdType?: string;

  // ---- Set by post-processing (all optional) ----
  budgetFallback?: boolean;
  readabilityResult?: ReadabilityResult;
  imagesList?: ImageInfo[];
  extracted?: Record<string, any>;
  domainData?: DomainExtractResult;
  quickAnswerResult?: QuickAnswerResult;
  brandingProfile?: BrandingProfile;
  designAnalysisResult?: DesignAnalysis;
  changeResult?: ChangeResult;
  summaryText?: string;
  screenshotBase64?: string;
  /** True when domain API extraction handled the content (skip redundant extraction) */
  domainApiHandled?: boolean;
  /** True when server returned pre-rendered markdown (Content-Type: text/markdown) */
  serverMarkdown?: boolean;
  /** True when HTTP fetch completed in < 500ms — enables fast path (skip challenge detection) */
  fastPath?: boolean;
  /** Non-fatal warnings accumulated during the pipeline run */
  warnings: string[];
  /** Raw HTML size in characters (measured from fetched content before any conversion) */
  rawHtmlSize?: number;
  /** Safe Browsing check result (set early in pipeline, before fetch) */
  safeBrowsingResult?: SafeBrowsingResult;
  /** Active domain verification result (TLS + DNS + headers) */
  domainVerification?: DomainVerification | null;
}

/** Create the initial PipelineContext with defaults */
export function createContext(url: string, options: PeelOptions): PipelineContext {
  return {
    url,
    options,
    timer: new Timer(),
    startTime: Date.now(),

    // Normalized options — filled by normalizeOptions()
    render: false,
    stealth: false,
    wait: 0,
    format: 'markdown',
    timeout: 30000,
    userAgent: undefined,
    screenshot: false,
    screenshotFullPage: false,
    selector: undefined,
    exclude: undefined,
    includeTags: undefined,
    excludeTags: undefined,
    headers: undefined,
    cookies: undefined,
    raw: false,
    actions: undefined,
    extract: undefined,
    maxTokens: undefined,
    extractImagesFlag: false,
    profileDir: undefined,
    headed: false,
    storageState: undefined,
    proxy: undefined,
    fullPage: false,
    autoScrollOpts: undefined,

    // Content type — filled by detectContentType()
    contentType: 'html',

    // Parsing results — filled by parseContent()
    content: '',
    title: '',
    metadata: {},
    links: [],
    quality: 0,

    // Link count — filled by parseContent() / buildResult
    linkCount: 0,

    // Domain API first-pass flag
    domainApiHandled: false,

    // Warnings accumulator
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Stage 1: normalizeOptions
// ---------------------------------------------------------------------------

/**
 * Resolve all PeelOptions values into flat context fields with defaults applied.
 * Force render=true when screenshot/stealth/actions/branding/autoScroll requested.
 * Parse the autoScroll option.
 */
export function normalizeOptions(ctx: PipelineContext): void {
  const opts = ctx.options;

  // Apply agent-mode defaults (can be overridden by explicit options)
  if (opts.agentMode) {
    if (opts.budget === undefined) opts.budget = 4000;
    if (opts.format === undefined) opts.format = 'markdown';
  }

  const {
    render = false,
    stealth = false,
    wait = 0,
    format = 'markdown',
    timeout = 30000,
    userAgent,
    screenshot = false,
    screenshotFullPage = false,
    selector,
    exclude,
    includeTags,
    excludeTags,
    headers,
    cookies,
    raw = false,
    actions,
    extract,
    maxTokens,
    images: extractImagesFlag = false,
    profileDir,
    headed = false,
    storageState,
    proxy,
    fullPage = false,
    autoScroll: autoScrollOption,
  } = opts;

  // Normalize autoScroll option
  const autoScrollOpts: AutoScrollOptions | undefined = autoScrollOption
    ? (typeof autoScrollOption === 'boolean' ? {} : autoScrollOption)
    : undefined;

  ctx.render = render;
  ctx.stealth = stealth;
  ctx.wait = wait;
  ctx.format = format;
  ctx.timeout = timeout;
  ctx.userAgent = userAgent;
  ctx.screenshot = screenshot;
  ctx.screenshotFullPage = screenshotFullPage;
  ctx.selector = selector;
  ctx.exclude = exclude;
  ctx.includeTags = includeTags;
  ctx.excludeTags = excludeTags;
  ctx.headers = headers;
  ctx.cookies = cookies;
  ctx.raw = raw;
  ctx.actions = actions;
  ctx.extract = extract;
  ctx.maxTokens = maxTokens;
  ctx.extractImagesFlag = extractImagesFlag;
  ctx.profileDir = profileDir;
  ctx.headed = headed;
  ctx.storageState = storageState;
  ctx.proxy = proxy;
  ctx.fullPage = fullPage;
  ctx.autoScrollOpts = autoScrollOpts;

  // NOTE: PDFs/DOCX are now handled via simpleFetch + document parser.
  // No need to force browser rendering for them.

  // If screenshot is requested, force render mode
  if (screenshot) {
    ctx.render = true;
  }

  // If stealth is requested, force render mode
  if (stealth) {
    ctx.render = true;
  }

  // If actions are provided, force render mode
  if (actions && actions.length > 0) {
    ctx.render = true;
  }

  // If branding is requested, force render mode
  if (opts.branding) {
    ctx.render = true;
  }

  // If designAnalysis is requested, force render mode
  if (opts.designAnalysis) {
    ctx.render = true;
  }

  // If autoScroll is requested, force render mode
  if (autoScrollOpts) {
    ctx.render = true;
  }

  // Auto-detect SPAs that require browser rendering (no --render flag needed).
  // This list is NOT proprietary — every developer knows these sites are SPAs.
  // The proprietary part is the domain EXTRACTORS (what data to pull), not this list.
  // Premium hook can extend this for additional server-side intelligence.
  if (!ctx.render) {
    const spaDomainsHook = getSPADomainsHook();
    const spaPatternsHook = getSPAPatternsHook();

    // Full SPA domain list — always available (npm + server)
    const DEFAULT_SPA_DOMAINS = new Set([
      // Search & travel
      'www.google.com',
      'flights.google.com',
      // Travel & hospitality
      'www.airbnb.com',
      'www.booking.com',
      'www.expedia.com',
      'www.kayak.com',
      'www.skyscanner.com',
      'www.tripadvisor.com',
      // Jobs
      'www.indeed.com',
      'www.glassdoor.com',
      // Real estate
      'www.zillow.com',
      // Our own dashboard
      'app.webpeel.dev',
    ]);
    const DEFAULT_SPA_PATTERNS = [
      /google\.com\/travel/,
      /google\.com\/maps/,
      /google\.com\/shopping/,
    ];

    // Premium hook can extend with additional domains; otherwise use full default list
    const SPA_DOMAINS = spaDomainsHook ? spaDomainsHook() : DEFAULT_SPA_DOMAINS;
    const SPA_URL_PATTERNS = spaPatternsHook ? spaPatternsHook() : DEFAULT_SPA_PATTERNS;

    try {
      const hostname = new URL(ctx.url).hostname;
      if (SPA_DOMAINS.has(hostname)) {
        ctx.render = true;
        log.debug(`Auto-enabling render: SPA domain detected (${hostname})`);
      } else if (SPA_URL_PATTERNS.some(p => p.test(ctx.url))) {
        ctx.render = true;
        log.debug(`Auto-enabling render: SPA URL pattern matched`);
      }
    } catch {
      // Invalid URL — skip SPA detection
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 2: handleYouTube
// ---------------------------------------------------------------------------

/**
 * If the URL is a YouTube URL, attempt transcript extraction.
 * Returns a PeelResult on success, or null to fall through to normal pipeline.
 */
export async function handleYouTube(ctx: PipelineContext): Promise<PeelResult | null> {
  const ytVideoId = parseYouTubeUrl(ctx.url);
  if (!ytVideoId) return null;

  const ytStartTime = Date.now();
  try {
    const transcript = await getYouTubeTranscript(ctx.url, {
      language: (ctx.options as any).language ?? 'en',
    });

    // Format view count
    let viewStr = '';
    if (transcript.viewCount) {
      const v = parseInt(transcript.viewCount, 10);
      if (!isNaN(v)) {
        if (v >= 1_000_000) viewStr = `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M views`;
        else if (v >= 1_000) viewStr = `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K views`;
        else viewStr = `${v.toLocaleString()} views`;
      }
    }

    // Format publish date
    let publishStr = '';
    if (transcript.publishDate) {
      try {
        const d = new Date(transcript.publishDate);
        publishStr = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' });
      } catch { publishStr = transcript.publishDate; }
    }

    // Build header metadata line
    const headerParts = [`**Channel:** ${transcript.channel}`];
    if (transcript.duration && transcript.duration !== '0:00') headerParts.push(`**Duration:** ${transcript.duration}`);
    if (viewStr) headerParts.push(`**${viewStr}**`);
    if (publishStr) headerParts.push(`**Published:** ${publishStr}`);

    /**
     * Strip music note symbols from YouTube auto-caption text.
     * Cleans: [♪♪♪], [🎵🎵🎵], ♪ text ♪ (keeps inner text), standalone ♪ / 🎵
     */
    const cleanMusicNotes = (text: string): string =>
      text
        .replace(/\[[♪🎵]+\]/g, '')
        .replace(/♪\s*([^♪]*?)\s*♪/g, (_: string, inner: string) => inner.trim())
        .replace(/[♪🎵]+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Add paragraph breaks to transcript for readability
    let readableText = cleanMusicNotes(transcript.fullText);
    readableText = readableText.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n');
    readableText = readableText.replace(/\n{3,}/g, '\n\n');

    // Build a clean markdown representation of the video + transcript
    const parts: string[] = [`# ${transcript.title}`, headerParts.join(' | ')];
    if (transcript.summary) {
      let summaryText = cleanMusicNotes(transcript.summary);
      summaryText = summaryText.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n\n');
      parts.push(`## Summary\n\n${summaryText}`);
    }
    if (transcript.keyPoints && transcript.keyPoints.length > 0) {
      const cleanedKps = transcript.keyPoints.map((kp: string) => cleanMusicNotes(kp)).filter((kp: string) => kp.length > 0);
      if (cleanedKps.length > 0) {
        parts.push(`## Key Points\n\n${cleanedKps.map((kp: string) => `- ${kp}`).join('\n')}`);
      }
    }
    if (transcript.chapters && transcript.chapters.length > 0) {
      parts.push(`## Chapters\n\n${transcript.chapters.map(ch => `- ${ch.time} — ${ch.title}`).join('\n')}`);
    }
    parts.push(`## Full Transcript\n\n${readableText}`);

    const videoInfoContent = parts.join('\n\n');

    const elapsed = Date.now() - ytStartTime;
    const tokens = estimateTokens(videoInfoContent);
    const fingerprint = createHash('sha256').update(videoInfoContent).digest('hex').slice(0, 16);

    return {
      url: `https://www.youtube.com/watch?v=${ytVideoId}`,
      title: transcript.title,
      content: videoInfoContent,
      metadata: {
        description: `YouTube video by ${transcript.channel}, duration ${transcript.duration}`,
        author: transcript.channel,
      },
      links: [`https://www.youtube.com/watch?v=${ytVideoId}`],
      tokens,
      method: 'simple',
      elapsed,
      contentType: 'youtube',
      quality: 1.0,
      fingerprint,
      extracted: undefined,
      structured: transcript,
    } as PeelResult & { structured: typeof transcript };
  } catch (_ytError) {
    // If transcript extraction fails (no captions, page changed, etc.),
    // fall through to the normal HTML fetch pipeline below.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage 3: fetchContent
// ---------------------------------------------------------------------------

/**
 * Fetch the URL via smartFetch, handle autoScroll, and store result in ctx.fetchResult.
 */
export async function fetchContent(ctx: PipelineContext): Promise<void> {
  const needsBranding = ctx.options.branding && ctx.render;
  const needsAutoScroll = !!ctx.autoScrollOpts && ctx.render;
  const needsDesignAnalysis = ctx.options.designAnalysis && ctx.render;

  // Try API-based domain extraction first (Reddit, GitHub, HN use APIs, not HTML)
  // This avoids expensive browser fetches that often get blocked
  // Skip if noDomainApi is set — user wants raw page content, not API shortcut
  if (hasDomainExtractor(ctx.url) && !ctx.options.noDomainApi) {
    try {
      ctx.timer.mark('domainApiFirst');
      const ddResult = await runDomainExtract('', ctx.url);
      ctx.timer.end('domainApiFirst');
      if (ddResult && ddResult.cleanContent.length > 50) {
        ctx.domainData = ddResult;
        ctx.content = ddResult.cleanContent;
        // Capture raw HTML size from the extractor (e.g. Wikipedia mobile-html size)
        if (ddResult.rawHtmlSize && ddResult.rawHtmlSize > 0) {
          ctx.rawHtmlSize = ddResult.rawHtmlSize;
        } else {
          // For API-first extractors (HN, Reddit, GitHub), the raw HTML page is typically
          // 6-10x larger than the extracted content. Estimate conservatively at 7x.
          ctx.rawHtmlSize = ddResult.cleanContent.length * 7;
        }
        // Create minimal fetchResult so downstream stages don't crash
        ctx.fetchResult = {
          html: ddResult.cleanContent,
          url: ctx.url,
          status: 200,
          contentType: 'text/html',
          method: 'domain-api',
        };
        ctx.title = ddResult.structured?.title || '';
        ctx.quality = 0.95; // High quality — structured API data
        // Compute basic metadata so downstream stages have wordCount etc.
        const domainWordCount = ddResult.cleanContent.split(/\s+/).filter(Boolean).length;
        ctx.metadata = {
          ...(ctx.metadata || {}),
          title: ddResult.structured?.title || ctx.title,
          description: ddResult.structured?.description || ddResult.structured?.extract || '',
          wordCount: domainWordCount,
          language: ddResult.structured?.language || 'en',
        } as any;
        ctx.domainApiHandled = true;
        return; // Skip browser fetch entirely
      }
    } catch (e) {
      // Domain API failed — fall through to normal fetch
      const errMsg = e instanceof Error ? e.message : String(e);
      log.warn('domain API first-pass failed, falling back to fetch:', errMsg);
      ctx.warnings.push(`Domain API extraction failed: ${errMsg}`);
    }
  }

  ctx.timer.mark('fetch');
  let fetchResult: any;
  try {
    fetchResult = await smartFetch(ctx.url, {
      forceBrowser: ctx.render,
      stealth: ctx.stealth,
      waitMs: ctx.wait,
      userAgent: ctx.userAgent,
      timeoutMs: ctx.timeout,
      screenshot: ctx.screenshot,
      screenshotFullPage: ctx.screenshotFullPage,
      headers: ctx.headers,
      cookies: ctx.cookies,
      actions: ctx.actions,
      keepPageOpen: needsBranding || needsAutoScroll || needsDesignAnalysis,
      profileDir: ctx.profileDir,
      headed: ctx.headed,
      storageState: ctx.storageState,
      proxy: ctx.proxy,
      proxies: ctx.options.proxies,
      device: ctx.options.device,
      viewportWidth: ctx.options.viewportWidth,
      viewportHeight: ctx.options.viewportHeight,
      deviceScaleFactor: ctx.options.deviceScaleFactor,
      waitUntil: ctx.options.waitUntil,
      waitSelector: ctx.options.waitSelector,
      blockResources: ctx.options.blockResources,
      cloaked: ctx.options.cloaked,
      cycle: ctx.options.cycle,
      tls: ctx.options.tls,
      noEscalate: ctx.options.noEscalate,
    });
  } catch (fetchError) {
    // If fetch failed but we have a domain extractor, try it as fallback
    if (hasDomainExtractor(ctx.url)) {
      try {
        const ddResult = await runDomainExtract('', ctx.url);
        if (ddResult && ddResult.cleanContent.length > 50) {
          ctx.timer.end('fetch');
          ctx.domainData = ddResult;
          ctx.content = ddResult.cleanContent;
          if (ddResult.rawHtmlSize && ddResult.rawHtmlSize > 0) {
            ctx.rawHtmlSize = ddResult.rawHtmlSize;
          } else {
            // Estimate raw HTML size for API-first extractors (7x compression factor)
            ctx.rawHtmlSize = ddResult.cleanContent.length * 7;
          }
          ctx.fetchResult = {
            html: ddResult.cleanContent,
            url: ctx.url,
            status: 200,
            contentType: 'text/html',
            method: 'domain-api-fallback',
          };
          ctx.title = ddResult.structured?.title || '';
          ctx.quality = 0.90;
          const fallbackWordCount = ddResult.cleanContent.split(/\s+/).filter(Boolean).length;
          ctx.metadata = { ...(ctx.metadata || {}), title: ddResult.structured?.title || ctx.title, wordCount: fallbackWordCount, language: 'en' } as any;
          ctx.domainApiHandled = true;
          return;
        }
      } catch (e) {
        // Domain API also failed — throw original error
      }
    }

    // Search-as-proxy fallback for blocked requests (BlockedError before pipeline)
    // When all fetch strategies fail with a bot-protection block, try DDG search
    // to get the title/snippet from the search engine's cached version.
    if (fetchError instanceof BlockedError) {
      try {
        // @ts-ignore — proprietary module, gitignored
        const { searchFallback } = await import('./search-fallback.js');
        const searchResult = await searchFallback(ctx.url);

        // If DDG/primary returned very little, also try Bing for richer snippets
        if (!searchResult.cachedContent || searchResult.cachedContent.length < 400) {
          try {
            const { simpleFetch } = await import('./http-fetch.js');
            const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(ctx.url)}`;
            const bingResult = await simpleFetch(bingUrl, ctx.userAgent, 8000);
            if (bingResult.html && bingResult.html.length > 500) {
              const snippetMatch = bingResult.html.match(/<p[^>]*class="[^"]*snippet[^"]*"[^>]*>(.*?)<\/p>/gi);
              if (snippetMatch) {
                const bingSnippet = snippetMatch.map(s => s.replace(/<[^>]+>/g, '')).join('\n');
                searchResult.cachedContent = (searchResult.cachedContent || '') + '\n\n---\n*Additional context from Bing:*\n' + bingSnippet;
              }
            }
          } catch { /* Bing fallback is best-effort */ }
        }

        if (searchResult.cachedContent && searchResult.cachedContent.length > 50) {
          ctx.timer.end('fetch');
          ctx.content = searchResult.cachedContent;
          ctx.title = searchResult.title || ctx.title;
          ctx.quality = 0.4;
          ctx.warnings.push('Content retrieved from search engine cache because the original page blocked direct access. Results may be incomplete.');
          ctx.fetchResult = {
            html: searchResult.cachedContent,
            url: ctx.url,
            status: 0,
            contentType: 'text/markdown',
            method: 'search-fallback',
          };
          ctx.metadata = {
            ...(ctx.metadata || {}),
            title: searchResult.title || ctx.title,
            blocked: true,
            fallbackSource: searchResult.source,
          } as any;
          return;
        }
      } catch { /* Search fallback also failed — rethrow original BlockedError */ }
    }

    // Enhance error messages with actionable advice
    if (fetchError instanceof BlockedError) {
      // Instead of crashing, return a helpful response with the block info
      ctx.timer.end('fetch');
      const host = new URL(ctx.url).hostname.replace('www.', '');
      ctx.content = `# ⚠️ ${host} — Access Blocked\n\nThis site uses advanced bot protection and blocked our request.\n\n**What you can try:**\n- Use a browser profile with saved login: \`webpeel login ${host}\`\n- Try an alternative site that provides similar data\n\n*Direct link: [Open in browser](${ctx.url})*`;
      ctx.title = `${host} — Blocked`;
      ctx.quality = 0.2;
      ctx.warnings.push('Site blocked automated access. Showing fallback content.');
      ctx.fetchResult = {
        html: ctx.content,
        url: ctx.url,
        status: 403,
        contentType: 'text/markdown',
        method: 'blocked-fallback',
      };
      return;
    }
    const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    if (errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('timed out') || errMsg.includes('AbortError')) {
      const ms = ctx.timeout ?? 30000;
      const enhancedMsg = `Request timed out after ${Math.round(ms / 1000)}s. This site may require browser rendering — try \`render: true\`.`;
      throw new Error(enhancedMsg);
    }
    throw fetchError;
  }
  const fetchDuration = ctx.timer.end('fetch');

  // Fast path: if a plain HTTP fetch completed quickly with real HTML content,
  // mark it so post-processing can skip expensive heuristics (challenge detection).
  // Only applies to non-browser fetches that succeeded with HTML content.
  if (
    fetchDuration < 500 &&
    !ctx.render &&
    fetchResult.statusCode === 200 &&
    (fetchResult.contentType || '').includes('html') &&
    (fetchResult.html?.length || 0) > 200
  ) {
    ctx.fastPath = true;
  }

  // Auto-scroll to load lazy content, then grab fresh HTML
  if (needsAutoScroll && fetchResult.page) {
    try {
      await runAutoScroll(fetchResult.page, ctx.autoScrollOpts);
      // Capture refreshed HTML after scrolling
      fetchResult.html = await fetchResult.page.content();
    } catch (e) {
      // Non-fatal: auto-scroll failed, continuing with whatever HTML we have
      log.debug('auto-scroll failed:', e instanceof Error ? e.message : e);
    } finally {
      // Close page unless branding or design analysis also needs it
      if (!needsBranding && !needsDesignAnalysis) {
        try {
          await fetchResult.page.close().catch(() => {});
          if (fetchResult.browser) {
            await fetchResult.browser.close().catch(() => {});
          }
        } catch (e) {
          // Non-fatal: page/browser cleanup after auto-scroll
          log.debug('page/browser cleanup after auto-scroll:', e instanceof Error ? e.message : e);
        }
        fetchResult.page = undefined;
      }
    }
  }

  // Capture raw HTML size BEFORE any processing (accurate measurement of original content)
  ctx.rawHtmlSize = fetchResult.html?.length || 0;

  ctx.fetchResult = fetchResult;

  // Attempt to solve challenge/CAPTCHA page when detected
  if (fetchResult.challengeDetected) {
    const hasBrowserWorker = !!process.env.BROWSER_WORKER_URL;
    // Only attempt solve if we have a browser worker URL or are not on a resource-constrained env
    const canSolve = hasBrowserWorker || process.env.ENABLE_LOCAL_CHALLENGE_SOLVE === 'true';
    if (canSolve) {
      try {
        const { solveChallenge } = await import('../ee/challenge-solver.js');
        const { detectChallenge } = await import('./challenge-detection.js');
        const rawHtml = fetchResult.html || '';
        const detectionResult = detectChallenge(rawHtml, fetchResult.statusCode);
        const challengeType = detectionResult.type || 'generic-block';
        const solveResult = await solveChallenge(ctx.url, challengeType, rawHtml, {
          timeout: 15000,
        });
        if (solveResult.solved && solveResult.html) {
          fetchResult.html = solveResult.html;
          (fetchResult as any).challengeDetected = false;
          log.debug(`Challenge solved (${challengeType}) for ${ctx.url}`);
        } else {
          ctx.warnings.push('Challenge/CAPTCHA page detected. Content may be incomplete or from a bot-detection page.');
        }
      } catch (e) {
        ctx.warnings.push('Challenge/CAPTCHA page detected. Content may be incomplete or from a bot-detection page.');
        log.debug('Challenge solve failed:', e instanceof Error ? e.message : e);
      }
    } else {
      ctx.warnings.push('Challenge/CAPTCHA page detected. Content may be incomplete or from a bot-detection page.');
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 4: detectContentType
// ---------------------------------------------------------------------------

/**
 * Detect and set ctx.contentType based on response headers and content.
 */
export function detectContentType(ctx: PipelineContext): void {
  // Skip HTML parsing stages — domain API already provided clean content
  if (ctx.domainApiHandled) return;

  const fetchResult = ctx.fetchResult!;
  const ct = (fetchResult.contentType || '').toLowerCase();
  const urlLower = fetchResult.url.toLowerCase();

  // Check for binary document types (PDF/DOCX)
  const isDocument = isPdfContentType(ct) || isDocxContentType(ct) ||
    urlLower.endsWith('.pdf') || urlLower.endsWith('.docx');

  const isHTML = !isDocument && (ct.includes('html') || ct.includes('xhtml') || (!ct && fetchResult.html.trimStart().startsWith('<')));
  const isJSON = !isDocument && ct.includes('json');
  const isXML = !isDocument && (ct.includes('xml') || ct.includes('rss') || ct.includes('atom'));
  const isPlainText = !isDocument && (ct.includes('text/plain') || ct.includes('text/markdown') || ct.includes('text/csv') || ct.includes('text/css') || ct.includes('javascript'));

  ctx.contentType = isDocument ? 'document' : isHTML ? 'html' : isJSON ? 'json' : isXML ? 'xml' : isPlainText ? 'text' : 'html';

  // Flag when the server returned pre-rendered markdown — no HTML parsing needed
  if (ct.includes('text/markdown')) {
    ctx.serverMarkdown = true;
  }
}

// ---------------------------------------------------------------------------
// Stage 5: parseContent
// ---------------------------------------------------------------------------

/**
 * Parse content from fetchResult based on the detected contentType.
 * Sets ctx.content, ctx.title, ctx.metadata, ctx.links, ctx.quality, ctx.prunedPercent.
 */
export async function parseContent(ctx: PipelineContext): Promise<void> {
  // Skip HTML parsing stages — domain API already provided clean content
  if (ctx.domainApiHandled) return;

  const fetchResult = ctx.fetchResult!;
  const { contentType, format, fullPage, raw, selector, exclude, includeTags, excludeTags } = ctx;
  const hasBuffer = !!fetchResult.buffer;

  // === Image alt-text enhancement (opt-in, heuristic) ===
  // Runs before any conversion so both lite mode and standard mode benefit.
  if (ctx.options.captionImages && contentType === 'html' && fetchResult.html) {
    ctx.timer.mark('captionImages');
    const { enhanceImageAltText } = await import('./image-caption.js');
    fetchResult.html = enhanceImageAltText(fetchResult.html);
    ctx.timer.end('captionImages');
  }

  if (contentType === 'document' && hasBuffer) {
    // Document parsing pipeline (PDF/DOCX)
    // 'clean' maps to 'markdown' for extraction; cleanForAI is applied in buildResult
    const docFormat = format === 'clean' ? 'markdown' : format;
    const docResult = await extractDocumentToFormat(fetchResult.buffer!, {
      url: fetchResult.url,
      contentType: fetchResult.contentType,
      format: docFormat,
    });

    ctx.content = docResult.content;
    ctx.title = docResult.metadata.title;
    ctx.metadata = docResult.metadata;
    ctx.quality = 1.0; // Documents are inherently structured content

  } else if (contentType === 'html') {
    // === Lite mode — minimal processing, maximum speed ===
    // Skips pruning, metadata, quality scoring, JSON-LD. Just fetch → markdown.
    if (ctx.options.lite) {
      let liteHtml = fetchResult.html;
      if (selector) {
        liteHtml = selectContent(liteHtml, selector, exclude);
      }
      ctx.timer.mark('convert');
      switch (format) {
        case 'html':  ctx.content = liteHtml; break;
        case 'text':  ctx.content = htmlToText(liteHtml); break;
        case 'clean': ctx.content = cleanForAI(htmlToMarkdown(liteHtml, { raw, prune: false })); break;
        default:      ctx.content = htmlToMarkdown(liteHtml, { raw, prune: false }); break;
      }
      ctx.timer.end('convert');
      ctx.title = liteHtml.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';
      ctx.quality = 0.5; // Unknown quality in lite mode
      return;
    }

    // === JSON-LD extraction — first-class content source ===
    // Many sites (recipes, products, articles) embed structured data that's
    // more reliable than DOM parsing, especially on JS-heavy SPAs.
    if (!raw && !selector) {
      const { extractJsonLd } = await import('./json-ld.js');
      const jsonLdResult = extractJsonLd(fetchResult.html);
      if (jsonLdResult && jsonLdResult.found && jsonLdResult.content.length > 100) {
        ctx.content = jsonLdResult.content;
        ctx.title = jsonLdResult.title || ctx.title;
        ctx.jsonLdType = jsonLdResult.type;
        ctx.quality = 0.95; // Structured data is high quality

        // Still extract metadata and links from HTML
        ctx.timer.mark('metadata');
        const meta = extractMetadata(fetchResult.html, fetchResult.url);
        ctx.metadata = meta.metadata;
        if (!ctx.title) ctx.title = meta.title;
        const htmlForLinks = fetchResult.html.length > 100000
          ? fetchResult.html.slice(0, 100000)
          : fetchResult.html;
        ctx.links = extractLinks(htmlForLinks, fetchResult.url);
        ctx.linkCount = ctx.links.length;
        ctx.timer.end('metadata');
        return;
      }
    }

    // === Readable mode fast-path ===
    // Run readability on raw HTML directly, skipping expensive prune + convert stages.
    // Readability handles its own noise removal and outputs markdown, making prune/convert redundant.
    if (ctx.options.readable && !raw && !selector && !fullPage) {
      // Run readability and metadata extraction in parallel
      const [readResult, metaResult] = await Promise.all([
        Promise.resolve().then(() => {
          ctx.timer.mark('readability');
          const result = extractReadableContent(fetchResult.html, fetchResult.url);
          ctx.timer.end('readability');
          return result;
        }),
        Promise.resolve().then(() => {
          ctx.timer.mark('metadata');
          const meta = extractMetadata(fetchResult.html, fetchResult.url);
          const htmlForLinks = fetchResult.html.length > 100000
            ? fetchResult.html.slice(0, 100000)
            : fetchResult.html;
          const links = extractLinks(htmlForLinks, fetchResult.url);
          ctx.timer.end('metadata');
          return { meta, links };
        }),
      ]);

      ctx.readabilityResult = readResult;
      ctx.content = readResult.content;
      ctx.title = readResult.title || metaResult.meta.title || ctx.title;
      ctx.metadata = {
        ...metaResult.meta.metadata,
        title: readResult.title || metaResult.meta.title,
        ...(readResult.author ? { author: readResult.author } : {}),
        ...(readResult.date ? { publishedDate: readResult.date } : {}),
      };
      ctx.links = metaResult.links;
      ctx.linkCount = metaResult.links.length;
      ctx.quality = readResult.content.length > 200 ? 0.95 : 0.5;
      return;
    }

    // Standard HTML pipeline
    let html = fetchResult.html;

    // Apply include/exclude tags filtering first (before selector)
    if (includeTags || excludeTags) {
      html = filterByTags(html, includeTags, excludeTags);
    }

    if (selector) {
      html = selectContent(html, selector, exclude);
    } else if (exclude?.length) {
      // Apply exclude selectors even without a specific selector
      const cheerio = await import('cheerio');
      const $doc = cheerio.load(html);
      exclude.forEach(sel => $doc(sel).remove());
      html = $doc.html() || html;
    }

    // Smart main content detection (unless raw or selector specified)
    let contentHtml = html;
    if (!raw && !selector) {
      const detected = detectMainContent(html);
      if (detected.detected) {
        contentHtml = detected.html;
      }
    }

    const metadataTask = Promise.resolve().then(() => {
      ctx.timer.mark('metadata');
      const meta = extractMetadata(html, fetchResult.url);
      // When budget is set, use pre-truncated HTML for link extraction (faster)
      const htmlForLinks = (ctx.options.budget && ctx.options.budget > 0 && html.length > 100000)
        ? html.slice(0, 100000)
        : html;
      const result = {
        title: meta.title,
        metadata: meta.metadata,
        links: extractLinks(htmlForLinks, fetchResult.url),
      };
      ctx.timer.end('metadata');
      return result;
    });

    // Content density pruning — runs on HTML before markdown conversion.
    // Removes low-value blocks (sidebars, footers, ads) CSS selectors miss.
    // OFF when fullPage=true, format !== markdown, or content is small (< 20K chars — overhead not worth it).
    if (format === 'markdown' && !fullPage && contentHtml.length >= 20000) {
      ctx.timer.mark('prune');
      const pruned = pruneContent(contentHtml, { dynamic: true });
      ctx.timer.end('prune');
      contentHtml = pruned.html;
      if (pruned.nodesRemoved > 0) {
        ctx.prunedPercent = pruned.reductionPercent;
      }
    }

    // OPTIMIZATION: When budget is set, pre-truncate HTML before markdown conversion.
    // Converting 332K chars → markdown takes ~450ms. If budget=4000 tokens (~16K chars),
    // we only need ~50K chars of HTML (3x overhead for tags/attributes).
    // This cuts convert time from ~450ms to ~30ms on large pages.
    let htmlForConvert = contentHtml;
    // Skip pre-truncation when question is specified — QA needs full content to find answers
    // that may be deep in the article (e.g., "Who coined AI?" → History section of Wikipedia)
    const hasQuestion = !!ctx.options.question;
    if (!hasQuestion && ctx.options.budget && ctx.options.budget > 0 && contentHtml.length > 50000) {
      const estimatedCharsNeeded = ctx.options.budget * 12; // ~12 chars HTML per output token
      const minChars = Math.max(estimatedCharsNeeded, 50000); // at least 50K to ensure quality
      if (contentHtml.length > minChars) {
        // Truncate at a block boundary (</p>, </div>, </li>, </tr>) to avoid broken HTML
        const truncPoint = contentHtml.lastIndexOf('</', minChars);
        if (truncPoint > minChars * 0.8) {
          // Find the end of this closing tag
          const tagEnd = contentHtml.indexOf('>', truncPoint);
          htmlForConvert = contentHtml.slice(0, tagEnd > 0 ? tagEnd + 1 : minChars);
        } else {
          htmlForConvert = contentHtml.slice(0, minChars);
        }
        if (process.env.DEBUG) {
          log.debug(`budget pre-truncate: ${contentHtml.length} → ${htmlForConvert.length} chars`);
        }
      }
    }

    const contentTask = Promise.resolve().then(() => {
      ctx.timer.mark('convert');
      let converted: string;
      switch (format) {
        case 'html':
          converted = htmlForConvert;
          break;
        case 'text':
          converted = htmlToText(htmlForConvert);
          break;
        case 'clean': {
          // First convert to markdown, then strip link syntax
          const md = htmlToMarkdown(htmlForConvert, { raw, prune: false });
          converted = cleanForAI(md);
          break;
        }
        case 'markdown':
        default:
          // prune:false — already pruned above; avoid double-pruning in htmlToMarkdown
          converted = htmlToMarkdown(htmlForConvert, { raw, prune: false });
          break;
      }
      ctx.timer.end('convert');
      return converted;
    });

    const [metaResult, convertedContent] = await Promise.all([metadataTask, contentTask]);
    ctx.title = metaResult.title;
    ctx.metadata = metaResult.metadata;
    ctx.links = metaResult.links;
    ctx.content = convertedContent;

    // Safety net: if budget pre-truncation produced thin content but the full HTML
    // has substantial content, redo conversion WITHOUT pre-truncation.
    // This catches pages where the actual content is in the second half of the HTML
    // (common for listing/index pages, SPAs with shell-first layouts).
    if (htmlForConvert !== contentHtml && convertedContent.length < 200 && contentHtml.length > 20000) {
      if (process.env.DEBUG) {
        log.debug(`budget pre-truncation produced thin content (${convertedContent.length} chars from ${htmlForConvert.length} HTML). Retrying with full HTML (${contentHtml.length} chars).`);
      }
      ctx.timer.mark('convert-retry');
      let retryConverted: string;
      switch (format) {
        case 'html':  retryConverted = contentHtml; break;
        case 'text':  retryConverted = htmlToText(contentHtml); break;
        case 'clean': retryConverted = cleanForAI(htmlToMarkdown(contentHtml, { raw, prune: false })); break;
        case 'markdown':
        default:      retryConverted = htmlToMarkdown(contentHtml, { raw, prune: false }); break;
      }
      ctx.timer.end('convert-retry');
      ctx.content = retryConverted;
    }

    // Clean up markdown noise (empty links, excess newlines, trailing spaces)
    if (format === 'markdown') {
      ctx.content = cleanMarkdownNoise(ctx.content);
      ctx.content = pruneMarkdown(ctx.content);
    }

    ctx.quality = calculateQuality(ctx.content, fetchResult.html);

  } else if (contentType === 'json') {
    // JSON content — format nicely
    try {
      const parsed = JSON.parse(fetchResult.html);
      ctx.content = JSON.stringify(parsed, null, 2);
      ctx.title = 'JSON Response';

      // Extract any URLs from JSON for links
      const urlRegex = /https?:\/\/[^\s"'`,\]})]+/g;
      const found = ctx.content.match(urlRegex) || [];
      ctx.links = [...new Set(found)];
    } catch (e) {
      // Non-fatal: JSON parse failed, treating as malformed
      log.debug('JSON parse failed:', e instanceof Error ? e.message : e);
      ctx.content = fetchResult.html;
      ctx.title = 'JSON Response (malformed)';
    }
    ctx.quality = 1.0; // JSON is structured, always "clean"

  } else if (contentType === 'xml') {
    // XML/RSS/Atom — convert to readable format
    try {
      const $ = (await import('cheerio')).load(fetchResult.html, { xml: true });

      // Check if RSS/Atom feed
      const items = $('item, entry');
      if (items.length > 0) {
        ctx.title = $('channel > title, feed > title').first().text() || 'RSS/Atom Feed';
        const feedItems: string[] = [];
        items.each((_, el) => {
          const itemTitle = $(el).find('title').first().text();
          const itemLink = $(el).find('link').first().text() || $(el).find('link').first().attr('href') || '';
          const itemDesc = $(el).find('description, summary, content').first().text().slice(0, 200);
          feedItems.push(`## ${itemTitle}\n${itemLink}\n${itemDesc}`);
          if (itemLink) ctx.links.push(itemLink);
        });
        ctx.content = `# ${ctx.title}\n\n${feedItems.join('\n\n---\n\n')}`;
      } else {
        ctx.content = fetchResult.html;
        ctx.title = $('title').first().text() || 'XML Document';
      }
    } catch (e) {
      // Non-fatal: XML/RSS parse failed, using raw content
      log.debug('XML/RSS parse failed:', e instanceof Error ? e.message : e);
      ctx.content = fetchResult.html;
      ctx.title = 'XML Document';
    }
    ctx.quality = 0.9;

  } else {
    // Plain text, CSS, JS, etc — return as-is
    ctx.content = fetchResult.html;
    ctx.title = fetchResult.url.split('/').pop() || 'Text Document';

    // Extract URLs from plain text
    const urlRegex = /https?:\/\/[^\s"'`,\]})]+/g;
    const found = ctx.content.match(urlRegex) || [];
    ctx.links = [...new Set(found)];
    ctx.quality = 1.0;
  }
}

// ---------------------------------------------------------------------------
// Stage 6: postProcess
// ---------------------------------------------------------------------------

/**
 * Run all post-processing in sequence:
 * readability, image extraction, structured extraction,
 * maxTokens truncation, budget distillation, domain extractors, quick answer.
 */
export async function postProcess(ctx: PipelineContext): Promise<void> {
  const fetchResult = ctx.fetchResult!;
  const { contentType, options } = ctx;
  const isHTML = contentType === 'html';

  // Lite mode — skip all post-processing (no readability, no QA, no budget, no domain extract)
  if (options.lite) return;

  // Readability mode — skip if fast-path already handled it in parseContent
  // Also skip if selector was used — user explicitly chose content, don't override with readability
  if (options.readable && isHTML && fetchResult.html && !ctx.readabilityResult && !ctx.selector) {
    ctx.timer.mark('readability');
    const readResult = extractReadableContent(fetchResult.html, fetchResult.url);
    ctx.timer.end('readability');
    ctx.readabilityResult = readResult;
    ctx.content = readResult.content;
    ctx.metadata = {
      ...ctx.metadata,
      title: readResult.title || ctx.metadata?.title,
      author: readResult.author || undefined,
      publishedDate: readResult.date || undefined,
    };
    ctx.title = readResult.title || ctx.title;
  }

  // Extract images if requested
  if (ctx.extractImagesFlag && isHTML) {
    ctx.imagesList = extractImages(fetchResult.html, fetchResult.url);
  }

  // Extract structured data if requested
  if (ctx.extract && isHTML) {
    if (ctx.extract.llmApiKey && (ctx.extract.prompt || ctx.extract.schema)) {
      // LLM-powered extraction
      const { extractWithLLM } = await import('./extract.js');
      ctx.extracted = await extractWithLLM(ctx.content, ctx.extract);
    } else if (ctx.extract.selectors || ctx.extract.schema) {
      // CSS-based extraction (existing)
      ctx.extracted = extractStructured(fetchResult.html, ctx.extract);
    }
  }

  // Quick answer (LLM-free) — tries pruned content first (higher quality),
  // then falls back to full raw HTML text if confidence is low (catches answers
  // deep in the document that pruning may have removed).
  if (options.question && ctx.content) {
    ctx.timer.mark('quickAnswer');
    let qa = runQuickAnswer({
      question: options.question,
      content: ctx.content,
      url: fetchResult.url,
    });

    // If confidence is below infobox-level (0.92) and we have raw HTML, try again on full text.
    // This catches answers deep in articles that pruning may have removed.
    if (qa.confidence < 0.91 && fetchResult.html && fetchResult.html.length > ctx.content.length * 2) {
      const { htmlToText } = await import('./markdown.js');
      const fullText = htmlToText(fetchResult.html);
      const qaFull = runQuickAnswer({
        question: options.question,
        content: fullText,
        url: fetchResult.url,
      });
      // Use the full-text answer if it's more confident
      if (qaFull.confidence > qa.confidence) {
        qa = qaFull;
      }
    }

    ctx.timer.end('quickAnswer');
    ctx.quickAnswerResult = qa;
  }

  // Truncate to token budget if requested (simple truncation)
  if (ctx.maxTokens && ctx.maxTokens > 0) {
    ctx.content = truncateToTokenBudget(ctx.content, ctx.maxTokens);
  }

  // Smart budget distillation — applied AFTER maxTokens truncation
  // This intelligently compresses content (strips boilerplate, compresses
  // tables, removes weak paragraphs) rather than blindly cutting.
  // Skip for domain-extracted content (e.g. YouTube) — it's already clean and structured.
  if (options.budget && options.budget > 0 && !ctx.domainData) {
    const budgetFormat: 'markdown' | 'text' | 'json' =
      ctx.contentType === 'json' ? 'json' :
      ctx.format === 'text' ? 'text' : 'markdown';
    const originalContent = ctx.content;
    ctx.timer.mark('budget');
    let budgetedContent = distillToBudget(ctx.content, options.budget, budgetFormat);
    ctx.timer.end('budget');
    if (process.env.DEBUG) {
      log.debug(`budget result: ${originalContent.length} → ${budgetedContent.length} chars`);
    }

    // Safety net: if BM25 distillation stripped too much (< 10% of original)
    // on a substantial page, fall back to simple head truncation.
    // This happens on listing/index pages with no clear topic to rank by.
    if (budgetedContent.length < originalContent.length * 0.10 && originalContent.length > 500) {
      const estimatedChars = options.budget * 4; // rough: 1 token ≈ 4 chars
      // Trim at a word boundary to avoid cutting mid-word
      let truncated = originalContent.slice(0, estimatedChars);
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > estimatedChars * 0.8) {
        truncated = truncated.slice(0, lastSpace);
      }
      budgetedContent = truncated;
      ctx.budgetFallback = true;
      ctx.warnings.push('Content was truncated to fit budget using head truncation (BM25 distillation produced insufficient content)');
      if (process.env.DEBUG) {
        log.debug(`budget distillation fallback: BM25 produced ${budgetedContent.length} chars (< 10% of ${originalContent.length}), using head truncation`);
      }
    }

    ctx.content = budgetedContent;
  }

  // Domain-aware structured extraction (Twitter, Reddit, GitHub, HN)
  // Fires when URL matches a known domain. Replaces content with clean markdown.
  if (hasDomainExtractor(fetchResult.url) && !ctx.domainApiHandled && !ctx.options.noDomainApi) {
    try {
      ctx.timer.mark('domainExtract');
      // Try raw HTML first, then fall back to readability-processed content
      // (some SPAs like Google Flights have data only after readability processing)
      let ddResult = await runDomainExtract(fetchResult.html, fetchResult.url);
      if (!ddResult && ctx.content) {
        ddResult = await runDomainExtract(ctx.content, fetchResult.url);
      }
      ctx.timer.end('domainExtract');
      if (ddResult) {
        ctx.domainData = ddResult;
        ctx.content = ddResult.cleanContent;
        // Update title from domain extractor (takes precedence over HTML page title)
        if (ddResult.structured?.title) {
          ctx.title = ddResult.structured.title;
        }
      }
    } catch (e) {
      // Domain extraction failure is non-fatal; continue with normal content
      const errMsg2 = e instanceof Error ? e.message : String(e);
      log.warn('domain extraction (second pass) failed:', errMsg2);
      ctx.warnings.push(`Domain extraction (second pass) failed: ${errMsg2}`);
    }
  }

  // === Challenge / bot-protection page detection ===
  // If the extracted content looks like a challenge page (not real content),
  // mark it and try the search-as-proxy fallback to get the real info.
  // Fast path: skip this check for HTTP fetches that completed in < 500ms —
  // a fast successful response is virtually never a challenge page.
  if (!ctx.fastPath && ctx.content && ctx.content.length < 2000) {
    const lowerContent = ctx.content.toLowerCase();
    const challengeSignals = [
      'please verify you are a human',
      'access denied',
      'enable javascript and cookies',
      'checking your browser',
      'cloudflare',
      'just a moment',
      'ray id',
      'attention required',
      'please wait while we verify',
      'bot protection',
      'are you a robot',
      'captcha',
      'page not found',
      'not found',
      'forbidden',
      'error 403',
      'error 404',
      '403 forbidden',
      '404 not found',
      'sorry, this page',
      'blocked',
    ];
    const isChallengeContent = challengeSignals.some(s => lowerContent.includes(s))
      || (ctx.content.length < 100 && (ctx.stealth || ctx.fetchResult?.method === 'stealth' || ctx.fetchResult?.method === 'browser'));

    if (isChallengeContent) {
      ctx.warnings.push('Bot protection detected. Content is a challenge page, not the actual page content.');
      if (ctx.metadata) {
        (ctx.metadata as any).blocked = true;
        (ctx.metadata as any).challengeDetected = true;
      }

      // Try challenge solver first (if browser worker available or local solve enabled)
      let solvedViaChallengeSolver = false;
      const hasBrowserWorker = !!process.env.BROWSER_WORKER_URL;
      const canSolve = hasBrowserWorker || process.env.ENABLE_LOCAL_CHALLENGE_SOLVE === 'true';
      if (canSolve && ctx.fetchResult?.html) {
        try {
          const { solveChallenge } = await import('../ee/challenge-solver.js');
          const { detectChallenge } = await import('./challenge-detection.js');
          const rawHtml = ctx.fetchResult.html;
          const detectionResult = detectChallenge(rawHtml, ctx.fetchResult.statusCode);
          const challengeType = detectionResult.type || 'cloudflare';
          const solveResult = await solveChallenge(ctx.url, challengeType, rawHtml, {
            timeout: 15000,
          });
          if (solveResult.solved && solveResult.html) {
            // Re-parse the solved HTML
            const { htmlToMarkdown, htmlToText, cleanForAI } = await import('./markdown.js');
            const fmt = ctx.format || 'markdown';
            ctx.content = fmt === 'text' ? htmlToText(solveResult.html)
              : fmt === 'clean' ? cleanForAI(solveResult.html)
              : htmlToMarkdown(solveResult.html);
            ctx.fetchResult.html = solveResult.html;
            if (ctx.metadata) {
              (ctx.metadata as any).blocked = false;
              (ctx.metadata as any).challengeDetected = false;
              (ctx.metadata as any).challengeSolved = true;
            }
            solvedViaChallengeSolver = true;
            log.debug(`Content-level challenge solved for ${ctx.url}`);
          }
        } catch (e) {
          log.debug('Content-level challenge solve failed:', e instanceof Error ? e.message : e);
        }
      }

      // Fall back to search fallback if challenge solve didn't work
      if (!solvedViaChallengeSolver) {
        try {
          // @ts-ignore — proprietary module, gitignored
          const { searchFallback } = await import('./search-fallback.js');
          const searchResult = await searchFallback(ctx.url);
          if (searchResult.cachedContent && searchResult.cachedContent.length > 50) {
            ctx.content = searchResult.cachedContent;
            ctx.title = searchResult.title || ctx.title;
            ctx.quality = 0.4;
            ctx.warnings.push('Content retrieved from search engine cache because the original page blocked direct access. Results may be incomplete.');
            if (ctx.metadata) {
              (ctx.metadata as any).fallbackSource = searchResult.source;
            }
          }
        } catch { /* Search fallback failed — continue with challenge page content */ }
      }
    }
  }

  // === Active domain verification ===
  // Run for ALL sites — even known official/established domains benefit from
  // showing real TLS, DNS, and header signals. This is what makes WebPeel useful.
  {
    const { verifyDomain } = await import('./domain-verify.js');
    const existingHeaders = ctx.fetchResult?.responseHeaders || undefined;
    ctx.domainVerification = await verifyDomain(ctx.url, existingHeaders).catch(() => null);
  }

  // === Zero-token safety net ===
  // NEVER return empty content. If pipeline produced nothing, fall back.
  if (!ctx.content || ctx.content.trim().length === 0) {
    ctx.warnings.push('Primary extraction failed; content sourced from fallback (meta description or raw HTML)');
    // Try 1: JSON-LD (may not have been tried if selector/raw was used)
    if (fetchResult.html) {
      const { extractJsonLd } = await import('./json-ld.js');
      const jsonLd = extractJsonLd(fetchResult.html);
      if (jsonLd?.content && jsonLd.content.length > 50) {
        ctx.content = jsonLd.content;
        ctx.title = jsonLd.title || ctx.title;
        ctx.jsonLdType = jsonLd.type;
        ctx.quality = 0.90;
        return;
      }
    }

    // Try 2: Meta description + title as minimal content
    const metaDesc = (ctx.metadata as any)?.description || (ctx.metadata as any)?.ogDescription;
    const pageTitle = ctx.title || (ctx.metadata as any)?.title;
    if (metaDesc || pageTitle) {
      const parts: string[] = [];
      if (pageTitle) parts.push(`# ${pageTitle}\n`);
      if (metaDesc) parts.push(metaDesc);
      ctx.content = parts.join('\n');
      ctx.quality = 0.3; // Low quality — we only got metadata
      return;
    }

    // Try 3: Raw text from HTML (strip all tags)
    if (fetchResult.html && fetchResult.html.length > 100) {
      const { htmlToText } = await import('./markdown.js');
      const rawText = htmlToText(fetchResult.html);
      if (rawText.trim().length > 50) {
        ctx.content = rawText.slice(0, 10000); // Cap at 10K chars
        ctx.quality = 0.2; // Very low quality
        return;
      }
    }

    // Try 4: Search-as-proxy fallback (when page appears blocked)
    // Search engines already crawled this page — use their cached snippet.
    try {
      // @ts-ignore — proprietary module, gitignored
        const { searchFallback } = await import('./search-fallback.js');
      const searchResult = await searchFallback(ctx.url);
      if (searchResult.cachedContent && searchResult.cachedContent.length > 50) {
        ctx.content = searchResult.cachedContent;
        ctx.title = searchResult.title || ctx.title;
        ctx.quality = 0.4; // Low quality — it's a search snippet, not the full page
        ctx.warnings.push('Content retrieved from search engine cache because the original page blocked direct access. Results may be incomplete.');
        if (ctx.metadata) {
          (ctx.metadata as any).blocked = true;
          (ctx.metadata as any).fallbackSource = searchResult.source;
        }
        return;
      }
    } catch { /* Search fallback failed — continue to final empty handler */ }
  }
}

// ---------------------------------------------------------------------------
// Stage 7: finalize
// ---------------------------------------------------------------------------

/**
 * Screenshot base64 conversion, branding extraction (needs page), change tracking, AI summary.
 */
export async function finalize(ctx: PipelineContext): Promise<void> {
  const fetchResult = ctx.fetchResult!;
  const { options } = ctx;

  // Convert screenshot buffer to base64 if present
  ctx.screenshotBase64 = fetchResult.screenshot?.toString('base64');

  // Extract branding if requested (reuses existing browser page when available)
  if (options.branding && ctx.render && fetchResult.page) {
    try {
      const { extractBranding } = await import('./branding.js');
      ctx.brandingProfile = await extractBranding(fetchResult.page);
    } catch (error) {
      log.error('Branding extraction failed:', error);
    } finally {
      // Clean up the kept-open page and browser
      try {
        await fetchResult.page.close().catch(() => {});
        if (fetchResult.browser) {
          await fetchResult.browser.close().catch(() => {});
        }
      } catch (e) {
        // Non-fatal: page/browser cleanup after branding extraction
        log.debug('page/browser cleanup after branding:', e instanceof Error ? e.message : e);
      }
    }
  }

  // Extract design analysis if requested (reuses existing browser page when available)
  if (options.designAnalysis && ctx.render && fetchResult.page) {
    try {
      const { extractDesignAnalysis } = await import('./design-analysis.js');
      ctx.designAnalysisResult = await extractDesignAnalysis(fetchResult.page);
    } catch (error) {
      log.error('Design analysis extraction failed:', error);
    } finally {
      if (!options.branding) {
        // Clean up the page and browser if branding didn't already do it
        try {
          await fetchResult.page.close().catch(() => {});
          if (fetchResult.browser) {
            await fetchResult.browser.close().catch(() => {});
          }
        } catch (e) {
          log.debug('page/browser cleanup after design analysis:', e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // Track content changes if requested
  if (options.changeTracking) {
    try {
      const fingerprint = createHash('sha256').update(ctx.content).digest('hex').slice(0, 16);
      const { trackChange } = await import('./change-tracking.js');
      ctx.changeResult = await trackChange(fetchResult.url, ctx.content, fingerprint);
    } catch (error) {
      log.error('Change tracking failed:', error);
    }
  }

  // Generate AI summary if requested
  if (options.summary && options.llm) {
    try {
      const { summarizeContent } = await import('./summarize.js');
      const maxLength = typeof options.summary === 'object' && options.summary.maxLength
        ? options.summary.maxLength
        : 150;

      ctx.summaryText = await summarizeContent(ctx.content, {
        apiKey: options.llm.apiKey,
        model: options.llm.model,
        apiBase: options.llm.baseUrl,
        maxWords: maxLength,
      });
    } catch (error) {
      log.error('Summary generation failed:', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 8: buildResult
// ---------------------------------------------------------------------------

/**
 * Assemble the final PeelResult from the pipeline context.
 */
export function buildResult(ctx: PipelineContext): PeelResult {
  const fetchResult = ctx.fetchResult!;
  const elapsed = Date.now() - ctx.startTime;

  // --- Trust & Safety ---
  // Run prompt injection scan on final content
  const sanitizeResult = sanitizeForLLM(ctx.content);
  // If injection was detected, use the cleaned content
  if (sanitizeResult.injectionDetected) {
    ctx.content = sanitizeResult.content;
    ctx.warnings.push('Prompt injection patterns detected and stripped from content.');
  }

  // Assess source credibility
  const credibility = getSourceCredibility(ctx.url);

  // Merge active domain verification signals (if available)
  const dv = ctx.domainVerification ?? null;
  const verificationBonus = dv?.verificationScore ?? 0;
  const finalCredibilityScore = Math.min(100, credibility.score + verificationBonus);

  // Merge signals/warnings from active verification into credibility
  const mergedSignals = [
    ...(credibility.signals ?? []),
    ...(dv?.signals ?? []),
  ];
  const mergedCredWarnings = [
    ...(credibility.warnings ?? []),
    ...(dv?.warnings ?? []),
  ];

  // Compute composite trust score from source credibility (0-100) + content safety
  let trustScore = finalCredibilityScore / 100; // normalize 0-100 → 0-1
  if (sanitizeResult.injectionDetected) trustScore -= 0.3;
  if ((ctx.quality ?? 1.0) < 0.5) trustScore -= 0.1;
  trustScore = Math.round(Math.max(0, Math.min(1, trustScore)) * 100) / 100;

  // Build trust warnings
  const trustWarnings: string[] = [...mergedCredWarnings];
  if (credibility.tier === 'new') trustWarnings.push('Domain has limited verifiable presence — exercise caution.');
  if (credibility.tier === 'suspicious') trustWarnings.push('Domain shows suspicious signals — treat content with caution.');
  if (sanitizeResult.injectionDetected) trustWarnings.push(`Prompt injection detected: ${sanitizeResult.detectedPatterns.join(', ')}`);
  if (sanitizeResult.strippedChars > 0) trustWarnings.push(`Stripped ${sanitizeResult.strippedChars} suspicious characters (zero-width/Unicode smuggling).`);

  // Build verification sub-object (compact version for PeelResult)
  const verificationData = dv ? {
    tls: dv.tls ? { valid: dv.tls.valid, issuer: dv.tls.issuer, daysRemaining: dv.tls.daysRemaining } : null,
    dns: dv.dns ? { hasMx: dv.dns.hasMx, hasDmarc: dv.dns.hasDmarc, hasSpf: dv.dns.hasSpf } : null,
    headers: dv.headers ? { hsts: dv.headers.hsts, csp: dv.headers.csp, server: dv.headers.server } : null,
  } : undefined;

  const trust: PeelResult['trust'] = {
    source: {
      tier: credibility.tier,
      score: finalCredibilityScore,
      label: credibility.label,
      signals: mergedSignals,
      warnings: mergedCredWarnings,
      ...(verificationData ? { verification: verificationData } : {}),
    },
    contentSafety: {
      clean: !sanitizeResult.injectionDetected,
      injectionDetected: sanitizeResult.injectionDetected,
      detectedPatterns: sanitizeResult.detectedPatterns,
      strippedCount: sanitizeResult.strippedChars,
    },
    score: trustScore,
    warnings: trustWarnings,
  };

  const tokens = estimateTokens(ctx.content);
  const fingerprint = createHash('sha256').update(ctx.content).digest('hex').slice(0, 16);

  // Token savings metrics — only when raw HTML size was captured (from actual fetch or domain extractor)
  const rawHtmlSize = ctx.rawHtmlSize ?? 0;
  const rawTokenEstimate = rawHtmlSize > 0 ? Math.round(rawHtmlSize / 4) : undefined;
  const tokenSavingsPercent = rawTokenEstimate !== undefined && rawTokenEstimate > 0
    ? Math.max(0, Math.round((1 - tokens / rawTokenEstimate) * 100))
    : undefined;

  // Build freshness from fetchResult response headers
  const freshness: PeelResult['freshness'] = {
    ...(fetchResult.responseHeaders?.['last-modified'] ? { lastModified: fetchResult.responseHeaders['last-modified'] } : {}),
    ...(fetchResult.responseHeaders?.['etag'] ? { etag: fetchResult.responseHeaders['etag'] } : {}),
    fetchedAt: new Date().toISOString(),
    ...(fetchResult.responseHeaders?.['cache-control'] ? { cacheControl: fetchResult.responseHeaders['cache-control'] } : {}),
  };

  // Detect and warn about potential content issues
  let warning: string | undefined;
  const contentLen = ctx.content.length;
  const htmlLen = ctx.fetchResult?.html?.length || 0;

  // Add contentQuality metadata for thin content (< 100 words)
  const wordCount = ctx.content.trim().split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 100 && wordCount > 0) {
    ctx.warnings.push(`Content is thin (${wordCount} words). The page may be paywalled, require authentication, or block automated access.`);
    if (ctx.metadata) {
      (ctx.metadata as any).contentQuality = 'thin';
    }
  }

  if (contentLen < 100 && htmlLen > 1000) {
    warning = 'Content extraction produced very little text from a substantial page. The site may use heavy JavaScript rendering. Try adding render: true.';
  } else if (ctx.budgetFallback) {
    warning = 'Budget distillation was unable to identify key content. Showing first portion of page instead. This may be a listing or index page — try fetching without a budget for full content.';
  } else if (contentLen < 50) {
    // Check if this looks like a blocked request
    const fetchMethod = ctx.fetchResult?.method || 'unknown';
    const triedStealth = fetchMethod === 'stealth' || ctx.options.stealth;
    const triedBrowser = fetchMethod === 'browser' || ctx.options.render;

    if (triedStealth || triedBrowser) {
      warning = 'This site appears to use bot protection (Cloudflare, Akamai, PerimeterX). Try: --cloaked flag, a residential proxy (--proxy), or check if the URL requires authentication.';
      // Set blocked flag in metadata
      if (ctx.metadata) {
        (ctx.metadata as any).blocked = true;
      }
    } else {
      warning = 'Very little content extracted. The page may require JavaScript rendering (try --render), be behind a login wall, or use bot protection.';
    }
  }

  // Apply clean format if requested (after all other processing)
  if (ctx.format === 'clean' && ctx.content) {
    ctx.content = cleanForAI(ctx.content);
  }

  // Chunking for RAG pipelines
  let ragChunks: PeelResult['chunks'] | undefined;
  if (ctx.options.chunk) {
    const chunkOpts: ChunkOptions = typeof ctx.options.chunk === 'object'
      ? ctx.options.chunk
      : {};
    const chunkResult = chunkContent(ctx.content, chunkOpts);
    ragChunks = chunkResult.chunks;
  }

  return {
    url: fetchResult.url,
    title: ctx.title,
    content: ctx.content,
    metadata: ctx.metadata,
    links: ctx.links,
    tokens,
    method: fetchResult.method === 'cached' ? 'simple' : fetchResult.method,
    elapsed,
    screenshot: ctx.screenshotBase64,
    contentType: ctx.contentType,
    quality: ctx.quality,
    fingerprint,
    extracted: ctx.extracted,
    branding: ctx.brandingProfile,
    designAnalysis: ctx.designAnalysisResult,
    changeTracking: ctx.changeResult,
    summary: ctx.summaryText,
    images: ctx.imagesList,
    linkCount: ctx.links.length,
    freshness,
    ...(warning !== undefined ? { warning } : {}),
    ...(ctx.metadata && (ctx.metadata as any).blocked ? { blocked: true } : {}),
    ...(ctx.prunedPercent !== undefined ? { prunedPercent: ctx.prunedPercent } : {}),
    ...(ctx.domainData !== undefined ? { domainData: ctx.domainData } : {}),
    ...(ctx.readabilityResult !== undefined ? { readability: ctx.readabilityResult } : {}),
    ...(ctx.quickAnswerResult !== undefined ? { quickAnswer: ctx.quickAnswerResult } : {}),
    timing: ctx.timer.toTiming(),
    ...(ctx.jsonLdType !== undefined ? { jsonLdType: ctx.jsonLdType } : {}),
    ...(ctx.warnings.length > 0 ? { warnings: ctx.warnings } : {}),
    ...(ragChunks !== undefined ? { chunks: ragChunks } : {}),
    ...(ctx.serverMarkdown ? { serverMarkdown: true } : {}),
    ...(rawTokenEstimate !== undefined ? { rawTokenEstimate } : {}),
    ...(tokenSavingsPercent !== undefined ? { tokenSavingsPercent } : {}),
    ...(fetchResult.autoInteract !== undefined ? { autoInteract: fetchResult.autoInteract } : {}),
    trust,
  };
}
