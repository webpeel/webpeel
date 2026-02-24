<p align="center">
  <a href="https://webpeel.dev">
    <img src=".github/banner.svg" alt="WebPeel — Web fetching for AI agents" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/v/webpeel.svg" alt="npm version"></a>
  <a href="https://pypi.org/project/webpeel/"><img src="https://img.shields.io/pypi/v/webpeel.svg" alt="PyPI version"></a>
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/dm/webpeel.svg" alt="downloads"></a>
  <a href="https://github.com/webpeel/webpeel/stargazers"><img src="https://img.shields.io/github/stars/webpeel/webpeel.svg" alt="GitHub stars"></a>
  <a href="https://github.com/webpeel/webpeel/actions/workflows/ci.yml"><img src="https://github.com/webpeel/webpeel/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="AGPL v3"></a>
</p>

<p align="center">
  <strong>Reliable web access for AI agents.</strong><br>
  Fetch any page · Extract structured data · Crawl entire sites · Deep research — one tool, three interfaces.
</p>

<p align="center">
  <a href="https://webpeel.dev">Website</a> ·
  <a href="https://webpeel.dev/docs">Docs</a> ·
  <a href="https://webpeel.dev/playground">Playground</a> ·
  <a href="https://app.webpeel.dev">Dashboard</a> ·
  <a href="https://github.com/webpeel/webpeel/discussions">Discussions</a>
</p>

---

## What is WebPeel?

WebPeel gives your AI agent reliable access to the web. Fetch any page, extract structured data, crawl entire sites, and research topics — all through a single CLI, API, or MCP server.

It automatically handles the hard parts: JavaScript rendering, bot detection, Cloudflare challenges, infinite scroll, pagination, and content noise. Your agent gets clean markdown. You don't think about the plumbing.

---

## 🚀 Quick Start

**Three paths in, all free to try:**

### CLI

```bash
npx webpeel "https://news.ycombinator.com"
```

