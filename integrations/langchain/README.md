# WebPeel LangChain Integration

**Official WebPeel document loader for LangChain.**

Load web pages into LangChain with smart extraction, JavaScript rendering, and stealth mode.

## Installation

```bash
pip install webpeel-langchain
```

## Quick Start

```python
from webpeel_langchain import WebPeelLoader

# Load web pages
loader = WebPeelLoader(
    urls=[
        "https://example.com",
        "https://example.com/about",
    ]
)

documents = loader.load()

for doc in documents:
    print(doc.page_content[:200])
    print(doc.metadata)
```

## Features

- **Smart Extraction**: Clean, AI-ready markdown content
- **JavaScript Rendering**: Handle SPAs and dynamic sites
- **Stealth Mode**: Bypass Cloudflare and anti-bot systems
- **Zero Config**: No API key needed for free tier
- **Lazy Loading**: Memory-efficient document streaming

## Usage

### Basic Loading

```python
from webpeel_langchain import WebPeelLoader

loader = WebPeelLoader(urls=["https://example.com"])
docs = loader.load()
```

### With API Key (Paid Tier)

```python
loader = WebPeelLoader(
    urls=["https://example.com"],
    api_key="wp_...",  # Get from webpeel.dev
)
```

### JavaScript-Heavy Sites

```python
loader = WebPeelLoader(
    urls=["https://twitter.com/elonmusk"],
    render=True,  # Enable browser rendering
)
```

### Stealth Mode (Bypass Bot Detection)

```python
loader = WebPeelLoader(
    urls=["https://protected-site.com"],
    stealth=True,  # Bypass Cloudflare, reCAPTCHA, etc.
)
```

### Token Budget Control

```python
loader = WebPeelLoader(
    urls=["https://example.com"],
    max_tokens=5000,  # Limit output to 5000 tokens
)
```

### Lazy Loading (Memory Efficient)

```python
loader = WebPeelLoader(urls=many_urls)

for doc in loader.lazy_load():
    # Process one document at a time
    print(doc.page_content)
```

## Using with LangChain

### Vector Store Indexing

```python
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from webpeel_langchain import WebPeelLoader

# Load documents
loader = WebPeelLoader(urls=[
    "https://docs.python.org/3/tutorial/",
    "https://docs.python.org/3/library/",
])
docs = loader.load()

# Create embeddings and vector store
embeddings = OpenAIEmbeddings()
vectorstore = FAISS.from_documents(docs, embeddings)

# Query
results = vectorstore.similarity_search("how to use lists in python")
```

### RAG Chain

```python
from langchain_openai import ChatOpenAI
from langchain.chains import RetrievalQA
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from webpeel_langchain import WebPeelLoader

# Load and index documents
loader = WebPeelLoader(urls=["https://example.com/docs"])
docs = loader.load()

vectorstore = FAISS.from_documents(docs, OpenAIEmbeddings())

# Create RAG chain
qa_chain = RetrievalQA.from_chain_type(
    llm=ChatOpenAI(),
    retriever=vectorstore.as_retriever(),
)

# Ask questions
answer = qa_chain.run("What is the main topic?")
print(answer)
```

## API Reference

### WebPeelLoader

```python
WebPeelLoader(
    urls: List[str],
    api_key: Optional[str] = None,
    base_url: str = "https://api.webpeel.dev",
    max_tokens: Optional[int] = None,
    render: bool = False,
    stealth: bool = False,
    timeout: int = 30,
)
```

**Parameters:**
- `urls`: List of URLs to load
- `api_key`: WebPeel API key (optional for free tier)
- `base_url`: API base URL (default: `https://api.webpeel.dev`)
- `max_tokens`: Maximum tokens per document
- `render`: Enable browser rendering for JavaScript-heavy sites
- `stealth`: Enable stealth mode to bypass bot detection
- `timeout`: Request timeout in seconds

**Methods:**
- `load() -> List[Document]`: Load all documents
- `lazy_load() -> Iterator[Document]`: Lazily load documents one by one

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
