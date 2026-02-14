"""
WebPeel Python SDK

Fast web fetcher for AI agents — smart extraction, stealth mode, structured data.
"""

from .client import WebPeel
from .types import (
    ScrapeResult,
    SearchResult,
    CrawlResult,
    MapResult,
    BatchResult,
)
from .exceptions import (
    WebPeelError,
    AuthError,
    RateLimitError,
    TimeoutError,
)
from ._version import __version__

__all__ = [
    "WebPeel",
    "ScrapeResult",
    "SearchResult",
    "CrawlResult",
    "MapResult",
    "BatchResult",
    "WebPeelError",
    "AuthError",
    "RateLimitError",
    "TimeoutError",
    "__version__",
]
