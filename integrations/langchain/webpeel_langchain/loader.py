"""WebPeel Document Loader for LangChain."""

from typing import Iterator, List, Optional
import urllib.request
import json

# LangChain is an optional dependency
try:
    from langchain_core.documents import Document
    from langchain_core.document_loaders.base import BaseLoader
except ImportError:
    raise ImportError(
        "langchain-core is required for WebPeelLoader. "
        "Install it with: pip install langchain-core"
    )


class WebPeelLoader(BaseLoader):
    """Load web pages using WebPeel API.
    
    WebPeel is a fast web fetcher for AI agents with smart extraction,
    stealth mode, and structured data support.
    
    Example:
        >>> from webpeel_langchain import WebPeelLoader
        >>> 
        >>> loader = WebPeelLoader(
        ...     urls=["https://example.com", "https://example.com/about"],
        ...     api_key="your-api-key",  # Optional for free tier
        ...     render=True,  # Enable browser rendering for JS-heavy sites
        ... )
        >>> 
        >>> documents = loader.load()
        >>> for doc in documents:
        ...     print(doc.page_content[:100])
        ...     print(doc.metadata)
    """
    
    def __init__(
        self,
        urls: List[str],
        api_key: Optional[str] = None,
        base_url: str = "https://api.webpeel.dev",
        max_tokens: Optional[int] = None,
        render: bool = False,
        stealth: bool = False,
        timeout: int = 30,
    ):
        """Initialize WebPeel loader.
        
        Args:
            urls: List of URLs to load
            api_key: WebPeel API key (optional for free tier)
            base_url: WebPeel API base URL
            max_tokens: Maximum tokens per document
            render: Use browser rendering for JavaScript-heavy sites
            stealth: Enable stealth mode to bypass bot detection
            timeout: Request timeout in seconds
        """
        self.urls = urls
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.max_tokens = max_tokens
        self.render = render
        self.stealth = stealth
        self.timeout = timeout
    
    def lazy_load(self) -> Iterator[Document]:
        """Lazily load documents from URLs.
        
        Yields:
            Document objects with page content and metadata
        """
        for url in self.urls:
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
                "User-Agent": "webpeel-langchain/0.1.0",
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
                yield Document(
                    page_content=result.get("content", ""),
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
                )
            
            except Exception as e:
                # On error, yield empty document with error in metadata
                yield Document(
                    page_content="",
                    metadata={
                        "source": url,
                        "error": str(e),
                    },
                )
    
    def load(self) -> List[Document]:
        """Load all documents.
        
        Returns:
            List of Document objects
        """
        return list(self.lazy_load())
