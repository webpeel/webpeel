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
  <strong>Web intelligence for AI agents.</strong><br>
  Fetch any URL → clean markdown. YouTube transcripts. Reddit threads. Quick answers. No API keys needed.
</p>

<p align="center">
  <a href="https://webpeel.dev">Website</a> ·
  <a href="https://webpeel.dev/docs">Docs</a> ·
  <a href="https://webpeel.dev/playground">Playground</a> ·
  <a href="https://app.webpeel.dev">Dashboard</a> ·
  <a href="https://github.com/webpeel/webpeel/discussions">Discussions</a>
</p>

---

> **WebPeel** gives AI agents reliable web access in one call. It handles JavaScript rendering, bot detection, and content extraction automatically — your agent gets clean, structured data. 18 MCP tools, 927 tests, 100% open source.

---

## 🚀 Quick Start

```bash
npx webpeel "https://example.com"
```

**More examples:**

```bash
# YouTube transcript — no API key!
npx webpeel "https://youtube.com/watch?v=dQw4w9WgXcQ"

# Ask any page a question — no LLM key!
npx webpeel "https://openai.com/pricing" -q "how much does GPT-4 cost?"

# Reddit thread — structured JSON
npx webpeel "https://reddit.com/r/programming/comments/..." --json

# Reader mode — strips all noise
npx webpeel "https://nytimes.com/article" --readable
```

