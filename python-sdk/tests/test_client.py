"""Basic tests for WebPeel SDK."""

import unittest
from unittest.mock import patch, MagicMock
import json

from webpeel import WebPeel, ScrapeResult, WebPeelError


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


if __name__ == '__main__':
    unittest.main()
