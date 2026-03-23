<p align="center">
  <a href="https://webpeel.dev">
    <img src=".github/banner.svg" alt="WebPeel — Web data API for AI agents" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/v/webpeel.svg?style=flat-square" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/webpeel"><img src="https://img.shields.io/npm/dm/webpeel.svg?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/webpeel/webpeel/stargazers"><img src="https://img.shields.io/github/stars/webpeel/webpeel?style=flat-square" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-WebPeel%20SDK-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://github.com/webpeel/webpeel/actions/workflows/ci.yml"><img src="https://github.com/webpeel/webpeel/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <strong>The web data platform for AI agents — fetch, search, crawl, extract, monitor, screenshot, and research any URL.</strong>
</p>

---

## Quick Start

```bash
npx webpeel "https://example.com"        # Clean markdown
npx webpeel search "AI trends 2025"       # Web search
npx webpeel crawl docs.example.com        # Crawl entire site
```

[Get your free API key →](https://app.webpeel.dev/signup) · No credit card required · 500 requests/week free

---

## Why WebPeel

- **65–98% token savings** — domain-specific extractors strip boilerplate, ads, and nav before content reaches your agent
- **29 domain extractors** — purpose-built parsers for Reddit, Wikipedia, GitHub, Hacker News, YouTube, ArXiv, Amazon, and 22 more
- **Zero-config Cloudflare bypass** — 4-layer escalation stack handles TLS fingerprinting, edge proxying, and cache fallback automatically

---

## Features

| Feature | Command / API |
|---------|---------------|
| Fetch any URL | `webpeel "url"` |
| Web search | `webpeel search "query"` |
| Crawl sites | `webpeel crawl "url" --max-pages 50` |
| Screenshots | `webpeel screenshot "url"` |
| Monitor changes | `webpeel monitor "url" --interval 300` |
| Browser actions | `--action 'click:.btn,wait:2000'` |
| YouTube transcripts | auto-detected |
| PDF extraction | auto-detected |
| MCP server | `webpeel mcp` |
| Schema extraction | `POST /v1/fetch` with `extract.schema` |
| Research agent | `POST /v1/agent` |
| Smart search | `POST /v1/search/smart` |

---

## MCP Integration

Give Claude, Cursor, or any MCP-compatible agent the ability to browse the web in one config change.

**Claude Desktop** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

**Cursor / VS Code** (`.cursor/mcp.json` or `.vscode/mcp.json`):
```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["-y", "webpeel", "mcp"],
      "env": {
        "WEBPEEL_API_KEY": "wp_your_key_here"
      }
    }
  }
}
```

Available MCP tools: `webpeel_read`, `webpeel_find`, `webpeel_see`, `webpeel_extract`, `webpeel_monitor`, `webpeel_act`, `webpeel_crawl`

[Full MCP setup guide →](https://webpeel.dev/docs/mcp)

---

## API Example

```bash
# Fetch any page — returns clean markdown + metadata
curl "https://api.webpeel.dev/v1/fetch?url=https://stripe.com/pricing" \
  -H "Authorization: Bearer $WEBPEEL_API_KEY"
```

```json
{
  "url": "https://stripe.com/pricing",
  "markdown": "# Stripe Pricing\n\n**Integrated per-transaction fees**...",
  "metadata": {
    "title": "Pricing & Fees | Stripe",
    "tokens": 420,
    "tokensOriginal": 8200,
    "savingsPct": 94.9
  }
}
```

[Full API reference →](https://webpeel.dev/docs/api)

---

## Token Efficiency

WebPeel's 29 domain-specific extractors strip navigation, ads, sidebars, and boilerplate before sending content to your agent.

| Site type | Raw HTML tokens | WebPeel tokens | Savings |
|-----------|:--------------:|:--------------:|:-------:|
| News article | 18,000 | 640 | **96%** |
| Reddit thread | 24,000 | 890 | **96%** |
| Wikipedia page | 31,000 | 2,100 | **93%** |
| GitHub README | 5,200 | 1,800 | **65%** |
| E-commerce product | 14,000 | 310 | **98%** |

Less context used = lower costs + faster inference + longer agent chains.

---

## Security

WebPeel is built with security-first principles:

- **Helmet.js headers** — HSTS, X-Frame-Options, nosniff, XSS protection on all responses
- **Webhook signing** — HMAC-SHA256 signatures on all outbound webhooks
- **Audit logging** — every API call logged with IP, key, and action
- **GDPR compliant** — `DELETE /v1/account` for full data erasure
- **SSH hardened** — Fail2Ban, MaxAuthTries, key-only auth on all infrastructure

[Security policy →](https://webpeel.dev/security)

---

## Links

- 📖 [Documentation](https://webpeel.dev/docs) — Guides, references, and examples
- 💰 [Pricing](https://webpeel.dev/pricing) — Plans and limits
- 📝 [Blog](https://webpeel.dev/blog) — Tutorials, comparisons, and use cases
- 📊 [Status](https://webpeel.dev/status) — Uptime and incidents
- 🔒 [Security](https://webpeel.dev/security) — Security policy and disclosure
- 📋 [SLA](https://webpeel.dev/sla) — Uptime commitments

---

## Contributing

Pull requests welcome! Please open an issue first to discuss major changes.

1. Fork the repo
2. Create your feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

---

## License

[WebPeel SDK License](LICENSE) — free for personal and commercial use with attribution. See LICENSE for full terms.

<p align="center">
  <a href="https://app.webpeel.dev/signup">Get started free →</a>
</p>
