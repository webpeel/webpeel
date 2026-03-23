"""
WebPeel SDK — test suite.

Uses respx to mock HTTP calls so no real network is needed.
Run with: pytest
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx

from webpeel import WebPeel, WebPeelError
from webpeel.types import (
    BatchJob,
    BatchStatus,
    CrawlJob,
    CrawlStatus,
    ExtractResult,
    MapResult,
    ResearchResult,
    ScrapeResult,
    SearchResponse,
)

API_KEY = "wp-test-key"
BASE_URL = "https://api.webpeel.dev"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def wp() -> WebPeel:
    return WebPeel(api_key=API_KEY, base_url=BASE_URL)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SCRAPE_RESPONSE = {
    "content": "# Hello World\n\nSome content.",
    "title": "Example Domain",
    "url": "https://example.com",
    "metadata": {"description": "Example website"},
    "links": ["https://example.com/page1", "https://example.com/page2"],
    "method": "basic",
    "elapsed": 345,
}

SEARCH_RESPONSE = {
    "success": True,
    "data": {
        "web": [
            {"title": "Python Scraping Guide", "url": "https://example.com/guide", "snippet": "How to scrape..."},
            {"title": "Web Scraping Tools", "url": "https://tools.example.com", "snippet": "Best tools..."},
        ]
    },
}

BATCH_SUBMIT_RESPONSE = {
    "success": True,
    "id": "batch-abc123",
    "url": "/v1/batch/scrape/batch-abc123",
}

BATCH_STATUS_RESPONSE = {
    "success": True,
    "status": "completed",
    "total": 2,
    "completed": 2,
    "creditsUsed": 2,
    "data": [
        {
            "content": "Page A content",
            "title": "Page A",
            "url": "https://a.com",
            "metadata": {},
            "links": [],
            "method": "basic",
            "elapsed": 100,
        }
    ],
}

CRAWL_SUBMIT_RESPONSE = {
    "success": True,
    "id": "crawl-xyz789",
    "url": "/v1/crawl/crawl-xyz789",
}

CRAWL_STATUS_RESPONSE = {
    "success": True,
    "status": "completed",
    "total": 5,
    "completed": 5,
    "creditsUsed": 5,
    "data": [],
    "expiresAt": "2025-12-31T00:00:00Z",
}

MAP_RESPONSE = {
    "success": True,
    "links": [
        "https://example.com/",
        "https://example.com/about",
        "https://example.com/contact",
    ],
}

EXTRACT_RESPONSE = {
    "success": True,
    "data": {"price": "$9.99"},
    "metadata": {"url": "https://example.com", "tokensUsed": {"input": 500, "output": 50}},
}

SCREENSHOT_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100  # Fake PNG bytes


def _png_data_uri() -> str:
    encoded = base64.b64encode(SCREENSHOT_PNG).decode()
    return f"data:image/png;base64,{encoded}"


SCREENSHOT_RESPONSE = {
    "success": True,
    "data": {
        "url": "https://example.com",
        "screenshot": _png_data_uri(),
        "metadata": {"sourceURL": "https://example.com", "format": "png", "width": 1280, "height": 720},
    },
}

# ---------------------------------------------------------------------------
# Auth header tests
# ---------------------------------------------------------------------------


class TestAuthHeaders:
    """Verify Authorization header is always sent."""

    @respx.mock
    def test_auth_header_sent(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/fetch").mock(return_value=httpx.Response(200, json=SCRAPE_RESPONSE))
        wp.scrape("https://example.com")
        assert route.called
        request = route.calls.last.request
        assert request.headers["authorization"] == f"Bearer {API_KEY}"

    def test_no_api_key_no_auth_header(self) -> None:
        client = WebPeel(api_key="", base_url=BASE_URL)
        assert "Authorization" not in client._headers()

    def test_env_var_api_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("WEBPEEL_API_KEY", "wp-from-env")
        monkeypatch.setenv("WEBPEEL_BASE_URL", BASE_URL)
        client = WebPeel()
        assert client._api_key == "wp-from-env"
        assert client._base_url == BASE_URL


# ---------------------------------------------------------------------------
# scrape
# ---------------------------------------------------------------------------


class TestScrape:
    @respx.mock
    def test_scrape_basic(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/fetch").mock(return_value=httpx.Response(200, json=SCRAPE_RESPONSE))
        result = wp.scrape("https://example.com")

        assert isinstance(result, ScrapeResult)
        assert result.content == SCRAPE_RESPONSE["content"]
        assert result.title == SCRAPE_RESPONSE["title"]
        assert result.url == SCRAPE_RESPONSE["url"]
        assert result.metadata == SCRAPE_RESPONSE["metadata"]
        assert result.links == SCRAPE_RESPONSE["links"]
        assert result.elapsed == SCRAPE_RESPONSE["elapsed"]

    @respx.mock
    def test_scrape_with_options(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/fetch").mock(return_value=httpx.Response(200, json=SCRAPE_RESPONSE))
        wp.scrape(
            "https://example.com",
            format="html",
            render=True,
            wait=2000,
            actions=[{"type": "click", "selector": ".btn"}],
        )
        body = json.loads(route.calls.last.request.content)
        assert body["format"] == "html"
        assert body["render"] is True
        assert body["wait"] == 2000
        assert body["actions"] == [{"type": "click", "selector": ".btn"}]

    @respx.mock
    def test_scrape_budget_alias(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/fetch").mock(return_value=httpx.Response(200, json=SCRAPE_RESPONSE))
        wp.scrape("https://example.com", budget=3000)
        body = json.loads(route.calls.last.request.content)
        assert body["wait"] == 3000

    @respx.mock
    def test_scrape_error_raises(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/fetch").mock(
            return_value=httpx.Response(400, json={"error": "invalid_url", "message": "Invalid URL format"})
        )
        with pytest.raises(WebPeelError) as exc_info:
            wp.scrape("not-a-url")
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "invalid_url"

    @respx.mock
    def test_scrape_500_error(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/fetch").mock(
            return_value=httpx.Response(500, json={"error": "internal_error", "message": "Server exploded"})
        )
        with pytest.raises(WebPeelError) as exc_info:
            wp.scrape("https://example.com")
        assert exc_info.value.status_code == 500

    @respx.mock
    async def test_async_scrape(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/fetch").mock(return_value=httpx.Response(200, json=SCRAPE_RESPONSE))
        result = await wp.async_scrape("https://example.com")
        assert isinstance(result, ScrapeResult)
        assert result.title == "Example Domain"


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------


class TestSearch:
    @respx.mock
    def test_search_basic(self, wp: WebPeel) -> None:
        respx.get(f"{BASE_URL}/v1/search").mock(return_value=httpx.Response(200, json=SEARCH_RESPONSE))
        resp = wp.search("python web scraping", max_results=5)

        assert isinstance(resp, SearchResponse)
        assert resp.query == "python web scraping"
        assert len(resp.results) == 2
        assert resp.results[0].title == "Python Scraping Guide"
        assert resp.results[0].url == "https://example.com/guide"

    @respx.mock
    def test_search_query_params(self, wp: WebPeel) -> None:
        route = respx.get(f"{BASE_URL}/v1/search").mock(return_value=httpx.Response(200, json=SEARCH_RESPONSE))
        wp.search("test query", max_results=3)
        request = route.calls.last.request
        assert "q=test+query" in str(request.url) or "q=test%20query" in str(request.url)
        assert "count=3" in str(request.url)

    @respx.mock
    def test_search_error(self, wp: WebPeel) -> None:
        respx.get(f"{BASE_URL}/v1/search").mock(
            return_value=httpx.Response(500, json={"error": "search_failed", "message": "Search failed"})
        )
        with pytest.raises(WebPeelError):
            wp.search("fail query")

    @respx.mock
    async def test_async_search(self, wp: WebPeel) -> None:
        respx.get(f"{BASE_URL}/v1/search").mock(return_value=httpx.Response(200, json=SEARCH_RESPONSE))
        resp = await wp.async_search("async test")
        assert isinstance(resp, SearchResponse)
        assert len(resp.results) == 2


# ---------------------------------------------------------------------------
# batch
# ---------------------------------------------------------------------------


class TestBatch:
    @respx.mock
    def test_batch_submit(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/batch/scrape").mock(return_value=httpx.Response(202, json=BATCH_SUBMIT_RESPONSE))
        job = wp.batch(["https://a.com", "https://b.com"])

        assert isinstance(job, BatchJob)
        assert job.id == "batch-abc123"

    @respx.mock
    def test_batch_status(self, wp: WebPeel) -> None:
        respx.get(f"{BASE_URL}/v1/batch/scrape/batch-abc123").mock(
            return_value=httpx.Response(200, json=BATCH_STATUS_RESPONSE)
        )
        status = wp.batch_status("batch-abc123")

        assert isinstance(status, BatchStatus)
        assert status.status == "completed"
        assert status.total == 2
        assert status.completed == 2

    @respx.mock
    def test_batch_sends_urls(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/batch/scrape").mock(
            return_value=httpx.Response(202, json=BATCH_SUBMIT_RESPONSE)
        )
        wp.batch(["https://a.com", "https://b.com"])
        body = json.loads(route.calls.last.request.content)
        assert body["urls"] == ["https://a.com", "https://b.com"]

    @respx.mock
    async def test_async_batch(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/batch/scrape").mock(return_value=httpx.Response(202, json=BATCH_SUBMIT_RESPONSE))
        job = await wp.async_batch(["https://a.com", "https://b.com"])
        assert job.id == "batch-abc123"


# ---------------------------------------------------------------------------
# crawl
# ---------------------------------------------------------------------------


class TestCrawl:
    @respx.mock
    def test_crawl_submit(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/crawl").mock(return_value=httpx.Response(202, json=CRAWL_SUBMIT_RESPONSE))
        job = wp.crawl("https://example.com", max_pages=50)

        assert isinstance(job, CrawlJob)
        assert job.id == "crawl-xyz789"

    @respx.mock
    def test_crawl_sends_params(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/crawl").mock(return_value=httpx.Response(202, json=CRAWL_SUBMIT_RESPONSE))
        wp.crawl("https://example.com", max_pages=10, max_depth=2)
        body = json.loads(route.calls.last.request.content)
        assert body["url"] == "https://example.com"
        assert body["limit"] == 10
        assert body["maxDepth"] == 2

    @respx.mock
    def test_crawl_status(self, wp: WebPeel) -> None:
        respx.get(f"{BASE_URL}/v1/crawl/crawl-xyz789").mock(
            return_value=httpx.Response(200, json=CRAWL_STATUS_RESPONSE)
        )
        status = wp.crawl_status("crawl-xyz789")

        assert isinstance(status, CrawlStatus)
        assert status.status == "completed"
        assert status.total == 5
        assert status.expires_at == "2025-12-31T00:00:00Z"

    @respx.mock
    async def test_async_crawl(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/crawl").mock(return_value=httpx.Response(202, json=CRAWL_SUBMIT_RESPONSE))
        job = await wp.async_crawl("https://example.com", max_pages=5)
        assert job.id == "crawl-xyz789"

    @respx.mock
    async def test_async_crawl_status(self, wp: WebPeel) -> None:
        respx.get(f"{BASE_URL}/v1/crawl/crawl-xyz789").mock(
            return_value=httpx.Response(200, json=CRAWL_STATUS_RESPONSE)
        )
        status = await wp.async_crawl_status("crawl-xyz789")
        assert status.status == "completed"


# ---------------------------------------------------------------------------
# map
# ---------------------------------------------------------------------------


class TestMap:
    @respx.mock
    def test_map_basic(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/map").mock(return_value=httpx.Response(200, json=MAP_RESPONSE))
        result = wp.map("https://example.com")

        assert isinstance(result, MapResult)
        assert len(result.urls) == 3
        assert "https://example.com/about" in result.urls

    @respx.mock
    def test_map_sends_url(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/map").mock(return_value=httpx.Response(200, json=MAP_RESPONSE))
        wp.map("https://example.com", limit=100, search="about")
        body = json.loads(route.calls.last.request.content)
        assert body["url"] == "https://example.com"
        assert body["limit"] == 100
        assert body["search"] == "about"

    @respx.mock
    async def test_async_map(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/map").mock(return_value=httpx.Response(200, json=MAP_RESPONSE))
        result = await wp.async_map("https://example.com")
        assert isinstance(result, MapResult)
        assert len(result.urls) == 3


# ---------------------------------------------------------------------------
# extract
# ---------------------------------------------------------------------------


class TestExtract:
    @respx.mock
    def test_extract_basic(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/extract").mock(return_value=httpx.Response(200, json=EXTRACT_RESPONSE))
        result = wp.extract(
            ["https://example.com"],
            prompt="Extract product prices",
            schema={"type": "object", "properties": {"price": {"type": "string"}}},
        )

        assert isinstance(result, ExtractResult)
        assert result.data == {"price": "$9.99"}

    @respx.mock
    def test_extract_sends_first_url(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/extract").mock(return_value=httpx.Response(200, json=EXTRACT_RESPONSE))
        wp.extract(["https://example.com", "https://other.com"], prompt="Extract data")
        body = json.loads(route.calls.last.request.content)
        assert body["url"] == "https://example.com"

    def test_extract_requires_prompt_or_schema(self, wp: WebPeel) -> None:
        with pytest.raises(ValueError, match="prompt.*schema"):
            wp.extract(["https://example.com"])

    @respx.mock
    def test_extract_error(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/extract").mock(
            return_value=httpx.Response(401, json={"success": False, "error": "llm_auth_failed", "message": "Auth failed"})
        )
        with pytest.raises(WebPeelError) as exc_info:
            wp.extract(["https://example.com"], prompt="test")
        assert exc_info.value.status_code == 401

    @respx.mock
    async def test_async_extract(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/extract").mock(return_value=httpx.Response(200, json=EXTRACT_RESPONSE))
        result = await wp.async_extract(["https://example.com"], prompt="Extract prices")
        assert result.data == {"price": "$9.99"}


# ---------------------------------------------------------------------------
# screenshot
# ---------------------------------------------------------------------------


class TestScreenshot:
    @respx.mock
    def test_screenshot_returns_bytes(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/screenshot").mock(return_value=httpx.Response(200, json=SCREENSHOT_RESPONSE))
        result = wp.screenshot("https://example.com")

        assert isinstance(result, bytes)
        assert result == SCREENSHOT_PNG

    @respx.mock
    def test_screenshot_options(self, wp: WebPeel) -> None:
        route = respx.post(f"{BASE_URL}/v1/screenshot").mock(
            return_value=httpx.Response(200, json=SCREENSHOT_RESPONSE)
        )
        wp.screenshot("https://example.com", full_page=True, width=1920, height=1080, format="jpeg", quality=80)
        body = json.loads(route.calls.last.request.content)
        assert body["fullPage"] is True
        assert body["width"] == 1920
        assert body["height"] == 1080
        assert body["format"] == "jpeg"
        assert body["quality"] == 80

    @respx.mock
    def test_screenshot_error(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/screenshot").mock(
            return_value=httpx.Response(500, json={"error": "internal_error", "message": "Screenshot failed"})
        )
        with pytest.raises(WebPeelError):
            wp.screenshot("https://example.com")

    @respx.mock
    async def test_async_screenshot(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/screenshot").mock(return_value=httpx.Response(200, json=SCREENSHOT_RESPONSE))
        result = await wp.async_screenshot("https://example.com")
        assert result == SCREENSHOT_PNG


# ---------------------------------------------------------------------------
# research
# ---------------------------------------------------------------------------


class TestResearch:
    @respx.mock
    def test_research_basic(self, wp: WebPeel) -> None:
        # Mock search
        respx.get(f"{BASE_URL}/v1/search").mock(return_value=httpx.Response(200, json=SEARCH_RESPONSE))
        # Mock each scrape
        respx.post(f"{BASE_URL}/v1/fetch").mock(return_value=httpx.Response(200, json=SCRAPE_RESPONSE))

        result = wp.research("python web scraping", max_sources=2)

        assert isinstance(result, ResearchResult)
        assert "python web scraping" in result.report.lower()
        assert len(result.sources) == 2

    @respx.mock
    def test_research_no_scrape(self, wp: WebPeel) -> None:
        """When scrape_content=False, no /v1/fetch calls are made."""
        search_route = respx.get(f"{BASE_URL}/v1/search").mock(return_value=httpx.Response(200, json=SEARCH_RESPONSE))
        fetch_route = respx.post(f"{BASE_URL}/v1/fetch").mock(return_value=httpx.Response(200, json=SCRAPE_RESPONSE))

        wp.research("test", max_sources=2, scrape_content=False)

        assert search_route.called
        assert not fetch_route.called

    @respx.mock
    def test_research_handles_scrape_error_gracefully(self, wp: WebPeel) -> None:
        """If a scrape fails, that source uses the snippet instead."""
        respx.get(f"{BASE_URL}/v1/search").mock(return_value=httpx.Response(200, json=SEARCH_RESPONSE))
        respx.post(f"{BASE_URL}/v1/fetch").mock(
            return_value=httpx.Response(500, json={"error": "internal_error", "message": "Failed"})
        )

        result = wp.research("test", max_sources=2)
        # Should not raise — just use snippets
        assert isinstance(result, ResearchResult)


# ---------------------------------------------------------------------------
# Error handling edge cases
# ---------------------------------------------------------------------------


class TestErrorHandling:
    @respx.mock
    def test_non_json_error_response(self, wp: WebPeel) -> None:
        respx.post(f"{BASE_URL}/v1/fetch").mock(
            return_value=httpx.Response(503, text="Service Unavailable")
        )
        with pytest.raises(WebPeelError) as exc_info:
            wp.scrape("https://example.com")
        assert exc_info.value.status_code == 503

    @respx.mock
    def test_404_not_found(self, wp: WebPeel) -> None:
        respx.get(f"{BASE_URL}/v1/crawl/nonexistent").mock(
            return_value=httpx.Response(404, json={"error": "not_found", "message": "Job not found"})
        )
        with pytest.raises(WebPeelError) as exc_info:
            wp.crawl_status("nonexistent")
        assert exc_info.value.status_code == 404
        assert "not_found" in str(exc_info.value.error_code)