No install needed. First 25 fetches work without signup. [Get 500/week free →](https://app.webpeel.dev/signup)

### MCP Server (for Claude, Cursor, VS Code, Windsurf)

Add to your MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"]
    }
  }
}
```

[![Install in Claude Desktop](https://img.shields.io/badge/Install-Claude%20Desktop-5B3FFF?style=for-the-badge&logo=anthropic)](https://mcp.so/install/webpeel?for=claude)
[![Install in VS Code](https://img.shields.io/badge/Install-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode)](https://mcp.so/install/webpeel?for=vscode)

### REST API

```bash
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer wp_YOUR_KEY"
```

---

## ✨ Features

### Core

| Feature | Description |
|---------|-------------|
| **Web Fetching** | Any URL → clean markdown, text, HTML, or JSON |
| **Smart Escalation** | Auto-upgrades: HTTP → Browser → Stealth. Uses the fastest method, escalates only when needed |
| **Content Pruning** | 2-pass HTML reduction — strips nav/footer/sidebar/ads automatically |
| **Token Budget** | Hard-cap output to N tokens. No surprises in your LLM bill |
| **Screenshots** | Full-page or viewport screenshots with a single flag |
| **Batch Mode** | Process multiple URLs concurrently |

### AI Agent

| Feature | Description |
|---------|-------------|
| **MCP Server** | 12 tools for Claude Desktop, Cursor, VS Code, and Windsurf |
| **Deep Research** | Multi-hop agent: search → fetch → analyze → follow leads → synthesize |
| **Search** | Web search across 27+ structured sources |
| **Hotel Search** | Kayak, Booking.com, Google Travel, Expedia — in parallel |
| **Browser Profiles** | Persistent sessions for sites that require login |
| **Infinite Scroll** | Auto-scrolls lazy-loaded feeds until stable |
| **Actions** | Click, type, fill, select, hover, press, scroll — full browser automation |

### Extraction

| Feature | Description |
|---------|-------------|
| **CSS Schema Extraction** | 7 built-in schemas (Amazon, Booking.com, eBay, Expedia, Hacker News, Walmart, Yelp) — auto-detected by domain |
| **JSON Schema Extraction** | Pass any JSON Schema and get back typed, structured data |
| **LLM Extraction (BYOK)** | Natural language → structured data using your own OpenAI-compatible key |
| **BM25 Filtering** | Query-focused content: only the parts relevant to your question |
| **Links / Images / Meta** | Extract just the links, images, or metadata from any page |

### Anti-Bot

| Feature | Description |
|---------|-------------|
| **Stealth Mode** | Bypasses Cloudflare, PerimeterX, DataDome, Akamai, and more |
| **28 Auto-Stealth Domains** | Amazon, LinkedIn, Glassdoor, Zillow, and 24 more — stealth kicks in automatically |
| **Challenge Detection** | 7 bot-protection vendors detected and handled automatically |
| **Browser Fingerprinting** | Masks WebGL, navigator properties, canvas fingerprint |

### Advanced

| Feature | Description |
|---------|-------------|
| **Crawl + Sitemap** | BFS/DFS crawling, sitemap discovery, robots.txt compliance, deduplication |
| **Site Map** | Map all URLs on a domain up to any depth |
| **Pagination** | Follow "Next" links automatically for N pages |
| **Chunking** | Split long content into LLM-sized pieces (fixed, semantic, or paragraph) |
| **Caching** | Local result cache with configurable TTL (`5m`, `1h`, `1d`) |
| **Geo-targeting** | ISO country code + language preferences per request |
| **Change Tracking** | Detect what changed between two fetches of the same page |
| **Brand Extraction** | Pull logo, colors, fonts, and social links from any site |
| **PDF Extraction** | Extract text from PDF documents |
| **Self-Hostable** | Docker Compose for full on-premise deployment |
| **Python SDK** | Sync + async client, `pip install webpeel` |

---

## 🤖 MCP Integration

WebPeel exposes **13 tools** to your AI coding assistant:

| Tool | What it does |
|------|--------------|
| `webpeel_fetch` | Fetch any URL → markdown (smart escalation built in) |
| `webpeel_search` | Web search with structured results |
| `webpeel_batch` | Fetch multiple URLs concurrently |
| `webpeel_crawl` | Crawl a site with depth/page limits |
| `webpeel_map` | Discover all URLs on a domain |
| `webpeel_extract` | Structured extraction (CSS, JSON Schema, or LLM) |
| `webpeel_screenshot` | Screenshot any page |
| `webpeel_research` | Deep multi-hop research on a topic |
| `webpeel_summarize` | AI summary of any URL |
| `webpeel_answer` | Ask a question about a URL's content |
| `webpeel_change_track` | Detect changes between two fetches |
| `webpeel_brand` | Extract branding assets from a site |

<details>
<summary>Setup for each editor</summary>

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "webpeel": { "command": "npx", "args": ["-y", "webpeel", "mcp"] }
  }
}
```

**Cursor** (Settings → MCP Servers):
```json
{
  "mcpServers": {
    "webpeel": { "command": "npx", "args": ["-y", "webpeel", "mcp"] }
  }
}
```

**VS Code** (`~/.vscode/mcp.json`):
```json
{
  "servers": {
    "webpeel": { "command": "npx", "args": ["-y", "webpeel", "mcp"] }
  }
}
```

**Windsurf** (`~/.codeium/windsurf/mcp_config.json`):
```json
{
  "mcpServers": {
    "webpeel": { "command": "npx", "args": ["-y", "webpeel", "mcp"] }
  }
}
```

**Docker (stdio)**:
```json
{
  "mcpServers": {
    "webpeel": { "command": "docker", "args": ["run", "-i", "--rm", "webpeel/mcp"] }
  }
}
```
</details>

---

## 🔬 Deep Research

Multi-hop research that thinks like a researcher, not a search engine:

```bash
# Sources only — no API key needed
npx webpeel research "best practices for rate limiting APIs" --max-sources 8

# Full synthesis with LLM (BYOK)
npx webpeel research "compare Firecrawl vs Crawl4AI vs WebPeel" --llm-key sk-...
```

**How it works:** Search → fetch top results → extract key passages (BM25) → follow the most relevant links → synthesize across sources. No circular references, no duplicate content.

---

## 📦 Extraction

Three ways to get structured data out of any page:

### CSS Schema (zero config, auto-detected)

