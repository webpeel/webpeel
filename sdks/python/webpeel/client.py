"""
WebPeel SDK — HTTP client (sync + async).

Usage::

    from webpeel import WebPeel

    wp = WebPeel(api_key="wp-xxx")

    # Sync
    result = wp.scrape("https://example.com")
    print(result.title, result.content)

    # Async
    import asyncio
    async def main():
        result = await wp.async_scrape("https://example.com")
    asyncio.run(main())
"""

from __future__ import annotations

import base64
import os
from typing import Any

import httpx

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

__all__ = ["WebPeel"]

_DEFAULT_BASE_URL = "https://api.webpeel.dev"
_DEFAULT_TIMEOUT = 60.0  # seconds


def _make_scrape_result(data: dict[str, Any]) -> ScrapeResult:
    """Parse a raw API response dict into a ScrapeResult."""
    # The /v1/fetch POST endpoint returns the PeelResult directly (not nested).
    return ScrapeResult(
        content=data.get("content", ""),
        title=data.get("title", ""),
        url=data.get("url", ""),
        metadata=data.get("metadata", {}),
        links=data.get("links", []),
        method=data.get("method", "basic"),
        elapsed=data.get("elapsed", 0),
        json=data.get("json"),
    )


def _parse_error(response: httpx.Response) -> WebPeelError:
    """Build a WebPeelError from a non-2xx httpx response."""
    try:
        body = response.json()
        message = body.get("message") or body.get("error") or response.text
        error_code = body.get("error") or body.get("error_code")
    except Exception:
        message = response.text or f"HTTP {response.status_code}"
        error_code = None
    return WebPeelError(message, status_code=response.status_code, error_code=error_code)


