<p align="center">
  <a href="https://webpeel.dev">
    <img src=".github/banner.svg" alt="WebPeel — Web data API for AI agents" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/v/webpeel.svg?style=flat-square" alt="npm version"></a>
  <a href="https://pypi.org/project/webpeel/"><img src="https://img.shields.io/pypi/v/webpeel.svg?style=flat-square" alt="PyPI version"></a>
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/dm/webpeel.svg?style=flat-square" alt="Monthly downloads"></a>
  <a href="https://github.com/webpeel/webpeel/stargazers"><img src="https://img.shields.io/github/stars/webpeel/webpeel.svg?style=flat-square" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-WebPeel%20SDK-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://status.webpeel.dev"><img src="https://img.shields.io/badge/status-operational-brightgreen.svg?style=flat-square" alt="Status"></a>
</p>

<p align="center">
  <strong>The web data API for AI agents.</strong><br>
  Fetch, search, extract, and understand any webpage — with one API call.
</p>

<p align="center">
  <a href="https://webpeel.dev/docs">Docs</a> ·
  <a href="https://app.webpeel.dev">Dashboard</a> ·
  <a href="https://webpeel.dev/docs/api">API Reference</a> ·
  <a href="https://discord.gg/webpeel">Discord</a> ·
  <a href="https://status.webpeel.dev">Status</a>
</p>

---

## Get Started

### Install

```bash
# Node.js / TypeScript
npm install webpeel

# Python
pip install webpeel

# No install — use directly
npx webpeel "https://example.com"
```

### Usage

**TypeScript**
```typescript
import { WebPeel } from 'webpeel';

const wp = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY });
const result = await wp.fetch('https://news.ycombinator.com');
console.log(result.markdown); // Clean, structured content
```

**Python**
```python
from webpeel import WebPeel

wp = WebPeel(api_key=os.environ["WEBPEEL_API_KEY"])
result = wp.fetch("https://news.ycombinator.com")
print(result.markdown)  # Clean, structured content
```

**curl**
```bash
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"
```

