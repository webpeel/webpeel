# WebPeel LlamaIndex Integration

**Official WebPeel reader for LlamaIndex.**

Load web pages into LlamaIndex with smart extraction, JavaScript rendering, and stealth mode.

## Installation

```bash
pip install webpeel-llamaindex
```

## Quick Start

```python
from webpeel_llamaindex import WebPeelReader

# Load web pages
reader = WebPeelReader()

documents = reader.load_data(urls=[
    "https://example.com",
    "https://example.com/about",
])

for doc in documents:
    print(doc.text[:200])
    print(doc.metadata)
```

## Features

- **Smart Extraction**: Clean, AI-ready markdown content
- **JavaScript Rendering**: Handle SPAs and dynamic sites
- **Stealth Mode**: Bypass Cloudflare and anti-bot systems
- **Zero Config**: No API key needed for free tier
- **Simple API**: Just pass URLs and get documents

## Usage

### Basic Loading

```python
from webpeel_llamaindex import WebPeelReader

reader = WebPeelReader()
docs = reader.load_data(urls=["https://example.com"])
```

### With API Key (Paid Tier)

```python
reader = WebPeelReader(api_key="wp_...")  # Get from webpeel.dev
docs = reader.load_data(urls=["https://example.com"])
```

### JavaScript-Heavy Sites

```python
reader = WebPeelReader(render=True)  # Enable browser rendering
docs = reader.load_data(urls=["https://twitter.com/elonmusk"])
```

### Stealth Mode (Bypass Bot Detection)

```python
reader = WebPeelReader(stealth=True)  # Bypass Cloudflare, reCAPTCHA, etc.
docs = reader.load_data(urls=["https://protected-site.com"])
```

### Token Budget Control

```python
reader = WebPeelReader(max_tokens=5000)  # Limit output to 5000 tokens
docs = reader.load_data(urls=["https://example.com"])
```

## Using with LlamaIndex

### Vector Store Indexing

```python
from llama_index.core import VectorStoreIndex
from webpeel_llamaindex import WebPeelReader

# Load documents
reader = WebPeelReader()
docs = reader.load_data(urls=[
    "https://docs.python.org/3/tutorial/",
    "https://docs.python.org/3/library/",
])

# Create index
index = VectorStoreIndex.from_documents(docs)

# Query
query_engine = index.as_query_engine()
response = query_engine.query("How do I use lists in Python?")
print(response)
```

### Knowledge Graph

```python
from llama_index.core import KnowledgeGraphIndex
from webpeel_llamaindex import WebPeelReader

# Load documents
reader = WebPeelReader()
docs = reader.load_data(urls=["https://example.com/docs"])

# Create knowledge graph
index = KnowledgeGraphIndex.from_documents(docs)

# Query with relationships
query_engine = index.as_query_engine()
response = query_engine.query("What are the main concepts?")
```

### Chat Engine

```python
from llama_index.core import VectorStoreIndex
from webpeel_llamaindex import WebPeelReader

# Load and index
reader = WebPeelReader()
docs = reader.load_data(urls=["https://example.com"])
index = VectorStoreIndex.from_documents(docs)

# Create chat engine
chat_engine = index.as_chat_engine()

# Chat
response = chat_engine.chat("Tell me about this website")
print(response)
```

### Multiple URL Sources

```python
from webpeel_llamaindex import WebPeelReader

# Load from multiple sources
urls = [
    "https://docs.example.com/intro",
    "https://docs.example.com/api",
    "https://blog.example.com/tutorial",
]

reader = WebPeelReader(render=True)
docs = reader.load_data(urls=urls)

# Each document has source in metadata
for doc in docs:
    print(f"Source: {doc.metadata['source']}")
    print(f"Title: {doc.metadata['title']}")
```

## API Reference

### WebPeelReader

```python
WebPeelReader(
    api_key: Optional[str] = None,
    base_url: str = "https://api.webpeel.dev",
    max_tokens: Optional[int] = None,
    render: bool = False,
    stealth: bool = False,
    timeout: int = 30,
)
```

**Parameters:**
- `api_key`: WebPeel API key (optional for free tier)
- `base_url`: API base URL (default: `https://api.webpeel.dev`)
- `max_tokens`: Maximum tokens per document
- `render`: Enable browser rendering for JavaScript-heavy sites
- `stealth`: Enable stealth mode to bypass bot detection
- `timeout`: Request timeout in seconds

**Methods:**
- `load_data(urls: List[str]) -> List[Document]`: Load documents from URLs

## Why WebPeel?

| Feature | WebPeel | Firecrawl |
|---------|---------|-----------|
| **Price** | Free tier + pay-as-you-go | $500+/mo minimum |
| **License** | MIT (open source) | Proprietary |
| **Stealth Mode** | ✅ Built-in | ❌ Not available |
| **Zero Config** | ✅ Works without API key | ❌ Requires paid plan |
| **Self-Hosted** | ✅ Free forever | ❌ Expensive enterprise |

**WebPeel is the free, fast, MIT-licensed alternative to Firecrawl.**

## Links

- [WebPeel Homepage](https://webpeel.dev)
- [Documentation](https://github.com/webpeel/webpeel)
- [Python SDK](https://pypi.org/project/webpeel/)
- [GitHub](https://github.com/webpeel/webpeel)

## License

MIT © Jake Liu
