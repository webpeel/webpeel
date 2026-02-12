# WebPeel Business Plan

## Revenue Model: Open Core + Hosted API

### Why This Works

The AI agent market is exploding. Every Claude Code session, every Cursor tab, every Codex CLI run needs web access. The official MCP Fetch server is basic — no JavaScript rendering, no anti-bot bypass. Firecrawl charges $16-333/mo and has a joke free tier (500 pages one-time). There's a massive gap.

**Our moat:** Local-first open source creates adoption. Hosted API creates revenue. The pattern is proven (Supabase, Vercel, PostHog).

### Revenue Streams

#### 1. Hosted API (Primary — 80% of revenue)

| Plan | Price | Requests/mo | Features |
|------|-------|-------------|----------|
| Free | $0 | 1,000 | Simple fetch, markdown, search |
| Pro | $9/mo | 25,000 | + Browser rendering, 10 concurrent |
| Scale | $29/mo | 100,000 | + Residential proxies, AI extraction |
| Enterprise | Custom | Unlimited | Dedicated infra, SLA, priority support |

**Why pay when CLI is free?**
- Speed: hosted is 3-5x faster (pre-warmed browsers, cached results)
- Proxies: bypass geo-blocks and rate limits
- Concurrency: parallel fetching at scale
- Uptime: 99.9% SLA for production
- No local Playwright: saves 400MB+ disk space

**Unit economics:**
- Simple fetch: ~$0.0001 per request (just bandwidth)
- Browser fetch: ~$0.002 per request (compute + memory)
- At $9/mo with 25K requests: $0.00036/request → ~$0.002 cost = 5x margin
- At $29/mo with 100K requests: better margins with caching

#### 2. VoltBee Integration (Licensing as a Service)

Use VoltBee to handle API key generation, billing, and usage tracking. This dogfoods our own product AND gives VoltBee a real customer.

**Implementation:**
- WebPeel API → VoltBee for license validation
- VoltBee Stripe Connect for payments
- Self-referencing: "WebPeel is powered by VoltBee" in API docs

#### 3. GitHub Sponsors / Open Source Funding

- GitHub Sponsors enabled (`.github/FUNDING.yml`)
- "Sponsored by" logos on README for $100+/mo sponsors
- Open Collective for team support

### Distribution Strategy (Ranked by Impact)

#### Tier 1: MCP Ecosystem (Highest ROI)

1. **MCP Registry** — Submit to `registry.modelcontextprotocol.io`
   - Status: `server.json` manifest ready
   - This is the #1 discovery channel for Claude Desktop, Cursor, VS Code
   - One-click install buttons in README

2. **npm Package** — `npx webpeel` (zero friction)
   - No install needed, works immediately
   - Powers the MCP server too (`npx webpeel mcp`)

3. **CLAUDE.md Pattern** — One-liner for AI coding tools
   ```
   # Web Access
   Use `npx webpeel <url>` to fetch any web page as markdown.
   For search: `npx webpeel search "query"`
   ```

#### Tier 2: Community (Medium ROI)

4. **Reddit** — r/ClaudeAI, r/cursor, r/LocalLLaMA, r/selfhosted
5. **Hacker News** — "Show HN: WebPeel – open source web fetcher for AI agents"
6. **X/Twitter** — Target: @steipete, @mcaborern, AI developer community
7. **Product Hunt** — "The Firecrawl alternative that runs locally"

#### Tier 3: Integrations (Long-term ROI)

8. **OpenClaw Skill** — built-in for OpenClaw users
9. **GitHub Action** — `uses: JakeLiuMe/webpeel-action@v1`
10. **VS Code Extension** — MCP configuration helper
11. **Docker Hub** — `docker run webpeel/webpeel`

### Competitive Positioning

```
                    Free Local CLI    JS Rendering    Anti-Bot    Price
Official MCP Fetch      ❌               ❌            ❌        Free
WebPeel                 ✅               ✅            ✅        Free/$9+
Firecrawl               ❌               ✅            ✅        $16+/mo
Jina Reader             ❌               ✅            ❌        Rate-limited
ScrapingBee             ❌               ✅            ✅        $49+/mo
```

**Our pitch:** "When the official MCP fetch can't get through, WebPeel can. And it's free."

### Revenue Projections (Conservative)

| Month | npm Installs | Free Users | Paid Users | MRR |
|-------|-------------|------------|------------|-----|
| 1 | 500 | 50 | 2 | $18 |
| 2 | 2,000 | 200 | 10 | $90 |
| 3 | 5,000 | 500 | 30 | $270 |
| 6 | 20,000 | 2,000 | 100 | $900 |
| 12 | 50,000 | 5,000 | 300 | $2,700 |

**Break-even:** ~$50/mo hosting costs, covered by Month 1-2.

### Infrastructure Costs

| Component | Provider | Cost |
|-----------|----------|------|
| API Server | Render/Railway | $7/mo (starter) |
| PostgreSQL | Neon | Free tier (existing) |
| Redis Cache | Upstash | Free tier (10K/day) |
| Browser Pool | Render worker | $7/mo |
| Domain | webpeel.dev | $12/year |
| **Total** | | **~$15/mo** |

### Launch Checklist

- [ ] npm publish `webpeel@0.1.0`
- [ ] GitHub repo public with CI/CD
- [ ] MCP Registry submission
- [ ] VS Code one-click install badge
- [ ] Landing page deployed to webpeel.dev
- [ ] `/health` endpoint live on api.webpeel.dev
- [ ] Reddit posts (r/ClaudeAI, r/cursor)
- [ ] Hacker News "Show HN" post
- [ ] X/Twitter launch thread
- [ ] OpenClaw skill published to clawhub.com

### Key Metrics to Track

- npm weekly downloads
- MCP Registry impressions (if available)
- API requests/day (free + paid)
- Conversion rate: free → paid
- Churn rate
- Customer acquisition cost ($0 for organic)
