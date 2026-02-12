# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
