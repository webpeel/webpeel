# @webpeel/sdk

Official TypeScript SDK for the [WebPeel API](https://webpeel.dev) — the fast, AI-ready web fetcher with stealth mode, JS rendering, screenshot capture, structured extraction, and more.

## Installation

```bash
npm install @webpeel/sdk
```

Node.js 18+ is required (uses native `fetch`). Zero runtime dependencies.

## Quick Start

```typescript
import WebPeel from '@webpeel/sdk';

const client = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY! });
const result = await client.fetch('https://example.com');
console.log(result.content); // Clean Markdown
```

## Authentication

Create an API key at [webpeel.dev/dashboard](https://webpeel.dev/dashboard). Keys start with `wp_`.

```typescript
const client = new WebPeel({ apiKey: 'wp_your_key_here' });
```

We recommend storing your key in an environment variable:

```bash
export WEBPEEL_API_KEY=wp_your_key_here
```

---

## Methods

### `client.fetch(url, options?)`

Fetch a URL and return clean, structured content.

```typescript
// Simple fetch → Markdown
const result = await client.fetch('https://example.com');
console.log(result.content);        // Markdown content
console.log(result.metadata.title); // Page title
console.log(result.metadata.wordCount);

// With JavaScript rendering (for SPAs, lazy-loaded content)
const result = await client.fetch('https://app.example.com', { render: true });

// With stealth mode (bypass bot detection)
const result = await client.fetch('https://protected.example.com', { stealth: true });

// Ask a question about the page
const result = await client.fetch('https://example.com', {
  question: 'What is this company's main product?',
});
console.log(result.answer); // Direct answer

// Token budget (stop early to save credits)
const result = await client.fetch('https://example.com', { budget: 4000 });

// Different output formats
const result = await client.fetch('https://example.com', { format: 'text' }); // plain text
const result2 = await client.fetch('https://example.com', { format: 'html' }); // raw HTML
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `render` | `boolean` | `false` | Use headless browser for JS-heavy pages |
| `stealth` | `boolean` | `false` | Enable stealth mode to bypass bot detection |
| `question` | `string` | — | Ask a question; get an `answer` in the result |
| `budget` | `number` | — | Token budget limit |
| `format` | `'markdown' \| 'text' \| 'html' \| 'json'` | `'markdown'` | Output format |
| `waitFor` | `string` | — | CSS selector to wait for (requires `render: true`) |
| `waitMs` | `number` | — | Extra wait time in ms (requires `render: true`) |
| `timeout` | `number` | client default | Per-request timeout (ms) |
| `signal` | `AbortSignal` | — | Cancellation signal |

**Result:**

```typescript
{
  url: string;           // Final URL (after redirects)
  content: string;       // Page content in requested format
  metadata: {
    title?: string;
    description?: string;
    author?: string;
    publishedAt?: string;
    wordCount?: number;
    language?: string;
    siteName?: string;
    favicon?: string;
    ogImage?: string;
    canonical?: string;
  };
  answer?: string;       // Answer to your question (if asked)
  statusCode?: number;   // HTTP status
  contentType?: string;  // Content-Type header
  requestId?: string;    // For debugging
}
```

---

### `client.search(query, options?)`

Search the web and return structured results.

```typescript
const results = await client.search('best web scrapers 2026');
for (const r of results) {
  console.log(r.rank, r.title, r.url);
  console.log(r.description);
}

// With options
const results = await client.search('web scraping tools', {
  limit: 20,
  country: 'US',
  language: 'en',
  includeContent: true, // Fetch page content for each result
});
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | `number` | `10` | Max results to return |
| `country` | `string` | — | Country code (`'US'`, `'GB'`, ...) |
| `language` | `string` | — | Language code (`'en'`, `'fr'`, ...) |
| `includeContent` | `boolean` | `false` | Include page content for each result |

---

### `client.screenshot(url, options?)`

Take a screenshot of a URL.

```typescript
const shot = await client.screenshot('https://example.com');
// shot.imageData is base64-encoded image
const buf = Buffer.from(shot.imageData, 'base64');
await fs.writeFile('screenshot.png', buf);

// Full-page screenshot in JPEG
const shot = await client.screenshot('https://example.com', {
  format: 'jpeg',
  quality: 90,
  fullPage: true,
  width: 1440,
});
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | `'png' \| 'jpeg' \| 'webp'` | `'png'` | Image format |
| `quality` | `number` | `80` | Quality 0–100 (JPEG/WebP only) |
| `fullPage` | `boolean` | `false` | Capture full scrollable page |
| `width` | `number` | `1280` | Viewport width |
| `height` | `number` | `720` | Viewport height |
| `selector` | `string` | — | CSS selector to screenshot |
| `waitForNetworkIdle` | `boolean` | `false` | Wait for network idle |

---

### `client.crawl(url, options?)`

Crawl a website, following internal links.

```typescript
const result = await client.crawl('https://example.com', {
  depth: 2,
  limit: 100,
  onPage: (page) => {
    console.log(`[${page.depth}] ${page.url} — ${page.metadata.title}`);
  },
});

console.log(`Crawled ${result.totalPages} pages (${result.failedPages} failed)`);
for (const page of result.pages) {
  console.log(page.url, page.content.slice(0, 200));
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `depth` | `number` | `1` | Max crawl depth from start URL |
| `limit` | `number` | `100` | Max pages to crawl |
| `include` | `string[]` | — | URL patterns to include (glob/regex) |
| `exclude` | `string[]` | — | URL patterns to exclude |
| `render` | `boolean` | `false` | Use JS rendering for all pages |
| `onPage` | `(page) => void` | — | Progress callback per page |

---

### `client.batch(urls, options?)`

Fetch multiple URLs concurrently with controlled parallelism.

```typescript
const result = await client.batch([
  'https://example.com',
  'https://example.org',
  'https://example.net',
], {
  concurrency: 5,
  onResult: (item) => {
    if (item.success) {
      console.log(`✓ ${item.url}`);
    } else {
      console.log(`✗ ${item.url}: ${item.error}`);
    }
  },
  fetchOptions: {
    render: true,
    format: 'markdown',
  },
});

console.log(`${result.succeeded} succeeded, ${result.failed} failed`);
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | `number` | `5` | Max concurrent requests |
| `onResult` | `(item) => void` | — | Callback per completed URL |
| `fetchOptions` | `FetchOptions` | — | Options applied to every fetch |

---

## Error Handling

All errors extend `WebPeelError`. Use `instanceof` to handle specific cases:

```typescript
import WebPeel, {
  AuthenticationError,
  RateLimitError,
  TimeoutError,
  BlockedError,
  ValidationError,
  NetworkError,
} from '@webpeel/sdk';

try {
  const result = await client.fetch('https://example.com');
} catch (err) {
  if (err instanceof AuthenticationError) {
    // Invalid/missing API key
    console.error('Check your API key:', err.message);
  } else if (err instanceof RateLimitError) {
    // Rate limit exceeded
    const waitSec = err.retryAfter ?? 60;
    console.error(`Rate limited. Retry after ${waitSec}s`);
  } else if (err instanceof TimeoutError) {
    // Request timed out
    console.error('Request timed out:', err.message);
  } else if (err instanceof BlockedError) {
    // Target site blocked the request
    console.error('Site blocked the request. Try { stealth: true }');
  } else if (err instanceof ValidationError) {
    // Bad request parameters
    console.error('Invalid parameters:', err.message);
  } else if (err instanceof NetworkError) {
    // No response received (network failure)
    console.error('Network error:', err.message);
  } else {
    throw err; // Re-throw unknown errors
  }
}
```

All errors have:
- `err.message` — Human-readable description
- `err.type` — Machine-readable type string
- `err.status` — HTTP status code (0 for network errors)
- `err.hint` — Optional fix suggestion
- `err.requestId` — Request ID for support (include this when filing issues)

---

## Configuration

```typescript
const client = new WebPeel({
  apiKey: 'wp_...',           // Required
  baseUrl: 'https://...',     // Override API base URL (default: https://api.webpeel.dev)
  timeout: 60_000,            // Default timeout in ms (default: 30000)
  maxRetries: 3,              // Max retries on 429/5xx (default: 2)
});
```

The SDK automatically retries requests on rate limit (429) and server errors (5xx) with exponential backoff, respecting the `Retry-After` header.

---

## TypeScript

The SDK ships with full TypeScript support. All options and return types are exported:

```typescript
import type {
  FetchOptions,
  FetchResult,
  SearchOptions,
  SearchResult,
  ScreenshotOptions,
  ScreenshotResult,
  CrawlOptions,
  CrawlResult,
  CrawledPage,
  BatchOptions,
  BatchResult,
  BatchItemResult,
  PageMetadata,
  WebPeelOptions,
} from '@webpeel/sdk';
```

---

## License

MIT © WebPeel
