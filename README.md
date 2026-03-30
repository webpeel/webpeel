<p align="center">
  <a href="https://webpeel.dev">
    <img src=".github/banner.svg" alt="WebPeel — Web data API for AI agents" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/v/webpeel.svg?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/dm/webpeel.svg?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/webpeel/webpeel/stargazers"><img src="https://img.shields.io/github/stars/webpeel/webpeel?style=flat-square" alt="GitHub stars"></a>
  <a href="https://github.com/webpeel/webpeel/actions/workflows/ci.yml"><img src="https://github.com/webpeel/webpeel/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-WebPeel%20SDK-blue.svg?style=flat-square" alt="License"></a>
</p>

<h3 align="center">The web data layer for AI agents.<br>Fetch, search, crawl, extract, screenshot — one call, zero boilerplate.</h3>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#agent-native-integrations">Agent Integrations</a> ·
  <a href="https://webpeel.dev/docs">Docs</a> ·
  <a href="https://webpeel.dev/playground">Playground</a> ·
  <a href="https://app.webpeel.dev/signup">Get API Key</a>
</p>

<p align="center">
  <img src=".github/readme-demo.svg" alt="WebPeel demo showing agent-friendly web fetch input, automatic engine selection, and clean JSON output" width="100%">
</p>

---

## The Problem

Every AI agent that touches the web rebuilds the same brittle stack: HTTP fetch → headless browser → anti-bot bypass → HTML cleanup → markdown conversion → token budgeting. Each layer fails differently. Sites change. Cloudflare rotates challenges. Your agent gets empty strings at 2 AM and your pipeline breaks.

**WebPeel replaces that entire stack with one function call.** It handles engine selection, anti-bot escalation, domain-specific extraction, and token optimization so your agent gets clean, structured data every time — without managing browsers, proxies, or parsing logic.

---

## Quick Start

```bash
# Zero-install — just run it
npx webpeel "https://example.com"

# Search the web
npx webpeel search "latest AI agent frameworks"

# Crawl an entire site
npx webpeel crawl docs.example.com --max-pages 50

# Screenshot any page
npx webpeel screenshot "https://stripe.com/pricing" --full-page

# Ask a question about any page
npx webpeel ask "https://arxiv.org/abs/2401.00001" "What is the main contribution?"
```

Or install globally:

```bash
npm install -g webpeel
```

**Use as a library:**

```typescript
import { peel } from 'webpeel';

const result = await peel('https://news.ycombinator.com');
console.log(result.markdown);   // Clean markdown, ready for your LLM
console.log(result.metadata);   // Title, tokens saved, timing, etc.
```

**Use via API:**

```bash
curl "https://api.webpeel.dev/v1/fetch?url=https://stripe.com/pricing" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"
```

```json
{
  "url": "https://stripe.com/pricing",
  "markdown": "# Stripe Pricing\n\n**Integrated per-transaction fees**...",
  "metadata": {
    "title": "Pricing & Fees | Stripe",
    "tokens": 420,
    "tokensOriginal": 8200,
    "savingsPct": 94.9
  }
}
```

