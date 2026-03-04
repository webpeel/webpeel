"""Basic tests for WebPeel SDK."""

import unittest
from unittest.mock import patch, MagicMock
import json

from webpeel import WebPeel, ScrapeResult, WebPeelError
from webpeel.types import ScrapeResult as ScrapeResultType


class TestWebPeel(unittest.TestCase):
    """Test WebPeel client."""
    
    def setUp(self):
        """Set up test client."""
        self.client = WebPeel(api_key="test-key")
    
    def test_init(self):
        """Test client initialization."""
        self.assertEqual(self.client.api_key, "test-key")
        self.assertEqual(self.client.base_url, "https://api.webpeel.dev")
        self.assertEqual(self.client.timeout, 30)
    
    def test_init_custom(self):
        """Test client with custom settings."""
        client = WebPeel(
            api_key="custom-key",
            base_url="https://custom.api",
            timeout=60,
        )
        self.assertEqual(client.api_key, "custom-key")
        self.assertEqual(client.base_url, "https://custom.api")
        self.assertEqual(client.timeout, 60)
    
    @patch('urllib.request.urlopen')
    def test_scrape_basic(self, mock_urlopen):
        """Test basic scrape."""
        # Mock response
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "url": "https://example.com",
            "title": "Example Domain",
            "content": "# Example Domain\n\nThis is an example.",
            "metadata": {"description": "Example site"},
            "links": ["https://example.com/about"],
            "tokens": 100,
            "method": "simple",
            "elapsed": 250,
        }).encode('utf-8')
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        
        mock_urlopen.return_value = mock_response
        
        # Call scrape
        result = self.client.scrape("https://example.com")
        
        # Verify result
        self.assertIsInstance(result, ScrapeResult)
        self.assertEqual(result.url, "https://example.com")
        self.assertEqual(result.title, "Example Domain")
        self.assertEqual(result.method, "simple")
        self.assertEqual(result.tokens, 100)
        self.assertIn("Example Domain", result.content)
    
    @patch('urllib.request.urlopen')
    def test_scrape_with_options(self, mock_urlopen):
        """Test scrape with options."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "url": "https://example.com",
            "title": "Example",
            "content": "Content",
            "metadata": {},
            "links": [],
            "tokens": 50,
            "method": "browser",
            "elapsed": 1500,
        }).encode('utf-8')
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        
        mock_urlopen.return_value = mock_response
        
        result = self.client.scrape(
            "https://example.com",
            render=True,
            wait=2000,
            max_tokens=5000,
        )
        
        self.assertEqual(result.method, "browser")
        self.assertEqual(result.url, "https://example.com")


class TestScrapeResultNewFields(unittest.TestCase):
    """Test new fields added in v0.13.0."""

    def test_new_fields_default_none(self):
        """New fields should default to None (backwards compatible)."""
        result = ScrapeResultType(
            url="https://example.com",
            title="Test",
            content="Content",
            markdown="Content",
            metadata={},
            links=[],
            tokens=100,
            method="simple",
            elapsed=200,
        )
        self.assertIsNone(result.raw_token_estimate)
        self.assertIsNone(result.token_savings_percent)
        self.assertIsNone(result.auto_interact)

    def test_new_fields_set(self):
        """New fields should accept values correctly."""
        result = ScrapeResultType(
            url="https://example.com",
            title="Test",
            content="Content",
            markdown="Content",
            metadata={},
            links=[],
            tokens=100,
            method="simple",
            elapsed=200,
            raw_token_estimate=1000,
            token_savings_percent=95,
            auto_interact={"cookieBanner": "dismissed"},
        )
        self.assertEqual(result.raw_token_estimate, 1000)
        self.assertEqual(result.token_savings_percent, 95)
        self.assertEqual(result.auto_interact, {"cookieBanner": "dismissed"})

    @patch('urllib.request.urlopen')
    def test_scrape_maps_new_fields_from_api(self, mock_urlopen):
        """Client should map camelCase API fields to snake_case."""
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "url": "https://example.com",
            "title": "Example",
            "content": "Content",
            "metadata": {},
            "links": [],
            "tokens": 500,
            "method": "simple",
            "elapsed": 300,
            "rawTokenEstimate": 8000,
            "tokenSavingsPercent": 94,
            "autoInteract": {"cookieBanner": "dismissed", "gdprConsent": "accepted"},
        }).encode('utf-8')
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_response

        client = WebPeel(api_key="test-key")
        result = client.scrape("https://example.com")

        self.assertEqual(result.raw_token_estimate, 8000)
        self.assertEqual(result.token_savings_percent, 94)
        self.assertEqual(result.auto_interact, {"cookieBanner": "dismissed", "gdprConsent": "accepted"})


if __name__ == '__main__':
    unittest.main()