class WebPeel:
    """
    WebPeel API client.

    Parameters
    ----------
    api_key:
        Your WebPeel API key (``wp-...``).  Falls back to the
        ``WEBPEEL_API_KEY`` environment variable.
    base_url:
        Base URL of the WebPeel API.  Falls back to the
        ``WEBPEEL_BASE_URL`` env-var, then ``https://api.webpeel.dev``.
    timeout:
        Request timeout in seconds (default 60).
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._api_key = api_key or os.environ.get("WEBPEEL_API_KEY", "")
        self._base_url = (
            base_url
            or os.environ.get("WEBPEEL_BASE_URL", _DEFAULT_BASE_URL)
        ).rstrip("/")
        self._timeout = timeout

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _sync_client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._base_url,
            headers=self._headers(),
            timeout=self._timeout,
            follow_redirects=True,
        )

    def _async_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            timeout=self._timeout,
            follow_redirects=True,
        )

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code >= 400:
            raise _parse_error(response)

    # ------------------------------------------------------------------
    # scrape
    # ------------------------------------------------------------------

    def scrape(
        self,
        url: str,
        *,
        format: str = "markdown",
        render: bool = False,
        wait: int | None = None,
        actions: list[dict[str, Any]] | None = None,
        include_tags: list[str] | None = None,
        exclude_tags: list[str] | None = None,
        images: bool = False,
        budget: int | None = None,
        **kwargs: Any,
    ) -> ScrapeResult:
        """
        Scrape a URL and return structured content.

        Parameters
        ----------
        url:
            The URL to scrape.
        format:
            Output format: ``"markdown"`` (default), ``"text"``, or ``"html"``.
        render:
            Use a headless browser for JavaScript-heavy sites.
        wait:
            Milliseconds to wait after page load (requires render=True).
        actions:
            List of browser actions, e.g.
            ``[{"type": "click", "selector": ".btn"}]``.
        include_tags:
            Only include content from these CSS selectors / HTML tags.
        exclude_tags:
            Strip content from these CSS selectors / HTML tags.
        images:
            Include image URLs in the result.
        budget:
            Alias for ``wait`` (milliseconds).  Provided for API parity.

        Returns
        -------
        ScrapeResult
        """
        payload: dict[str, Any] = {"url": url, "format": format, "render": render}
        if wait is not None:
            payload["wait"] = wait
        elif budget is not None:
            payload["wait"] = budget
        if actions:
            payload["actions"] = actions
        if include_tags:
            payload["includeTags"] = include_tags
        if exclude_tags:
            payload["excludeTags"] = exclude_tags
        if images:
            payload["images"] = True
        payload.update(kwargs)

        with self._sync_client() as client:
            resp = client.post("/v1/fetch", json=payload)
            self._raise_for_status(resp)
            return _make_scrape_result(resp.json())

    async def async_scrape(
        self,
        url: str,
        *,
        format: str = "markdown",
        render: bool = False,
        wait: int | None = None,
        actions: list[dict[str, Any]] | None = None,
        include_tags: list[str] | None = None,
        exclude_tags: list[str] | None = None,
        images: bool = False,
        budget: int | None = None,
        **kwargs: Any,
    ) -> ScrapeResult:
        """Async version of :meth:`scrape`."""
        payload: dict[str, Any] = {"url": url, "format": format, "render": render}
        if wait is not None:
            payload["wait"] = wait
        elif budget is not None:
            payload["wait"] = budget
        if actions:
            payload["actions"] = actions
        if include_tags:
            payload["includeTags"] = include_tags
        if exclude_tags:
            payload["excludeTags"] = exclude_tags
        if images:
            payload["images"] = True
        payload.update(kwargs)

        async with self._async_client() as client:
            resp = await client.post("/v1/fetch", json=payload)
            self._raise_for_status(resp)
            return _make_scrape_result(resp.json())

    # ------------------------------------------------------------------
    # search
    # ------------------------------------------------------------------

    def search(
        self,
        query: str,
        *,
        max_results: int = 5,
        scrape_results: bool = False,
        **kwargs: Any,
    ) -> SearchResponse:
        """
        Search the web and return results.

        Parameters
        ----------
        query:
            Search query string.
        max_results:
            Number of results to return (1–10, default 5).
        scrape_results:
            If True, also scrape the content of each result URL.

        Returns
        -------
        SearchResponse
        """
        params: dict[str, Any] = {
            "q": query,
            "count": max_results,
        }
        if scrape_results:
            params["scrapeResults"] = "true"
        params.update(kwargs)

        with self._sync_client() as client:
            resp = client.get("/v1/search", params=params)
            self._raise_for_status(resp)
            body = resp.json()

        web_list = body.get("data", {}).get("web", [])
        results = [
            SearchResult(
                title=r.get("title", ""),
                url=r.get("url", ""),
                snippet=r.get("snippet", ""),
                content=r.get("content"),
            )
            for r in web_list
        ]
        return SearchResponse(results=results, query=query)

    async def async_search(
        self,
        query: str,
        *,
        max_results: int = 5,
        scrape_results: bool = False,
        **kwargs: Any,
    ) -> SearchResponse:
        """Async version of :meth:`search`."""
        params: dict[str, Any] = {
            "q": query,
            "count": max_results,
        }
        if scrape_results:
            params["scrapeResults"] = "true"
        params.update(kwargs)

        async with self._async_client() as client:
            resp = await client.get("/v1/search", params=params)
            self._raise_for_status(resp)
            body = resp.json()

        web_list = body.get("data", {}).get("web", [])
        results = [
            SearchResult(
                title=r.get("title", ""),
                url=r.get("url", ""),
                snippet=r.get("snippet", ""),
                content=r.get("content"),
            )
            for r in web_list
        ]
        return SearchResponse(results=results, query=query)

    # ------------------------------------------------------------------
    # batch
    # ------------------------------------------------------------------

    def batch(
        self,
        urls: list[str],
        *,
        formats: list[str] | None = None,
        webhook: str | None = None,
        **kwargs: Any,
    ) -> BatchJob:
        """
        Submit a batch of URLs for async scraping.

        Returns a :class:`BatchJob` handle.  Poll with
        :meth:`batch_status` until ``status == "completed"``.

        Parameters
        ----------
        urls:
            List of URLs to scrape (max 100).
        formats:
            Output formats (default ``["markdown"]``).
        webhook:
            URL to receive progress webhooks.

        Returns
        -------
        BatchJob
        """
        payload: dict[str, Any] = {"urls": urls, "formats": formats or ["markdown"]}
        if webhook:
            payload["webhook"] = webhook
        payload.update(kwargs)

        with self._sync_client() as client:
            resp = client.post("/v1/batch/scrape", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return BatchJob(id=body["id"], status_url=body.get("url", f"/v1/batch/scrape/{body['id']}"))

    async def async_batch(
        self,
        urls: list[str],
        *,
        formats: list[str] | None = None,
        webhook: str | None = None,
        **kwargs: Any,
    ) -> BatchJob:
        """Async version of :meth:`batch`."""
        payload: dict[str, Any] = {"urls": urls, "formats": formats or ["markdown"]}
        if webhook:
            payload["webhook"] = webhook
        payload.update(kwargs)

        async with self._async_client() as client:
            resp = await client.post("/v1/batch/scrape", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return BatchJob(id=body["id"], status_url=body.get("url", f"/v1/batch/scrape/{body['id']}"))

    def batch_status(self, job_id: str) -> BatchStatus:
        """Retrieve the status / results of a batch job."""
        with self._sync_client() as client:
            resp = client.get(f"/v1/batch/scrape/{job_id}")
            self._raise_for_status(resp)
            body = resp.json()

        raw_data = body.get("data") or []
        data = [_make_scrape_result(r) for r in raw_data if isinstance(r, dict) and "content" in r]
        return BatchStatus(
            status=body.get("status", "unknown"),
            total=body.get("total", 0),
            completed=body.get("completed", 0),
            credits_used=body.get("creditsUsed", 0),
            data=data or None,
            error=body.get("error"),
        )

    async def async_batch_status(self, job_id: str) -> BatchStatus:
        """Async version of :meth:`batch_status`."""
        async with self._async_client() as client:
            resp = await client.get(f"/v1/batch/scrape/{job_id}")
            self._raise_for_status(resp)
            body = resp.json()

        raw_data = body.get("data") or []
        data = [_make_scrape_result(r) for r in raw_data if isinstance(r, dict) and "content" in r]
        return BatchStatus(
            status=body.get("status", "unknown"),
            total=body.get("total", 0),
            completed=body.get("completed", 0),
            credits_used=body.get("creditsUsed", 0),
            data=data or None,
            error=body.get("error"),
        )

    # ------------------------------------------------------------------
    # crawl
    # ------------------------------------------------------------------

    def crawl(
        self,
        url: str,
        *,
        max_pages: int = 100,
        max_depth: int = 3,
        webhook: str | None = None,
        scrape_options: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> CrawlJob:
        """
        Start an async crawl of a domain.

        Returns a :class:`CrawlJob` handle.  Poll with
        :meth:`crawl_status` to track progress.

        Parameters
        ----------
        url:
            Seed URL to crawl.
        max_pages:
            Maximum number of pages to scrape (default 100).
        max_depth:
            Maximum link depth to follow (default 3).
        webhook:
            URL to receive crawl progress events.
        scrape_options:
            Extra options forwarded to the scrape step.

        Returns
        -------
        CrawlJob
        """
        payload: dict[str, Any] = {
            "url": url,
            "limit": max_pages,
            "maxDepth": max_depth,
        }
        if webhook:
            payload["webhook"] = webhook
        if scrape_options:
            payload["scrapeOptions"] = scrape_options
        payload.update(kwargs)

        with self._sync_client() as client:
            resp = client.post("/v1/crawl", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return CrawlJob(id=body["id"], status_url=body.get("url", f"/v1/crawl/{body['id']}"))

    async def async_crawl(
        self,
        url: str,
        *,
        max_pages: int = 100,
        max_depth: int = 3,
        webhook: str | None = None,
        scrape_options: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> CrawlJob:
        """Async version of :meth:`crawl`."""
        payload: dict[str, Any] = {
            "url": url,
            "limit": max_pages,
            "maxDepth": max_depth,
        }
        if webhook:
            payload["webhook"] = webhook
        if scrape_options:
            payload["scrapeOptions"] = scrape_options
        payload.update(kwargs)

        async with self._async_client() as client:
            resp = await client.post("/v1/crawl", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return CrawlJob(id=body["id"], status_url=body.get("url", f"/v1/crawl/{body['id']}"))

    def crawl_status(self, job_id: str) -> CrawlStatus:
        """
        Retrieve the status and results of a crawl job.

        Parameters
        ----------
        job_id:
            The ``id`` from the :class:`CrawlJob` returned by :meth:`crawl`.

        Returns
        -------
        CrawlStatus
        """
        with self._sync_client() as client:
            resp = client.get(f"/v1/crawl/{job_id}")
            self._raise_for_status(resp)
            body = resp.json()

        raw_data = body.get("data") or []
        data = [_make_scrape_result(r) for r in raw_data if isinstance(r, dict) and "content" in r]
        return CrawlStatus(
            status=body.get("status", "unknown"),
            total=body.get("total", 0),
            completed=body.get("completed", 0),
            credits_used=body.get("creditsUsed", 0),
            data=data or None,
            error=body.get("error"),
            expires_at=body.get("expiresAt"),
        )

    async def async_crawl_status(self, job_id: str) -> CrawlStatus:
        """Async version of :meth:`crawl_status`."""
        async with self._async_client() as client:
            resp = await client.get(f"/v1/crawl/{job_id}")
            self._raise_for_status(resp)
            body = resp.json()

        raw_data = body.get("data") or []
        data = [_make_scrape_result(r) for r in raw_data if isinstance(r, dict) and "content" in r]
        return CrawlStatus(
            status=body.get("status", "unknown"),
            total=body.get("total", 0),
            completed=body.get("completed", 0),
            credits_used=body.get("creditsUsed", 0),
            data=data or None,
            error=body.get("error"),
            expires_at=body.get("expiresAt"),
        )

    # ------------------------------------------------------------------
    # map
    # ------------------------------------------------------------------

    def map(
        self,
        url: str,
        *,
        limit: int = 5000,
        search: str | None = None,
        **kwargs: Any,
    ) -> MapResult:
        """
        Discover all URLs on a domain.

        Parameters
        ----------
        url:
            Root URL to map.
        limit:
            Maximum number of URLs to return (default 5000).
        search:
            Optional keyword filter — only return URLs containing this term.

        Returns
        -------
        MapResult
        """
        payload: dict[str, Any] = {"url": url, "limit": limit}
        if search:
            payload["search"] = search
        payload.update(kwargs)

        with self._sync_client() as client:
            resp = client.post("/v1/map", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return MapResult(urls=body.get("links", []))

    async def async_map(
        self,
        url: str,
        *,
        limit: int = 5000,
        search: str | None = None,
        **kwargs: Any,
    ) -> MapResult:
        """Async version of :meth:`map`."""
        payload: dict[str, Any] = {"url": url, "limit": limit}
        if search:
            payload["search"] = search
        payload.update(kwargs)

        async with self._async_client() as client:
            resp = await client.post("/v1/map", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return MapResult(urls=body.get("links", []))

    # ------------------------------------------------------------------
    # extract
    # ------------------------------------------------------------------

    def extract(
        self,
        urls: list[str],
        *,
        prompt: str | None = None,
        schema: dict[str, Any] | None = None,
        llm_api_key: str | None = None,
        model: str | None = None,
        **kwargs: Any,
    ) -> ExtractResult:
        """
        Extract structured data from one or more URLs using an LLM.

        Parameters
        ----------
        urls:
            One or more URLs to extract from.  (Currently the server
            processes the first URL; multi-URL support is on the roadmap.)
        prompt:
            Natural-language instruction, e.g. "Extract product prices".
        schema:
            JSON Schema describing the expected output structure.
        llm_api_key:
            BYOK LLM API key (OpenAI-compatible).  Falls back to the
            server-side ``OPENAI_API_KEY`` env var if not provided.
        model:
            LLM model to use (default ``gpt-4o-mini``).

        Returns
        -------
        ExtractResult
        """
        if not prompt and not schema:
            raise ValueError("At least one of 'prompt' or 'schema' must be provided.")

        payload: dict[str, Any] = {"url": urls[0] if isinstance(urls, list) else urls}
        if prompt:
            payload["prompt"] = prompt
        if schema:
            payload["schema"] = schema
        if llm_api_key:
            payload["llmApiKey"] = llm_api_key
        if model:
            payload["model"] = model
        payload.update(kwargs)

        with self._sync_client() as client:
            resp = client.post("/v1/extract", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return ExtractResult(
            data=body.get("data"),
            metadata=body.get("metadata", {}),
        )

    async def async_extract(
        self,
        urls: list[str],
        *,
        prompt: str | None = None,
        schema: dict[str, Any] | None = None,
        llm_api_key: str | None = None,
        model: str | None = None,
        **kwargs: Any,
    ) -> ExtractResult:
        """Async version of :meth:`extract`."""
        if not prompt and not schema:
            raise ValueError("At least one of 'prompt' or 'schema' must be provided.")

        payload: dict[str, Any] = {"url": urls[0] if isinstance(urls, list) else urls}
        if prompt:
            payload["prompt"] = prompt
        if schema:
            payload["schema"] = schema
        if llm_api_key:
            payload["llmApiKey"] = llm_api_key
        if model:
            payload["model"] = model
        payload.update(kwargs)

        async with self._async_client() as client:
            resp = await client.post("/v1/extract", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        return ExtractResult(
            data=body.get("data"),
            metadata=body.get("metadata", {}),
        )

    # ------------------------------------------------------------------
    # screenshot
    # ------------------------------------------------------------------

    def screenshot(
        self,
        url: str,
        *,
        full_page: bool = False,
        width: int | None = None,
        height: int | None = None,
        format: str = "png",
        quality: int | None = None,
        wait_for: int | None = None,
        **kwargs: Any,
    ) -> bytes:
        """
        Take a screenshot of a URL and return the raw image bytes.

        Parameters
        ----------
        url:
            URL to screenshot.
        full_page:
            Capture the entire page, not just the viewport.
        width:
            Viewport width in pixels (100–5000).
        height:
            Viewport height in pixels (100–5000).
        format:
            Image format: ``"png"`` (default) or ``"jpeg"``.
        quality:
            JPEG quality (1–100).  Ignored for PNG.
        wait_for:
            Milliseconds to wait after page load.

        Returns
        -------
        bytes
            Raw image bytes (PNG or JPEG).
        """
        payload: dict[str, Any] = {"url": url, "fullPage": full_page, "format": format}
        if width is not None:
            payload["width"] = width
        if height is not None:
            payload["height"] = height
        if quality is not None:
            payload["quality"] = quality
        if wait_for is not None:
            payload["waitFor"] = wait_for
        payload.update(kwargs)

        with self._sync_client() as client:
            resp = client.post("/v1/screenshot", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        # Server returns base64 data URI: "data:image/png;base64,<data>"
        screenshot_data: str = body["data"]["screenshot"]
        if "," in screenshot_data:
            screenshot_data = screenshot_data.split(",", 1)[1]
        return base64.b64decode(screenshot_data)

    async def async_screenshot(
        self,
        url: str,
        *,
        full_page: bool = False,
        width: int | None = None,
        height: int | None = None,
        format: str = "png",
        quality: int | None = None,
        wait_for: int | None = None,
        **kwargs: Any,
    ) -> bytes:
        """Async version of :meth:`screenshot`."""
        payload: dict[str, Any] = {"url": url, "fullPage": full_page, "format": format}
        if width is not None:
            payload["width"] = width
        if height is not None:
            payload["height"] = height
        if quality is not None:
            payload["quality"] = quality
        if wait_for is not None:
            payload["waitFor"] = wait_for
        payload.update(kwargs)

        async with self._async_client() as client:
            resp = await client.post("/v1/screenshot", json=payload)
            self._raise_for_status(resp)
            body = resp.json()

        screenshot_data: str = body["data"]["screenshot"]
        if "," in screenshot_data:
            screenshot_data = screenshot_data.split(",", 1)[1]
        return base64.b64decode(screenshot_data)

    # ------------------------------------------------------------------
    # research  (client-side synthesis — no dedicated REST endpoint yet)
    # ------------------------------------------------------------------

    def research(
        self,
        query: str,
        *,
        max_sources: int = 5,
        scrape_content: bool = True,
        **kwargs: Any,
    ) -> ResearchResult:
        """
        Perform AI-assisted research by combining search + scrape.

        This method calls :meth:`search` to find relevant pages, then
        :meth:`scrape` to gather their full content.  The results are
        returned as a :class:`ResearchResult` so the caller can pass them
        to their preferred LLM for synthesis.

        Parameters
        ----------
        query:
            Research question or topic.
        max_sources:
            Maximum number of source pages to retrieve (default 5).
        scrape_content:
            If True (default), fetch the full markdown content of each
            search result.  If False, only snippets are returned.

        Returns
        -------
        ResearchResult
        """
        search_resp = self.search(query, max_results=max_sources)
        sources = search_resp.results

        if scrape_content:
            enriched: list[SearchResult] = []
            for result in sources:
                try:
                    scraped = self.scrape(result.url)
                    enriched.append(
                        SearchResult(
                            title=result.title,
                            url=result.url,
                            snippet=result.snippet,
                            content=scraped.content,
                        )
                    )
                except WebPeelError:
                    enriched.append(result)
            sources = enriched

        # Build a simple markdown report from available content
        report_parts = [f"# Research: {query}\n"]
        for i, src in enumerate(sources, 1):
            report_parts.append(f"## Source {i}: {src.title}")
            report_parts.append(f"**URL:** {src.url}\n")
            report_parts.append(src.content or src.snippet)
            report_parts.append("")

        report = "\n".join(report_parts)
        return ResearchResult(report=report, sources=sources)

    async def async_research(
        self,
        query: str,
        *,
        max_sources: int = 5,
        scrape_content: bool = True,
        **kwargs: Any,
    ) -> ResearchResult:
        """Async version of :meth:`research`."""
        import asyncio

        search_resp = await self.async_search(query, max_results=max_sources)
        sources = search_resp.results

        if scrape_content:
            tasks = [self.async_scrape(r.url) for r in sources]
            scraped_list = await asyncio.gather(*tasks, return_exceptions=True)
            enriched: list[SearchResult] = []
            for result, scraped in zip(sources, scraped_list):
                if isinstance(scraped, Exception):
                    enriched.append(result)
                else:
                    enriched.append(
                        SearchResult(
                            title=result.title,
                            url=result.url,
                            snippet=result.snippet,
                            content=scraped.content,
                        )
                    )
            sources = enriched

        report_parts = [f"# Research: {query}\n"]
        for i, src in enumerate(sources, 1):
            report_parts.append(f"## Source {i}: {src.title}")
            report_parts.append(f"**URL:** {src.url}\n")
            report_parts.append(src.content or src.snippet)
            report_parts.append("")

        report = "\n".join(report_parts)
        return ResearchResult(report=report, sources=sources)
