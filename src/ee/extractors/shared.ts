import { simpleFetch } from '../../core/fetcher.js';

export { simpleFetch };

export function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Strip HTML tags from a string. */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

/** Format a Unix timestamp (seconds) as ISO 8601. */
export function unixToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

/** Fetch JSON from a URL using simpleFetch (reuses WebPeel's HTTP stack). */
export async function fetchJson(url: string, customHeaders?: Record<string, string>): Promise<any> {
  // Use plain fetch (not simpleFetch) for JSON API calls.
  // simpleFetch adds stealth browser headers (Sec-CH-UA, Sec-Fetch-*, etc.)
  // which confuse API endpoints like api.github.com into returning HTML.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'webpeel/0.21 (https://webpeel.dev)',
        'Accept': 'application/json',
        ...customHeaders,
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    // Surface 429 as a thrown error so callers can detect rate-limiting
    // and the cache wrapper can serve stale results instead of garbage.
    if (resp.status === 429) {
      const err = new Error(`429 Too Many Requests: ${url}`);
      (err as any).statusCode = 429;
      throw err;
    }
    const text = await resp.text();
    const parsed = tryParseJson(text);
    if (parsed === null && text.length > 0) {
      console.warn(`[webpeel:fetchJson] Non-JSON response from ${url} (${text.length} bytes, status: ${resp.status}): ${text.slice(0, 120)}`);
    }
    return parsed;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/** Fetch JSON with exponential backoff retry on 429 / rate-limit errors. */
export async function fetchJsonWithRetry(
  url: string,
  headers?: Record<string, string>,
  retries = 2,
  baseDelayMs = 1000
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fetchJson(url, headers);
      return result;
    } catch (e: any) {
      // Retry on rate-limit or transient errors
      if (attempt < retries && (e.message?.includes('429') || e.message?.includes('rate') || e.message?.includes('Too Many'))) {
        await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Twitter / X extractor
// ---------------------------------------------------------------------------

/** Recursively search an object for a value matching predicate (BFS). */
