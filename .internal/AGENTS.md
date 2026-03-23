# AGENTS.md — WebPeel Development Guide

## Quick Start

```bash
git clone https://github.com/webpeel/webpeel
cd webpeel
npm install
npm run build
npm test
```

## Architecture

```
src/
├── core/
│   ├── pipeline.ts          # Main processing pipeline (8 stages)
│   ├── strategies.ts        # Fetch strategy selection + proxy rotation
│   ├── domain-extractors.ts # API-first extractors (Reddit, GitHub, etc.)
│   ├── markdown.ts          # HTML→Markdown + cleanForAI
│   ├── http-fetch.ts        # HTTP fetching (simpleFetch)
│   ├── browser-fetch.ts     # Playwright browser fetching
│   └── bm25-filter.ts       # BM25 scoring for content relevance (DO NOT MODIFY)
├── server/
│   ├── routes/              # Express API routes
│   ├── middleware/          # Auth, rate limiting, CORS
│   └── openapi.yaml         # OpenAPI 3.1 spec
├── mcp/
│   └── server.ts            # MCP server (7 tools)
├── cli.ts                   # CLI entry point (Commander.js)
├── types.ts                 # Core types (PeelOptions, PeelResult)
└── tests/                   # Vitest test files
```

## Key Concepts

### Domain-First Pipeline

For known domains (Reddit, GitHub, Wikipedia, etc.), we call their native API BEFORE launching a browser. This is faster, more reliable, and avoids anti-bot detection.

Flow: `getDomainExtractor(url)` → `extractDomainData('', url)` → if success, set `ctx.domainApiHandled = true` → skip browser fetch

### Fetch Strategy Cascade

1. Simple HTTP fetch (fastest)
2. Browser fetch (for JS-heavy sites)
3. Stealth browser (for anti-bot sites)
4. Stealth + wait (for aggressive anti-bot)
5. Proxy rotation (if `proxies` provided)

### Content Pipeline (8 stages)

1. `initialize` — Parse URL, set defaults
2. `checkCache` — Check response cache
3. `fetchContent` — Domain API or fetch strategy
4. `detectContentType` — Identify HTML/PDF/JSON
5. `parseContent` — Convert to requested format
6. `extractMetadata` — Title, description, JSON-LD
7. `postProcess` — Budget distillation, quality scoring
8. `buildResult` — Assemble final PeelResult

## Rules

- **DO NOT modify `src/core/bm25-filter.ts`** — it's stable and tested
- All tests must pass: `npx vitest run`
- TypeScript must compile: `npx tsc --noEmit`
- Maintain backward compatibility for `peel()` function signatures
- Use `fetchJson()` for API calls in domain extractors
- New domain extractors go in `src/core/domain-extractors.ts` + register in REGISTRY
