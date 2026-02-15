---
name: webpeel
description: Scrape, crawl, search, and extract web data. Converts any website to LLM-ready markdown. Local-first with smart escalation (HTTP → browser → stealth). No API key needed.
---

# WebPeel — Web Fetching for AI Agents

WebPeel converts any website into clean, LLM-ready markdown. It handles JavaScript rendering, anti-bot protection, and content extraction automatically.

## When to Use

Use WebPeel when you need to:
- Fetch a web page and get clean markdown content
- Search the web and get full page content from results
- Crawl an entire site or discover all URLs
- Extract structured data from pages
- Get screenshots of web pages
- Track changes on a page over time
- Extract branding/design system from a site

## Quick Reference

### CLI (installed globally or via npx)

```bash
# Install
npm install -g webpeel

# Scrape a page (default: markdown output)
npx webpeel https://example.com

# Search the web
npx webpeel search "latest AI news"

# Crawl a site (up to 10 pages)
npx webpeel crawl https://example.com --limit 10

# Discover all URLs on a site
npx webpeel map https://example.com

# Extract structured data
npx webpeel https://example.com --extract '{"title": "string", "price": "number"}'

# Use browser rendering for JS-heavy sites
npx webpeel https://example.com --render

# Use stealth mode for protected sites
npx webpeel https://example.com --stealth

# Get screenshot
npx webpeel https://example.com --screenshot

# AI-powered research agent
npx webpeel agent "Find the pricing of Notion" --llm-key sk-...

# Filter content by HTML tags
npx webpeel https://example.com --include-tags article,main --exclude-tags nav,footer

# Extract images
npx webpeel https://example.com --images

# Limit token output
npx webpeel https://example.com --max-tokens 4000

# Get branding/design info
npx webpeel brand https://example.com

# Track changes over time
npx webpeel track https://example.com
```

### Node.js Library

```typescript
import { peel, crawl, mapDomain, extractBranding, runAgent } from 'webpeel';

// Scrape a page
const result = await peel('https://example.com');
console.log(result.content);   // Clean markdown
console.log(result.metadata);  // { title, description, language, ... }

// Scrape with options
const result2 = await peel('https://example.com', {
  render: true,           // Use browser for JS sites
  stealth: true,          // Anti-bot stealth mode
  screenshot: true,       // Capture screenshot
  format: 'markdown',     // 'markdown' | 'text' | 'html'
  selector: 'article',    // CSS selector for content
  includeTags: ['main'],  // Only include these HTML tags
  excludeTags: ['nav'],   // Remove these HTML tags
  maxTokens: 4000,        // Limit output tokens
  images: true,           // Extract image URLs
});

// Search the web
import { search } from 'webpeel'; // Note: search is a CLI/API feature
// Use the API: GET https://api.webpeel.dev/v1/search?q=query

// Crawl a site
const pages = await crawl('https://example.com', {
  limit: 20,
  maxDepth: 3,
  onProgress: (p) => console.log(`${p.completed}/${p.total}`),
});

// Discover URLs
const urls = await mapDomain('https://example.com', { limit: 100 });

// Extract branding
const brand = await extractBranding('https://example.com');
console.log(brand.colors, brand.fonts, brand.logo);

// AI agent research
const research = await runAgent({
  prompt: 'Find Notion pricing plans',
  llmApiKey: 'sk-...',
  llmModel: 'gpt-4o',
});
```

### Python SDK

```python
from webpeel import WebPeel

client = WebPeel(api_key="wp_...")  # Or no key for local usage

# Scrape
result = client.scrape("https://example.com")
print(result.markdown)

# Search
results = client.search("AI frameworks comparison")

# Crawl
pages = client.crawl("https://example.com", limit=10)
```

### MCP Server

WebPeel includes a built-in MCP server with 7 tools:

```bash
# Start MCP server
npx webpeel mcp
```

**Tools available:**
- `webpeel_fetch` — Fetch a URL and get markdown/text/HTML
- `webpeel_search` — Search the web via DuckDuckGo
- `webpeel_crawl` — Crawl a website and get all pages
- `webpeel_map` — Discover all URLs on a domain
- `webpeel_extract` — Extract structured data from a page
- `webpeel_batch` — Batch scrape multiple URLs
- `webpeel_agent` — AI-powered web research agent

**MCP configuration for Claude Desktop / other clients:**
```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["webpeel", "mcp"]
    }
  }
}
```

### Hosted API

Free tier available at `https://api.webpeel.dev`:

```bash
# Scrape (no auth for basic requests)
curl "https://api.webpeel.dev/v1/fetch?url=https://example.com"

# Search
curl "https://api.webpeel.dev/v1/search?q=latest+news"

# With API key for higher limits
curl -H "Authorization: Bearer wp_..." "https://api.webpeel.dev/v1/fetch?url=https://example.com&render=true"
```

## Key Features

- **Smart Escalation**: Automatically tries HTTP first, then browser, then stealth mode
- **No API Key Needed**: Works locally without any configuration
- **Token Efficient**: Smart content extraction saves ~96% tokens vs raw HTML
- **Stealth Mode**: Bypasses anti-bot protection on protected sites
- **Screenshot**: Full-page or viewport screenshots
- **Structured Extraction**: Extract JSON data using CSS selectors or AI
- **Change Tracking**: Track page changes over time with diffs
- **Branding Extraction**: Get colors, fonts, logos from any site

## Tips

- Use `--render` only when needed (JS-heavy sites). Simple HTTP is 5-10x faster.
- Use `--stealth` for sites that block bots (Cloudflare, etc.)
- Use `--max-tokens 4000` to keep output within context limits
- Use `--include-tags article,main` to extract only relevant content
- For batch operations, use `npx webpeel batch urls.txt`
- The MCP server is the easiest way to integrate with AI agents

## Links

- **GitHub**: https://github.com/webpeel/webpeel
- **npm**: https://www.npmjs.com/package/webpeel
- **PyPI**: https://pypi.org/project/webpeel/
- **Docs**: https://webpeel.dev/docs/
- **API**: https://api.webpeel.dev