No install needed. First 25 fetches work without signup. [Get 500/week free →](https://app.webpeel.dev/signup)

### MCP Server (for Claude, Cursor, VS Code, Windsurf)

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

## ✨ What can it do?

| | Feature | What you get |
|---|---------|-------------|
| 🌐 | **Fetch** | Any URL → clean markdown, text, or JSON. Auto-handles JS rendering, bot detection, CAPTCHAs |
| 🎬 | **YouTube** | Full video transcripts with timestamps. No API key |
| 🐦 | **Twitter/Reddit/GitHub/HN** | Structured data from social platforms via native APIs |
| ❓ | **Quick Answer** | Ask a question about any page. BM25 scoring, no LLM key |
| 📖 | **Reader Mode** | Browser Reader Mode for AI — strips nav, ads, cookies, 25+ noise patterns |
| 🔍 | **Search** | Web search across 27+ sites. Deep research with multi-hop analysis |
| 📊 | **Extract** | Pricing pages, products, contacts → structured JSON. CSS/JSON Schema/LLM extraction |
| 🕵️ | **Stealth** | Bypasses Cloudflare, PerimeterX, DataDome, Akamai. 28 auto-stealth domains |
| 🏨 | **Hotels** | Kayak + Booking + Google Travel + Expedia in parallel |
| 🔄 | **Monitor** | Watch URLs for changes, get webhook notifications |
| 🕷️ | **Crawl** | BFS/DFS site crawling, sitemap discovery, robots.txt compliance |
| 📸 | **Screenshot** | Full-page or viewport screenshots |
| 🐍 | **Python SDK** | `pip install webpeel` — sync + async client |

---

## 🏆 How does it compare?

| Feature | WebPeel | Firecrawl | Crawl4AI | Jina Reader |
|---------|:-------:|:---------:|:--------:|:-----------:|
| YouTube transcripts | ✅ | ❌ | ❌ | ❌ |
| LLM-free Q&A | ✅ | ❌ | ❌ | ❌ |
| Reader mode | ✅ | ❌ | ❌ | ❌ |
| Domain extractors (Twitter, Reddit, GH, HN) | ✅ | ❌ | ❌ | ❌ |
| Auto-extract (pricing, products) | ✅ | ❌ | ❌ | ❌ |
| URL monitoring | ✅ | ❌ | ❌ | ❌ |
| Stealth / anti-bot | ✅ | ⚡ Hosted only | ✅ | ❌ |
| MCP server | ✅ 18 tools | ✅ 4 tools | ❌ | ❌ |
| Deep research | ✅ | ❌ | ❌ | ❌ |
| Hotel search | ✅ | ❌ | ❌ | ❌ |
| Self-hostable | ✅ | ✅ | ✅ | ❌ |
| Free tier | 500/week | 500 credits | Unlimited | Unlimited |
| Open source | AGPL-3.0 | AGPL-3.0 | Apache-2.0 | N/A |

---

## ⚡ Benchmark

Evaluated on 30 real-world URLs across 6 categories (static, dynamic, SPA, protected, documents, international):

| | WebPeel | Next best |
|---|:---:|:---:|
| **Success rate** | **100%** (30/30) | 93.3% |
| **Content quality** | **92.3%** | 83.2% |

WebPeel is the only tool that extracted content from all 30 test URLs. [Full methodology →](https://webpeel.dev/blog/benchmarks)

---

## 🤖 MCP Integration

WebPeel exposes **18 tools** to your AI coding assistant:

| Tool | What it does |
|------|--------------|
| `webpeel_fetch` | Fetch any URL → markdown. Smart escalation built in. Supports `readable: true` for reader mode |
| `webpeel_search` | Web search with structured results across 27+ sources |
| `webpeel_batch` | Fetch multiple URLs concurrently |
| `webpeel_crawl` | Crawl a site with depth/page limits |
| `webpeel_map` | Discover all URLs on a domain |
| `webpeel_extract` | Structured extraction (CSS, JSON Schema, or LLM) |
| `webpeel_screenshot` | Screenshot any page (full-page or viewport) |
| `webpeel_research` | Deep multi-hop research on a topic |
| `webpeel_summarize` | AI summary of any URL |
| `webpeel_answer` | Ask a question about a URL's content |
| `webpeel_change_track` | Detect changes between two fetches |
| `webpeel_brand` | Extract branding assets from a site |
| `webpeel_deep_fetch` | Search + batch fetch + merge — comprehensive research, no LLM key |
| `webpeel_youtube` | Extract YouTube video transcripts — all URL formats, no API key |
| `webpeel_auto_extract` | Heuristic structured data extraction — auto-detects pricing, products, contacts |
| `webpeel_quick_answer` | BM25-powered Q&A — ask any question about any page, no LLM key |
| `webpeel_watch` | Persistent URL change monitoring with webhook notifications |
| `webpeel_hotels` | Hotel search across Kayak, Booking.com, Google Travel, Expedia in parallel |

<details>
<summary>Setup for Claude Desktop, Cursor, VS Code, Windsurf, Docker</summary>

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

**Hosted endpoint** (no local server needed):
```json
{
  "mcpServers": {
    "webpeel": {
      "url": "https://api.webpeel.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
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

Search → fetch top results → extract key passages (BM25) → follow the most relevant links → synthesize. No circular references, no duplicate content.

---

## 📦 Extraction

<details>
<summary>CSS Schema, JSON Schema, and LLM extraction — click to expand</summary>

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

```typescript
import { peel } from 'webpeel';

// CSS selector extraction
const result = await peel('https://news.ycombinator.com', {
  extract: { selectors: { titles: '.titleline > a', scores: '.score' } }
});

// LLM extraction with JSON Schema
const product = await peel('https://example.com/product', {
  llmExtract: 'title, price, rating, availability',
  llmKey: process.env.OPENAI_API_KEY,
});
```
</details>

---

## 🛡️ Stealth & Anti-Bot

<details>
<summary>Supported bot-protection vendors and auto-stealth domains — click to expand</summary>

WebPeel detects 7 bot-protection vendors automatically:

- **Cloudflare** (JS challenge, Turnstile, Bot Management)
- **PerimeterX / HUMAN** (behavioral analysis)
- **DataDome** (ML-based bot detection)
- **Akamai Bot Manager**
- **Distil Networks**
- **reCAPTCHA / hCaptcha**
- **Generic challenge pages**

28 high-protection domains (Amazon, LinkedIn, Glassdoor, Zillow, Ticketmaster, and more) automatically route through stealth mode — no flags needed.

```bash
# Explicitly enable stealth
npx webpeel "https://glassdoor.com/jobs" --stealth

# Auto-escalation (stealth triggers automatically on challenge detection)
npx webpeel "https://amazon.com/dp/ASIN"
```
</details>

---

## 🏨 Hotel Search

<details>
<summary>Multi-source hotel search — click to expand</summary>

Search Kayak, Booking.com, Google Travel, and Expedia in parallel — returns unified results in one call.

```bash
npx webpeel hotels "Paris" --check-in 2025-06-01 --check-out 2025-06-07 --guests 2 --json
```

Available as `webpeel_hotels` MCP tool and via the REST API.
</details>

---

## 💳 Pricing

| Plan | Price | Weekly Fetches | Burst |
|------|------:|:--------------:|:-----:|
| **Free** | $0/mo | 500/wk | 50/hr |
| **Pro** | $9/mo | 1,250/wk | 100/hr |
| **Max** | $29/mo | 6,250/wk | 500/hr |

All features on all plans. Pro/Max add pay-as-you-go extra usage. Quota resets every Monday.

[Sign up free →](https://app.webpeel.dev/signup) · [Compare with Firecrawl →](https://webpeel.dev/migrate-from-firecrawl)

---

## 🐍 Python SDK

<details>
<summary>Python SDK usage — click to expand</summary>

```bash
pip install webpeel
```

```python
from webpeel import WebPeel

client = WebPeel(api_key="wp_...")  # or WEBPEEL_API_KEY env var

result = client.scrape("https://example.com")
print(result.content)    # Clean markdown
print(result.metadata)   # title, description, author, ...

results = client.search("latest AI research papers")
job = client.crawl("https://docs.example.com", limit=100)
result = client.scrape("https://protected-site.com", render=True, stealth=True)
```

Sync and async clients. Pure Python 3.8+, zero dependencies. [Full SDK docs →](python-sdk/README.md)
</details>

---

## 🐳 Self-Hosting

```bash
git clone https://github.com/webpeel/webpeel.git
cd webpeel && docker compose up
```

Full REST API at `http://localhost:3000`. AGPL-3.0 licensed. [Self-hosting guide →](SELF_HOST.md)

```bash
docker run -i webpeel/mcp          # MCP server only
docker run -p 3000:3000 webpeel/api  # API server only
```

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

The project has 927 tests. Please add tests for new features.

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
