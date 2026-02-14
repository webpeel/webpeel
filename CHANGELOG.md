# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-02-14

### Added
- **Page Actions**: Execute browser actions before scraping (`click`, `scroll`, `type`, `fill`, `select`, `press`, `hover`, `waitForSelector`)
  - CLI: `--action "click:.cookie-accept" --action "wait:2000" --action "scroll:bottom"`
  - Library: `peel(url, { actions: [{ type: 'click', selector: '.btn' }] })`
  - Actions auto-enable browser rendering
- **Structured Data Extraction**: Extract structured data using CSS selectors or JSON schema validation
  - CLI: `--extract '{"title": "h1", "price": ".price"}'`
  - Library: `peel(url, { extract: { selectors: { title: 'h1' } } })`
- **PDF Extraction**: Automatic PDF detection and text extraction with metadata
  - Works automatically for `.pdf` URLs
  - Extracts title, author, pages, creation date, and full text content
- **Map/Sitemap Discovery**: Discover all URLs on a domain (`webpeel map`)
  - Parses sitemap.xml, sitemap index files, and robots.txt
  - Combines with homepage link crawling for comprehensive URL discovery
  - CLI: `webpeel map https://example.com --max-urls 5000`
  - MCP: `webpeel_map` tool
- **Token Budget**: Intelligently truncate output to a maximum token count
  - CLI: `--max-tokens 2000`
  - Library: `peel(url, { maxTokens: 2000 })`
  - Uses tiktoken to estimate tokens and truncates content while preserving structure
- **Advanced Crawl Features**:
  - `--sitemap-first`: Discover URLs via sitemap before crawling (faster, more comprehensive)
  - Content fingerprint deduplication (skip duplicate pages)
  - BFS/DFS crawl strategy support
  - Include/exclude URL pattern matching
- **Rate Limit Headers**: Standard `X-RateLimit-*` headers on all API responses
- **New MCP Tools**: `webpeel_map` and `webpeel_extract`

### Changed
- **Usage-Gating Model**: All features (stealth, crawl, batch, actions, extraction) now available on all tiers including free. Only usage limits differentiate plans.
- All plan-specific feature restrictions removed from CLI, API, and documentation
- Updated landing page, README, and llms.txt to reflect new usage-gating model
- Pricing page emphasizes "All features on all plans"
- `webpeel_fetch` MCP tool now includes `actions`, `maxTokens`, and `extract` parameters
- `webpeel_crawl` MCP tool now supports `sitemapFirst` parameter

### Removed
- `checkFeatureAccess()` function from `cli-auth.ts` (feature-gating no longer needed)
- All references to "Pro plan required" or feature-tier restrictions

## [0.3.4] - 2026-02-13

### Added
- **Smart content extraction** — Auto-detects main content area (`<article>`, `<main>`, `.post-content`, largest text block). Strips navigation, footers, sidebars, cookie banners. **96% token savings** on typical blog/news pages.
- **JSON support** — Fetches JSON APIs directly, auto-formats with pretty-printing. `peel('https://api.example.com/data')` just works.
- **RSS/Atom feed parsing** — Detects RSS/XML feeds and extracts structured items with titles, links, and descriptions.
- **Plain text support** — text/plain, text/csv, text/markdown, JavaScript, CSS all accepted and returned as-is.
- **Content quality score** (`quality: 0-1`) — Measures extraction cleanliness based on compression ratio, text density, structure, and length.
- **Content fingerprint** (`fingerprint`) — SHA256 hash of content (16 chars) for change detection without storing pages.
- **`--raw` flag** — Skip smart content extraction, return full page with all boilerplate.

### Fixed
- JSON API endpoints (short responses) no longer trigger "suspiciously small response" error
- Cloudflare challenge detection limited to HTML content only

## [0.3.3] - 2026-02-13

### Added
- **Local caching** (`--cache <ttl>`) — Cache responses locally with TTL (e.g., `--cache 5m`, `--cache 1h`). Avoids repeat fetches and is kinder to target sites.
- **`webpeel config`** — View CLI configuration, auth status, and cache stats
- **`webpeel cache`** — Manage local cache: `stats`, `clear` (expired), `purge` (all)
- **`--links` flag** — Output only the links found on a page (one per line, or JSON array with `--json`)
- **`--meta` flag** — Output only page metadata (title, description, author, published date, etc.)
- **Stdin pipe for batch** — `cat urls.txt | webpeel batch` now works (file argument optional)

### Improved
- **Error messages** — Specific diagnostics for TLS/SSL errors, DNS failures, connection refused, connection reset, and network timeouts (no more generic "NETWORK" errors)
- Cache hit indicator (cyan `⚡ Cache hit` message) when using `--cache`

## [0.3.2] - 2026-02-13

### Fixed
- **CLI endpoint bug**: Fixed CLI calling `/v1/usage` (JWT-only) instead of `/v1/cli/usage` (API key auth)
- **CLI response format**: Rewrote response handling to match actual API response shape
- **API base URL**: Changed from `webpeel-api.onrender.com` to `api.webpeel.dev`
- **Stealth auto-render**: `--stealth` now correctly auto-enables `--render`
- **Dynamic versions**: Health endpoint and MCP server read version from package.json
- **Health check 429**: Moved health route before rate limiter to prevent Render restart loops
- **Removed CAPTCHA claims**: Removed AI CAPTCHA solving from roadmap and FAQ
- **Fixed competitor pricing**: Corrected Jina Reader price in comparison tables

