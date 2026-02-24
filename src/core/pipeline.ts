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
  estimateTokens,
  selectContent,
  detectMainContent,
  calculateQuality,
  truncateToTokenBudget,
  filterByTags,
} from './markdown.js';
import { pruneContent } from './content-pruner.js';
import { distillToBudget } from './budget.js';
import { extractMetadata, extractLinks, extractImages } from './metadata.js';
import { autoScroll as runAutoScroll, type AutoScrollOptions } from './actions.js';
import { extractStructured } from './extract.js';
import { isPdfContentType, isDocxContentType, extractDocumentToFormat } from './documents.js';
import { parseYouTubeUrl, getYouTubeTranscript } from './youtube.js';
import { extractDomainData, getDomainExtractor, type DomainExtractResult } from './domain-extractors.js';
import { extractReadableContent, type ReadabilityResult } from './readability.js';
import { quickAnswer as runQuickAnswer, type QuickAnswerResult } from './quick-answer.js';
import { Timer } from './timing.js';
import type { PeelOptions, PeelResult, ImageInfo } from '../types.js';
import type { BrandingProfile } from './branding.js';
import type { ChangeResult } from './change-tracking.js';

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
  format: 'markdown' | 'text' | 'html';
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
  readabilityResult?: ReadabilityResult;
  imagesList?: ImageInfo[];
  extracted?: Record<string, any>;
  domainData?: DomainExtractResult;
  quickAnswerResult?: QuickAnswerResult;
  brandingProfile?: BrandingProfile;
  changeResult?: ChangeResult;
  summaryText?: string;
  screenshotBase64?: string;
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

  // If autoScroll is requested, force render mode
  if (autoScrollOpts) {
    ctx.render = true;
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

    // Build a clean markdown representation of the video + transcript
    const videoInfoLines = [
      `# ${transcript.title}`,
      '',
      `**Channel:** ${transcript.channel}`,
      `**Duration:** ${transcript.duration}`,
      `**Language:** ${transcript.language}`,
      transcript.availableLanguages.length > 1
        ? `**Available Languages:** ${transcript.availableLanguages.join(', ')}`
        : '',
      '',
      '## Transcript',
      '',
      transcript.fullText,
    ].filter(l => l !== undefined);
    const videoInfoContent = videoInfoLines.join('\n');

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

  ctx.timer.mark('fetch');
  const fetchResult = await smartFetch(ctx.url, {
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
    keepPageOpen: needsBranding || needsAutoScroll,
    profileDir: ctx.profileDir,
    headed: ctx.headed,
    storageState: ctx.storageState,
    proxy: ctx.proxy,
  });
  ctx.timer.end('fetch');

  // Auto-scroll to load lazy content, then grab fresh HTML
  if (needsAutoScroll && fetchResult.page) {
    try {
      await runAutoScroll(fetchResult.page, ctx.autoScrollOpts);
      // Capture refreshed HTML after scrolling
      fetchResult.html = await fetchResult.page.content();
    } catch (e) {
      // Non-fatal: auto-scroll failed, continuing with whatever HTML we have
      if (process.env.DEBUG) console.debug('[webpeel]', 'auto-scroll failed:', e instanceof Error ? e.message : e);
    } finally {
      // Close page unless branding also needs it
      if (!needsBranding) {
        try {
          await fetchResult.page.close().catch(() => {});
          if (fetchResult.browser && !needsBranding) {
            await fetchResult.browser.close().catch(() => {});
          }
        } catch (e) {
          // Non-fatal: page/browser cleanup after auto-scroll
          if (process.env.DEBUG) console.debug('[webpeel]', 'page/browser cleanup after auto-scroll:', e instanceof Error ? e.message : e);
        }
        fetchResult.page = undefined;
      }
    }
  }

  ctx.fetchResult = fetchResult;
}

// ---------------------------------------------------------------------------
// Stage 4: detectContentType
// ---------------------------------------------------------------------------

/**
 * Detect and set ctx.contentType based on response headers and content.
 */
export function detectContentType(ctx: PipelineContext): void {
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
}

// ---------------------------------------------------------------------------
// Stage 5: parseContent
// ---------------------------------------------------------------------------

/**
 * Parse content from fetchResult based on the detected contentType.
 * Sets ctx.content, ctx.title, ctx.metadata, ctx.links, ctx.quality, ctx.prunedPercent.
 */
