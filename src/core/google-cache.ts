/**
 * Google Cache fallback fetcher.
 *
 * When a site blocks direct access (Akamai, PerimeterX, Cloudflare, etc.),
 * Google's cache at webcache.googleusercontent.com often has a clean copy
 * that's freely accessible without anti-bot protection.
 */

export interface GoogleCacheResult {
  html: string;
  url: string;
  cachedDate?: string; // Extracted from Google's cache notice if available
  statusCode: number;
  method: 'google-cache';
}

/**
 * Fetch a cached copy of a URL from Google Cache.
 *
 * Returns null if:
 * - Google returns a 404 (page not in cache)
 * - Google redirects to the live page (cache unavailable)
 * - The response looks like a Google search page rather than a cache
 */
export async function fetchGoogleCache(
  url: string,
  options?: { timeout?: number },
): Promise<GoogleCacheResult | null> {
  const timeout = options?.timeout ?? 10000;

  // Build the Google Cache URL
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(cacheUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Must look like a real Chrome browser or Google blocks us
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    clearTimeout(timer);

    // 404 → page not cached
    if (response.status === 404) {
      return null;
    }

    // If redirected to the live site (Google doesn't have a cache), return null
    const finalUrl = response.url;
    if (
      !finalUrl.includes('webcache.googleusercontent.com') &&
      !finalUrl.includes('google.com/search')
    ) {
      // Redirected away from Google cache — cache unavailable
      return null;
    }

    const html = await response.text();

    // If this looks like a Google search results page (not a cache page), return null
    if (isGoogleSearchPage(html)) {
      return null;
    }

    // If the page is way too small to be real content, return null
    if (html.length < 200) {
      return null;
    }

    // Extract the cache date from Google's notice banner
    const cachedDate = extractCacheDate(html);

    // Remove Google's wrapper elements and return the cleaned HTML
    const cleanedHtml = removeGoogleWrapper(html);

    return {
      html: cleanedHtml,
      url,
      cachedDate,
      statusCode: 200,
      method: 'google-cache',
    };
  } catch (error) {
    clearTimeout(timer);

    if (error instanceof Error && error.name === 'AbortError') {
      // Timeout
      return null;
    }

    // Network errors → return null (not in cache / unavailable)
    return null;
  }
}

/**
 * Detect if a page is a Google search results page rather than a cached page.
 */
function isGoogleSearchPage(html: string): boolean {
  // Google search pages have these distinctive patterns
  if (html.includes('<title>Google Search</title>')) return true;
  if (html.includes('id="search"') && html.includes('class="g"')) return true;
  // "Did not match any documents" message
  if (html.includes('did not match any documents')) return true;
  // Redirect to google.com/search with no cache content
  if (html.includes('www.google.com/search?') && !html.includes('webcache')) return true;
  return false;
}

/**
 * Extract the cache date from Google's cache notice banner.
 *
 * The notice typically reads:
 * "It is a snapshot of the page as it appeared on 15 Jan 2025 09:30:12 GMT."
 */
function extractCacheDate(html: string): string | undefined {
  // Match date patterns in Google's cache notice
  // Patterns like: "15 Jan 2025 09:30:12 GMT" or "Jan 15, 2025"
  const patterns = [
    /as it appeared on ([^<."]+(?:GMT|UTC))/i,
    /snapshot.*?on\s+([A-Za-z]+ \d+,?\s+\d{4}[^<."]*)/i,
    /cached on:?\s*([^<."]+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Remove Google's wrapper elements from the cached page.
 *
 * Google's cache page structure:
 * 1. A <div style="..."> at the very top with the cache notice
 * 2. An <hr> separator
 * 3. The actual cached page content
 *
 * We remove Google's branding/notice and return just the original content.
 */
function removeGoogleWrapper(html: string): string {
  let cleaned = html;

  // Remove the Google cache notice div at the top
  // It's typically: <div style="...">...</div><hr>
  // Strategy 1: Find the first <hr> that follows the cache notice and take everything after it
  const hrIndex = findFirstCacheHr(html);
  if (hrIndex !== -1) {
    cleaned = html.slice(hrIndex + 4); // +4 for '<hr>'
  }

  // Remove remaining Google-specific elements that might be injected
  // Google injects a top bar div with id="google-cache-hdr" or similar
  cleaned = cleaned
    .replace(/<div[^>]*id=["']google-cache-hdr["'][^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<div[^>]*id=["']gbw["'][^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<div[^>]*id=["']gb["'][^>]*>[\s\S]*?<\/div>/gi, '');

  return cleaned.trim();
}

/**
 * Find the index of the <hr> tag that separates Google's cache notice
 * from the actual page content.
 *
 * We look for the first <hr> that appears after Google's cache notice text.
 */
function findFirstCacheHr(html: string): number {
  // Look for the cache notice keywords to confirm we're in a Google cache page
  const noticeKeywords = [
    'webcache.googleusercontent',
    "Google's cache of",
    'cached version of',
    'It is a snapshot',
  ];

  const hasNotice = noticeKeywords.some((kw) =>
    html.toLowerCase().includes(kw.toLowerCase()),
  );

  if (!hasNotice) {
    // Not a standard Google cache page — don't strip anything
    return -1;
  }

  // Find the first <hr>, <hr/>, or <hr /> tag — that's the separator
  const hrMatch = html.match(/<hr\s*\/?>/i);
  if (hrMatch && hrMatch.index !== undefined) {
    return hrMatch.index;
  }

  return -1;
}

/**
 * Google Cache is always available — no API key or special setup required.
 */
export function isGoogleCacheAvailable(): boolean {
  return true;
}
