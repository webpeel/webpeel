<p align="center">
  <a href="https://webpeel.dev">
    <img src=".github/banner.svg" alt="WebPeel — Web fetching for AI agents" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/v/webpeel.svg" alt="npm version"></a>
  <a href="https://pypi.org/project/webpeel/"><img src="https://img.shields.io/pypi/v/webpeel.svg" alt="PyPI version"></a>
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/dm/webpeel.svg" alt="npm downloads"></a>
  <a href="https://github.com/webpeel/webpeel/stargazers"><img src="https://img.shields.io/github/stars/webpeel/webpeel.svg" alt="GitHub stars"></a>
  <a href="https://github.com/webpeel/webpeel/actions/workflows/ci.yml"><img src="https://github.com/webpeel/webpeel/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg" alt="TypeScript"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="AGPL v3 License"></a>
</p>

<p align="center">
  <b>Turn any web page into AI-ready markdown. Smart escalation. Stealth mode. Free to start.</b>
</p>

<p align="center">
  <a href="https://webpeel.dev">Website</a> ·
  <a href="https://webpeel.dev/docs">Docs</a> ·
  <a href="https://webpeel.dev/playground">Playground</a> ·
  <a href="https://app.webpeel.dev">Dashboard</a> ·
  <a href="https://github.com/webpeel/webpeel/discussions">Discussions</a>
</p>

---

## Quick Start

```bash
# Zero install — just run it
npx webpeel https://news.ycombinator.com
```

```bash
# Stealth mode (bypass bot detection)
npx webpeel https://protected-site.com --stealth

# Crawl a website
npx webpeel crawl https://example.com --max-pages 20

# Search the web
npx webpeel search "best AI frameworks 2026"

# Autonomous agent (BYOK LLM)
npx webpeel agent "Find the founders of Stripe" --llm-key sk-...
```

