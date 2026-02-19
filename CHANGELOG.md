# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [0.10.0] - 2026-02-19

### 🚀 Features

- **Browser Profiles** — `webpeel profile create|list|show|delete` manages persistent browser sessions. Pass `--profile <name>` on `fetch` or `search` to reuse cookies, localStorage, and auth state across requests.
- **CSS Schema Extraction** — 6 bundled schemas: Booking.com, Amazon, eBay, Yelp, Walmart, and Hacker News. Use `--schema <name>` to apply a schema or `--list-schemas` to see all available. Domains auto-detected when no flag is provided.
- **LLM Extraction** — `--llm-extract [instruction]` extracts structured data from any page using an OpenAI-compatible endpoint (BYOK). Supports custom instructions, multiple output formats, and tracks token cost per request.
- **Hotel Search** — `webpeel hotels "destination" --checkin YYYY-MM-DD --checkout YYYY-MM-DD --sort price` runs parallel multi-source hotel searches and merges results. Expedia now works thanks to Stealth v2.

### 🛡️ Stealth

- **Stealth v2** — Fixed viewport fingerprint leaks, suppressed `__pwInitScripts` injection artifacts, and removed Chrome branding leaks from `navigator.userAgentData`. PerimeterX bypass is now reliable; Expedia confirmed working.
- **Challenge Detection wired end-to-end** — `detectChallenge()` now runs automatically after every fetch (not just on escalation). Added 17 new detection signals. PerimeterX and DataDome errors now include `vendor` and `confidence` fields.

### 🔒 Security

- **PostgreSQL TLS secure-by-default** — `DB_SSL_REJECT_UNAUTHORIZED` now defaults to `true`; opt-out required for dev/self-hosted environments.
- **Timing oracle fix** — Login path uses constant-time comparison with a dummy bcrypt hash to prevent user-enumeration via response timing.
- **OAuth rate limiter per-IP** — Rate limiting on OAuth routes is now per source IP address (was per provider), preventing a single abuser from triggering a global DoS.

### 🐛 Fixes

- **Title cleaning** — Strip Google Travel price suffixes (e.g. "· $149"), remove "Opens in new window" artifacts, and filter ad-network prefixes from page titles.
- **Multi-cluster extraction** — Improved listing extraction on pages with diverse content (e.g. Hacker News threads, mixed-media pages) by segmenting DOM clusters before scoring.

### 📚 Documentation

- CLI reference updated: `webpeel profile`, `webpeel hotels`, `--schema`, `--list-schemas`, `--llm-extract`, `--profile` flag documented.
- README Quick Start updated with hotel search and LLM extraction examples.
- Feature comparison table updated to reflect v0.10.0 capabilities.

---

## [0.9.0] - 2026-02-18

### Added
- **Dynamic challenge detection** — automatically detects Cloudflare, PerimeterX, Akamai, DataDome, Incapsula, and generic block pages with confidence scoring (0-1)
- **Site-aware search** — `webpeel search --site ebay "query"` with 27 built-in sites across 7 categories (shopping, general, social, tech, jobs, real-estate, food)
- **Agent mode** — `--agent` flag sets JSON output, silent mode, extraction, and 4,000 token budget in one shot
- **Listing extraction** — `--extract-all` auto-detects repeated DOM patterns (product cards, search results)
- **Table/CSV output** — `--table` for Unicode box-drawing tables, `--csv` for CSV export
- **Multi-page pagination** — `--pages <n>` follows next-page links automatically
- **Infinite scroll extraction** — `--scroll-extract [count]` for lazy-loaded content
- `webpeel sites` command to list all supported site templates
- `agentMode` option in library API and MCP server defaults (4,000 token budget)
- `challengeDetected` flag on responses when a site can't be bypassed

### Changed
- Full escalation cascade: simple → browser → stealth → stealth+wait → return with warning
- **28 stealth domains** with auto-detection (Amazon, eBay, Walmart, Nike, LinkedIn, Etsy, and more)
- **15 browser domains** for SPA rendering (Reddit, Medium, Notion, Figma, Substack, etc.)
- Updated user agents to Chrome 132-136 (was 120-130)
- Dynamic `Sec-CH-UA` header generation matching actual user agent string
- Challenge pages are never cached (prevents cache poisoning)

### Security
- PostgreSQL TLS: configurable `rejectUnauthorized` via `DB_SSL_REJECT_UNAUTHORIZED` env var
- Login timing oracle fixed: constant-time auth with dummy bcrypt hash
- OAuth rate limiter: per-IP instead of per-provider (prevents global DoS)
- Content accuracy: fixed misleading claims (benchmark, migration savings)
- SDK docs: removed non-existent LangChain/LlamaIndex integrations

