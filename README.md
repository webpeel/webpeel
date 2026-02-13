# WebPeel

[![npm version](https://img.shields.io/npm/v/webpeel.svg)](https://www.npmjs.com/package/webpeel)
[![npm downloads](https://img.shields.io/npm/dm/webpeel.svg)](https://www.npmjs.com/package/webpeel)
[![GitHub stars](https://img.shields.io/github/stars/JakeLiuMe/webpeel.svg)](https://github.com/JakeLiuMe/webpeel/stargazers)
[![CI](https://github.com/JakeLiuMe/webpeel/actions/workflows/ci.yml/badge.svg)](https://github.com/JakeLiuMe/webpeel/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Turn any web page into clean markdown. **Stealth mode. Crawl mode. Zero config. Free forever.**

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
| **Free tier** | ✅ 125/week | ❌ Cloud only | ❌ Cloud only | ✅ Unlimited |
| **JS rendering** | ✅ Auto-escalates | ✅ Always | ❌ No | ❌ No |
| **Stealth mode** | ✅ Built-in | ✅ Yes | ⚠️ Limited | ❌ No |
| **Crawl mode** | ✅ Built-in | ✅ Yes | ❌ No | ❌ No |
| **MCP Server** | ✅ Built-in | ✅ Separate repo | ❌ No | ✅ Yes |
| **Zero config** | ✅ `npx webpeel` | ❌ API key required | ❌ API key required | ✅ Yes |
| **Free tier** | 125/week | 500 pages (one-time) | 1000 req/month | ∞ Unlimited |
| **Hosted API** | $9/mo (1,250/wk) | $16/mo (3K/mo) | $200/mo (Starter) | N/A |
| **Weekly reset** | N/A | ❌ Monthly only | ❌ Monthly only | ❌ N/A |
| **Extra usage** | N/A | ✅ Pay-as-you-go | ❌ Upgrade only | N/A |
| **Rollover** | N/A | ✅ 1 week | ❌ Expire monthly | ❌ N/A |
| **Soft limits** | ✅ Never blocked | ❌ Hard cut-off | ❌ Rate limited | ❌ N/A |
| **Markdown output** | ✅ Optimized for AI | ✅ Yes | ✅ Yes | ⚠️ Basic |

**WebPeel gives you Firecrawl's power with a generous free tier.** Like Claude Code — pay only when you need more.

### Usage Model

WebPeel uses a **weekly usage budget** for all users (CLI and API):

- **First 25 fetches**: No account needed — try it instantly
- **Free tier**: 125 fetches/week (resets every Monday)
- **Pro tier**: 1,250 fetches/week ($9/mo)
- **Max tier**: 6,250 fetches/week ($29/mo)

**Credit costs**: Basic fetch = 1 credit, Stealth mode = 5 credits, Search = 1 credit, Crawl = 1 credit/page

**Open source**: The CLI is MIT licensed — you can self-host if needed. But the hosted API requires authentication after 25 fetches.

### Highlights

1. **🎭 Stealth Mode** — Bypass bot detection with playwright-extra stealth plugin. Works on sites that block regular scrapers.
2. **🕷️ Crawl Mode** — Follow links and extract entire sites. Respects robots.txt and rate limits automatically.
3. **💰 Generous Free Tier** — Like Claude Code: 125 free fetches every week. First 25 work instantly, no signup. Open source MIT.

---

## Quick Start

### CLI (Zero Install)

```bash
# First 25 fetches work instantly, no signup
npx webpeel https://example.com

# After 25 fetches, sign up for free (125/week)
webpeel login

# Check your usage
webpeel usage

# Stealth mode (bypass bot detection)
npx webpeel https://protected-site.com --stealth

# Crawl a website (follow links, respect robots.txt)
npx webpeel crawl https://example.com --max-pages 20 --max-depth 2

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

### MCP Server (Claude Desktop, Cursor, VS Code, Windsurf)

WebPeel provides four MCP tools: `webpeel_fetch` (fetch a URL), `webpeel_search` (search the web), `webpeel_batch` (fetch multiple URLs), and `webpeel_crawl` (crawl a site).

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

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

## Use with Claude Code

One command to add WebPeel to Claude Code:

```bash
claude mcp add webpeel -- npx -y webpeel mcp
```

Or add to your project's `.mcp.json` for team sharing:

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

This gives Claude Code access to:
- **webpeel_fetch** — Fetch any URL as clean markdown (with stealth mode for protected sites)
- **webpeel_search** — Search the web via DuckDuckGo
- **webpeel_batch** — Fetch multiple URLs concurrently
- **webpeel_crawl** — Crawl websites following links

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

Live at `https://webpeel-api.onrender.com` — authentication required after first 25 fetches.

```bash
# Register and get your API key
curl -X POST https://webpeel-api.onrender.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'

# Fetch a page
curl "https://webpeel-api.onrender.com/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer wp_live_your_api_key"
```

### Pricing — Weekly Reset Model

Usage resets every **Monday at 00:00 UTC**, just like Claude Code.

| Plan | Price | Weekly Fetches | Burst Limit | Stealth Mode | Extra Usage |
|------|------:|---------------:|:-----------:|:------------:|:-----------:|
| **Free** | $0 | 125/wk (~500/mo) | 25/hr | ❌ | ❌ |
| **Pro** | $9/mo | 1,250/wk (~5K/mo) | 100/hr | ✅ | ✅ |
| **Max** | $29/mo | 6,250/wk (~25K/mo) | 500/hr | ✅ | ✅ |

**Three layers of usage control:**
1. **Burst limit** — Per-hour cap (25/hr free, 100/hr Pro, 500/hr Max) prevents hammering
2. **Weekly limit** — Main usage gate, resets every Monday
3. **Extra usage** — When you hit your weekly limit, keep fetching at pay-as-you-go rates

**Extra usage rates (Pro/Max only):**
| Fetch Type | Cost |
|-----------|------|
| Basic (HTTP) | $0.002 |
| Stealth (browser) | $0.01 |
| Search | $0.001 |

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
- **Like Claude Code** — Generous free tier (125/week), pay when you need more
- **Weekly resets** — Your usage refreshes every Monday, not once a month
- **Soft limits on every tier** — At 100%, we degrade gracefully instead of blocking you
- **Extra usage** — Pro/Max users can toggle on pay-as-you-go with spending caps (no surprise bills)
- **First 25 free** — Try it instantly, no signup required
- **Open source** — MIT licensed, self-host if you want full control

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
- [x] Hosted API with authentication and usage tracking
- [x] Rate limiting and caching
- [x] Batch processing API (`batch <file>`)
- [x] Screenshot capture (`--screenshot`)
- [x] CSS selector filtering (`--selector`, `--exclude`)
- [x] DuckDuckGo search (`search <query>`)
- [x] Custom headers and cookies
- [x] Weekly reset usage model with extra usage
- [x] Stealth mode (playwright-extra + anti-detect)
- [x] Crawl mode (follow links, respect robots.txt)
- [ ] PDF extraction
- [ ] Webhook notifications for monitoring
- [ ] AI CAPTCHA solving (planned)

Vote on features and roadmap at [GitHub Discussions](https://github.com/JakeLiuMe/webpeel/discussions).

---

## FAQ

**Q: How is this different from Firecrawl?**  
A: WebPeel has a more generous free tier (125/week vs Firecrawl's 500 one-time credits) and uses weekly resets like Claude Code. We also have smart escalation to avoid burning resources on simple pages.

**Q: Can I self-host the API server?**  
A: Yes! Run `npm run serve` to start the API server. See [docs/self-hosting.md](docs/self-hosting.md) (coming soon).

**Q: Does this violate websites' Terms of Service?**  
A: WebPeel is a tool — how you use it is up to you. Always check a site's ToS before fetching at scale. We recommend respecting `robots.txt` in your own workflows.

**Q: What about CAPTCHA and Cloudflare?**  
A: WebPeel handles most Cloudflare challenges automatically via stealth mode. AI-powered CAPTCHA solving is on our roadmap.

**Q: Can I use this in production?**  
A: Yes! The hosted API at `https://webpeel-api.onrender.com` is production-ready with authentication, rate limiting, and usage tracking.

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
