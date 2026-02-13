/**
 * Web crawler functionality
 * Crawls a starting URL and follows links matching specified patterns
 */

import { peel } from '../index.js';
import type { PeelOptions } from '../types.js';
import { fetch as undiciFetch } from 'undici';

export interface CrawlOptions extends Omit<PeelOptions, 'format'> {
  /** Maximum number of pages to crawl (default: 10, max: 100) */
  maxPages?: number;
  /** Maximum depth to crawl (default: 2, max: 5) */
  maxDepth?: number;
  /** Only crawl URLs from these domains (default: same domain as starting URL) */
  allowedDomains?: string[];
  /** Exclude URLs matching these patterns (regex strings) */
  excludePatterns?: string[];
  /** Respect robots.txt (default: true) */
  respectRobotsTxt?: boolean;
  /** Rate limit between requests in milliseconds (default: 1000ms = 1 req/sec) */
  rateLimitMs?: number;
}

export interface CrawlResult {
  /** URL of the crawled page */
  url: string;
  /** Page title */
  title: string;
  /** Markdown content */
  markdown: string;
  /** All links found on this page (absolute URLs) */
  links: string[];
  /** Depth level (0 = starting URL) */
  depth: number;
  /** Parent URL that linked to this page (null for starting URL) */
  parent: string | null;
  /** Time elapsed fetching this page (ms) */
  elapsed: number;
  /** Error message if page failed to fetch */
  error?: string;
}

interface RobotsRules {
  disallowedPaths: string[];
  crawlDelay?: number;
}

/**
 * Parse robots.txt and return disallowed paths for User-agent: *
 */
async function fetchRobotsTxt(domain: string): Promise<RobotsRules> {
  const robotsUrl = `https://${domain}/robots.txt`;
  
  try {
    const response = await undiciFetch(robotsUrl, {
      headers: {
        'User-Agent': 'WebPeel/0.3.1 (+https://webpeel.dev)',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      // If robots.txt doesn't exist, allow everything
      return { disallowedPaths: [] };
    }

    const text = await response.text();
    const lines = text.split('\n');
    
    const disallowedPaths: string[] = [];
    let crawlDelay: number | undefined;
    let relevantSection = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check for User-agent: *
      if (trimmed.toLowerCase().startsWith('user-agent:')) {
        const agent = trimmed.substring('user-agent:'.length).trim();
        relevantSection = agent === '*';
        continue;
      }

      if (!relevantSection) continue;

      // Parse Disallow directives
      if (trimmed.toLowerCase().startsWith('disallow:')) {
        const path = trimmed.substring('disallow:'.length).trim();
        if (path) {
          disallowedPaths.push(path);
        }
      }

      // Parse Crawl-delay directive
      if (trimmed.toLowerCase().startsWith('crawl-delay:')) {
        const delay = parseInt(trimmed.substring('crawl-delay:'.length).trim());
        if (!isNaN(delay)) {
          crawlDelay = delay * 1000; // Convert to milliseconds
        }
      }
    }

    return { disallowedPaths, crawlDelay };
  } catch {
    // If we can't fetch robots.txt, allow everything
    return { disallowedPaths: [] };
  }
}

/**
 * Check if a URL is allowed by robots.txt rules
 */
function isAllowedByRobots(url: string, rules: RobotsRules): boolean {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  for (const disallowed of rules.disallowedPaths) {
    // Simple prefix matching (proper robots.txt parsing would handle wildcards)
    if (path.startsWith(disallowed)) {
      return false;
    }
  }

  return true;
}

/**
 * Crawl a website starting from a URL
 * 
 * @param startUrl - Starting URL to crawl from
 * @param options - Crawl options
 * @returns Array of crawl results
 * 
 * @example
 * ```typescript
 * import { crawl } from 'webpeel';
 * 
 * const results = await crawl('https://example.com', {
 *   maxPages: 20,
 *   maxDepth: 2,
 * });
 * 
 * console.log(`Crawled ${results.length} pages`);
 * ```
 */
export async function crawl(
  startUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResult[]> {
  const {
    maxPages = 10,
    maxDepth = 2,
    allowedDomains,
    excludePatterns = [],
    respectRobotsTxt = true,
    rateLimitMs = 1000,
    ...peelOptions
  } = options;

  // Validate limits
  const validatedMaxPages = Math.min(Math.max(maxPages, 1), 100);
  const validatedMaxDepth = Math.min(Math.max(maxDepth, 1), 5);
  const validatedRateLimit = Math.max(rateLimitMs, 100); // Min 100ms between requests

  // Parse starting URL
  const startUrlObj = new URL(startUrl);
  const startDomain = startUrlObj.hostname;

  // Default: only crawl same domain as starting URL
  const validatedAllowedDomains = allowedDomains && allowedDomains.length > 0
    ? allowedDomains
    : [startDomain];

  // Compile exclude patterns
  const excludeRegexes = excludePatterns.map(pattern => new RegExp(pattern));

  // Fetch robots.txt if needed
  let robotsRules: RobotsRules = { disallowedPaths: [] };
  if (respectRobotsTxt) {
    robotsRules = await fetchRobotsTxt(startDomain);
    
    // Use crawl-delay from robots.txt if it's larger than our rate limit
    if (robotsRules.crawlDelay && robotsRules.crawlDelay > validatedRateLimit) {
      console.error(`[Crawler] Using Crawl-delay from robots.txt: ${robotsRules.crawlDelay}ms`);
    }
  }

  const effectiveRateLimit = robotsRules.crawlDelay || validatedRateLimit;

  // State tracking
  const results: CrawlResult[] = [];
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number; parent: string | null }> = [
    { url: startUrl, depth: 0, parent: null },
  ];

  while (queue.length > 0 && results.length < validatedMaxPages) {
    const item = queue.shift()!;
    const { url, depth, parent } = item;

    // Skip if already visited
    if (visited.has(url)) continue;
    visited.add(url);

    // Skip if depth exceeded
    if (depth > validatedMaxDepth) continue;

    // Validate URL
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      continue; // Skip invalid URLs
    }

    // Check if domain is allowed
    if (!validatedAllowedDomains.includes(urlObj.hostname)) {
      continue;
    }

    // Check exclude patterns
    if (excludeRegexes.some(regex => regex.test(url))) {
      continue;
    }

    // Check robots.txt
    if (respectRobotsTxt && !isAllowedByRobots(url, robotsRules)) {
      console.error(`[Crawler] Skipping ${url} (disallowed by robots.txt)`);
      continue;
    }

    // Fetch the page
    try {
      const result = await peel(url, {
        ...peelOptions,
        format: 'markdown',
      });

      results.push({
        url: result.url,
        title: result.title,
        markdown: result.content,
        links: result.links,
        depth,
        parent,
        elapsed: result.elapsed,
      });

      // Add discovered links to queue
      if (depth < validatedMaxDepth) {
        for (const link of result.links) {
          if (!visited.has(link)) {
            queue.push({
              url: link,
              depth: depth + 1,
              parent: url,
            });
          }
        }
      }

      // Rate limiting
      if (results.length < validatedMaxPages) {
        await new Promise(resolve => setTimeout(resolve, effectiveRateLimit));
      }
    } catch (error) {
      // Log error and continue
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Crawler] Failed to fetch ${url}: ${errorMessage}`);
      
      results.push({
        url,
        title: '',
        markdown: '',
        links: [],
        depth,
        parent,
        elapsed: 0,
        error: errorMessage,
      });
    }
  }

  return results;
}
