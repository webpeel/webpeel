---
name: webpeel
description: Fetch web pages as clean markdown, search the web, crawl sites, and take screenshots using the WebPeel CLI. Use when needing to read web content, research topics, or extract data from websites.
---

# WebPeel — Web Fetching for AI Agents

## Quick Reference

### Fetch a page
```bash
webpeel "https://example.com"
```

### Fetch with browser rendering (JS-heavy sites)
```bash
webpeel "https://example.com" --render
```

### Fetch with stealth mode (bot-protected sites)
```bash
webpeel "https://example.com" --stealth
```

### Search the web
```bash
webpeel search "your query here"
```

### Get JSON output
```bash
webpeel "https://example.com" --json --silent
```

### Screenshot
```bash
webpeel "https://example.com" --screenshot --output screenshot.png
```

### CSS selector extraction
```bash
webpeel "https://example.com" --selector "article.main"
```

## When to Use

| Situation | Command |
|-----------|---------|
| Read a blog post or docs page | `webpeel "url"` |
| JS-heavy SPA (React, Next.js) | `webpeel "url" --render` |
| Bot-protected site (Cloudflare) | `webpeel "url" --stealth` |
| Research a topic | `webpeel search "query"` |
| Get page metadata | `webpeel "url" --json --silent` |

## Smart Escalation

WebPeel automatically tries the cheapest method first:
1. **HTTP** — Simple fetch (~200ms)
2. **Browser** — Playwright rendering (~1-3s)
3. **Stealth** — Anti-detection mode (~3-5s)

If a simple fetch fails (403, empty content, bot detection), it escalates automatically.

## Installation

```bash
npm install -g webpeel
```

## Notes
- Default output is markdown (great for LLM context)
- Use `--silent` to suppress status messages
- Use `--json` for structured output with metadata
- Stealth mode requires Playwright browsers: `npx playwright install chromium`