[Get your free API key →](https://app.webpeel.dev/signup) · No credit card required · 500 requests/week free

---

## What It Does

| | Capability | Result |
|---|---|---|
| 🌐 | **Fetch** | Any URL → clean markdown or JSON. Handles JavaScript, bot detection, and dynamic content automatically |
| 🔍 | **Search** | Web search with structured results — titles, URLs, snippets, and optional full-page content |
| 📊 | **Extract** | Pull structured data using JSON Schema. Products, pricing, contacts, tables — any pattern |
| 🕷️ | **Crawl** | Map and scrape entire websites with one API call. Follows links, respects robots.txt |
| 🤖 | **MCP** | 18 tools natively available in Claude, Cursor, VS Code, Windsurf, and any MCP-compatible agent |
| 📸 | **Screenshot** | Full-page or viewport screenshots in PNG/JPEG |
| 🎬 | **YouTube** | Video transcripts with timestamps — no YouTube API key required |
| 👁️ | **Monitor** | Watch pages for changes and receive webhook notifications |

---

## Anti-Bot Bypass Stack

WebPeel uses a 4-layer escalation chain to bypass bot protection — all built in-house, no paid proxy services required:

```
1. PeelTLS      — Chrome TLS fingerprint spoofing (in-process Go binary)  ~85% of sites
2. CF Worker    — Cloudflare edge network proxy (different IP reputation)  +5%
3. Google Cache — Cached page copy if available                            +2%
4. Search       — Extract from search engine snippets (last resort)        last resort
```

**For e-commerce sites**, WebPeel uses official APIs before attempting HTML scraping:
- **Best Buy** — Free Products API (50K queries/day). Set `BESTBUY_API_KEY` env var.
- **Walmart** — Frontend API (may be blocked; falls through gracefully)
- **Reddit, GitHub, HN, Wikipedia, YouTube, ArXiv** — Official APIs, always fast

**Self-hosted CF Worker** (100K requests/day free):
```bash
cd worker && npx wrangler deploy
# Then set WEBPEEL_CF_WORKER_URL and WEBPEEL_CF_WORKER_TOKEN env vars
```

---

## Benchmarks

Independent testing across 500 URLs including e-commerce, news, SaaS, and social platforms.

| Metric | **WebPeel** | Firecrawl | Crawl4AI | Jina Reader |
|--------|:-----------:|:---------:|:--------:|:-----------:|
| Success rate (protected sites) | **94%** | 71% | 58% | 49% |
| Median response time | **380ms** | 890ms | 1,240ms | 520ms |
| Content quality score¹ | **0.91** | 0.74 | 0.69 | 0.72 |
| Price per 1,000 requests | **$0.80** | $5.33 | self-host | $1.00 |

¹ Content quality = signal-to-noise ratio (relevant content vs boilerplate), scored 0–1.

> Methodology: Tested Feb 2026. Protected sites = Cloudflare/bot-protected pages. Quality scored by GPT-4o on content relevance and completeness. [Full methodology →](https://webpeel.dev/benchmarks)

---

## Pricing

| Plan | Price | Requests | Features |
|------|-------|----------|----------|
| **Free** | $0/mo | 500/week | Fetch, search, extract, crawl |
| **Pro** | $9/mo | 1,250/week | Everything + protected site access |
| **Max** | $29/mo | 6,250/week | Everything + priority queue |
| **Enterprise** | Custom | Unlimited | SLA, dedicated infra, custom domains |

All plans include: full API access, TypeScript + Python SDKs, MCP server, CLI.  
[See full pricing →](https://webpeel.dev/pricing)

---

## SDK

### TypeScript / Node.js

```typescript
import { WebPeel } from 'webpeel';

const wp = new WebPeel({ apiKey: process.env.WEBPEEL_API_KEY });

// Fetch a page
const page = await wp.fetch('https://stripe.com/pricing', {
  format: 'markdown',  // 'markdown' | 'html' | 'text' | 'json'
});

// Search the web
const results = await wp.search('best vector databases 2025', {
  limit: 5,
  fetchContent: true,  // Optionally fetch full content for each result
});

// Extract structured data
const pricing = await wp.extract('https://stripe.com/pricing', {
  schema: {
    type: 'object',
    properties: {
      plans: {
        type: 'array',
        items: { type: 'object', properties: {
          name: { type: 'string' },
          price: { type: 'string' },
          features: { type: 'array', items: { type: 'string' } }
        }}
      }
    }
  }
});

// Crawl a site
const crawl = await wp.crawl('https://docs.example.com', {
  maxPages: 50,
  maxDepth: 3,
  outputFormat: 'markdown',
});
for await (const page of crawl) {
  console.log(page.url, page.markdown);
}

// Screenshot
const shot = await wp.screenshot('https://webpeel.dev', { fullPage: true });
fs.writeFileSync('screenshot.png', shot.image, 'base64');
```

[Full TypeScript reference →](https://webpeel.dev/docs/sdk/typescript)

### Python

```python
from webpeel import WebPeel
import os

wp = WebPeel(api_key=os.environ["WEBPEEL_API_KEY"])

# Fetch a page
page = wp.fetch("https://stripe.com/pricing", format="markdown")
print(page.markdown)

# Search
results = wp.search("best vector databases 2025", limit=5)
for r in results:
    print(r.title, r.url)

# Extract structured data
pricing = wp.extract("https://stripe.com/pricing", schema={
    "type": "object",
    "properties": {
        "plans": {
            "type": "array",
            "items": { "type": "object", "properties": {
                "name": { "type": "string" },
                "price": { "type": "string" }
            }}
        }
    }
})

# Async client
from webpeel import AsyncWebPeel
import asyncio

async def main():
    wp = AsyncWebPeel(api_key=os.environ["WEBPEEL_API_KEY"])
    results = await asyncio.gather(
        wp.fetch("https://site1.com"),
        wp.fetch("https://site2.com"),
        wp.fetch("https://site3.com"),
    )

asyncio.run(main())
```

[Full Python reference →](https://webpeel.dev/docs/sdk/python)

### MCP — For AI Agents

Give Claude, Cursor, or any MCP-compatible agent the ability to browse the web.

**Claude Desktop** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

**Cursor / VS Code** (`.cursor/mcp.json` or `.vscode/mcp.json`):
```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

Available MCP tools: `fetch`, `search`, `extract`, `crawl`, `screenshot`, `youtube_transcript`, `monitor_start`, `monitor_stop`, `monitor_list`, `batch_fetch`, `map_site`, `diff`, `summarize`, `qa`, `pdf`, `reddit`, `twitter`, `github` — 18 tools total.

[![Install in Claude Desktop](https://img.shields.io/badge/Install-Claude%20Desktop-5B3FFF?style=for-the-badge&logo=anthropic)](https://mcp.so/install/webpeel?for=claude)
[![Install in VS Code](https://img.shields.io/badge/Install-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode)](https://mcp.so/install/webpeel?for=vscode)

[MCP setup guide →](https://webpeel.dev/docs/mcp)

### CLI

```bash
# Install globally
npm install -g webpeel

# Fetch a page (outputs clean markdown)
webpeel "https://news.ycombinator.com"

# Search the web
webpeel search "typescript orm comparison 2025"

# Extract structured data
webpeel extract "https://stripe.com/pricing" --schema pricing-schema.json

# Crawl a site, save to folder
webpeel crawl "https://docs.example.com" --output ./docs-dump --max-pages 100

# Screenshot
webpeel screenshot "https://webpeel.dev" --full-page --output screenshot.png

# YouTube transcript
webpeel youtube "https://youtube.com/watch?v=dQw4w9WgXcQ"

# Ask a question about a page
webpeel qa "https://openai.com/pricing" --question "How much does GPT-4o cost per million tokens?"

# Output as JSON
webpeel "https://example.com" --json
```

---

## API Reference

Base URL: `https://api.webpeel.dev/v1`

```bash
# Fetch
GET /fetch?url=<url>&format=markdown

# Search
GET /search?q=<query>&limit=10

# Extract
POST /extract
{ "url": "...", "schema": { ... } }

# Crawl
POST /crawl
{ "url": "...", "maxPages": 50, "maxDepth": 3 }

# Screenshot
GET /screenshot?url=<url>&fullPage=true

# YouTube transcript
GET /youtube?url=<youtube_url>
```

All endpoints require `Authorization: Bearer wp_YOUR_KEY`.

[Full API reference →](https://webpeel.dev/docs/api)

---

## Links

- 📖 [Documentation](https://webpeel.dev/docs) — Guides, references, and examples
- 🚀 [Dashboard](https://app.webpeel.dev) — Manage your API keys and usage
- 🔌 [API Reference](https://webpeel.dev/docs/api) — Full endpoint documentation
- 💬 [Discord](https://discord.gg/webpeel) — Community and support
- 📊 [Status](https://status.webpeel.dev) — Uptime and incidents
- 💰 [Pricing](https://webpeel.dev/pricing) — Plans and limits
- 📈 [Benchmarks](https://webpeel.dev/benchmarks) — How we compare

---

<p align="center">
  <a href="https://app.webpeel.dev/signup">Get started free →</a>
</p>
