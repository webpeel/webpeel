"""WebPeel Reader for LlamaIndex."""

from typing import List, Optional
import urllib.request
import json

# LlamaIndex is an optional dependency
try:
    from llama_index.core.readers.base import BaseReader
    from llama_index.core.schema import Document
except ImportError:
    raise ImportError(
        "llama-index-core is required for WebPeelReader. "
        "Install it with: pip install llama-index-core"
    )


class WebPeelReader(BaseReader):
    """Read web pages using WebPeel API.
    
    WebPeel is a fast web fetcher for AI agents with smart extraction,
    stealth mode, and structured data support.
    
    Example:
        >>> from webpeel_llamaindex import WebPeelReader
        >>> 
        >>> reader = WebPeelReader(
        ...     api_key="your-api-key",  # Optional for free tier
        ...     render=True,  # Enable browser rendering for JS-heavy sites
        ... )
        >>> 
        >>> documents = reader.load_data(urls=[
        ...     "https://example.com",
        ...     "https://example.com/about",
        ... ])
        >>> 
        >>> for doc in documents:
        ...     print(doc.text[:100])
        ...     print(doc.metadata)
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.webpeel.dev",
        max_tokens: Optional[int] = None,
        render: bool = False,
        stealth: bool = False,
        timeout: int = 30,
    ):
        """Initialize WebPeel reader.
        
        Args:
            api_key: WebPeel API key (optional for free tier)
            base_url: WebPeel API base URL
            max_tokens: Maximum tokens per document
            render: Use browser rendering for JavaScript-heavy sites
            stealth: Enable stealth mode to bypass bot detection
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.max_tokens = max_tokens
        self.render = render
        self.stealth = stealth
        self.timeout = timeout
    
    def load_data(self, urls: List[str]) -> List[Document]:
        """Load documents from URLs.
        
        Args:
            urls: List of URLs to load
        
        Returns:
            List of Document objects with content and metadata
        """
        documents = []
        
        for url in urls:
            # Build request payload
            payload = {
                "url": url,
                "format": "markdown",
            }
            
            if self.max_tokens is not None:
                payload["maxTokens"] = self.max_tokens
            if self.render:
                payload["render"] = self.render
            if self.stealth:
                payload["stealth"] = self.stealth
            
            # Prepare request
            req_data = json.dumps(payload).encode('utf-8')
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "webpeel-llamaindex/0.1.0",
            }
            
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            req = urllib.request.Request(
                f"{self.base_url}/v1/fetch",
                data=req_data,
                headers=headers,
                method="POST",
            )
            
            try:
                # Make request
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    result = json.loads(resp.read().decode('utf-8'))
                
                # Create Document
                documents.append(Document(
                    text=result.get("content", ""),
                    metadata={
                        "source": result.get("url", url),
                        "title": result.get("title", ""),
                        "description": result.get("metadata", {}).get("description"),
                        "author": result.get("metadata", {}).get("author"),
                        "published": result.get("metadata", {}).get("published"),
                        "tokens": result.get("tokens", 0),
                        "method": result.get("method", ""),
                        "quality": result.get("quality"),
                        "fingerprint": result.get("fingerprint"),
                    },
                ))
            
            except Exception as e:
                # On error, append empty document with error in metadata
                documents.append(Document(
                    text="",
                    metadata={
                        "source": url,
                        "error": str(e),
                    },
                ))
        
        return documents
