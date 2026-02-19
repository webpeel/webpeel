/**
 * WebPeel - Fast web fetcher for AI agents
 * 
 * Main library export
 */

import { createHash } from 'crypto';
import { smartFetch } from './core/strategies.js';
import { htmlToMarkdown, htmlToText, estimateTokens, selectContent, detectMainContent, calculateQuality, truncateToTokenBudget, filterByTags } from './core/markdown.js';
import { distillToBudget } from './core/budget.js';
import { extractMetadata, extractLinks, extractImages } from './core/metadata.js';
import { cleanup, warmup, closePool, scrollAndWait, closeProfileBrowser } from './core/fetcher.js';
import { extractStructured } from './core/extract.js';
import { isPdfContentType, isDocxContentType, extractDocumentToFormat } from './core/documents.js';
import type { PeelOptions, PeelResult, ImageInfo } from './types.js';

export * from './types.js';
export { crawl, type CrawlOptions, type CrawlResult, type CrawlProgress } from './core/crawler.js';
export { discoverSitemap, type SitemapUrl, type SitemapResult } from './core/sitemap.js';
export { mapDomain, type MapOptions, type MapResult } from './core/map.js';
export { extractBranding, type BrandingProfile } from './core/branding.js';
export { trackChange, getSnapshot, clearSnapshots, type ChangeResult, type Snapshot } from './core/change-tracking.js';
export { extractWithLLM } from './core/extract.js';
export { extractDocumentToFormat, isPdfContentType, isDocxContentType, type DocumentExtractionResult } from './core/documents.js';
export { extractInlineJson, type InlineExtractOptions, type InlineExtractResult } from './core/extract-inline.js';
export { runAgent, type AgentOptions, type AgentResult, type AgentProgress, type AgentStreamEvent, type AgentDepth, type AgentTopic } from './core/agent.js';
export { summarizeContent, type SummarizeOptions } from './core/summarize.js';
export {
  getSearchProvider,
  DuckDuckGoProvider,
  BraveSearchProvider,
  type SearchProvider,
  type SearchProviderId,
  type WebSearchResult,
  type WebSearchOptions,
} from './core/search-provider.js';
export {
  answerQuestion,
  type AnswerRequest,
  type AnswerResponse,
  type AnswerCitation,
  type LLMProviderId,
  type TokensUsed,
} from './core/answer.js';

export { searchJobs, type JobCard, type JobDetail, type JobSearchOptions, type JobSearchResult } from './core/jobs.js';
export {
  RateGovernor,
  formatDuration,
  type RateConfig,
  type RateState,
  type CanApplyResult,
} from './core/rate-governor.js';
export {
  ApplicationTracker,
  type ApplicationRecord,
  type ApplicationFilter,
  type ApplicationStats,
  type ApplicationStatus,
} from './core/application-tracker.js';
export {
  applyToJob,
  loadApplications,
  saveApplication,
  getApplicationsToday,
  updateApplicationStatus,
  type ApplyProfile,
  type ApplyOptions,
  type ApplyProgressEvent,
  type DetectedField,
  type ApplyResult,
  type ApplicationRecord as ApplyApplicationRecord,
} from './core/apply.js';
// Human behavior exports — see bottom of file for full export
export { extractListings, type ListingItem } from './core/extract-listings.js';
export { formatTable } from './core/table-format.js';
export { findNextPageUrl } from './core/paginate.js';
export { distillToBudget, budgetListings, TOKENS_PER_LISTING_ITEM } from './core/budget.js';
export {
  watch,
  parseDuration,
  parseAssertion,
  type WatchOptions,
  type Assertion,
  type WatchCheckResult,
  type AssertionResult,
} from './core/watch.js';
export {
  diffUrl,
  type DiffOptions,
  type DiffResult,
  type DiffChange,
} from './core/diff.js';

