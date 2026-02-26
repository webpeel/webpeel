# Endpoints

Base URL: `https://api.webpeel.dev/v1`

All endpoints require `Authorization: Bearer wp_YOUR_KEY`.

---

## Fetch

Fetch any URL as clean markdown, HTML, text, or JSON.

```
GET /v1/fetch
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | The URL to fetch |
| `format` | string | `markdown` | Output format: `markdown`, `html`, `text`, `json` |
| `screenshot` | boolean | `false` | Include a base64 screenshot |
| `fullPage` | boolean | `false` | Full-page screenshot (requires `screenshot=true`) |
| `timeout` | number | `30000` | Request timeout in milliseconds |

**Example:**
```bash
curl "https://api.webpeel.dev/v1/fetch?url=https://stripe.com/pricing&format=markdown" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"
```

**Response:**
```json
{
  "url": "https://stripe.com/pricing",
  "title": "Pricing & Fees | Stripe",
  "markdown": "# Stripe Pricing\n\nSimple, transparent pricing...",
  "wordCount": 3241,
  "responseTime": 412,
  "screenshot": null
}
```

---

## Search

Search the web and get structured results.

```
GET /v1/search
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | required | Search query |
| `limit` | number | `10` | Number of results (max 20) |
| `fetchContent` | boolean | `false` | Fetch full page content for each result |
| `lang` | string | `en` | Language code |
| `region` | string | `us` | Region code |

**Example:**
```bash
curl "https://api.webpeel.dev/v1/search?q=typescript+orm+comparison&limit=5" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"
```

**Response:**
```json
{
  "query": "typescript orm comparison",
  "results": [
    {
      "title": "The Best TypeScript ORMs in 2025",
      "url": "https://prisma.io/blog/...",
      "snippet": "Comparing Prisma, Drizzle, TypeORM...",
      "publishedAt": "2025-01-15"
    }
  ]
}
```

---

## Extract

Extract structured data from a URL using a JSON Schema.

```
POST /v1/extract
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | URL to extract from |
| `schema` | object | JSON Schema defining the data to extract |
| `prompt` | string | Optional: natural language instructions |

**Example:**
```bash
curl -X POST "https://api.webpeel.dev/v1/extract" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://stripe.com/pricing",
    "schema": {
      "type": "object",
      "properties": {
        "plans": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name":     { "type": "string" },
              "price":    { "type": "string" },
              "features": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    }
  }'
```

**Response:**
```json
{
  "url": "https://stripe.com/pricing",
  "data": {
    "plans": [
      {
        "name": "Starter",
        "price": "2.9% + 30¢ per transaction",
        "features": ["Basic card processing", "Dashboard", "Email support"]
      }
    ]
  }
}
```

---

## Crawl

Crawl an entire website and return all pages.

```
POST /v1/crawl
```

**Body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | Starting URL |
| `maxPages` | number | `50` | Maximum pages to crawl |
| `maxDepth` | number | `3` | Maximum link depth |
| `outputFormat` | string | `markdown` | Format for page content |
| `include` | string[] | `[]` | URL path patterns to include |
| `exclude` | string[] | `[]` | URL path patterns to exclude |
| `respectRobotsTxt` | boolean | `true` | Honor robots.txt directives |

**Example:**
```bash
curl -X POST "https://api.webpeel.dev/v1/crawl" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://docs.example.com", "maxPages": 100, "maxDepth": 3 }'
```

**Response:**
```json
{
  "jobId": "crawl_abc123",
  "status": "running",
  "pagesFound": 0,
  "streamUrl": "https://api.webpeel.dev/v1/crawl/crawl_abc123/stream"
}
```

Use the `streamUrl` to receive pages as they are crawled (Server-Sent Events).

---

## Screenshot

Capture a full-page or viewport screenshot.

```
GET /v1/screenshot
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | URL to screenshot |
| `fullPage` | boolean | `false` | Capture full scrollable page |
| `width` | number | `1280` | Viewport width in pixels |
| `height` | number | `800` | Viewport height in pixels |
| `format` | string | `png` | Image format: `png` or `jpeg` |
| `quality` | number | `90` | JPEG quality (1–100) |

**Example:**
```bash
curl "https://api.webpeel.dev/v1/screenshot?url=https://webpeel.dev&fullPage=true" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY" \
  | jq -r '.image' | base64 -d > screenshot.png
```

---

## YouTube Transcript

Get the full transcript of a YouTube video.

```
GET /v1/youtube
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | YouTube video URL |
| `timestamps` | boolean | `true` | Include timestamps |
| `lang` | string | `en` | Preferred transcript language |

**Example:**
```bash
curl "https://api.webpeel.dev/v1/youtube?url=https://youtube.com/watch?v=VIDEO_ID" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"
```

---

## Batch Fetch

Fetch multiple URLs in a single request.

```
POST /v1/batch
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `urls` | string[] | Array of URLs to fetch (max 50) |
| `format` | string | Output format (applies to all) |
| `concurrency` | number | Parallel fetch limit (default: 10) |

---

## More Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/map` | Discover all URLs on a site (sitemap) |
| `POST /v1/monitor` | Watch a URL for changes |
| `DELETE /v1/monitor/:id` | Stop monitoring a URL |
| `GET /v1/monitor` | List active monitors |
| `GET /v1/pdf` | Extract content from a PDF URL |

[Full interactive API docs →](https://webpeel.dev/docs/api)