### Added
- `webpeel whoami` command — shows auth status, masked API key, cached plan tier
- `webpeel login` validates API key against server before saving
- 5s timeout on all CLI API calls
- Billing page: upgrade buttons pass user email to Stripe checkout
- Billing page: honest extra usage info (replaced non-functional controls)

## [0.3.0] - 2026-02-12

### Added
- **Stealth Mode** (CRITICAL differentiator)
  - Added `playwright-extra` and `puppeteer-extra-plugin-stealth` dependencies
  - New `--stealth` flag in CLI to bypass bot detection
  - `stealth: true` option in library API
  - `stealth` parameter in MCP `webpeel_fetch` tool
  - Smart escalation now tries stealth mode as fallback when browser mode gets blocked (403, CAPTCHA)
  - Stealth plugin handles: navigator.webdriver, chrome.runtime, WebGL vendor, languages, permissions, codecs, etc.

- **Crawl Mode** (Firecrawl's killer feature)
  - New `webpeel crawl` CLI command with options: `--max-pages`, `--max-depth`, `--allowed-domains`, `--exclude`, `--ignore-robots`, `--rate-limit`
  - New `crawl(url, options)` function export in library API
  - New `webpeel_crawl` MCP tool for Claude/Cursor
  - Crawls starting URL and follows links matching domain/pattern
  - Respects robots.txt by default (can be disabled with `--ignore-robots`)
  - Rate limiting between requests (default 1 req/sec, honors `Crawl-delay` directive)
  - Maximum pages limit (default 10, max 100)
  - Maximum depth limit (default 2, max 5)
  - Returns array of `{url, markdown, title, links, depth, parent, elapsed, error?}` objects

- **Landing Page Improvements**
  - Added "Works with" section showing Claude, Cursor, VS Code, Windsurf, Cline, OpenAI
  - Updated comparison table with "Stealth mode" and "Crawl mode" rows
  - Updated terminal demo to show `--stealth` flag example
  - Updated meta description to mention stealth and crawl modes
  - Updated stats: "3 modes" (HTTP → Browser → Stealth)

- **README Improvements**
  - Added GitHub stars badge
  - Added "Why WebPeel?" section with 3 clear value propositions
  - Added quick comparison table at top (vs Firecrawl, Jina, MCP Fetch)
  - Added stealth mode and crawl mode examples to CLI section
  - Updated feature comparison table with stealth and crawl rows

### Changed
- Package version bumped to 0.3.0 in package.json, CLI, and MCP server
- Package description updated to mention stealth mode and crawl mode
- Method return value now includes 'stealth' as possible value (in addition to 'simple' and 'browser')

## [0.1.2] - 2026-02-12

### Changed
- npm package slimmed down: server code excluded (216KB removed), server deps moved to optional
- GitHub Actions keepalive workflow to prevent Render cold starts

### Fixed
- README "Hosted API" section updated (was "Coming Soon", now has live URL and curl examples)
- Pricing synced between README and landing page (removed pay-per-use track from README)

## [0.1.1] - 2026-02-12

### Added
- Free tier card on pricing page (500 pages/month, HTTP only)
- OG image, favicon (SVG/ICO/PNG), apple-touch-icon
- Email capture form on landing page
- MCP tool annotations (`readOnlyHint`, `idempotentHint`, `openWorldHint`)
- AI discoverability files: `.well-known/ai-plugin.json`, `llms.txt`, `server.json`
- GitHub issue templates and FUNDING.yml
- Sitemap and robots.txt

### Changed
- Landing page redesigned (Resend-inspired, violet accent on pure black)
- Premium effects: aurora background, noise texture, mouse-tracking glow, animated gradient borders
- Expanded npm keywords to 23 for discoverability

### Fixed
- Fixed `import { fetch }` → `import { peel }` in landing page code example
- Fixed MCP config `--mcp` → `mcp` in landing page
- Fixed hash-only link extraction in metadata.ts
- Fixed integration test URL trailing slash
- Fixed npm bin field path (`./dist/cli.js` → `dist/cli.js`)
- CLI version string now matches package.json

## [0.1.0] - 2026-02-12

### Added
- Initial release
- CLI with smart fetch (simple → browser → stealth escalation)
- Markdown output optimized for LLMs
- MCP server for Claude Desktop and Cursor
- DuckDuckGo search integration
- TypeScript support with full type definitions
- Self-hosted API server mode (`webpeel serve`)
- Configuration via `.webpeelrc` or inline options
- Automatic Cloudflare bypass
- JavaScript rendering with Playwright
- Stealth mode with playwright-extra
- Zero-config setup

[0.1.1]: https://github.com/JakeLiuMe/webpeel/releases/tag/v0.1.1
[0.1.0]: https://github.com/JakeLiuMe/webpeel/releases/tag/v0.1.0
