"""
WebPeel SDK — Type definitions.

All result types are dataclasses with type hints for easy IDE support.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class WebPeelError(Exception):
    """Raised when the WebPeel API returns a non-2xx response."""

    def __init__(self, message: str, status_code: int | None = None, error_code: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code

    def __repr__(self) -> str:  # pragma: no cover
        return f"WebPeelError(status_code={self.status_code!r}, error_code={self.error_code!r}, message={str(self)!r})"


# ---------------------------------------------------------------------------
# Scrape / fetch
# ---------------------------------------------------------------------------


@dataclass
class ScrapeResult:
    """Result of a scrape / fetch operation."""

    content: str
    """Scraped content in the requested format (markdown by default)."""

    title: str
    """Page title."""

    url: str
    """Final URL after redirects."""

    metadata: dict[str, Any] = field(default_factory=dict)
    """Page metadata (description, og:image, canonical, etc.)."""

    links: list[str] = field(default_factory=list)
    """All hyperlinks found on the page."""

    method: str = "basic"
    """Fetch method used: 'basic' | 'stealth' | 'browser'."""

    elapsed: int = 0
    """Processing time in milliseconds."""

    json: dict[str, Any] | None = None
    """Inline-extracted JSON data (if extract was requested)."""


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@dataclass
class SearchResult:
    """A single web search result."""

    title: str
    url: str
    snippet: str
    content: str | None = None
    """Full page content, populated when scrape_results=True."""


@dataclass
class SearchResponse:
    """Response from a search query."""

    results: list[SearchResult]
    query: str


# ---------------------------------------------------------------------------
# Batch
# ---------------------------------------------------------------------------


@dataclass
class BatchJob:
    """Handle returned when a batch scrape job is submitted."""

    id: str
    status_url: str


@dataclass
class BatchStatus:
    """Status of a running or completed batch job."""

    status: str
    """'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'"""

    total: int
    completed: int
    credits_used: int
    data: list[ScrapeResult] | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Crawl
# ---------------------------------------------------------------------------


@dataclass
class CrawlJob:
    """Handle returned when a crawl job is submitted."""

    id: str
    status_url: str


@dataclass
class CrawlStatus:
    """Status of a running or completed crawl job."""

    status: str
    """'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'"""

    total: int
    completed: int
    credits_used: int
    data: list[ScrapeResult] | None = None
    error: str | None = None
    expires_at: str | None = None


# ---------------------------------------------------------------------------
# Map
# ---------------------------------------------------------------------------


@dataclass
class MapResult:
    """Result of a domain map operation."""

    urls: list[str]
    """All discovered URLs."""


# ---------------------------------------------------------------------------
# Extract
# ---------------------------------------------------------------------------


@dataclass
class ExtractResult:
    """Structured data extracted from one or more URLs."""

    data: Any
    """The extracted structured data (matches the provided schema)."""

    metadata: dict[str, Any] = field(default_factory=dict)
    """Metadata: url, title, model, tokens_used, cost, elapsed."""


# ---------------------------------------------------------------------------
# Screenshot
# ---------------------------------------------------------------------------


@dataclass
class ScreenshotResult:
    """Result of a screenshot operation."""

    image: bytes
    """Raw PNG/JPEG bytes."""

    content_type: str
    """MIME type, e.g. 'image/png'."""

    url: str
    """Final URL of the page."""

    format: str = "png"


# ---------------------------------------------------------------------------
# Research
# ---------------------------------------------------------------------------


@dataclass
class ResearchResult:
    """Result of an AI-powered research operation."""

    report: str
    """Synthesised research report in markdown."""

    sources: list[SearchResult]
    """Source pages used to build the report."""