/**
 * Fetch and extract content from a URL
 * 
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Extracted content and metadata
 * 
 * @example
 * ```typescript
 * import { peel } from 'webpeel';
 * 
 * const result = await peel('https://example.com');
 * console.log(result.content); // Markdown content
 * console.log(result.metadata); // Structured metadata
 * ```
 */
export async function peel(url: string, options: PeelOptions = {}): Promise<PeelResult> {
  const startTime = Date.now();

  // Apply agent-mode defaults (can be overridden by explicit options)
  if (options.agentMode) {
    if (options.budget === undefined) options.budget = 4000;
    if (options.format === undefined) options.format = 'markdown';
  }

  let {
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
    location: _location,
    stream: _stream,
    profileDir,
    headed = false,
  } = options;
  void _stream;

  // NOTE: PDFs/DOCX are now handled via simpleFetch + document parser.
  // No need to force browser rendering for them.

  // If screenshot is requested, force render mode
  if (screenshot) {
    render = true;
  }

  // If stealth is requested, force render mode
  if (stealth) {
    render = true;
  }

  // If actions are provided, force render mode
  if (actions && actions.length > 0) {
    render = true;
  }

  // If branding is requested, force render mode
  if (options.branding) {
    render = true;
  }

  try {
    // Fetch the page (keep browser open if branding extraction is needed)
    const needsBranding = options.branding && render;
    const fetchResult = await smartFetch(url, {
      forceBrowser: render,
      stealth,
      waitMs: wait,
      userAgent,
      timeoutMs: timeout,
      screenshot,
      screenshotFullPage,
      headers,
      cookies,
      actions,
      keepPageOpen: needsBranding,
      profileDir,
      headed,
    });

    // Detect content type from the response
    const ct = (fetchResult.contentType || '').toLowerCase();
    const urlLower = fetchResult.url.toLowerCase();

    // Check for binary document types (PDF/DOCX)
    const isDocument = isPdfContentType(ct) || isDocxContentType(ct) ||
      urlLower.endsWith('.pdf') || urlLower.endsWith('.docx');
    const hasBuffer = !!fetchResult.buffer;

    const isHTML = !isDocument && (ct.includes('html') || ct.includes('xhtml') || (!ct && fetchResult.html.trimStart().startsWith('<')));
    const isJSON = !isDocument && ct.includes('json');
    const isXML = !isDocument && (ct.includes('xml') || ct.includes('rss') || ct.includes('atom'));
    const isPlainText = !isDocument && (ct.includes('text/plain') || ct.includes('text/markdown') || ct.includes('text/csv') || ct.includes('text/css') || ct.includes('javascript'));
    
    const detectedType = isDocument ? 'document' : isHTML ? 'html' : isJSON ? 'json' : isXML ? 'xml' : isPlainText ? 'text' : 'html';
    
    let content: string;
    let title = '';
    let metadata: any = {};
    let links: string[] = [];
    let quality = 0;
    
    if (isDocument && hasBuffer) {
      // Document parsing pipeline (PDF/DOCX)
      const docResult = await extractDocumentToFormat(fetchResult.buffer!, {
        url: fetchResult.url,
        contentType: fetchResult.contentType,
        format,
      });

      content = docResult.content;
      title = docResult.metadata.title;
      metadata = docResult.metadata;
      quality = 1.0; // Documents are inherently structured content
    } else if (isHTML) {
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
        const meta = extractMetadata(html, fetchResult.url);
        return {
          title: meta.title,
          metadata: meta.metadata,
          links: extractLinks(html, fetchResult.url),
        };
      });

      const contentTask = Promise.resolve().then(() => {
        switch (format) {
          case 'html':
            return contentHtml;
          case 'text':
            return htmlToText(contentHtml);
          case 'markdown':
          default:
            return htmlToMarkdown(contentHtml, { raw });
        }
      });

      const [metaResult, convertedContent] = await Promise.all([metadataTask, contentTask]);
      title = metaResult.title;
      metadata = metaResult.metadata;
      links = metaResult.links;
      content = convertedContent;

      quality = calculateQuality(content, fetchResult.html);
    } else if (isJSON) {
      // JSON content — format nicely
      try {
        const parsed = JSON.parse(fetchResult.html);
        content = JSON.stringify(parsed, null, 2);
        title = 'JSON Response';
        
        // Extract any URLs from JSON for links
        const urlRegex = /https?:\/\/[^\s"'`,\]})]+/g;
        const found = content.match(urlRegex) || [];
        links = [...new Set(found)];
      } catch {
        content = fetchResult.html;
        title = 'JSON Response (malformed)';
      }
      quality = 1.0; // JSON is structured, always "clean"
    } else if (isXML) {
      // XML/RSS/Atom — convert to readable format
      try {
        const $ = (await import('cheerio')).load(fetchResult.html, { xml: true });
        
        // Check if RSS/Atom feed
        const items = $('item, entry');
        if (items.length > 0) {
          title = $('channel > title, feed > title').first().text() || 'RSS/Atom Feed';
          const feedItems: string[] = [];
          items.each((_, el) => {
            const itemTitle = $(el).find('title').first().text();
            const itemLink = $(el).find('link').first().text() || $(el).find('link').first().attr('href') || '';
            const itemDesc = $(el).find('description, summary, content').first().text().slice(0, 200);
            feedItems.push(`## ${itemTitle}\n${itemLink}\n${itemDesc}`);
            if (itemLink) links.push(itemLink);
          });
          content = `# ${title}\n\n${feedItems.join('\n\n---\n\n')}`;
        } else {
          content = fetchResult.html;
          title = $('title').first().text() || 'XML Document';
        }
      } catch {
        content = fetchResult.html;
        title = 'XML Document';
      }
      quality = 0.9;
    } else {
      // Plain text, CSS, JS, etc — return as-is
      content = fetchResult.html;
      title = fetchResult.url.split('/').pop() || 'Text Document';
      
      // Extract URLs from plain text
      const urlRegex = /https?:\/\/[^\s"'`,\]})]+/g;
      const found = content.match(urlRegex) || [];
      links = [...new Set(found)];
      quality = 1.0;
    }

    // Extract images if requested
    let imagesList: ImageInfo[] | undefined;
    if (extractImagesFlag && isHTML) {
      imagesList = extractImages(fetchResult.html, fetchResult.url);
    }

    // Extract structured data if requested
    let extracted: Record<string, any> | undefined;
    if (extract && isHTML) {
      if (extract.llmApiKey && (extract.prompt || extract.schema)) {
        // LLM-powered extraction
        const { extractWithLLM } = await import('./core/extract.js');
        extracted = await extractWithLLM(content, extract);
      } else if (extract.selectors || extract.schema) {
        // CSS-based extraction (existing)
        extracted = extractStructured(fetchResult.html, extract);
      }
    }

    // Truncate to token budget if requested (simple truncation)
    if (maxTokens && maxTokens > 0) {
      content = truncateToTokenBudget(content, maxTokens);
    }

    // Smart budget distillation — applied AFTER maxTokens truncation
    // This intelligently compresses content (strips boilerplate, compresses
    // tables, removes weak paragraphs) rather than blindly cutting.
    if (options.budget && options.budget > 0) {
      const budgetFormat: 'markdown' | 'text' | 'json' =
        detectedType === 'json' ? 'json' :
        format === 'text' ? 'text' : 'markdown';
      content = distillToBudget(content, options.budget, budgetFormat);
    }

    // Calculate elapsed time, tokens, and fingerprint
    const elapsed = Date.now() - startTime;
    const tokens = estimateTokens(content);
    const fingerprint = createHash('sha256').update(content).digest('hex').slice(0, 16);

    // Convert screenshot buffer to base64 if present
    const screenshotBase64 = fetchResult.screenshot?.toString('base64');

    // Extract branding if requested (reuses existing browser page when available)
    let brandingProfile: import('./core/branding.js').BrandingProfile | undefined;
    if (options.branding && render && fetchResult.page) {
      try {
        const { extractBranding } = await import('./core/branding.js');
        brandingProfile = await extractBranding(fetchResult.page);
      } catch (error) {
        console.error('Branding extraction failed:', error);
      } finally {
        // Clean up the kept-open page and browser
        try {
          await fetchResult.page.close().catch(() => {});
          if (fetchResult.browser) {
            await fetchResult.browser.close().catch(() => {});
          }
        } catch { /* ignore cleanup errors */ }
      }
    }

    // Track content changes if requested
    let changeResult: import('./core/change-tracking.js').ChangeResult | undefined;
    if (options.changeTracking) {
      try {
        const { trackChange } = await import('./core/change-tracking.js');
        changeResult = await trackChange(fetchResult.url, content, fingerprint);
      } catch (error) {
        console.error('Change tracking failed:', error);
      }
    }

    // Generate AI summary if requested
    let summaryText: string | undefined;
    if (options.summary && options.llm) {
      try {
        const { summarizeContent } = await import('./core/summarize.js');
        const maxLength = typeof options.summary === 'object' && options.summary.maxLength
          ? options.summary.maxLength
          : 150;
        
        summaryText = await summarizeContent(content, {
          apiKey: options.llm.apiKey,
          model: options.llm.model,
          apiBase: options.llm.baseUrl,
          maxWords: maxLength,
        });
      } catch (error) {
        console.error('Summary generation failed:', error);
      }
    }

    return {
      url: fetchResult.url,
      title,
      content,
      metadata,
      links,
      tokens,
      method: fetchResult.method === 'cached' ? 'simple' : fetchResult.method,
      elapsed,
      screenshot: screenshotBase64,
      contentType: detectedType,
      quality,
      fingerprint,
      extracted,
      branding: brandingProfile,
      changeTracking: changeResult,
      summary: summaryText,
      images: imagesList,
    };
  } catch (error) {
    // Clean up browser resources on error
    await cleanup();
    throw error;
  }
}

