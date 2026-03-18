/**
 * WebPeel - Fast web fetcher for AI agents
 * 
 * Main library export
 */

import { cleanup, warmup, closePool, scrollAndWait, closeProfileBrowser } from './core/fetcher.js';
import type { PeelOptions, PeelResult } from './types.js';
import {
  createContext,
  normalizeOptions,
  handleYouTube,
  fetchContent,
  detectContentType,
  parseContent,
  postProcess,
  finalize,
  buildResult,
} from './core/pipeline.js';
import { checkUrlSafety } from './core/safe-browsing.js';

export * from './types.js';
export { getDomainExtractor, extractDomainData, type DomainExtractResult, type DomainExtractor } from './core/domain-extractors.js';
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
  providerStats,
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
export {
  parseYouTubeUrl,
  extractVideoInfo,
  extractPlayerResponse,
  parseCaptionXml,
  decodeHtmlEntities,
  getYouTubeTranscript,
  type TranscriptSegment,
  type YouTubeTranscript,
  type YouTubeVideoInfo,
} from './core/youtube.js';
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
export { extractReadableContent, type ReadabilityResult, type ReadabilityOptions } from './core/readability.js';
export { quickAnswer, type QuickAnswerOptions, type QuickAnswerResult } from './core/quick-answer.js';
export { extractValueFromPassage, smartExtractSchemaFields } from './core/schema-postprocess.js';
export { Timer, type PipelineTiming } from './core/timing.js';
export { chunkContent, type ChunkOptions, type ContentChunk, type ChunkResult } from './core/chunker.js';
// search-fallback: proprietary module, loaded at runtime only
export type SearchFallbackResult = { content: string; url: string; method: string };
export async function searchFallback(..._args: any[]): Promise<SearchFallbackResult | null> {
  // @ts-ignore — proprietary module, gitignored
  try { const m = await import('./core/search-fallback.js'); return m.searchFallback(..._args); } catch { return null; }
}
export { peelTLSFetch, isPeelTLSAvailable, shutdownPeelTLS, type PeelTLSOptions, type PeelTLSResult } from './core/peel-tls.js';
export { sanitizeForLLM, type SanitizeResult } from './core/prompt-guard.js';
export { getSourceCredibility, type SourceCredibility } from './core/source-credibility.js';
export { verifyDomain, type DomainVerification } from './core/domain-verify.js';
export { checkUrlSafety, type SafeBrowsingResult } from './core/safe-browsing.js';

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
  const ctx = createContext(url, options);
  normalizeOptions(ctx);

  // Safe Browsing check — runs before any HTTP request, non-blocking
  const sbResult = await checkUrlSafety(url, process.env.SAFE_BROWSING_API_KEY);
  ctx.safeBrowsingResult = sbResult;
  if (!sbResult.safe) {
    const threatList = sbResult.threats.join(', ');
    ctx.warnings.push(`⚠️ URL flagged by Safe Browsing: ${threatList}`);
  }

  const ytResult = await handleYouTube(ctx);
  if (ytResult) {
    // Attach safe browsing to YouTube results too
    return {
      ...ytResult,
      safeBrowsing: sbResult,
      ...(ytResult.warnings || ctx.warnings.length > 0
        ? { warnings: [...(ytResult.warnings ?? []), ...ctx.warnings.filter(w => !ytResult.warnings?.includes(w))] }
        : {}),
    };
  }

  try {
    await fetchContent(ctx);
    detectContentType(ctx);
    await parseContent(ctx);
    await postProcess(ctx);
    await finalize(ctx);
    const result = buildResult(ctx);
    // Attach safe browsing result
    result.safeBrowsing = sbResult;
    return result;
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
  options: PeelOptions & {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<(PeelResult | { url: string; error: string })[]> {
  const { concurrency = 3, onProgress, ...peelOpts } = options;
  const results: (PeelResult | { url: string; error: string })[] = new Array(urls.length);
  let nextIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      const url = urls[index];
      try {
        results[index] = await peel(url, peelOpts);
      } catch (error) {
        results[index] = {
          url,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
      completedCount++;
      onProgress?.(completedCount, urls.length);
    }
  }

  // Launch concurrent workers (true worker-pool, not sequential batches)
  const workerCount = Math.min(concurrency, urls.length);
  if (workerCount > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
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

export { SCHEMA_TEMPLATES, getSchemaTemplate, listSchemaTemplates, type SchemaTemplate } from './core/schema-templates.js';

// Framework integrations
export { WebPeelLoader, type WebPeelLoaderOptions } from './integrations/langchain.js';
export { WebPeelReader, type WebPeelReaderOptions } from './integrations/llamaindex.js';

// Advanced stealth utilities — for power users who want to apply extra evasions
// to their own Playwright pages.
// stealth-patches: proprietary module, loaded at runtime only
export async function applyStealthPatches(page: any): Promise<void> {
  // @ts-ignore — proprietary module, gitignored
  try { const m = await import('./core/stealth-patches.js'); await m.applyStealthPatches(page); } catch { /* not available */ }
}
export async function applyAcceptLanguageHeader(page: any, lang?: string): Promise<void> {
  // @ts-ignore — proprietary module, gitignored
  try { const m = await import('./core/stealth-patches.js'); await m.applyAcceptLanguageHeader(page, lang); } catch { /* not available */ }
}

// Google Cache fallback — fetch cached copies of blocked pages
export { fetchGoogleCache, isGoogleCacheAvailable, type GoogleCacheResult } from './core/google-cache.js';
export { cfWorkerFetch, isCfWorkerAvailable, type CfWorkerProxyOptions, type CfWorkerProxyResult } from './core/cf-worker-proxy.js';

/**
 * WebPeel client class — alternative OOP interface over the functional API.
 * Provides the same capabilities as the standalone functions but with
 * a configured client instance.
 *
 * @example
 * import { WebPeel } from 'webpeel';
 * const wp = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY });
 * const result = await wp.fetch('https://stripe.com');
 */
export class WebPeel {
  private readonly apiKey: string;
  constructor(config: { apiKey: string; apiUrl?: string }) {
    if (!config.apiKey) throw new Error('WebPeel: apiKey is required');
    this.apiKey = config.apiKey;
    // apiUrl reserved for future use (remote API proxy mode)
    void config.apiUrl;
  }

  /** Fetch and extract content from a URL */
  async fetch(url: string, options: PeelOptions = {}): Promise<PeelResult> {
    return peel(url, { ...options });
  }

  /** Search the web */
  async search(query: string, options: Record<string, unknown> = {}): Promise<unknown> {
    const { getSearchProvider } = await import('./core/search-provider.js');
    const provider = getSearchProvider({ ...options as any });
    return provider.searchWeb(query, options as any);
  }

  /** Crawl a site */
  async crawl(startUrl: string, options: Record<string, unknown> = {}): Promise<unknown> {
    const { crawl: crawlFn } = await import('./core/crawler.js');
    return crawlFn(startUrl, { ...options as any, apiKey: this.apiKey });
  }

  /** Map a domain's pages */
  async map(url: string, options: Record<string, unknown> = {}): Promise<unknown> {
    const { mapDomain } = await import('./core/map.js');
    return mapDomain(url, { ...options as any });
  }

  /** Extract structured data */
  async extract(url: string, _schema: Record<string, unknown>, options: PeelOptions = {}): Promise<unknown> {
    const result = await peel(url, { ...options });
    return result;
  }
}
