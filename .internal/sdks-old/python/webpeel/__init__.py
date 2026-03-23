"""
WebPeel Python SDK
==================

The official Python client for the WebPeel API — open-source web scraping
with support for headless browsers, AI extraction, crawling, and more.

Quick start::

    from webpeel import WebPeel

    wp = WebPeel(api_key="wp-...")          # or set WEBPEEL_API_KEY env var

    # Scrape a page
    result = wp.scrape("https://example.com")
    print(result.title, result.content[:200])

    # Search the web
    resp = wp.search("python web scraping", max_results=5)
    for r in resp.results:
        print(r.title, r.url)

    # Screenshot
    png_bytes = wp.screenshot("https://example.com")
    with open("screenshot.png", "wb") as f:
        f.write(png_bytes)

See https://webpeel.dev/docs for the full API reference.
"""

from .client import WebPeel
from .types import (
    BatchJob,
    BatchStatus,
    CrawlJob,
    CrawlStatus,
    ExtractResult,
    MapResult,
    ResearchResult,
    ScreenshotResult,
    ScrapeResult,
    SearchResponse,
    SearchResult,
    WebPeelError,
)

__version__ = "0.12.0"
__all__ = [
    "WebPeel",
    "WebPeelError",
    "ScrapeResult",
    "SearchResult",
    "SearchResponse",
    "BatchJob",
    "BatchStatus",
    "CrawlJob",
    "CrawlStatus",
    "MapResult",
    "ExtractResult",
    "ScreenshotResult",
    "ResearchResult",
]
