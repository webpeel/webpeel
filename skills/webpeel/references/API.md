# WebPeel API Reference

Base URL: `https://api.webpeel.dev`

All endpoints require `Authorization: Bearer YOUR_API_KEY` header.

## Core Endpoints

### GET /v1/fetch
Extract clean content from a URL.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | URL to fetch |
| `format` | string | `markdown` | Output: `markdown`, `html`, `text` |
| `render` | boolean | `false` | Use browser rendering (JS sites) |
| `stealth` | boolean | `false` | Anti-bot evasion mode |
| `budget` | number | - | Max tokens in output |
| `extract` | string | - | JSON schema for structured extraction |

**Response:**
```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "content": "# Example Domain\n\nThis domain is for...",
  "tokens": 46,
  "rawTokenEstimate": 132,
  "tokenSavingsPercent": 65,
  "method": "simple",
  "elapsed": 141,
  "metadata": {
    "title": "Example Domain",
    "description": "...",
    "wordCount": 28
  }
}
```

### GET /v1/search
Search the web and return structured results.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search query |
| `limit` | number | Max results (default: 10) |

### POST /v1/screenshot
Take a screenshot of a URL.

**Body:**
```json
{
  "url": "https://example.com",
  "fullPage": true,
  "width": 1280,
  "height": 720
}
```

### POST /v1/batch
Fetch multiple URLs in parallel.

**Body:**
```json
{
  "urls": ["https://example.com", "https://stripe.com"],
  "format": "markdown"
}
```

### POST /v1/watch
Start monitoring a URL for changes.

**Body:**
```json
{
  "url": "https://example.com/status",
  "interval": 3600
}
```

### POST /v1/watch/:id/check
Check for changes. Add `?diff=true` for diff-only output.

### POST /v1/crawl
Crawl a site starting from a URL.

**Body:**
```json
{
  "url": "https://example.com",
  "maxPages": 50
}
```

### POST /v1/map
Discover all URLs on a domain.

**Body:**
```json
{
  "url": "https://example.com"
}
```

## Firecrawl-Compatible Endpoints

These endpoints accept the same request format as Firecrawl:

- `POST /v1/scrape` — Same as Firecrawl's scrape endpoint
- `POST /v2/scrape` — V2 format with `formats` array
- `POST /v1/crawl` — Async crawl job
- `GET /v1/crawl/:id` — Check crawl status
- `POST /v1/search` — Search endpoint
- `POST /v1/map` — Site mapping

## Rate Limits

| Tier | Requests/month | Requests/hour |
|------|---------------|---------------|
| Free | ~2,000 | 25 |
| Pro ($9) | ~5,000 | 100 |
| Max ($29) | ~25,000 | 500 |

No surprise charges. Requests over the limit return 429 with `Retry-After` header.