```bash
# Auto-detects Amazon and applies the built-in schema
npx webpeel "https://www.amazon.com/s?k=mechanical+keyboard" --json

# Force a specific schema
npx webpeel "https://www.booking.com/searchresults.html?city=Paris" --schema booking --json

# List all built-in schemas
npx webpeel --list-schemas
```

Built-in schemas: `amazon` · `booking` · `ebay` · `expedia` · `hackernews` · `walmart` · `yelp`

### JSON Schema (type-safe structured extraction)

```bash
npx webpeel "https://example.com/product" \
  --extract-schema '{"type":"object","properties":{"title":{"type":"string"},"price":{"type":"number"}}}' \
  --llm-key sk-...
```

### LLM Extraction (natural language, BYOK)

```bash
npx webpeel "https://hn.algolia.com" \
  --llm-extract "top 10 posts with title, score, and comment count" \
  --llm-key $OPENAI_API_KEY \
  --json
```

<details>
<summary>Node.js extraction example</summary>

```typescript
import { peel } from 'webpeel';

// CSS selector extraction
const result = await peel('https://news.ycombinator.com', {
  extract: {
    selectors: {
      titles: '.titleline > a',
      scores: '.score',
    }
  }
});
console.log(result.extracted); // { titles: [...], scores: [...] }

// LLM extraction with JSON Schema
const product = await peel('https://example.com/product', {
  llmExtract: 'title, price, rating, availability',
  llmKey: process.env.OPENAI_API_KEY,
});
```
</details>

---

## 🛡️ Stealth & Anti-Bot

WebPeel detects 7 bot-protection vendors and handles them automatically:

- **Cloudflare** (JS challenge, Turnstile, Bot Management)
- **PerimeterX / HUMAN** (behavioral analysis)
- **DataDome** (ML-based bot detection)
- **Akamai Bot Manager**
- **Distil Networks**
- **reCAPTCHA / hCaptcha** (page-level detection)
- **Generic challenge pages**

28 high-protection domains (Amazon, LinkedIn, Glassdoor, Zillow, Ticketmaster, and more) automatically route through stealth mode — no flags needed.

```bash
# Explicitly enable stealth
npx webpeel "https://glassdoor.com/jobs" --stealth

# Auto-escalation (stealth triggers automatically on challenge detection)
npx webpeel "https://amazon.com/dp/ASIN"
```

---

## ⚡ Benchmark

Evaluated on 30 real-world URLs across 6 categories (static, dynamic, SPA, protected, documents, international):

| | WebPeel | Next best |
|---|:---:|:---:|
| **Success rate** | **100%** (30/30) | 93.3% |
| **Content quality** | **92.3%** | 83.2% |

