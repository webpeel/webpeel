# Contributing to WebPeel

Thanks for your interest in contributing! WebPeel is open source under the AGPL-3.0 license, and we welcome contributions from everyone.

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm

### Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/webpeel.git
cd webpeel

# Install dependencies
pnpm install

# Install Playwright (needed for browser-based tests)
npx playwright install chromium

# Build
pnpm build

# Run tests
pnpm test
```

### Environment Variables

Copy `.env.example` to `.env` and fill in any needed values. Most features work without any API keys — only LLM-based extraction requires an external key.

## Project Structure

```
webpeel/
├── src/
│   ├── core/           # Core library — fetcher, strategies, cache, cleaning
│   │   ├── fetcher.ts          # HTTP + browser fetch implementations
│   │   ├── strategies.ts       # Smart escalation (simple → browser → stealth)
│   │   ├── strategy-hooks.ts   # Plugin interface for strategy extensions
│   │   ├── cleaner.ts          # HTML → clean markdown conversion
│   │   ├── cache.ts            # LRU + SWR caching
│   │   ├── dns-cache.ts        # DNS pre-resolution
│   │   ├── crawler.ts          # Multi-page crawl engine
│   │   └── search.ts           # DuckDuckGo + Brave search
│   ├── mcp/            # MCP (Model Context Protocol) server — 11 tools
│   │   └── server.ts           # All MCP tool definitions
│   ├── server/         # Express API server (hosted version)
│   │   ├── app.ts              # Server setup + routes
│   │   ├── middleware/         # Auth, rate limiting, CORS, security
│   │   └── premium/           # Server-only premium features
│   ├── tests/          # Vitest test suites
│   └── types/          # Shared TypeScript types
├── site/               # Marketing website (webpeel.dev)
│   ├── blog/           # Blog posts (static HTML)
│   └── docs/           # Documentation pages
├── dashboard/          # Next.js dashboard app (app.webpeel.dev)
├── sdk/                # Python SDK
├── benchmarks/         # Performance benchmark suite
├── scripts/            # Build and release scripts
└── .github/            # CI workflows + issue templates
```

### Key Concepts

- **Smart Escalation**: WebPeel tries the fastest method first (HTTP fetch), then automatically escalates to browser rendering, then stealth mode if needed.
- **Strategy Hooks**: A plugin system (`src/core/strategy-hooks.ts`) that lets the server layer add premium strategies without modifying core code.
- **MCP Tools**: 11 tools exposed via the Model Context Protocol for AI assistants.

## Making Changes

### Workflow

1. **Fork** the repo and create a feature branch from `main`
2. **Make your changes** with clear, focused commits
3. **Add tests** if you're adding features or fixing bugs
4. **Run the test suite**: `pnpm test`
5. **Run type checking**: `pnpm build` (includes `tsc`)
6. **Submit a PR** against `main`

### Code Style

- TypeScript for all source code
- Use existing patterns — look at similar code before writing new code
- Keep functions focused and well-named
- Add JSDoc comments for public APIs
- No magic numbers — use named constants

### Tests

Tests use Vitest. Run them with:

```bash
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
```

Some tests require network access (integration tests). These are skipped in CI. If you're adding a test that hits external services, use the `skipInCI` pattern from existing tests.

### Commit Messages

Use conventional commits:

```
feat: add new content extraction strategy
fix: handle timeout in browser fetch
docs: update API reference for /v1/crawl
test: add tests for stealth mode bypass
chore: update dependencies
```

## What to Work On

Check the [issues page](https://github.com/webpeel/webpeel/issues) for:
- 🏷️ `good first issue` — great starting points
- 🏷️ `help wanted` — we'd love help with these
- 🏷️ `enhancement` — feature requests

If you want to work on something not listed, open an issue first to discuss the approach.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Link to the related issue if one exists
- Make sure CI passes before requesting review
- Be open to feedback — we review carefully

## Reporting Bugs

Use the [bug report template](https://github.com/webpeel/webpeel/issues/new?template=bug_report.md) and include:
- Steps to reproduce
- Expected vs actual behavior
- Your environment (Node version, OS)

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license. See [LICENSE](LICENSE) for details.

For commercial licensing inquiries: support@webpeel.dev