First 25 fetches work instantly, no signup. After that, [sign up free](https://app.webpeel.dev/signup) for 125/week.

## Why WebPeel?

| Feature | **WebPeel** | Firecrawl | Jina Reader | MCP Fetch |
|---------|:-----------:|:---------:|:-----------:|:---------:|
| **Free tier** | ✅ 125/wk recurring | 500 one-time | ❌ Cloud only | ✅ Unlimited |
| **Smart escalation** | ✅ HTTP→Browser→Stealth | Manual | ❌ | ❌ |
| **Stealth mode** | ✅ All plans | ✅ | ⚠️ Limited | ❌ |
| **Firecrawl-compatible** | ✅ Drop-in replacement | ✅ Native | ❌ | ❌ |
| **Self-hosting** | ✅ Docker compose | ⚠️ Complex | ❌ | N/A |
| **Autonomous agent** | ✅ BYOK any LLM | ⚠️ Locked | ❌ | ❌ |
| **MCP tools** | ✅ 9 tools | 3 | 0 | 1 |
| **License** | ✅ MIT | AGPL-3.0 | Proprietary | MIT |
| **Pricing** | **Free / $9 / $29** | $0 / $16 / $83 | Custom | Free |

## Install

```bash
# Node.js
npm install webpeel        # or: pnpm add webpeel

# Python
pip install webpeel

# Global CLI
npm install -g webpeel
```

## Usage

### Node.js

```typescript
import { peel } from 'webpeel';

const result = await peel('https://example.com');
console.log(result.content);    // Clean markdown
console.log(result.metadata);   // { title, description, author, ... }
console.log(result.tokens);     // Estimated token count

// With options
const advanced = await peel('https://example.com', {
  render: true,           // Browser for JS-heavy sites
  stealth: true,          // Anti-bot stealth mode
  maxTokens: 4000,        // Limit output
  includeTags: ['main'],  // Filter HTML tags
});
```

### Python

```python
from webpeel import WebPeel

client = WebPeel()  # Free tier, no key needed

result = client.scrape("https://example.com")
print(result.content)  # Clean markdown

results = client.search("python web scraping")
job = client.crawl("https://docs.example.com", limit=100)
```

Zero dependencies. Pure Python 3.8+. [Full SDK docs →](python-sdk/README.md)

### MCP Server

9 tools for Claude Desktop, Cursor, VS Code, and Windsurf:

`webpeel_fetch` · `webpeel_search` · `webpeel_crawl` · `webpeel_map` · `webpeel_extract` · `webpeel_batch` · `webpeel_agent` · `webpeel_summarize` · `webpeel_brand`

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

> **Where to add this config:** Claude Desktop → `~/Library/Application Support/Claude/claude_desktop_config.json` · Cursor → Settings → MCP Servers · VS Code → `~/.vscode/mcp.json` · Windsurf → `~/.codeium/windsurf/mcp_config.json`

### Docker (Self-Hosted)

```bash
git clone https://github.com/webpeel/webpeel.git
cd webpeel && docker compose up
```

Full API at `http://localhost:3000`. MIT licensed — no restrictions.

## Features

### 🎯 Smart Escalation

Automatically uses the fastest method, escalates only when needed:

```
HTTP Fetch (200ms)  →  Browser Rendering (2s)  →  Stealth Mode (5s)
     80% of sites          15% of sites             5% of sites
```

### 🎭 Stealth Mode

Bypass Cloudflare and bot detection. Masks browser fingerprints, navigator properties, WebGL vendor.

```bash
npx webpeel https://protected-site.com --stealth
```

### 🕷️ Crawl & Map

Crawl websites with link following, sitemap discovery, robots.txt compliance, and deduplication.

```bash
npx webpeel crawl https://docs.example.com --max-pages 100
npx webpeel map https://example.com --max-urls 5000
```

### 🤖 Autonomous Agent (BYOK)

Give it a prompt, it researches the web using your own LLM key.

```bash
npx webpeel agent "Compare pricing of Notion vs Coda" --llm-key sk-...
```

### 📊 More Features

| Feature | CLI | Node.js | Python | API |
|---------|:---:|:-------:|:------:|:---:|
| Structured extraction | ✅ | ✅ | ✅ | ✅ |
| Screenshots | ✅ | ✅ | — | ✅ |
| Branding extraction | ✅ | ✅ | — | — |
| Change tracking | ✅ | ✅ | — | — |
| Token budget | ✅ | ✅ | ✅ | ✅ |
| Tag filtering | ✅ | ✅ | ✅ | ✅ |
| Image extraction | ✅ | ✅ | — | ✅ |
| AI summarization | ✅ | ✅ | — | ✅ |
| Batch processing | — | ✅ | — | ✅ |
| PDF extraction | ✅ | ✅ | — | — |

## Integrations

Works with **LangChain**, **LlamaIndex**, **CrewAI**, **Dify**, and **n8n**. [Integration docs →](https://webpeel.dev/docs)

## Hosted API

Live at [`api.webpeel.dev`](https://api.webpeel.dev) — Firecrawl-compatible endpoints.

```bash
# Fetch a page (free, no auth needed for first 25)
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com"

# With API key
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer wp_..."
```

### Pricing

| Plan | Price | Weekly Fetches | Burst | Extra Usage |
|------|------:|---------------:|:-----:|:-----------:|
| **Free** | $0 | 125/wk | 25/hr | — |
| **Pro** | $9/mo | 1,250/wk | 100/hr | ✅ from $0.001 |
| **Max** | $29/mo | 6,250/wk | 500/hr | ✅ from $0.001 |

Extra credit costs: fetch $0.002, search $0.001, stealth $0.01. Resets every Monday. All features on all plans. [Compare with Firecrawl →](https://webpeel.dev/migrate-from-firecrawl)

## Development

```bash
git clone https://github.com/webpeel/webpeel.git
cd webpeel
npm install && npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Links

[Documentation](https://webpeel.dev/docs) · [Playground](https://webpeel.dev/playground) · [API Reference](https://webpeel.dev/docs/api-reference) · [npm](https://www.npmjs.com/package/webpeel) · [PyPI](https://pypi.org/project/webpeel/) · [Migration Guide](https://webpeel.dev/migrate-from-firecrawl) · [Blog](https://webpeel.dev/blog) · [Discussions](https://github.com/webpeel/webpeel/discussions)

## Star History

<a href="https://star-history.com/#webpeel/webpeel&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=webpeel/webpeel&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=webpeel/webpeel&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=webpeel/webpeel&type=Date" width="600" />
  </picture>
</a>

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html).

**What this means:**
- ✅ Free to use, modify, and distribute
- ✅ Free for personal and commercial use
- ⚠️ If you run a modified version as a network service, you must release your source code under AGPL-3.0

**Need a commercial license?** Contact us at [support@webpeel.dev](mailto:support@webpeel.dev) for proprietary/enterprise licensing.

> **Note:** Versions 0.7.1 and earlier were released under MIT. Those releases remain MIT-licensed.

© [WebPeel](https://github.com/webpeel)

---

<p align="center">
  <b>Like WebPeel?</b> <a href="https://github.com/webpeel/webpeel">⭐ Star us on GitHub</a> — it helps others discover the project!
</p>