/**
 * Fetch multiple URLs in batch with concurrency control
 * 
 * @param urls - Array of URLs to fetch
 * @param options - Fetch options (including concurrency)
 * @returns Array of results or errors
 * 
 * @example
 * ```typescript
 * import { peelBatch } from 'webpeel';
 * 
 * const urls = ['https://example.com', 'https://example.org'];
 * const results = await peelBatch(urls, { concurrency: 3 });
 * ```
 */
export async function peelBatch(
  urls: string[],
  options: PeelOptions & { concurrency?: number } = {}
): Promise<(PeelResult | { url: string; error: string })[]> {
  const { concurrency = 3, ...peelOpts } = options;
  const results: (PeelResult | { url: string; error: string })[] = [];
  
  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(url => peel(url, peelOpts))
    );
    
    batchResults.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ 
          url: batch[j], 
          error: result.reason?.message || 'Unknown error' 
        });
      }
    });
  }
  
  return results;
}

/**
 * Clean up any browser resources
 * Call this when you're done using WebPeel
 */
export { cleanup, warmup, closePool, scrollAndWait, closeProfileBrowser };
export { getCached, setCached, clearCache, setCacheTTL } from './core/cache.js';
export {
  getRealisticUserAgent,
  getRandomUA,
  REALISTIC_USER_AGENTS,
} from './core/user-agents.js';
export {
  humanDelay,
  humanMouseMove,
  humanRead,
  warmupBrowse,
  humanType,
  humanClearAndType,
  humanClick,
  humanScroll,
  humanScrollToElement,
  warmupSession,
  humanSelect,
  humanUploadFile,
  humanToggle,
  type HumanConfig,
} from './core/human.js';
