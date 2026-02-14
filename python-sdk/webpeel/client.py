"""WebPeel Python SDK client."""

import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Any, Dict, List, Optional

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


class WebPeel:
    """WebPeel Python SDK — Fast web fetcher for AI agents."""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.webpeel.dev",
        timeout: int = 30,
    ):
        """
        Initialize WebPeel client.
        
        Args:
            api_key: API key for authentication (optional for free tier)
            base_url: Base URL for the WebPeel API
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
    
    def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Make an HTTP request to the WebPeel API.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint path
            data: Request body data (for POST/PUT)
            params: URL query parameters
        
        Returns:
            Parsed JSON response
        
        Raises:
            AuthError: Authentication failed
            RateLimitError: Rate limit exceeded
            TimeoutError: Request timeout
            WebPeelError: Other API errors
        """
        # Build URL
        url = f"{self.base_url}{endpoint}"
        if params:
            query_string = urllib.parse.urlencode(params)
            url = f"{url}?{query_string}"
        
        # Prepare headers
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "webpeel-python/0.1.0",
        }
        
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        # Prepare request
        req_data = None
        if data is not None:
            req_data = json.dumps(data).encode('utf-8')
        
        request = urllib.request.Request(
            url,
            data=req_data,
            headers=headers,
            method=method,
        )
        
        # Make request
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                response_data = response.read().decode('utf-8')
                return json.loads(response_data)
        
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if e.fp else ''
            
            # Parse error response
            try:
                error_data = json.loads(error_body)
                error_message = error_data.get('error', {}).get('message', str(e))
            except (json.JSONDecodeError, AttributeError):
                error_message = error_body or str(e)
            
            # Map HTTP status codes to specific exceptions
            if e.code == 401:
                raise AuthError(f"Authentication failed: {error_message}")
            elif e.code == 429:
                raise RateLimitError(f"Rate limit exceeded: {error_message}")
            elif e.code == 408 or e.code == 504:
                raise TimeoutError(f"Request timeout: {error_message}")
            else:
                raise WebPeelError(f"API error ({e.code}): {error_message}")
        
        except urllib.error.URLError as e:
            if "timeout" in str(e).lower():
                raise TimeoutError(f"Request timeout: {e}")
            else:
                raise WebPeelError(f"Network error: {e}")
        
        except Exception as e:
            raise WebPeelError(f"Unexpected error: {e}")
    
    def scrape(
        self,
        url: str,
        formats: Optional[List[str]] = None,
        max_tokens: Optional[int] = None,
        render: bool = False,
        stealth: bool = False,
        actions: Optional[List[Dict[str, Any]]] = None,
        extract: Optional[Dict[str, Any]] = None,
        raw: bool = False,
        wait: int = 0,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None,
    ) -> ScrapeResult:
        """
        Scrape a URL and extract content.
        
        Args:
            url: URL to scrape
            formats: Output formats (default: ["markdown"])
            max_tokens: Maximum token count for output
            render: Use headless browser for JavaScript-heavy sites
            stealth: Use stealth mode to bypass bot detection
            actions: Page actions to execute before scraping
            extract: Structured data extraction options
            raw: Return full page without smart content extraction
            wait: Wait time in milliseconds after page load
            headers: Custom HTTP headers
            timeout: Request timeout override in seconds
        
        Returns:
            ScrapeResult with extracted content and metadata
        
        Example:
            >>> client = WebPeel()
            >>> result = client.scrape("https://example.com")
            >>> print(result.title)
            >>> print(result.content)
        """
        if formats is None:
            formats = ["markdown"]
        
        # Build request payload
        payload: Dict[str, Any] = {
            "url": url,
            "format": formats[0] if formats else "markdown",
        }
        
        if max_tokens is not None:
            payload["maxTokens"] = max_tokens
        if render:
            payload["render"] = render
        if stealth:
            payload["stealth"] = stealth
        if actions:
            payload["actions"] = actions
        if extract:
            payload["extract"] = extract
        if raw:
            payload["raw"] = raw
        if wait > 0:
            payload["wait"] = wait
        if headers:
            payload["headers"] = headers
        
        # Override timeout if specified
        original_timeout = self.timeout
        if timeout is not None:
            self.timeout = timeout
        
        try:
            response = self._make_request("POST", "/v1/fetch", data=payload)
        finally:
            # Restore original timeout
            if timeout is not None:
                self.timeout = original_timeout
        
        # Parse response into ScrapeResult
        return ScrapeResult(
            url=response.get("url", url),
            title=response.get("title", ""),
            content=response.get("content", ""),
            markdown=response.get("content", ""),  # Alias
            metadata=response.get("metadata", {}),
            links=response.get("links", []),
            tokens=response.get("tokens", 0),
            method=response.get("method", "simple"),
            elapsed=response.get("elapsed", 0),
            screenshot=response.get("screenshot"),
            content_type=response.get("contentType"),
            quality=response.get("quality"),
            fingerprint=response.get("fingerprint"),
            extracted=response.get("extracted"),
            branding=response.get("branding"),
            summary=response.get("summary"),
        )
    
    def search(
        self,
        query: str,
        limit: int = 5,
        scrape_results: bool = False,
    ) -> SearchResult:
        """
        Search the web via DuckDuckGo.
        
        Args:
            query: Search query
            limit: Number of results to return (1-10)
            scrape_results: Whether to scrape the result pages
        
        Returns:
            SearchResult with search results
        
        Example:
            >>> client = WebPeel()
            >>> results = client.search("python web scraping")
            >>> for item in results.data.get("web", []):
            ...     print(item["title"], item["url"])
        """
        params = {
            "q": query,
            "limit": limit,
        }
        
        if scrape_results:
            params["scrape"] = "true"
        
        response = self._make_request("GET", "/v1/search", params=params)
        
        return SearchResult(
            success=response.get("success", True),
            data=response.get("data", {}),
            query=query,
            count=limit,
        )
    
    def crawl(
        self,
        url: str,
        limit: int = 50,
        max_depth: int = 3,
        webhook: Optional[Dict[str, Any]] = None,
    ) -> CrawlResult:
        """
        Start a crawl job (async, returns job ID).
        
        Args:
            url: Starting URL to crawl from
            limit: Maximum number of pages to crawl
            max_depth: Maximum depth to crawl
            webhook: Webhook configuration for job completion
        
        Returns:
            CrawlResult with job ID
        
        Example:
            >>> client = WebPeel(api_key="your-api-key")
            >>> job = client.crawl("https://example.com", limit=100)
            >>> print(job.id)
            >>> # Check status later with get_job(job.id)
        """
        payload = {
            "url": url,
            "limit": limit,
            "maxDepth": max_depth,
        }
        
        if webhook:
            payload["webhook"] = webhook
        
        response = self._make_request("POST", "/v1/crawl", data=payload)
        
        return CrawlResult(
            success=response.get("success", True),
            id=response.get("id", ""),
            url=url,
            status=response.get("status"),
        )
    
    def map(
        self,
        url: str,
        search: Optional[str] = None,
    ) -> MapResult:
        """
        Discover all URLs on a domain.
        
        Args:
            url: Starting URL or domain
            search: Optional search pattern to filter URLs
        
        Returns:
            MapResult with discovered URLs
        
        Example:
            >>> client = WebPeel()
            >>> result = client.map("https://example.com")
            >>> print(f"Found {result.total} URLs")
            >>> for url in result.urls[:10]:
            ...     print(url)
        """
        params = {"url": url}
        
        if search:
            params["search"] = search
        
        response = self._make_request("GET", "/v1/map", params=params)
        
        return MapResult(
            success=response.get("success", True),
            urls=response.get("urls", []),
            total=response.get("total"),
            elapsed=response.get("elapsed"),
            sitemap_urls=response.get("sitemapUrls"),
        )
    
    def batch_scrape(
        self,
        urls: List[str],
        formats: Optional[List[str]] = None,
        max_tokens: Optional[int] = None,
    ) -> BatchResult:
        """
        Batch scrape multiple URLs.
        
        Args:
            urls: List of URLs to scrape
            formats: Output formats (default: ["markdown"])
            max_tokens: Maximum token count per result
        
        Returns:
            BatchResult with job ID
        
        Example:
            >>> client = WebPeel(api_key="your-api-key")
            >>> urls = ["https://example.com/1", "https://example.com/2"]
            >>> job = client.batch_scrape(urls)
            >>> print(job.id)
        """
        if formats is None:
            formats = ["markdown"]
        
        payload = {
            "urls": urls,
            "format": formats[0] if formats else "markdown",
        }
        
        if max_tokens is not None:
            payload["maxTokens"] = max_tokens
        
        response = self._make_request("POST", "/v1/batch/scrape", data=payload)
        
        return BatchResult(
            success=response.get("success", True),
            id=response.get("id", ""),
            url=response.get("url", ""),
            urls=urls,
            status=response.get("status"),
        )
    
    def get_job(self, job_id: str) -> Dict[str, Any]:
        """
        Check status of an async job.
        
        Args:
            job_id: Job ID from crawl() or batch_scrape()
        
        Returns:
            Job status and results
        
        Example:
            >>> client = WebPeel(api_key="your-api-key")
            >>> status = client.get_job("job-123")
            >>> print(status["status"])  # pending, running, completed, failed
        """
        response = self._make_request("GET", f"/v1/jobs/{job_id}")
        return response