[Get your free API key →](https://app.webpeel.dev/signup) · No credit card required · 500 requests/week free

---

## Hosted deployment

A hosted deployment is available on [Fronteir AI](https://fronteir.ai/mcp/webpeel-webpeel).

## Why WebPeel

### 🧠 55+ Domain Extractors — Not Just HTML-to-Markdown

Generic scrapers convert raw HTML to markdown and call it a day. WebPeel has **purpose-built extractors** for 55+ domains — Reddit, GitHub, YouTube, Amazon, ArXiv, Hacker News, Wikipedia, StackOverflow, Zillow, Polymarket, ESPN, and more. Each extractor understands the site's structure and returns clean, structured data without browser rendering.

### ⚡ 65–98% Token Savings

Domain extractors strip navigation, ads, sidebars, and boilerplate *before* content reaches your agent. Less context consumed = lower costs, faster inference, and longer agent chains.

| Site | Raw HTML tokens | WebPeel tokens | Savings |
|------|:--------------:|:--------------:|:-------:|
| News article | 18,000 | 640 | **96%** |
| Reddit thread | 24,000 | 890 | **96%** |
| Wikipedia page | 31,000 | 2,100 | **93%** |
| GitHub README | 5,200 | 1,800 | **65%** |
| E-commerce product | 14,000 | 310 | **98%** |

### 🔄 6-Layer Engine Escalation

WebPeel doesn't just try one method — it automatically escalates through 6 engines until it gets a good result:

```
Simple HTTP → Domain API → Browser render → Stealth browser → Cloaked browser → Search cache fallback
```

No manual `--render` flags for most sites. WebPeel knows which sites need JavaScript, which need stealth, and which have anti-bot protection — and picks the right engine automatically.

### 🔌 Firecrawl-Compatible Migration Path

Already using Firecrawl-style workflows? WebPeel supports compatible `/v1/scrape`, `/v2/scrape`, `/v1/crawl`, `/v1/search`, and `/v1/map` endpoints, which makes migration dramatically easier than rebuilding your pipeline from scratch.

---

## Agent-Native Integrations

### MCP Server (Claude, Cursor, Windsurf, VS Code)

Give any MCP-compatible AI the ability to browse, search, and extract from the web.

```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": { "WEBPEEL_API_KEY": "wp_your_key_here" }
    }
  }
}
```

**7 MCP tools exposed:** `webpeel_read` · `webpeel_find` · `webpeel_see` · `webpeel_extract` · `webpeel_monitor` · `webpeel_act` · `webpeel_crawl`

[Full MCP setup guide →](https://webpeel.dev/docs/mcp)

### LangChain

```typescript
import { WebPeelLoader } from 'webpeel/integrations/langchain';

const loader = new WebPeelLoader({ url: 'https://example.com', render: true });
const docs = await loader.load();
```

### LlamaIndex

```typescript
import { WebPeelReader } from 'webpeel/integrations/llamaindex';

const reader = new WebPeelReader();
const docs = await reader.loadData('https://example.com');
```

### Python SDK

```bash
pip install webpeel
```

```python
from webpeel import WebPeel

wp = WebPeel(api_key="wp_...")
result = wp.fetch("https://example.com")
print(result.markdown)
```

---

## Full Feature Set

| Capability | CLI | API | Details |
|-----------|:---:|:---:|---------|
| **Fetch & extract** | `webpeel "url"` | `GET /v1/fetch` | Clean markdown from any URL |
| **Web search** | `webpeel search "query"` | `GET /v1/search` | DuckDuckGo (free) or Brave (BYOK) |
| **Smart search** | — | `POST /v1/search/smart` | AI-powered structured results |
| **Crawl sites** | `webpeel crawl "url"` | `POST /v1/crawl` | Depth/page limits, rate control |
| **Screenshots** | `webpeel screenshot "url"` | `POST /v1/screenshot` | Full-page, multi-viewport, visual diff, filmstrip |
| **Structured extraction** | `--extract-schema` | `POST /v1/extract` | JSON schema → structured data |
| **Q&A** | `webpeel ask "url" "q"` | `POST /v1/answer` | Answer questions about any page |
| **Deep research** | — | `POST /v1/deep-research` | Multi-query autonomous research |
| **Content monitoring** | `webpeel monitor "url"` | `POST /v1/watch` | Change detection with webhooks |
| **Browser sessions** | — | `POST /v1/session` | Persistent sessions for login flows |
| **Browser actions** | `--action 'click:.btn'` | actions field | Click, type, scroll, wait |
| **Batch scrape** | `webpeel batch file` | `POST /v1/batch/scrape` | Parallel multi-URL processing |
| **URL discovery** | `webpeel map "url"` | `POST /v1/map` | Sitemap and link discovery |
| **YouTube transcripts** | auto-detected | auto-detected | Multiple export formats |
| **PDF extraction** | auto-detected | auto-detected | Text, tables, structure |
| **Research agent** | — | `POST /v1/agent` | Autonomous multi-step research |

---

## Use Cases for Agent Builders

**RAG pipelines** — Fetch docs, articles, or entire sites as clean markdown ready for chunking, embedding, and retrieval.

**Price monitoring** — Track product pages across major commerce sites with structured extraction and change detection.

**Competitive intel** — Monitor competitor pages, pricing tables, and job boards. Visual diff screenshots catch layout changes CSS selectors would miss.

**Research agents** — Give Claude, Codex, Cursor, or your own agent grounded web access through the API or MCP server.

**Lead enrichment** — Pull company details, public links, and page structure from business sites without writing per-site parsers.

**Content aggregation** — Crawl and extract from communities, docs sites, and publications with domain-native extractors that understand each site's structure.

---

## Architecture

```
Your Agent
    ↓
 WebPeel (npm / API / MCP)
    ↓
┌─────────────────────────────────┐
│  Engine Ranker                  │
│  HTTP → Domain API → Browser   │
│  → Stealth → Cloaked → Cache   │
├─────────────────────────────────┤
│  55+ Domain Extractors          │
│  reddit · github · youtube      │
│  amazon · arxiv · zillow · ...  │
├─────────────────────────────────┤
│  Content Pipeline               │
│  Readability → Turndown →       │
│  Token budgeting → Chunking     │
└─────────────────────────────────┘
    ↓
 Clean markdown / structured JSON
```

---

## Reliability

WebPeel is built for production agent workflows, not just one-off demos.

- **Automated evals in-repo** — smart search and fetch eval suites ship with the codebase
- **Post-deploy gate** — critical checks run before calling a deploy healthy
- **Engine fallback chain** — when one fetch method fails, WebPeel escalates instead of giving up
- **Multiple surfaces, one core** — CLI, API, SDK, and MCP all ride the same extraction pipeline

---

## Security

- **SSRF protection** — blocks localhost, private IPs, metadata endpoints, `file://` schemes
- **Helmet.js** — HSTS, X-Frame-Options, nosniff, XSS protection on all responses
- **Webhook signing** — HMAC-SHA256 on all outbound webhooks
- **API key hashing** — SHA-256 with granular scopes
- **Rate limiting** — sliding window, per-tier
- **Audit logging** — every API call logged with IP, key, and action
- **GDPR compliant** — `DELETE /v1/account` for full data erasure
[Security policy →](https://webpeel.dev/security) · [SLA (99.9% uptime) →](https://webpeel.dev/sla)

---

## Why teams choose WebPeel instead of stitching a stack together

| Approach | What it gives you | Where it breaks down |
|---|---|---|
| Raw HTTP + HTML parsing | Cheap, simple fetches | Falls apart on JS-heavy sites, anti-bot pages, and noisy HTML |
| Pure browser automation | Maximum control | Expensive, slow, fragile, and high-maintenance for large-scale use |
| Search-only APIs | Great discovery | Weak page extraction, limited structured output, limited downstream actions |
| Single-purpose scrapers | Fast on one job | You end up composing 4–6 tools for real agent workflows |
| **WebPeel** | Fetch + search + crawl + extraction + screenshots + monitoring in one layer | Opinionated toward agent workflows rather than generic scraping |

---

## Links

📖 [Documentation](https://webpeel.dev/docs) · 💰 [Pricing](https://webpeel.dev/pricing) · 🎮 [Playground](https://webpeel.dev/playground) · 📝 [Blog](https://webpeel.dev/blog) · 💬 [Discussions](https://github.com/webpeel/webpeel/discussions) · 🚀 [Releases](https://github.com/webpeel/webpeel/releases) · 📊 [Status](https://webpeel.dev/status) · 🔒 [Security](https://webpeel.dev/security) · 📋 [Changelog](https://webpeel.dev/changelog)

---

## Contributing

Pull requests welcome. Please open an issue first to discuss major changes.

```bash
git clone https://github.com/webpeel/webpeel.git
cd webpeel && npm install
npm run build && npm test
```

---

## License

[WebPeel SDK License](LICENSE) — free for personal and commercial use with attribution.

<p align="center">
  <a href="https://app.webpeel.dev/signup"><strong>Get started free →</strong></a>
</p>
