# WebPeel — Architecture

## Project Structure

```
webpeel/
├── src/
│   ├── index.ts              # Main library exports
│   ├── cli.ts                # CLI entry point (npx webpeel)
│   ├── core/
│   │   ├── fetcher.ts        # Core fetch logic (simple + browser)
│   │   ├── markdown.ts       # HTML → clean markdown conversion
│   │   ├── metadata.ts       # Extract structured metadata
│   │   └── strategies.ts     # Smart escalation (simple → browser → stealth)
│   ├── server/
│   │   ├── app.ts            # Express API server
│   │   ├── routes/
│   │   │   ├── fetch.ts      # GET /v1/fetch
│   │   │   ├── health.ts     # GET /health
│   │   │   └── search.ts     # GET /v1/search (DuckDuckGo proxy)
│   │   ├── middleware/
│   │   │   ├── auth.ts       # API key auth
│   │   │   ├── rate-limit.ts # Rate limiting
│   │   │   └── usage.ts      # Track usage per key
│   │   └── db/
│   │       └── schema.sql    # Neon PostgreSQL schema
│   └── mcp/
│       └── server.ts         # MCP server for Claude/Cursor
├── tests/
│   ├── fetcher.test.ts
│   ├── markdown.test.ts
│   └── cli.test.ts
├── package.json
├── tsconfig.json
├── LICENSE                   # MIT
├── README.md
└── CHANGELOG.md
```

## Key Design Decisions

1. **Single package, multiple entry points:**
   - `npx webpeel <url>` — CLI
   - `import { peel } from 'webpeel'` — Library
   - `npx webpeel serve` — Self-hosted API
   - `npx webpeel mcp` — MCP server

2. **Smart escalation:** simple fetch → headless browser → stealth mode
   - Don't spin up a browser unless needed (fast by default)

3. **Markdown-first output:** AI agents want markdown, not HTML
   - Uses Turndown + custom rules to produce clean, token-efficient markdown

4. **Zero config:** works with `npx webpeel <url>` — nothing to configure

5. **TypeScript throughout** — proper types, no `any`

## Output Format

```json
{
  "url": "https://x.com/steipete",
  "title": "Peter Steinberger (@steipete)",
  "content": "## Peter Steinberger\n\nPolyagentmorous ClawFather...",
  "metadata": {
    "description": "...",
    "author": "...",
    "image": "...",
    "published": "..."
  },
  "links": ["https://..."],
  "tokens": 1234,
  "method": "browser",
  "elapsed": 2341
}
```
