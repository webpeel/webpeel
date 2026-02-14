# WebPeel

[![npm version](https://img.shields.io/npm/v/webpeel.svg)](https://www.npmjs.com/package/webpeel)
[![PyPI version](https://img.shields.io/pypi/v/webpeel.svg)](https://pypi.org/project/webpeel/)
[![npm downloads](https://img.shields.io/npm/dm/webpeel.svg)](https://www.npmjs.com/package/webpeel)
[![GitHub stars](https://img.shields.io/github/stars/JakeLiuMe/webpeel.svg)](https://github.com/JakeLiuMe/webpeel/stargazers)
[![CI](https://github.com/JakeLiuMe/webpeel/actions/workflows/ci.yml/badge.svg)](https://github.com/JakeLiuMe/webpeel/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Turn any web page into AI-ready markdown. Smart escalation. Stealth mode. Autonomous agent. Free to start.**

```bash
npx webpeel https://news.ycombinator.com
```

**Output:**
```markdown
# Hacker News

**New** | **Past** | **Comments** | **Ask** | **Show** | **Jobs** | **Submit**

## Top Stories

1. **Show HN: WebPeel – Turn any webpage into AI-ready markdown**
   [https://github.com/JakeLiuMe/webpeel](https://github.com/JakeLiuMe/webpeel)
   142 points by jakeliu 2 hours ago | 31 comments

2. **The End of the API Era**
   ...
```

---

## Why WebPeel?

| Feature | **WebPeel** | Firecrawl | Jina Reader | MCP Fetch |
|---------|:-----------:|:---------:|:-----------:|:---------:|
| **Free tier** | ✅ **125/wk recurring** | 500 one-time | ❌ Cloud only | ✅ Unlimited |
| **Smart escalation** | ✅ **HTTP→Browser→Stealth** | Manual mode | ❌ No | ❌ No |
| **Stealth mode** | ✅ All plans | ✅ Yes | ⚠️ Limited | ❌ No |
| **Firecrawl-compatible API** | ✅ **YES (only us!)** | ✅ Native | ❌ No | ❌ No |
| **Self-hosting** | ✅ **Docker compose** | ⚠️ Complex | ❌ No | N/A |
| **Autonomous agent** | ✅ **BYOK any LLM** | ⚠️ Locked to Spark | ❌ No | ❌ No |
| **MCP tools** | ✅ **9 tools** | 3 tools | 0 tools | 1 tool |
| **Python SDK** | ✅ **Zero-dep** | Requires requests | N/A | N/A |
| **License** | ✅ **MIT** | AGPL-3.0 | Proprietary | MIT |
| **Interactive playground** | ✅ **No signup** | Requires signup | ❌ No | ❌ No |
| **Pricing** | **Free/$9/$29** | $0/$16/$83 | Custom | Free |

**WebPeel is the only Firecrawl-compatible alternative with a generous free tier and MIT license.**

---

## Quick Start

### CLI (Zero Install)

```bash
# First 25 fetches work instantly, no signup
npx webpeel https://example.com

# After 25 fetches, sign up for free (125/week)
webpeel login

# Stealth mode (bypass bot detection)
npx webpeel https://protected-site.com --stealth

# Autonomous agent — just give a prompt (BYOK LLM)
npx webpeel agent "Find the founders of Stripe" --llm-key sk-...

# Crawl a website (follow links, respect robots.txt)
npx webpeel crawl https://example.com --max-pages 20

# Search the web
npx webpeel search "best AI frameworks 2026"

# Extract structured data
npx webpeel https://example.com --extract '{"title": "h1", "price": ".price"}'

# Get branding/design system
npx webpeel brand https://stripe.com

# Track content changes
npx webpeel track https://example.com/pricing
```

### Node.js Library

```bash
npm install webpeel
```

```typescript
import { peel } from 'webpeel';

// Simple usage
const result = await peel('https://example.com');
console.log(result.content);    // Clean markdown
console.log(result.metadata);   // { title, description, author, ... }
console.log(result.tokens);     // Estimated token count

// With options
const advanced = await peel('https://example.com', {
  render: true,           // Use browser for JS-heavy sites
  stealth: true,          // Anti-bot stealth mode
  screenshot: true,       // Capture screenshot
  maxTokens: 4000,        // Limit output tokens
  images: true,           // Extract image URLs
  includeTags: ['main'],  // Filter to specific HTML tags
});
```

### Python SDK

```bash
pip install webpeel
```

```python
from webpeel import WebPeel

client = WebPeel()  # Free tier, no API key needed

# Scrape
result = client.scrape("https://example.com")
print(result.content)  # Clean markdown

# Search
results = client.search("python web scraping")

# Crawl (async job)
job = client.crawl("https://docs.example.com", limit=100)
status = client.get_job(job.id)
```

**Zero dependencies. Pure Python 3.8+ stdlib.** [Full docs →](python-sdk/README.md)

### MCP Server (Claude Desktop, Cursor, Windsurf, VS Code)

WebPeel provides **9 MCP tools** for AI agents:

- `webpeel_fetch` — Fetch any URL as clean markdown
- `webpeel_search` — Search the web
- `webpeel_crawl` — Crawl websites
- `webpeel_map` — Discover all URLs on a domain
- `webpeel_extract` — Extract structured data
- `webpeel_batch` — Batch fetch multiple URLs
- `webpeel_agent` — Autonomous web research (BYOK LLM)
- `webpeel_summarize` — AI-powered summarization
- `webpeel_brand` — Extract branding/design system

**Claude Desktop** — Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

**Cursor** — Add to Settings → MCP Servers:

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

**VS Code** (with Cline or other MCP clients) — Create `~/.vscode/mcp.json`:

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

**Windsurf** — Add to `~/.codeium/windsurf/mcp_config.json`:

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

Or install with one click:

[![Install in Claude Desktop](https://img.shields.io/badge/Install-Claude%20Desktop-5B3FFF?style=for-the-badge&logo=anthropic)](https://mcp.so/install/webpeel?for=claude)
[![Install in VS Code](https://img.shields.io/badge/Install-VS%20Code-007ACC?style=for-the-badge&logo=visualstudiocode)](https://mcp.so/install/webpeel?for=vscode)

### Docker (Self-Hosted)

```bash
# Clone the repo
git clone https://github.com/JakeLiuMe/webpeel.git
cd webpeel

# Start with Docker Compose
docker compose up
```

Your API will be available at `http://localhost:3000` with all features included.

---

## Features

### 🎯 Smart Escalation

WebPeel automatically tries the fastest method first, then escalates only when needed:

```
HTTP Fetch (200ms)  →  Browser Rendering (2s)  →  Stealth Mode (5s)
     80% of sites           15% of sites           5% of sites
```

No configuration needed — it just works.

```typescript
import { peel } from 'webpeel';

// Automatically escalates if needed
const result = await peel('https://protected-site.com');
console.log(result.method); // 'simple', 'browser', or 'stealth'
```

### 🎭 Stealth Mode

Bypass bot detection and Cloudflare protection using playwright-extra stealth plugin.

```bash
# CLI
npx webpeel https://protected-site.com --stealth
```

```typescript
// Library
const result = await peel('https://protected-site.com', { stealth: true });
```

Masks browser fingerprints, navigator properties, WebGL vendor, and more.

### 🕷️ Crawl & Map

Crawl entire websites or discover all URLs on a domain.

```bash
# Crawl with link following
npx webpeel crawl https://docs.example.com --max-pages 100 --max-depth 3

# Sitemap-first crawl (faster, more comprehensive)
npx webpeel crawl https://example.com --sitemap-first

# Discover all URLs (sitemap + link crawling)
npx webpeel map https://example.com --max-urls 5000
```

```typescript
import { crawl, mapDomain } from 'webpeel';

// Crawl with progress tracking
const pages = await crawl('https://docs.example.com', {
  limit: 100,
  maxDepth: 3,
  onProgress: (progress) => {
    console.log(`${progress.completed}/${progress.total} pages`);
  },
});

// Discover all URLs
const urls = await mapDomain('https://example.com', { limit: 5000 });
console.log(urls.map(u => u.url)); // Array of all discovered URLs
```

Respects `robots.txt`, honors crawl delays, and includes content deduplication.

### 🔍 Search

Search the web via DuckDuckGo with optional auto-scrape of results.

```bash
# CLI
npx webpeel search "latest AI news"
npx webpeel search "machine learning frameworks" --limit 20
```

```bash
# API
curl "https://api.webpeel.dev/v1/search?q=AI+frameworks&limit=10"
```

Supports time filters, categories (news, github, pdf), and geo-targeting.

### 🤖 Autonomous Agent (BYOK)

**v0.6.0**: Give WebPeel a prompt and let it research the web autonomously using your own LLM.

```bash
# CLI with any OpenAI-compatible LLM
npx webpeel agent "Find the pricing plans for Notion" --llm-key sk-...
npx webpeel agent "Who are the founders of Stripe?" --llm-model gpt-4o
```

```typescript
import { runAgent } from 'webpeel';

const result = await runAgent({
  prompt: 'Find the pricing plans for Notion',
  llmApiKey: 'sk-...',           // OpenAI, Anthropic proxy, or local
  llmModel: 'gpt-4o-mini',
  maxIterations: 10,
});

console.log(result.answer);      // Compiled research answer
console.log(result.sources);     // URLs used
console.log(result.iterations);  // Research steps taken
```

**BYOK = Bring Your Own Key.** Works with OpenAI, Anthropic (via proxy), local models, or any OpenAI-compatible API.

### 📊 Structured Extraction

Extract structured data using CSS selectors or AI-powered extraction.

```bash
# CSS-based extraction
npx webpeel https://example.com --extract '{"title": "h1", "price": ".price", "description": ".desc"}'
```

```typescript
import { peel } from 'webpeel';

// CSS selectors
const result = await peel('https://example.com', {
  extract: {
    selectors: {
      title: 'h1',
      price: '.price',
      description: '.desc',
    },
  },
});
console.log(result.extracted); // { title: '...', price: '...', ... }

// AI-powered extraction (BYOK)
const aiExtract = await peel('https://example.com', {
  extract: {
    prompt: 'Extract all product names and prices',
    llmApiKey: 'sk-...',
  },
});
console.log(aiExtract.extracted);
```

### 📸 Screenshots

Capture full-page or viewport screenshots as base64 PNG.

```bash
# CLI
npx webpeel https://example.com --screenshot
npx webpeel https://example.com --screenshot --screenshot-full-page
```

```typescript
const result = await peel('https://example.com', {
  screenshot: true,
  screenshotFullPage: true,
});
console.log(result.screenshot); // Base64 PNG string
```

### 🎨 Branding Extraction

**v0.5.0**: Extract complete design systems from any website — colors, fonts, typography, spacing, CSS variables, logo, favicon.

```bash
# CLI
npx webpeel brand https://stripe.com
```

```typescript
import { extractBranding } from 'webpeel';

const brand = await extractBranding('https://stripe.com');
console.log(brand.colors);      // Primary, secondary, accent, etc.
console.log(brand.fonts);       // Font families used
console.log(brand.typography);  // Headings, body text styles
console.log(brand.logo);        // Logo URL
console.log(brand.favicon);     // Favicon URL
console.log(brand.cssVariables); // CSS custom properties
```

Perfect for competitive analysis, design inspiration, or building style guides.

### 🔄 Change Tracking

**v0.5.0**: Track content changes over time with local snapshots and unified diff output.

```bash
# CLI
npx webpeel track https://example.com/pricing
```

```typescript
import { trackChange } from 'webpeel';

const result = await trackChange('https://example.com/pricing');
console.log(result.changeStatus); // 'new', 'same', 'changed', or 'removed'
console.log(result.diff);         // Unified diff if changed
console.log(result.previousSnapshot); // Previous content
```

Snapshots stored in `~/.webpeel/snapshots/` — fully local, no server needed.

### 🎯 Token Budget

Intelligently truncate output to fit within LLM context limits.

```bash
# CLI
npx webpeel https://example.com --max-tokens 4000
```

```typescript
const result = await peel('https://example.com', { maxTokens: 4000 });
console.log(result.tokens); // Will be ≤ 4000
```

Uses tiktoken for accurate token estimation, preserves markdown structure while truncating.

### 🏷️ Tag Filtering

**v0.6.0**: Include/exclude specific HTML tags for fine-grained content control.

```bash
# CLI
npx webpeel https://example.com --include-tags article,main,section
npx webpeel https://example.com --exclude-tags nav,footer,aside
npx webpeel https://example.com --only-main-content  # Shortcut for main content
```

```typescript
const result = await peel('https://example.com', {
  includeTags: ['article', 'main'],
  excludeTags: ['nav', 'footer'],
});
```

Removes navigation, footers, sidebars, cookie banners — **saves ~96% tokens** on typical pages.

### 🖼️ Images Extraction

**v0.6.0**: Extract all images with URLs, alt text, dimensions, and deduplication.

```bash
# CLI
npx webpeel https://example.com --images
```

```typescript
const result = await peel('https://example.com', { images: true });
console.log(result.images);
// [
//   { src: 'https://...', alt: '...', width: 800, height: 600 },
//   ...
// ]
```

### 💭 AI Summarization

**v0.6.0**: Generate concise summaries using your own LLM.

```bash
# CLI
npx webpeel https://example.com --summary --llm-key sk-...
```

```typescript
import { summarizeContent } from 'webpeel';

const summary = await summarizeContent('...long content...', {
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',
  maxWords: 150,
});
console.log(summary);
```

### 🌍 Location & Language

**v0.6.0**: Geo-targeted scraping with location and language preferences.

```bash
# CLI
npx webpeel https://example.com --location US --language en
```

```typescript
const result = await peel('https://example.com', {
  location: 'US',
  language: 'en',
});
```

Useful for location-specific content, regional pricing, and localized pages.

### 🔥 Firecrawl Compatibility

**v0.7.0**: Drop-in replacement for Firecrawl — same API endpoints, same request/response format.

```bash
# Just change the base URL
# Before: https://api.firecrawl.dev/v1/scrape
# After:  https://api.webpeel.dev/v1/scrape

curl "https://api.webpeel.dev/v1/scrape" \
  -H "Authorization: Bearer wp_..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

WebPeel accepts Firecrawl API keys (format: `fc-...`) and maps them to equivalent features. **Migration takes 5 minutes.**

---

## Integrations

### LangChain

```typescript
import { WebPeelLoader } from 'webpeel/integrations/langchain';

const loader = new WebPeelLoader('https://example.com', {
  render: true,
  stealth: true,
});
const docs = await loader.load();
```

### LlamaIndex

```typescript
import { WebPeelReader } from 'webpeel/integrations/llamaindex';

const reader = new WebPeelReader({ render: true });
const documents = await reader.loadData(['https://example.com']);
```

### CrewAI

```python
from webpeel import WebPeel
from crewai import Agent, Task, Crew

webpeel = WebPeel()

researcher = Agent(
    role='Web Researcher',
    goal='Gather information from websites',
    tools=[webpeel.scrape, webpeel.search],
)
```

### Dify

WebPeel MCP server works with Dify's MCP integration out of the box.

### n8n

Use the HTTP Request node with WebPeel's API:

```
GET https://api.webpeel.dev/v1/fetch?url={{$node["Trigger"].json["url"]}}
```

### Claude Code Skill

Install the WebPeel skill for OpenClaw:

```bash
claude mcp add webpeel -- npx -y webpeel mcp
```

Or add to `.mcp.json` for team sharing:

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

---

## How It Works: Smart Escalation

WebPeel tries the fastest method first, then escalates only when needed:

```
┌─────────────────────────────────────────────────────────────┐
│                    Smart Escalation                          │
└─────────────────────────────────────────────────────────────┘

Simple HTTP Fetch     →     Browser Rendering    →     Stealth Mode
    ~200ms                      ~2 seconds               ~5 seconds
       │                            │                       │
       ├─ User-Agent headers        ├─ Full JS execution   ├─ Anti-detect
       ├─ Cheerio parsing           ├─ Wait for content    ├─ Fingerprint mask
       ├─ Fast & cheap              ├─ Screenshots         ├─ Cloudflare bypass
       │                            │                       │
       ▼                            ▼                       ▼
   Works for 80%              Works for 15%            Works for 5%
   of websites                (JS-heavy sites)         (bot-protected)
```

**Why this matters:**
- **Speed**: Don't waste 2 seconds rendering when 200ms will do
- **Cost**: Headless browsers burn CPU and memory
- **Reliability**: Auto-retry with browser if simple fetch fails

WebPeel automatically detects blocked requests (403, 503, Cloudflare challenges) and retries with browser mode. You get the best of both worlds.

---

## API Reference

### `peel(url, options?)`

Fetch and extract content from a URL.

```typescript
interface PeelOptions {
  render?: boolean;              // Force browser mode (default: false)
  stealth?: boolean;             // Use stealth mode (default: false)
  wait?: number;                 // Wait time after page load in ms
  format?: 'markdown' | 'text' | 'html'; // Output format
  timeout?: number;              // Request timeout in ms
  screenshot?: boolean;          // Capture screenshot
  screenshotFullPage?: boolean;  // Full-page screenshot
  selector?: string;             // CSS selector for content
  exclude?: string;              // CSS selector to exclude
  includeTags?: string[];        // HTML tags to include
  excludeTags?: string[];        // HTML tags to exclude
  maxTokens?: number;            // Max tokens in output
  images?: boolean;              // Extract image URLs
  location?: string;             // Geo-location (country code)
  language?: string;             // Preferred language
  branding?: boolean;            // Extract branding/design
  changeTracking?: boolean;      // Track content changes
  summary?: boolean | { maxLength: number }; // AI summary
  llm?: {                        // LLM config for AI features
    apiKey: string;
    model?: string;
    baseUrl?: string;
  };
  extract?: {                    // Structured extraction
    selectors?: Record<string, string>;
    schema?: object;
    prompt?: string;
    llmApiKey?: string;
  };
  actions?: Array<{              // Browser actions
    type: 'click' | 'type' | 'scroll' | 'wait' | 'fill' | 'select' | 'press' | 'hover';
    selector?: string;
    value?: string | number;
  }>;
}

interface PeelResult {
  url: string;                   // Final URL (after redirects)
  title: string;                 // Page title
  content: string;               // Page content (markdown/text/html)
  metadata: {                    // Extracted metadata
    description?: string;
    author?: string;
    published?: string;          // ISO 8601 date
    image?: string;              // Open Graph image
    canonical?: string;
  };
  links: string[];               // All links on page
  tokens: number;                // Estimated token count
  method: 'simple' | 'browser' | 'stealth'; // Method used
  elapsed: number;               // Time taken (ms)
  quality: number;               // Content quality score (0-1)
  fingerprint: string;           // Content hash (16 chars)
  screenshot?: string;           // Base64 PNG (if requested)
  extracted?: Record<string, any>; // Structured data
  branding?: BrandingProfile;    // Branding info
  changeTracking?: ChangeResult; // Change tracking
  summary?: string;              // AI summary
  images?: ImageInfo[];          // Extracted images
}
```

### `crawl(url, options?)`

Crawl a website by following links.

```typescript
import { crawl } from 'webpeel';

const pages = await crawl('https://docs.example.com', {
  limit: 100,                    // Max pages to crawl
  maxDepth: 3,                   // Max link depth
  allowedDomains: ['example.com'], // Restrict to domains
  excludePaths: ['/admin'],      // Exclude URL patterns
  sitemapFirst: true,            // Parse sitemap before crawling
  onProgress: (progress) => {
    console.log(`${progress.completed}/${progress.total} pages`);
  },
});
```

### `mapDomain(url, options?)`

Discover all URLs on a domain via sitemap.xml and link crawling.

```typescript
import { mapDomain } from 'webpeel';

const urls = await mapDomain('https://example.com', {
  limit: 5000,                   // Max URLs to discover
  searchTerm: 'pricing',         // Filter by relevance (optional)
});

console.log(urls.map(u => u.url)); // Array of discovered URLs
```

### `extractBranding(url)`

Extract branding and design system from a website.

```typescript
import { extractBranding } from 'webpeel';

const brand = await extractBranding('https://stripe.com');

console.log(brand.colors);       // Primary, secondary, etc.
console.log(brand.fonts);        // Font families
console.log(brand.typography);   // Heading/body styles
console.log(brand.logo);         // Logo URL
console.log(brand.favicon);      // Favicon URL
```

### `trackChange(url, content?, fingerprint?)`

Track content changes over time.

```typescript
import { trackChange } from 'webpeel';

const result = await trackChange('https://example.com/pricing');

console.log(result.changeStatus); // 'new' | 'same' | 'changed' | 'removed'
console.log(result.diff);         // Unified diff (if changed)
```

### `runAgent(options)`

Autonomous web research using your own LLM.

```typescript
import { runAgent } from 'webpeel';

const result = await runAgent({
  prompt: 'Find the pricing plans for Notion',
  llmApiKey: 'sk-...',
  llmModel: 'gpt-4o-mini',
  maxIterations: 10,
});

console.log(result.answer);      // Compiled answer
console.log(result.sources);     // URLs used
console.log(result.iterations);  // Research steps
```

### `summarizeContent(content, options)`

Generate AI-powered summary.

```typescript
import { summarizeContent } from 'webpeel';

const summary = await summarizeContent('...long content...', {
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',
  maxWords: 150,
});
```

### `cleanup()`

Clean up browser resources. Call when done using WebPeel:

```typescript
import { cleanup } from 'webpeel';

// ... use peel(), crawl(), etc. ...

await cleanup(); // Close browser instances
```

---

## Hosted API

Live at `https://api.webpeel.dev` — Firecrawl-compatible endpoints.

```bash
# Register and get your API key
curl -X POST https://api.webpeel.dev/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'

# Fetch a page
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer wp_..."

# Search the web
curl "https://api.webpeel.dev/v1/search?q=AI+frameworks" \
  -H "Authorization: Bearer wp_..."

# Start a crawl job (async)
curl -X POST https://api.webpeel.dev/v1/crawl \
  -H "Authorization: Bearer wp_..." \
  -H "Content-Type: application/json" \
  -d '{"url":"https://docs.example.com","limit":100}'

# Autonomous agent
curl -X POST https://api.webpeel.dev/v1/agent \
  -H "Authorization: Bearer wp_..." \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Find Notion pricing","llmApiKey":"sk-..."}'
```

### Pricing — Weekly Reset Model

Usage resets every **Monday at 00:00 UTC**, just like Claude Code.

| Plan | Price | Weekly Fetches | Burst Limit | All Features | Extra Usage |
|------|------:|---------------:|:-----------:|:------------:|:-----------:|
| **Free** | $0 | 125/wk (~500/mo) | 25/hr | ✅ | ❌ |
| **Pro** | $9/mo | 1,250/wk (~5K/mo) | 100/hr | ✅ | ✅ |
| **Max** | $29/mo | 6,250/wk (~25K/mo) | 500/hr | ✅ | ✅ |

**All features on all plans** — including stealth mode, crawl, agent, extraction, and more.

**Extra usage rates** (Pro/Max only when you exceed weekly limit):
- Basic fetch: $0.002
- Stealth mode: $0.01
- Search: $0.001

### Why WebPeel Beats Firecrawl

| Feature | WebPeel Free | WebPeel Pro | Firecrawl Hobby |
|---------|:-------------:|:-----------:|:---------------:|
| **Price** | $0 | $9/mo | $16/mo |
| **Weekly Fetches** | 125/wk | 1,250/wk | ~750/wk |
| **Rollover** | ❌ | ✅ 1 week | ❌ Expire monthly |
| **Soft Limits** | ✅ Degrades | ✅ Never locked out | ❌ Hard cut-off |
| **Extra Usage** | ❌ | ✅ Pay-as-you-go | ❌ Upgrade only |
| **Self-Host** | ✅ MIT | ✅ MIT | ❌ AGPL |

**Key differentiators:**
- **Generous free tier** — 125/week recurring (not one-time like Firecrawl)
- **Firecrawl-compatible** — Drop-in replacement, migration takes 5 minutes
- **MIT license** — Self-host without restrictions
- **BYOK agent** — Use any LLM (OpenAI, Anthropic, local models)
- **Weekly resets** — Like Claude Code, not monthly lockouts

---

## Examples

### Extract blog post metadata

```typescript
const result = await peel('https://example.com/blog/post');

console.log(result.metadata);
// {
//   title: "How We Built WebPeel",
//   description: "A deep dive into smart escalation...",
//   author: "Jake Liu",
//   published: "2026-02-12T18:00:00Z",
//   image: "https://example.com/og-image.png"
// }
```

### Get all links from a page

```typescript
const result = await peel('https://news.ycombinator.com');

console.log(result.links.slice(0, 5));
// [
//   "https://news.ycombinator.com/newest",
//   "https://news.ycombinator.com/submit",
//   "https://github.com/example/repo",
//   ...
// ]
```

### Force browser rendering for JavaScript-heavy sites

```typescript
// Twitter/X requires JavaScript
const result = await peel('https://x.com/elonmusk', {
  render: true,
  wait: 2000,  // Wait for tweets to load
});

console.log(result.content);  // Rendered tweet content
```

### Batch processing with concurrency

```typescript
import { peelBatch } from 'webpeel';

const urls = [
  'https://example.com',
  'https://example.org',
  'https://example.net',
];

const results = await peelBatch(urls, { concurrency: 3 });

results.forEach(result => {
  if ('error' in result) {
    console.error(`Failed: ${result.url} - ${result.error}`);
  } else {
    console.log(`Success: ${result.title}`);
  }
});
```

### Autonomous research

```typescript
import { runAgent } from 'webpeel';

const result = await runAgent({
  prompt: 'Compare the pricing of Notion, Coda, and Airtable',
  llmApiKey: 'sk-...',
  llmModel: 'gpt-4o',
  maxIterations: 15,
});

console.log(result.answer);
// "Based on my research:
//  - Notion: Free, Plus ($10/mo), Business ($18/mo), Enterprise (custom)
//  - Coda: Free, Pro ($12/mo), Team ($36/user/mo), Enterprise (custom)
//  - Airtable: Free, Plus ($10/mo), Pro ($20/mo), Enterprise (custom)
//  ..."

console.log(result.sources);
// ["https://notion.so/pricing", "https://coda.io/pricing", ...]
```

---

## Use Cases

- **AI Agents**: Feed web content to Claude, GPT, or local LLMs
- **Research**: Bulk extract articles, docs, or social media
- **Monitoring**: Track content changes on pricing pages, docs, etc.
- **Competitive Analysis**: Extract branding, design systems, and structured data
- **Data Pipelines**: Extract structured data from web sources
- **Archiving**: Save web pages as clean markdown
- **RAG Pipelines**: Load web content into LangChain, LlamaIndex, etc.

---

## Development

```bash
# Clone the repo
git clone https://github.com/JakeLiuMe/webpeel.git
cd webpeel

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode (auto-rebuild)
npm run dev

# Test the CLI locally
node dist/cli.js https://example.com

# Test the MCP server
npm run mcp

# Start API server
npm run serve
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Links

- **Documentation**: [webpeel.dev/docs](https://webpeel.dev/docs)
- **Playground**: [webpeel.dev/playground](https://webpeel.dev/playground) (no signup required)
- **API Reference**: [api.webpeel.dev](https://api.webpeel.dev)
- **npm Package**: [npmjs.com/package/webpeel](https://www.npmjs.com/package/webpeel)
- **Python SDK**: [pypi.org/project/webpeel](https://pypi.org/project/webpeel/)
- **Migration Guide**: [webpeel.dev/migrate-from-firecrawl](https://webpeel.dev/migrate-from-firecrawl)
- **Blog**: [webpeel.dev/blog](https://webpeel.dev/blog)
- **GitHub Discussions**: [github.com/JakeLiuMe/webpeel/discussions](https://github.com/JakeLiuMe/webpeel/discussions)

---

## FAQ

**Q: How is this different from Firecrawl?**  
A: WebPeel is Firecrawl-compatible but with a more generous free tier (125/week recurring vs 500 one-time), MIT license (vs AGPL), and autonomous agent with BYOK LLM. We also have smart escalation to avoid burning resources on simple pages.

**Q: Can I self-host the API server?**  
A: Yes! Run `docker compose up` to start the full stack. It's MIT licensed — no restrictions.

**Q: Does this violate websites' Terms of Service?**  
A: WebPeel is a tool — how you use it is up to you. Always check a site's ToS before fetching at scale. We recommend respecting `robots.txt` in your own workflows.

**Q: What about Cloudflare and bot protection?**  
A: WebPeel handles most Cloudflare challenges automatically via stealth mode (available on all plans). For heavily protected sites, stealth mode uses browser fingerprint randomization to bypass detection.

**Q: Can I use this in production?**  
A: Yes! The hosted API at `https://api.webpeel.dev` is production-ready with authentication, rate limiting, and usage tracking.

**Q: Is this really Firecrawl-compatible?**  
A: Yes! WebPeel accepts Firecrawl API keys (format: `fc-...`) and supports the same endpoints (`/v1/scrape`, `/v1/crawl`, etc.) with equivalent request/response formats. Migration typically takes 5 minutes.

---

## Roadmap

- [x] CLI with smart escalation
- [x] TypeScript library
- [x] MCP server (9 tools)
- [x] Hosted API with auth and usage tracking
- [x] Stealth mode (playwright-extra + anti-detect)
- [x] Crawl mode (follow links, respect robots.txt)
- [x] PDF extraction
- [x] Structured data extraction (CSS selectors + AI)
- [x] Page actions (click, scroll, type, etc.)
- [x] Map/sitemap discovery
- [x] Token budget
- [x] Advanced crawl (sitemap-first, BFS/DFS, deduplication)
- [x] Branding extraction
- [x] Change tracking
- [x] Python SDK (zero dependencies)
- [x] LangChain & LlamaIndex integrations
- [x] Autonomous agent (BYOK LLM)
- [x] Tag filtering (include/exclude)
- [x] Images extraction
- [x] AI summarization
- [x] Location/language support
- [x] Firecrawl compatibility
- [ ] Webhook notifications for monitoring
- [ ] Browser extension for one-click extraction
- [ ] GraphQL API

Vote on features at [GitHub Discussions](https://github.com/JakeLiuMe/webpeel/discussions).

---

## Credits

Built with:
- [Playwright](https://playwright.dev/) — Headless browser automation
- [playwright-extra](https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra) — Stealth plugin
- [Cheerio](https://cheerio.js.org/) — Fast HTML parsing
- [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown conversion
- [Commander](https://github.com/tj/commander.js) — CLI framework

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT © [Jake Liu](https://github.com/JakeLiuMe)

---

**Like WebPeel?** [⭐ Star us on GitHub](https://github.com/JakeLiuMe/webpeel) — it helps others discover the project!
