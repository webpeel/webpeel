# WebPeel

[![npm version](https://img.shields.io/npm/v/webpeel.svg)](https://www.npmjs.com/package/webpeel)
[![npm downloads](https://img.shields.io/npm/dm/webpeel.svg)](https://www.npmjs.com/package/webpeel)
[![CI](https://github.com/JakeLiuMe/webpeel/actions/workflows/ci.yml/badge.svg)](https://github.com/JakeLiuMe/webpeel/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Turn any web page into clean markdown. Zero config. Free forever.

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

|  | **WebPeel** | Firecrawl | Jina Reader | MCP Fetch |
|---|:---:|:---:|:---:|:---:|
| **Local execution** | ✅ Free forever | ❌ Cloud only | ❌ Cloud only | ✅ Free |
| **JS rendering** | ✅ Auto-escalates | ✅ Always | ❌ No | ❌ No |
| **Anti-bot handling** | ✅ Stealth mode | ✅ Yes | ⚠️ Limited | ❌ No |
| **MCP Server** | ✅ Built-in | ✅ Separate repo | ❌ No | ✅ Yes |
| **Zero config** | ✅ `npx webpeel` | ❌ API key required | ❌ API key required | ✅ Yes |
| **Free tier** | ∞ Unlimited local | 500 pages (one-time) | 1000 req/month | ∞ Local only |
| **Hosted API** | $9/mo (5K pages) | $16/mo (3K pages) | $200/mo (Starter) | N/A |
| **Credit rollover** | ✅ Up to 1 month | ❌ Expire monthly | ❌ N/A | ❌ N/A |
| **Soft limits** | ✅ Never blocked | ❌ Hard cut-off | ❌ Rate limited | ❌ N/A |
| **Markdown output** | ✅ Optimized for AI | ✅ Yes | ✅ Yes | ⚠️ Basic |

**WebPeel gives you Firecrawl's power without the price tag.** Run locally for free, or use our hosted API when you need scale.

---

## Quick Start

### CLI (Zero Install)

```bash
# Basic usage
npx webpeel https://example.com

# JSON output with metadata
npx webpeel https://example.com --json

# Force browser rendering (for JS-heavy sites)
npx webpeel https://x.com/elonmusk --render

# Wait for dynamic content
npx webpeel https://example.com --render --wait 3000
```

### Library (TypeScript)

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
const result = await peel('https://example.com', {
  format: 'markdown',  // 'markdown' | 'text' | 'html'
  render: true,        // Force browser mode
  wait: 3000,          // Wait 3s for dynamic content
  timeout: 30000,      // Request timeout (ms)
});
```

### MCP Server (Claude Desktop, Cursor, VS Code)

WebPeel provides two MCP tools: `webpeel_fetch` (fetch a URL) and `webpeel_search` (DuckDuckGo search + fetch results).

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

#### Cursor

Add to Cursor Settings → MCP Servers:

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

#### VS Code (with Cline or other MCP clients)

Create or edit `~/.vscode/mcp.json`:

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

---

## How It Works: Smart Escalation

WebPeel tries the fastest method first, then escalates only when needed:

```
┌─────────────────────────────────────────────────────────────┐
│                    Smart Escalation                          │
└─────────────────────────────────────────────────────────────┘

Simple HTTP Fetch          Browser Rendering         Stealth Mode
    ~200ms                      ~2 seconds             ~5 seconds
       │                            │                       │
       ├─ User-Agent headers        ├─ Full JS execution   ├─ Anti-detect
       ├─ Cheerio parsing           ├─ Wait for content    ├─ Proxy rotation
       ├─ Fast & cheap              ├─ Screenshots         └─ Cloudflare bypass
       │                            │
       ▼                            ▼
   Works for 80%              Works for 19%            Works for 1%
   of websites                (JS-heavy sites)         (heavily protected)
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
  render?: boolean;        // Force browser mode (default: false)
  wait?: number;           // Wait time after page load in ms (default: 0)
  format?: 'markdown' | 'text' | 'html';  // Output format (default: 'markdown')
  timeout?: number;        // Request timeout in ms (default: 30000)
  userAgent?: string;      // Custom user agent
}

interface PeelResult {
  url: string;             // Final URL (after redirects)
  title: string;           // Page title
  content: string;         // Page content in requested format
  metadata: {              // Extracted metadata
    description?: string;
    author?: string;
    published?: string;    // ISO 8601 date
    image?: string;        // Open Graph image
    canonical?: string;
  };
  links: string[];         // All links on page (absolute URLs)
  tokens: number;          // Estimated token count
  method: 'simple' | 'browser';  // Method used
  elapsed: number;         // Time taken (ms)
}
```

### Error Types

```typescript
import { TimeoutError, BlockedError, NetworkError } from 'webpeel';

try {
  const result = await peel('https://example.com');
} catch (error) {
  if (error instanceof TimeoutError) {
    // Request timed out
  } else if (error instanceof BlockedError) {
    // Site blocked the request (403, Cloudflare, etc.)
  } else if (error instanceof NetworkError) {
    // Network/DNS error
  }
}
```

### `cleanup()`

Clean up browser resources. Call this when you're done using WebPeel in your application:

```typescript
import { peel, cleanup } from 'webpeel';

// ... use peel() ...

await cleanup();  // Close browser instances
```

---

## Hosted API

Live at `https://webpeel-api.onrender.com` — or use the CLI locally for free.

```bash
# Register and get your API key
curl -X POST https://webpeel-api.onrender.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'

# Fetch a page
curl "https://webpeel-api.onrender.com/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer wp_live_your_api_key"
```

### Pricing

| Plan | Price | Fetches/Month | JS Rendering | Key Features |
|------|------:|---------------:|:------------:|----------|
| **Local CLI** | $0 | ∞ Unlimited | ✅ | Full power, your machine |
| **Cloud Free** | $0 | 500 | ❌ | Soft limits — never blocked |
| **Cloud Pro** | $9/mo | 5,000 | ✅ | Credit rollover, soft limits |
| **Cloud Max** | $29/mo | 25,000 | ✅ | Priority queue, credit rollover |

### Why WebPeel Pro Beats Firecrawl

| Feature | WebPeel Local | WebPeel Pro | Firecrawl Hobby |
|---------|:-------------:|:-----------:|:---------------:|
| **Price** | $0 | $9/mo | $16/mo |
| **Monthly Fetches** | ∞ | 5,000 | 3,000 |
| **Credit Rollover** | N/A | ✅ 1 month | ❌ Expire monthly |
| **Soft Limits** | ✅ Always | ✅ Never locked out | ❌ Hard cut-off |
| **Self-Host** | ✅ MIT | N/A | ❌ AGPL |

**Key differentiators:**
- **Soft limits on every tier** — When you hit your limit, we degrade to HTTP-only instead of blocking you. Even free users are never locked out.
- **Credits roll over** — Unused fetches carry forward for 1 month (Firecrawl expires monthly)
- **CLI is always free** — No vendor lock-in. Run unlimited locally forever.

See pricing at [webpeel.dev](https://webpeel.dev/#pricing)

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

### Token counting for LLM usage

```typescript
const result = await peel('https://example.com/long-article');

console.log(`Content is ~${result.tokens} tokens`);
// Content is ~3,247 tokens

if (result.tokens > 4000) {
  console.log('Too long for GPT-3.5 context window');
}
```

---

## Use Cases

- **AI Agents**: Feed web content to Claude, GPT, or local LLMs
- **Research**: Bulk extract articles, docs, or social media
- **Monitoring**: Track content changes on websites
- **Archiving**: Save web pages as clean markdown
- **Data Pipelines**: Extract structured data from web sources

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
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Roadmap

- [x] CLI with smart escalation
- [x] TypeScript library
- [x] MCP server for Claude/Cursor/VS Code
- [ ] Hosted API with authentication
- [ ] Rate limiting and caching
- [ ] Batch processing API
- [ ] Screenshot capture
- [ ] PDF extraction
- [ ] Webhook notifications for monitoring

Vote on features and roadmap at [GitHub Discussions](https://github.com/JakeLiuMe/webpeel/discussions).

---

## FAQ

**Q: How is this different from Firecrawl?**  
A: WebPeel runs locally for free (Firecrawl is cloud-only). We also have smart escalation to avoid burning resources on simple pages.

**Q: Can I self-host the API server?**  
A: Yes! Run `npm run serve` to start the API server. See [docs/self-hosting.md](docs/self-hosting.md) (coming soon).

**Q: Does this violate websites' Terms of Service?**  
A: WebPeel respects `robots.txt` by default. Always check a site's ToS before scraping at scale.

**Q: What about CAPTCHA and Cloudflare?**  
A: WebPeel handles most Cloudflare challenges automatically. For CAPTCHAs, you'll need a solving service (not included).

**Q: Can I use this in production?**  
A: Yes, but be mindful of rate limits. The hosted API (coming soon) is better for high-volume production use.

---

## Credits

Built with:
- [Playwright](https://playwright.dev/) — Headless browser automation
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
