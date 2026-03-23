# WebPeel Python SDK

Official Python client for the [WebPeel](https://webpeel.dev) API — open-source web scraping with headless browsers, AI extraction, crawling, and more.

[![PyPI version](https://img.shields.io/pypi/v/webpeel)](https://pypi.org/project/webpeel/)
[![Python versions](https://img.shields.io/pypi/pyversions/webpeel)](https://pypi.org/project/webpeel/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
pip install webpeel
```

## Quick Start

```python
from webpeel import WebPeel

# Initialise — reads WEBPEEL_API_KEY and WEBPEEL_BASE_URL env vars by default
wp = WebPeel(api_key="wp-xxx")

# Scrape a URL → ScrapeResult
result = wp.scrape("https://example.com")
print(result.title)       # "Example Domain"
print(result.content)     # Markdown content
print(result.links)       # ["https://..."]
```

## Authentication

```python
import os

# Option 1: explicit
wp = WebPeel(api_key="wp-xxx")

# Option 2: environment variables (recommended)
# export WEBPEEL_API_KEY=wp-xxx
# export WEBPEEL_BASE_URL=https://api.webpeel.dev   # optional, this is the default
wp = WebPeel()
```

## Self-Hosted

Point the client at your own WebPeel server:

```python
wp = WebPeel(api_key="wp-local", base_url="http://localhost:3000")
```

---

## API Reference

### `scrape(url, **options)` → `ScrapeResult`

Scrape a single URL and return its content.

```python
result = wp.scrape("https://example.com")
# Basic options
result = wp.scrape(
    "https://example.com",
    format="html",          # "markdown" (default) | "text" | "html"
    render=True,            # Use headless browser for JS-heavy sites
    wait=2000,              # Wait 2 s after page load (requires render=True)
    actions=[               # Browser actions to perform before capture
        {"type": "click", "selector": ".cookie-banner .close"},
        {"type": "wait", "ms": 500},
    ],
    include_tags=["article"],   # Only include these CSS selectors
    exclude_tags=[".ads"],       # Strip these selectors
    images=True,                 # Include image URLs
)

print(result.content)     # str — scraped content
print(result.title)       # str — page title
print(result.url)         # str — final URL (after redirects)
print(result.metadata)    # dict — og tags, description, etc.
print(result.links)       # list[str] — hyperlinks
print(result.elapsed)     # int — ms taken
```

---

### `search(query, **options)` → `SearchResponse`

Search the web (powered by DuckDuckGo by default).

```python
resp = wp.search("python web scraping", max_results=5)

for r in resp.results:
    print(r.title, r.url, r.snippet)

# Also scrape each result page
resp = wp.search("best open-source tools", max_results=3, scrape_results=True)
for r in resp.results:
    print(r.content)   # Full markdown of each result page
```

---

### `batch(urls, **options)` → `BatchJob`

Submit multiple URLs for async scraping.

```python
# Submit the job
job = wp.batch(["https://a.com", "https://b.com", "https://c.com"])
print(job.id)  # "batch-abc123"

# Poll until done
import time
while True:
    status = wp.batch_status(job.id)
    print(f"{status.completed}/{status.total} pages done")
    if status.status in ("completed", "failed"):
        break
    time.sleep(2)

# Access results
for page in (status.data or []):
    print(page.title, page.url)
```

---

### `crawl(url, **options)` → `CrawlJob`

Crawl an entire domain (async job).

```python
# Start the crawl
job = wp.crawl("https://docs.example.com", max_pages=50, max_depth=3)

# Check status
status = wp.crawl_status(job.id)
print(status.status)      # "processing" | "completed" | "failed"
print(status.completed)   # pages scraped so far
print(status.total)       # total pages discovered

# Results when done
for page in (status.data or []):
    print(page.url, page.title)
```

---

### `map(url, **options)` → `MapResult`

Discover all URLs on a domain without scraping content.

```python
result = wp.map("https://example.com")
print(result.urls)   # ["https://example.com/", "https://example.com/about", ...]

# Filter URLs by keyword
result = wp.map("https://example.com", search="pricing", limit=100)
```

---

### `extract(urls, prompt, schema, **options)` → `ExtractResult`

Extract structured data from a URL using an LLM.

```python
result = wp.extract(
    ["https://shop.example.com/product"],
    prompt="Extract the product name, price, and availability",
    schema={
        "type": "object",
        "properties": {
            "name":         {"type": "string"},
            "price":        {"type": "string"},
            "availability": {"type": "string"},
        },
    },
    llm_api_key="sk-...",   # BYOK — falls back to server OPENAI_API_KEY
    model="gpt-4o-mini",
)

print(result.data)        # {"name": "Widget Pro", "price": "$49", ...}
print(result.metadata)    # {"tokensUsed": {...}, "cost": 0.0002, ...}
```

---

### `screenshot(url, **options)` → `bytes`

Take a screenshot and get back raw image bytes.

```python
# Returns raw PNG bytes
png = wp.screenshot("https://example.com")
with open("screenshot.png", "wb") as f:
    f.write(png)

# Full-page JPEG
jpg = wp.screenshot(
    "https://example.com",
    full_page=True,
    width=1440,
    height=900,
    format="jpeg",
    quality=85,
    wait_for=1000,   # ms to wait after load
)
```

---

### `research(query, **options)` → `ResearchResult`

Research a topic by combining search + scraping.

```python
result = wp.research("best Python web scraping tools 2025", max_sources=5)

print(result.report)   # Markdown report with sourced content

for src in result.sources:
    print(src.title, src.url)
    print(src.content[:500])  # Full scraped content
```

---

## Async Support

Every method has an `async_*` counterpart for use with `asyncio`:

```python
import asyncio
from webpeel import WebPeel

wp = WebPeel(api_key="wp-xxx")

async def main():
    # All async equivalents
    result   = await wp.async_scrape("https://example.com")
    resp     = await wp.async_search("python scraping")
    job      = await wp.async_crawl("https://example.com", max_pages=10)
    status   = await wp.async_crawl_status(job.id)
    batch    = await wp.async_batch(["https://a.com", "https://b.com"])
    map_res  = await wp.async_map("https://example.com")
    extract  = await wp.async_extract(["https://example.com"], prompt="Get title")
    png      = await wp.async_screenshot("https://example.com")
    research = await wp.async_research("web scraping 2025")

asyncio.run(main())
```

---

## Error Handling

All API errors raise `WebPeelError`:

```python
from webpeel import WebPeel, WebPeelError

wp = WebPeel(api_key="wp-xxx")

try:
    result = wp.scrape("https://blocked-site.com")
except WebPeelError as e:
    print(e.status_code)   # 403
    print(e.error_code)    # "BLOCKED"
    print(str(e))          # Human-readable message
```

---

## Running Tests

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest
```

---

## License

MIT — see [LICENSE](../../LICENSE) for details.