export async function parseContent(ctx: PipelineContext): Promise<void> {
  const fetchResult = ctx.fetchResult!;
  const { contentType, format, fullPage, raw, selector, exclude, includeTags, excludeTags } = ctx;
  const hasBuffer = !!fetchResult.buffer;

  if (contentType === 'document' && hasBuffer) {
    // Document parsing pipeline (PDF/DOCX)
    const docResult = await extractDocumentToFormat(fetchResult.buffer!, {
      url: fetchResult.url,
      contentType: fetchResult.contentType,
      format,
    });

    ctx.content = docResult.content;
    ctx.title = docResult.metadata.title;
    ctx.metadata = docResult.metadata;
    ctx.quality = 1.0; // Documents are inherently structured content

  } else if (contentType === 'html') {
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
          console.debug('[webpeel]', `budget pre-truncate: ${contentHtml.length} → ${htmlForConvert.length} chars`);
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
    ctx.quality = calculateQuality(convertedContent, fetchResult.html);

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
      if (process.env.DEBUG) console.debug('[webpeel]', 'JSON parse failed:', e instanceof Error ? e.message : e);
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
      if (process.env.DEBUG) console.debug('[webpeel]', 'XML/RSS parse failed:', e instanceof Error ? e.message : e);
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

  // Readability mode
  if (options.readable && isHTML && fetchResult.html) {
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
  if (options.budget && options.budget > 0) {
    const budgetFormat: 'markdown' | 'text' | 'json' =
      ctx.contentType === 'json' ? 'json' :
      ctx.format === 'text' ? 'text' : 'markdown';
    ctx.timer.mark('budget');
    ctx.content = distillToBudget(ctx.content, options.budget, budgetFormat);
    ctx.timer.end('budget');
  }

  // Domain-aware structured extraction (Twitter, Reddit, GitHub, HN)
  // Fires when URL matches a known domain. Replaces content with clean markdown.
  if (getDomainExtractor(fetchResult.url)) {
    try {
      ctx.timer.mark('domainExtract');
      const ddResult = await extractDomainData(fetchResult.html, fetchResult.url);
      ctx.timer.end('domainExtract');
      if (ddResult) {
        ctx.domainData = ddResult;
        ctx.content = ddResult.cleanContent;
      }
    } catch (e) {
      // Domain extraction failure is non-fatal; continue with normal content
      if (process.env.DEBUG) console.debug('[webpeel]', 'domain extraction failed:', e instanceof Error ? e.message : e);
    }
  }

  // === Zero-token safety net ===
  // NEVER return empty content. If pipeline produced nothing, fall back.
  if (!ctx.content || ctx.content.trim().length === 0) {
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
      console.error('Branding extraction failed:', error);
    } finally {
      // Clean up the kept-open page and browser
      try {
        await fetchResult.page.close().catch(() => {});
        if (fetchResult.browser) {
          await fetchResult.browser.close().catch(() => {});
        }
      } catch (e) {
        // Non-fatal: page/browser cleanup after branding extraction
        if (process.env.DEBUG) console.debug('[webpeel]', 'page/browser cleanup after branding:', e instanceof Error ? e.message : e);
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
      console.error('Change tracking failed:', error);
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
      console.error('Summary generation failed:', error);
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
  const tokens = estimateTokens(ctx.content);
  const fingerprint = createHash('sha256').update(ctx.content).digest('hex').slice(0, 16);

  // Build freshness from fetchResult response headers
  const freshness: PeelResult['freshness'] = {
    ...(fetchResult.responseHeaders?.['last-modified'] ? { lastModified: fetchResult.responseHeaders['last-modified'] } : {}),
    ...(fetchResult.responseHeaders?.['etag'] ? { etag: fetchResult.responseHeaders['etag'] } : {}),
    fetchedAt: new Date().toISOString(),
    ...(fetchResult.responseHeaders?.['cache-control'] ? { cacheControl: fetchResult.responseHeaders['cache-control'] } : {}),
  };

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
    changeTracking: ctx.changeResult,
    summary: ctx.summaryText,
    images: ctx.imagesList,
    linkCount: ctx.links.length,
    freshness,
    ...(ctx.prunedPercent !== undefined ? { prunedPercent: ctx.prunedPercent } : {}),
    ...(ctx.domainData !== undefined ? { domainData: ctx.domainData } : {}),
    ...(ctx.readabilityResult !== undefined ? { readability: ctx.readabilityResult } : {}),
    ...(ctx.quickAnswerResult !== undefined ? { quickAnswer: ctx.quickAnswerResult } : {}),
    timing: ctx.timer.toTiming(),
    ...(ctx.jsonLdType !== undefined ? { jsonLdType: ctx.jsonLdType } : {}),
  };
}