## [0.8.1] - 2026-02-17

### Fixed
- npm publish fix — corrected package entry points and exports
- All MIT references updated to AGPL-3.0 across site, README, and docs
- Homepage version badge updated to v0.8.1
- API docs OpenAPI version updated

## [0.8.0] - 2026-02-17

### Changed
- **License changed from MIT to AGPL-3.0** — protects the project while staying open source. Commercial licensing available.
- Premium server architecture — SWR cache, domain intelligence, and parallel race strategy now server-only (not shipped in npm package)

### Added
- Hook-based strategy pattern for extensible fetch pipeline
- Stale-while-revalidate caching with 30s revalidation timeout guard
- Domain intelligence learns which sites need browser/stealth from traffic history
- Chrome 131 impersonation headers for better anti-detection
- GFM table conversion, enhanced content cleaning (paywall gates, chat widgets)
- Benchmark v7: 100% success rate, 373ms median, 92.3% quality
- Dashboard security headers hardened (HSTS, X-XSS-Protection, Permissions-Policy)

## [0.7.0] - 2026-02-14

### Added — "Launch & Polish" Release

#### Interactive Playground
- **Live playground at webpeel.dev/playground** — Try WebPeel in your browser without installing anything
- Real-time markdown preview with syntax highlighting
- Four operation modes: Scrape, Search, Crawl, and Map
- Full options UI: stealth mode toggle, page actions builder, structured extraction, token budget control, output format selection
- One-click example URLs (Hacker News, Wikipedia, blog posts, e-commerce sites)
- Code generation panel: auto-generates cURL, Node.js, Python, and CLI commands from UI settings
- Export results as markdown or JSON with one click
- Anonymous access enabled (first 25 fetches, no signup required)
- Mobile-responsive design 

#### Firecrawl-Compatible API
- **Drop-in Firecrawl replacement** — Migrate by changing only the base URL
- Compatible endpoints: `POST /v1/scrape`, `POST /v1/crawl`, `GET /v1/map`, `GET /v1/search`
- Request/response format matches Firecrawl's API specification exactly
- Migration guide at webpeel.dev/migrate-from-firecrawl with side-by-side examples
- Supports existing Firecrawl SDKs (JavaScript, Python) with config override
- Query parameter mapping: Firecrawl params automatically translated to WebPeel equivalents
- Response format includes both WebPeel and Firecrawl field names for compatibility

