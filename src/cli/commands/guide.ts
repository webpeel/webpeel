import type { Command } from 'commander';

const GUIDE = `
# WebPeel — AI Usage Guide

WebPeel is a fast web fetcher built for AI agents. It handles JS rendering, Cloudflare protection,
and 55+ domain-specific extractors automatically. Run any webpeel command with --help for options.

## Quick Decision Tree

- Static page                        → webpeel <url>
- JavaScript SPA (React/Vue/Angular) → webpeel <url> --render
- Bot-protected site (Cloudflare)    → webpeel <url> --stealth
- Infinite scroll / lazy content     → webpeel <url> --render --action 'scroll:bottom' --action 'wait:2000'
- Need to interact (click, type)     → webpeel <url> --render --action 'click:.button' --action 'wait:1000'
- Screenshot                         → webpeel screenshot <url>
- Search the web                     → webpeel search "query"
- YouTube transcript                 → webpeel <youtube-url>
- PDF content                        → webpeel <pdf-url>
- Structured data                    → webpeel <url> --schema product --json
- Monitor for changes                → webpeel watch <url>

## When to Use --render

Use for ANY site that:
- Shows blank/minimal content without JavaScript
- Is a Single Page Application (React, Vue, Angular, Svelte, Next.js)
- Returns less than 50 tokens of content
- Has dynamic/interactive elements

Known SPA sites (auto-detected): Google, Airbnb, Booking.com, Expedia, Indeed, Zillow, Polymarket, and more.
For sites NOT in the auto-list, add --render manually.

Tip: If content looks sparse or empty, ALWAYS retry with --render before concluding the page has no content.

## Browser Actions (--action flag)

Actions require --render (auto-enabled when you pass --action). Chain multiple actions with repeated --action flags.

Available Actions:
  scroll:bottom         — scroll to page bottom (for infinite scroll / lazy-loaded content)
  scroll:top            — scroll to top
  scroll:down:500       — scroll down 500px
  scroll:0,1500         — scroll to exact coordinates (x,y)
  wait:2000             — wait 2000ms (useful after navigation or clicks)
  click:.selector       — click a CSS element
  type:#input:hello     — type text into an input field
  waitFor:.selector     — wait for a CSS element to appear in the DOM
  hover:.element        — hover over an element (for dropdown menus, tooltips)

Common Patterns:

  # Load all lazy content / infinite scroll
  webpeel <url> --render --action 'scroll:bottom' --action 'wait:2000'

  # Click "Load More" button then extract
  webpeel <url> --render --action 'click:.load-more' --action 'wait:1000'

  # Fill a search form and submit
  webpeel <url> --render --action 'type:#search:query' --action 'click:.submit' --action 'wait:2000'

  # Wait for dynamic content to appear
  webpeel <url> --render --action 'waitFor:.results-list' --action 'wait:500'

## Stealth Mode (--stealth)

Use when:
- Site returns a Cloudflare challenge page
- Site blocks bots with fingerprinting or rate limiting
- Normal --render fails with access denied / 403

  webpeel <url> --stealth

Stealth mode auto-enables --render.

## Authentication (Login-Protected Pages)

Some pages require you to be logged in (e.g. dashboards, profiles, activity feeds).
WebPeel detects auth walls automatically and tells you what to do.

To access login-protected content:

  1. Create a browser profile:
     webpeel profile create polymarket

  2. A browser opens — log in to the site normally

  3. Press Ctrl+C when done (cookies are saved)

  4. Fetch with your profile:
     webpeel "https://polymarket.com/@user" --profile polymarket

Profiles are saved in ~/.webpeel/profiles/ and can be reused.

  webpeel profile list              — see all saved profiles
  webpeel profile delete <name>     — remove a profile

## 55+ Domain Extractors (automatic)

These sites get instant structured data via dedicated API — no browser needed:
Amazon, Reddit, YouTube, GitHub, Wikipedia, ESPN, Polymarket, Kalshi, TradingView,
Hacker News, NPM, PyPI, Stack Overflow, and 40+ more.

If the URL matches a supported domain, WebPeel uses the extractor automatically.
You never need to configure this.

## Output Options

  Default            → clean markdown (LLM-optimized, 65-98% token reduction)
  --json             → full JSON with metadata, token count, method used
  --raw              → full page HTML/text, no smart extraction
  --budget N         → distill content to N tokens (smart summarization)
  --schema NAME      → extract structured data (product, article, recipe, job, event, contact, review)
  --silent           → suppress progress spinner (for piping output)
  --question "..."   → answer a specific question about the page (BM25, no LLM needed)

## MCP Server

For Claude Desktop, Cursor, VS Code — add to your MCP config:

  {
    "mcpServers": {
      "webpeel": {
        "command": "npx",
        "args": ["-y", "webpeel", "mcp"]
      }
    }
  }

Available MCP tools: webpeel (smart), webpeel_read, webpeel_see, webpeel_find,
                     webpeel_extract, webpeel_monitor, webpeel_act

## Troubleshooting

  Very little content?              → Add --render
  Still blocked?                    → Add --stealth (implies --render)
  SPA not loading data?             → --render --action 'wait:3000'
  Screenshot fails?                 → Run: npx playwright install chromium
  Wrong content for /profile pages? → Content is client-side routed. Use --render.
  Need to extract specific fields?  → Use --schema or --json with jq

## Examples

  # Fetch a static page
  webpeel https://example.com

  # Fetch a React SPA (Polymarket, Airbnb, etc.)
  webpeel https://polymarket.com --render

  # Scroll and load all predictions on Polymarket
  webpeel https://polymarket.com --render --action 'scroll:bottom' --action 'wait:2000'

  # Get Cloudflare-protected site
  webpeel https://someprotectedsite.com --stealth

  # Extract product data from Amazon
  webpeel https://amazon.com/dp/B09X3PRGT7 --schema product --json

  # Get YouTube transcript
  webpeel https://youtube.com/watch?v=dQw4w9WgXcQ

  # Screenshot on mobile viewport
  webpeel screenshot https://stripe.com/pricing --viewport mobile

  # Search and get top results
  webpeel search "best TypeScript ORM 2024"

  # Watch a page for price changes
  webpeel watch https://store.example.com/product

  # Limit output to 500 tokens
  webpeel https://longpage.com --budget 500

  # Silent JSON output (pipe-friendly)
  webpeel https://example.com --json --silent | jq .tokens
`.trimStart();

export function registerGuideCommand(program: Command): void {
  program
    .command('guide')
    .description('Print AI-optimized usage guide to stdout')
    .action(() => {
      process.stdout.write(GUIDE);
      process.exit(0);
    });
}
