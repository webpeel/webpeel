import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchGoogleCache, isGoogleCacheAvailable } from '../core/google-cache.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Google Cache fallback', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('isGoogleCacheAvailable() always returns true', () => {
    expect(isGoogleCacheAvailable()).toBe(true);
  });

  it('returns null for 404 responses', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 404,
      url: 'https://webcache.googleusercontent.com/...',
      text: async () => '',
    });
    const result = await fetchGoogleCache('https://example.com');
    expect(result).toBeNull();
  });

  it('returns null when redirected away from Google cache', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://www.example.com/page', // Not a Google URL
      text: async () => '<html>live page</html>',
    });
    const result = await fetchGoogleCache('https://example.com');
    expect(result).toBeNull();
  });

  it('returns null for JS challenge page (Google enablejs redirect)', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://webcache.googleusercontent.com/search?q=cache:...',
      text: async () => `<!DOCTYPE html><html><head><title>Google Search</title></head><body>
        <noscript><meta content="0;url=/httpservice/retry/enablejs" http-equiv="refresh">
        Please click here if not redirected</noscript>
        <script>window.google = {};</script></body></html>`,
    });
    const result = await fetchGoogleCache('https://www.bestbuy.com/product/123');
    expect(result).toBeNull();
  });

  it('returns null for "did not match any documents"', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://webcache.googleusercontent.com/search?q=cache:...',
      text: async () => `<html><body>Your search - https://example.com - did not match any documents.</body></html>`,
    });
    const result = await fetchGoogleCache('https://example.com');
    expect(result).toBeNull();
  });

  it('returns cleaned HTML for a valid cache page', async () => {
    const mockCacheHtml = `<html>
      <body>
      <div>This is Google's cache of <a href="https://example.com">https://example.com</a>.
      It is a snapshot of the page as it appeared on 15 Jan 2025 12:00:00 GMT.</div>
      <hr>
      <html>
        <head><title>Example Product - $99.99</title></head>
        <body>
          <h1>Example Product</h1>
          <span class="price">$99.99</span>
        </body>
      </html>
      </body>
    </html>`;

    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://webcache.googleusercontent.com/search?q=cache:...',
      text: async () => mockCacheHtml,
    });

    const result = await fetchGoogleCache('https://example.com/product/123');
    expect(result).not.toBeNull();
    expect(result!.html).toContain('Example Product');
    expect(result!.html).toContain('$99.99');
    expect(result!.statusCode).toBe(200);
    expect(result!.method).toBe('google-cache');
    expect(result!.cachedDate).toContain('15 Jan 2025');
  });

  it('returns null for timeout (AbortError)', async () => {
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );
    const result = await fetchGoogleCache('https://example.com', { timeout: 100 });
    expect(result).toBeNull();
  });

  it('returns null for network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
    const result = await fetchGoogleCache('https://example.com');
    expect(result).toBeNull();
  });

  it('returns null for page too small', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      url: 'https://webcache.googleusercontent.com/search?q=cache:...',
      text: async () => `<html><body>
  This is Google's cache. It is a snapshot.
  <hr>
  Hi
</body></html>`,
    });
    const result = await fetchGoogleCache('https://example.com');
    expect(result).toBeNull();
  });
});