#### Documentation Site
- **Comprehensive documentation at webpeel.dev/docs/** — 6 major doc sections
- Quick Start guide with step-by-step installation and first fetch
- API Reference with detailed endpoint documentation and code samples (cURL, Node.js, Python)
- SDK Guide covering JavaScript/TypeScript library and Python SDK usage
- CLI Reference with all commands, flags, and examples
- MCP Server integration guide for Claude Desktop, Cursor, VS Code, and Windsurf
- Self-Hosting guide with Docker setup, environment variables, and deployment options
- Comparison page: WebPeel vs Firecrawl vs Jina Reader vs MCP Fetch (feature matrix)
- Migration guide from Firecrawl
- Interactive code examples with live API calls

#### AI Agent Skill
- **Pre-built AI agent skill** for rapid integration with AI coding assistants
- Installation: `npx skills add webpeel/webpeel` (works with Claude Code, Cursor, OpenCode, etc.)
- Natural language interface: agent understands "fetch the latest HN posts" and auto-selects `webpeel_fetch` + `webpeel_search`
- Intelligent tool routing: knows when to use fetch vs crawl vs map vs extract based on user intent
- Error recovery patterns: auto-retry with stealth mode on 403/503, fallback to simple mode on timeout
- Compatible with 35+ AI coding assistants (Claude Code, Cursor, Windsurf, Cline, Aider, etc.)

#### New Integrations
- **CrewAI integration** (`integrations/crewai/`) — WebPeelTool for CrewAI agents with async support
- **Dify integration** (`integrations/dify/`) — Custom tool manifest for Dify platform with YAML spec
- **n8n integration** (`integrations/n8n/`) — HTTP Request node configuration guide and workflow template
- **OpenAPI 3.0 specification** (`openapi.yaml`) — Full API spec for code generation and API clients

#### Python SDK on PyPI
- **Published to PyPI** — `pip install webpeel` now available globally
- Package name officially reserved: https://pypi.org/project/webpeel
- Zero dependencies for core functionality (pure stdlib with urllib.request)
- Async support with optional `aiohttp` extra: `pip install webpeel[async]`
- Full type hints for all methods (PEP 484 compliant, passes mypy strict mode)
- Comprehensive examples in `/python-sdk/examples/`: basic fetch, batch processing, crawling, search
- Error handling with custom exceptions: `WebPeelError`, `AuthError`, `RateLimitError`, `TimeoutError`
- Dataclass-based return types: `ScrapeResult`, `SearchResult`, `CrawlResult`, `MapResult`, `BatchResult`
- Published via GitHub Actions OIDC (trusted publisher, no manual token management)

#### Testing & Quality Assurance
- **219 comprehensive test cases** with 96% code coverage (up from 166 tests)
- New test suites:
  - Markdown extraction tests (heading preservation, link normalization, code block handling)
  - Metadata extraction tests (Open Graph, JSON-LD, Dublin Core, Twitter Cards)
  - AI agent endpoint tests (prompt handling, LLM integration, error recovery)
  - Firecrawl compatibility tests (request/response format matching)
- Integration tests for all API endpoints with real HTTP calls
- MCP tool validation tests (parameter passing, error handling, response format)
- Python SDK test suite using pytest (unit tests, integration tests, async tests)
- CLI command tests with snapshot assertions for output validation
- Browser rendering tests using Playwright Test (screenshot comparison, JS execution)
- Rate limiting and authentication flow tests (JWT, API key, anonymous)
- Performance benchmarks: latency (p50/p95/p99), memory usage, concurrency limits
- Security tests: SQL injection, XSS, CSRF, rate limit bypass attempts

#### Anonymous API Access
- **First 25 fetches work instantly** — No signup, no API key, no credit card required
- Anonymous rate limit: 25 fetches per IP address per 24-hour period
- Automatic upgrade prompt after reaching 25-fetch limit with registration link
- Free tier activation flow: email-only signup, no payment method required
- Usage tracking by IP address with Redis (TTL-based expiration after 24h)
- Anonymous users can access playground, docs, and basic API endpoints
- Anonymous quota displayed in playground UI
- Smooth transition from anonymous → free tier → paid tier

### Changed
- MCP server now includes 9 tools (added `webpeel_brand`, `webpeel_summarize`, `webpeel_agent`)
- Landing page redesigned with interactive playground embed in hero section
- README updated with PyPI installation instructions and Firecrawl migration guide
- API response format now includes `quality` score (0-1) and content `fingerprint` (SHA256 hash) for all endpoints
- Docker image optimized: 50% smaller using multi-stage build, Alpine base, and pruned dependencies
- Rate limit headers now use standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` format
- Error messages now include specific error codes (e.g., `RATE_LIMIT_EXCEEDED`, `STEALTH_REQUIRED`) for easier debugging

### Fixed
- CORS headers now include playground domain (`webpeel.dev`) in allowed origins
- Rate limit reset time calculation now uses UTC timezone (was off by local timezone offset)
- Stealth mode no longer double-launches browser when escalating from simple mode (2-3s speed improvement)
- Python SDK error messages now include HTTP status codes and response body for debugging
- MCP `webpeel_crawl` tool now correctly respects `maxPages` parameter (was ignoring it and using default)
- Playground code generation now properly escapes special characters in URL and JSON fields
- Anonymous usage counter now correctly resets after 24h (was persisting indefinitely)

## [0.6.0] - 2026-02-14

### Added — "Agent & Parity" Release
- **Agent endpoint** (`POST /v1/agent`) — Autonomous web research with just a prompt. No URLs required. BYOK LLM.
- **CLI `agent` command** — `webpeel agent "Find the founders of Stripe" --llm-key sk-...`
- **Include/exclude tags** — `--include-tags main,article` / `--exclude-tags nav,footer` for fine-grained filtering
- **Images extraction** — `--images` flag extracts all image URLs with alt text, dimensions, deduplication
- **AI summarization** — `--summary` generates summaries via BYOK LLM (OpenAI-compatible)
- **Location/language** — `--location US --language en` for geo-targeted scraping
- **Server-side caching** — `maxAge` and `storeInCache` query params on `/v1/fetch`
- **Search enhancements** — Categories (`github`, `pdf`, `news`), time filters (`tbs`), geo-targeting
- **MCP: webpeel_summarize** — New MCP tool for AI summarization
- **MCP: enhanced webpeel_fetch** — Added includeTags, excludeTags, images, location params
- **Only main content** — `--only-main-content` shortcut (includes main, article, .content)

### Fixed
- Branding extraction reuses browser page (no second launch, 2-5s savings)
- Dockerfile works correctly for Render deploys

## [0.5.0] - 2026-02-14

### Added — "9x Better" Release

#### Core Library
- **Branding Extraction**: Full design system extraction from any webpage — colors, fonts, typography, spacing, components, CSS variables, logo, favicon, dark/light detection
- **Change Tracking**: Local-first content change detection with file-based snapshots (`~/.webpeel/snapshots/`), unified diff output, change status tracking (new/same/changed/removed)
- **AI Extraction (BYOK)**: LLM-powered structured data extraction using any OpenAI-compatible API — bring your own key, works with OpenAI, Anthropic proxy, local models
- **Map with Search**: Relevance-based URL filtering in map command — score URLs by search term matches in path/title/description
- **Batch Processing**: `peelBatch()` function with concurrency control for processing multiple URLs

#### Server/API
- **Async Job Queue**: In-memory job queue for crawl and batch operations with progress tracking, cancellation, and auto-expiration (24h)
- **SSE Streaming**: Real-time progress updates via Server-Sent Events (`Accept: text/event-stream`)
- **Webhook Callbacks**: HMAC-SHA256 signed webhook notifications for job events (started/page/completed/failed) with retry logic
- **Batch Scrape API**: `POST /v1/batch/scrape` with concurrent processing (max 5) and structured extraction
- **Async Crawl API**: `POST /v1/crawl` returns job ID, `GET /v1/crawl/:id` for status/results
- **Enhanced Search**: Multi-source search (web/news/images via DuckDuckGo), optional auto-scrape of result URLs

#### Python SDK (`python-sdk/`)
- **Zero-dependency Python SDK**: Pure stdlib (urllib.request), Python 3.8+ compatible
- Methods: `scrape()`, `search()`, `crawl()`, `map()`, `batch_scrape()`, `get_job()`
- Proper error hierarchy: `WebPeelError`, `AuthError`, `RateLimitError`, `TimeoutError`
- Dataclass-based types: `ScrapeResult`, `SearchResult`, `CrawlResult`, `MapResult`, `BatchResult`

#### Integrations
- **LangChain Document Loader** (`integrations/langchain/`): `WebPeelLoader` with lazy_load, render/stealth support
- **LlamaIndex Reader** (`integrations/llamaindex/`): `WebPeelReader` for RAG pipelines

#### CLI
- `webpeel brand <url>` — Extract design system as JSON
- `webpeel track <url>` — Track content changes with diff output
- `webpeel summarize <url>` — AI-powered summary (requires --llm-key)
- `webpeel jobs` — List active async jobs
- `webpeel job <id>` — Check job status

#### MCP
- `webpeel_batch` — Batch fetch multiple URLs with concurrency control

#### New API Endpoints
- `POST /v1/crawl` — Start async crawl job
- `GET /v1/crawl/:id` — Get crawl status (JSON or SSE)
- `DELETE /v1/crawl/:id` — Cancel crawl
- `POST /v1/batch/scrape` — Start batch scrape
- `GET /v1/batch/scrape/:id` — Get batch status
- `DELETE /v1/batch/scrape/:id` — Cancel batch
- `GET /v1/jobs` — List all active jobs

#### Blog
- 4 SEO-optimized blog posts at `/blog/`: Firecrawl comparison, MCP guide, AI scraping guide, token optimization
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

[0.10.0]: https://github.com/webpeel/webpeel/releases/tag/v0.10.0
[0.9.0]: https://github.com/webpeel/webpeel/releases/tag/v0.9.0
[0.8.1]: https://github.com/webpeel/webpeel/releases/tag/v0.8.1
[0.8.0]: https://github.com/webpeel/webpeel/releases/tag/v0.8.0
[0.7.0]: https://github.com/webpeel/webpeel/releases/tag/v0.7.0
[0.6.0]: https://github.com/webpeel/webpeel/releases/tag/v0.6.0
[0.5.0]: https://github.com/webpeel/webpeel/releases/tag/v0.5.0
[0.4.0]: https://github.com/webpeel/webpeel/releases/tag/v0.4.0
[0.3.4]: https://github.com/webpeel/webpeel/releases/tag/v0.3.4
[0.3.3]: https://github.com/webpeel/webpeel/releases/tag/v0.3.3
[0.3.2]: https://github.com/webpeel/webpeel/releases/tag/v0.3.2
[0.3.0]: https://github.com/webpeel/webpeel/releases/tag/v0.3.0
[0.1.2]: https://github.com/webpeel/webpeel/releases/tag/v0.1.2
[0.1.1]: https://github.com/webpeel/webpeel/releases/tag/v0.1.1
[0.1.0]: https://github.com/webpeel/webpeel/releases/tag/v0.1.0
