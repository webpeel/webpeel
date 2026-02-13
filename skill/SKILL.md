---
name: webpeel
description: Fetch web pages as clean markdown for AI consumption. Smart escalation from HTTP to headless browser. Includes search via DuckDuckGo.
metadata.openclaw:
  emoji: 🕸️
  requires:
    bins: [node, npx]
---

# WebPeel — Web Fetching for AI Agents

Use WebPeel to fetch any web page and get clean, token-efficient markdown. Auto-escalates from fast HTTP to headless browser when JavaScript rendering is needed.

## When to Use

- User asks to read/fetch/scrape a web page
- You need web content for research or analysis
- You need to search the web
- A URL returns blocked/empty content (try `--render`)

## Quick Start

```bash
# Fetch any URL → clean markdown
npx webpeel "https://example.com"

# Search the web
npx webpeel search "latest AI frameworks"

# Force browser rendering (JS-heavy sites)
npx webpeel "https://spa-site.com" --render

# Get JSON output with metadata
npx webpeel "https://example.com" --json --silent

# Take a screenshot
npx webpeel "https://example.com" --screenshot output.png

# Use CSS selector to extract specific content
npx webpeel "https://docs.example.com" --selector "article.main"
```

## MCP Server

For Claude Desktop, Cursor, VS Code, Windsurf, or Cline — add to MCP settings:

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

Provides tools: `webpeel_fetch`, `webpeel_search`, `webpeel_batch`.

## Smart Escalation

WebPeel automatically picks the fastest method:
1. **HTTP fetch** (~120ms) — handles ~80% of pages
2. **Browser mode** (~2s) — auto-launches when JS rendering needed or content blocked

No configuration needed. If simple HTTP fails, it escalates automatically.

## Key Flags

| Flag | Description |
|------|-------------|
| `--render` | Force headless browser |
| `--json` | JSON output with metadata |
| `--silent` | No spinner/progress |
| `--selector "css"` | Extract specific element |
| `--screenshot [path]` | Capture screenshot |
| `--html` | Raw HTML instead of markdown |
| `--text` | Plain text instead of markdown |
| `-H "key: value"` | Custom headers |
| `--cookie "k=v"` | Custom cookies |
| `--timeout <ms>` | Request timeout (default 30s) |

## Hosted API

For high-volume use, register at https://app.webpeel.dev for an API key:

```bash
curl "https://webpeel-api.onrender.com/v1/fetch?url=https://example.com" \
  -H "Authorization: Bearer wp_live_YOUR_KEY"
```

Free tier: 125 fetches/week. Pro ($9/mo): 1,250/week.

## Tips

- Use `--silent --json` for programmatic use
- Pipe output: `npx webpeel "url" --silent | head -50`
- Search returns titles, URLs, and snippets from DuckDuckGo
- For protected sites, `--render` often bypasses basic bot detection