WebPeel is the only tool that extracted content from all 30 test URLs. [Full methodology →](https://webpeel.dev/blog/benchmarks)

---

## 🆚 Comparison

| Feature | **WebPeel** | Firecrawl | Jina Reader | ScrapingBee | Tavily |
|---------|:-----------:|:---------:|:-----------:|:-----------:|:------:|
| **Free tier** | ✅ 500/wk recurring | ⚠️ 500 one-time | ❌ | ❌ | ⚠️ 1,000 one-time |
| **Smart escalation** | ✅ auto HTTP→browser→stealth | ❌ manual | ❌ | ❌ | ❌ |
| **Stealth mode** | ✅ all plans | ✅ | ❌ | ✅ paid | ❌ |
| **Challenge detection** | ✅ 7 vendors | ❌ | ❌ | ❌ | ❌ |
| **MCP tools** | ✅ 12 tools | ⚠️ ~6 | ❌ | ❌ | ✅ |
| **Deep research** | ✅ multi-hop + BM25 | ⚠️ cloud only | ❌ | ❌ | ✅ |
| **CSS schema extraction** | ✅ 7 bundled | ❌ | ❌ | ❌ | ❌ |
| **LLM extraction (BYOK)** | ✅ | ⚠️ cloud only | ❌ | ❌ | ❌ |
| **Site search (27+ sites)** | ✅ | ❌ | ❌ | ❌ | ⚠️ web only |
| **Hotel search** | ✅ 4 sources parallel | ❌ | ❌ | ❌ | ❌ |
| **Browser profiles** | ✅ persistent sessions | ❌ | ❌ | ❌ | ❌ |
| **Self-hosting** | ✅ Docker Compose | ⚠️ complex | ❌ | ❌ | ❌ |
| **Python SDK** | ✅ `pip install` | ✅ | ❌ | ✅ | ✅ |
| **Firecrawl-compatible API** | ✅ drop-in | ✅ native | ❌ | ❌ | ❌ |
| **License** | AGPL-3.0 | AGPL-3.0 | Proprietary | Proprietary | Proprietary |
| **Price** | **$0 / $9 / $29** | $0 / $16 / $83 | custom | $49 / $149 | $0 / $99 |

---

## 💳 Pricing

| Plan | Price | Weekly Fetches | Burst |
|------|------:|:--------------:|:-----:|
| **Free** | $0/mo | 500/wk | 50/hr |
| **Pro** | $9/mo | 1,250/wk | 100/hr |
| **Max** | $29/mo | 6,250/wk | 500/hr |

All features on all plans. Pro/Max add pay-as-you-go extra usage (fetch $0.002, search $0.001, stealth $0.01). Quota resets every Monday.

[Sign up free →](https://app.webpeel.dev/signup) · [Compare with Firecrawl →](https://webpeel.dev/migrate-from-firecrawl)

---

## 🐍 Python SDK

```bash
pip install webpeel
```

```python
from webpeel import WebPeel

client = WebPeel(api_key="wp_...")  # or use WEBPEEL_API_KEY env var

# Fetch a page
result = client.scrape("https://example.com")
print(result.content)    # Clean markdown
print(result.metadata)   # title, description, author, ...

# Search the web
results = client.search("latest AI research papers")

# Crawl a site
job = client.crawl("https://docs.example.com", limit=100)

# With browser + stealth
result = client.scrape("https://protected-site.com", render=True, stealth=True)
```

Sync and async clients. Pure Python 3.8+, zero dependencies. [Full SDK docs →](python-sdk/README.md)

---

## 🐳 Self-Hosting

```bash
git clone https://github.com/webpeel/webpeel.git
cd webpeel && docker compose up
```

Full REST API available at `http://localhost:3000`. AGPL-3.0 licensed. [Self-hosting guide →](SELF_HOST.md)

**Just the MCP server:**
```bash
docker run -i webpeel/mcp
```

**Just the API server:**
```bash
docker run -p 3000:3000 webpeel/api
```

---

## 📖 API Reference

Full OpenAPI spec at [`openapi.yaml`](openapi.yaml) and [`api.webpeel.dev`](https://api.webpeel.dev).

```bash
# Fetch
GET  /v1/fetch?url=<url>

# Search
GET  /v1/search?q=<query>

# Crawl
POST /v1/crawl  { "url": "...", "limit": 100 }

# Map
GET  /v1/map?url=<url>

# Extract
POST /v1/extract  { "url": "...", "schema": { ... } }
```

[Full API reference →](https://webpeel.dev/docs/api-reference)

---

## 🤝 Contributing

```bash
git clone https://github.com/webpeel/webpeel.git
cd webpeel
npm install && npm run build
npm test
```

- **Bug reports:** [Open an issue](https://github.com/webpeel/webpeel/issues)
- **Feature requests:** [Start a discussion](https://github.com/webpeel/webpeel/discussions)
- **Code:** See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines

The project has a comprehensive test suite. Please add tests for new features.

---

## Star History

<a href="https://star-history.com/#webpeel/webpeel&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=webpeel/webpeel&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=webpeel/webpeel&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=webpeel/webpeel&type=Date" width="600" />
  </picture>
</a>

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and distribute. If you run a modified version as a network service, you must release your source under AGPL-3.0.

Need a commercial license? [support@webpeel.dev](mailto:support@webpeel.dev)

> Versions 0.7.1 and earlier were released under MIT and remain MIT-licensed.

---

<p align="center">
  If WebPeel saves you time, <a href="https://github.com/webpeel/webpeel"><strong>⭐ star the repo</strong></a> — it helps others find it.
</p>

© [WebPeel](https://github.com/webpeel)
