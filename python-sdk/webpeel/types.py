"""Type definitions for WebPeel SDK."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ScrapeResult:
    """Result from scraping a URL."""
    
    url: str
    """Final URL after redirects."""
    
    title: str
    """Page title."""
    
    content: str
    """Extracted content in the requested format."""
    
    markdown: str
    """Markdown content (alias for content)."""
    
    metadata: Dict[str, Any]
    """Extracted metadata (description, author, published, etc.)."""
    
    links: List[str]
    """All links found on the page (absolute URLs)."""
    
    tokens: int
    """Estimated token count."""
    
    method: str
    """Method used: 'simple' | 'browser' | 'stealth'."""
    
    elapsed: int
    """Time elapsed in milliseconds."""
    
    screenshot: Optional[str] = None
    """Base64-encoded screenshot (PNG), if requested."""
    
    content_type: Optional[str] = None
    """Content type detected (html, json, xml, text, etc.)."""
    
    quality: Optional[float] = None
    """Content quality score 0-1."""
    
    fingerprint: Optional[str] = None
    """SHA256 hash of content (for change detection)."""
    
    extracted: Optional[Dict[str, Any]] = None
    """Extracted structured data."""
    
    branding: Optional[Dict[str, Any]] = None
    """Branding/design system data."""
    
    summary: Optional[str] = None
    """AI-generated summary."""


@dataclass
class SearchResult:
    """Result from web search."""
    
    success: bool
    """Whether the search was successful."""
    
    data: Dict[str, List[Dict[str, str]]]
    """Search results grouped by type (web, images, news)."""
    
    query: Optional[str] = None
    """Original search query."""
    
    count: Optional[int] = None
    """Number of results returned."""


@dataclass
class CrawlResult:
    """Result from starting a crawl job."""
    
    success: bool
    """Whether the crawl was initiated successfully."""
    
    id: str
    """Job ID for tracking the crawl."""
    
    url: str
    """Starting URL."""
    
    status: Optional[str] = None
    """Job status (pending, running, completed, failed)."""


@dataclass
class MapResult:
    """Result from mapping a domain."""
    
    success: bool
    """Whether the mapping was successful."""
    
    urls: List[str]
    """List of discovered URLs."""
    
    total: Optional[int] = None
    """Total number of URLs discovered."""
    
    elapsed: Optional[int] = None
    """Time elapsed in milliseconds."""
    
    sitemap_urls: Optional[List[str]] = None
    """Sitemaps used for discovery."""


@dataclass
class BatchResult:
    """Result from starting a batch scrape job."""
    
    success: bool
    """Whether the batch was initiated successfully."""
    
    id: str
    """Job ID for tracking the batch."""
    
    url: str
    """API endpoint for the batch job."""
    
    urls: Optional[List[str]] = None
    """List of URLs being scraped."""
    
    status: Optional[str] = None
    """Job status (pending, running, completed, failed)."""
