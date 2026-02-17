# WebPeel Competitive Analysis Report
**Date: February 15, 2026**

---

## Executive Summary

WebPeel competes in the "web data for AI" space against six established players. This analysis reveals that WebPeel's strongest differentiators are its **pricing** (5-20x cheaper), **AGPL-3.0 open-source license**, **local-first architecture**, and **Firecrawl API compatibility**. Its biggest weaknesses are **brand recognition**, **search quality** (DuckDuckGo vs. proprietary indices), **enterprise trust signals** (SOC 2, SLAs), and **scale/reliability** relative to VC-backed competitors.

**Updated Feb 16, 2026:** Added Jina Reader and ScrapingBee as competitors #5 and #6, with benchmark data.

---

## 1. Individual Competitor Profiles

---

### 1.1 LinkUp — https://www.linkup.so/

**What They Do:**
LinkUp is an AI-focused web search API from a Paris-based startup. Their core value prop is **factuality** — they claim #1 in the world on OpenAI's SimpleQA benchmark. They position as "the search engine for AI apps" with a strong emphasis on premium, licensed content sources (news publishers) and ethical data access.

**Raised:** €3M (Nov 2024). Covered by TechCrunch, BFM TV, La Tribune.

**Features:**
- `/search` endpoint — Standard (fast) and Deep (reasoning-quality, SOTA factuality)
- `/fetch` endpoint — Fetch a single webpage (with optional JS rendering)
- `/credits/balance` — Check credit balance
- Source/URL filtering, date filtering, max results parameter
- Image support in search results
- Structured output support
- Prompt optimizer tool (prompt.linkup.so)

**What They DON'T Have:**
- ❌ No crawl/sitemap/map
- ❌ No screenshots
- ❌ No structured data extraction (LLM-based)
- ❌ No batch/async jobs
- ❌ No agent/research endpoint
- ❌ No change tracking
- ❌ No PDF parsing
- ❌ No page actions (click, scroll, etc.)
- ❌ No CAPTCHA solving
- ❌ Not self-hostable / not open source
- ❌ No CLI

**SDKs:** Python, TypeScript, OpenAI SDK compatible
**Integrations:** LangChain, LlamaIndex, CrewAI, Dify, n8n, Claude Desktop (MCP), Vercel AI SDK, Composio, Make, Zapier, Pipedream, Clay, Cerebras, HuggingFace, Lovable, Google Sheets
**MCP:** Yes (linkup MCP server)

**Pricing:**
- Free: €5/month credit (~1,000 standard searches or ~100 deep searches)
- Pay as you go:
  - Standard search: €0.005/call (~$0.0054)
  - Deep search: €0.05/call (~$0.054)
  - Fetch (no JS): €0.001/call
  - Fetch (with JS): €0.005/call
- Custom/Enterprise with volume discounts (10-20% on €1K-10K+ top-ups)

**Unique Advantages Over WebPeel:**
1. **SOTA factuality** — #1 on SimpleQA benchmark; proprietary search index trained for accuracy
2. **Licensed premium content** — Legal access to news publishers (ethical positioning, TechCrunch coverage on this specifically)
3. **Deep search mode** — Multi-step reasoning search that's independently benchmarked
4. **EU-based** — Data privacy advantages for European customers
5. **Massive integration ecosystem** — 25+ integrations including Clay, Google Sheets, Zapier

**What WebPeel Has That LinkUp Doesn't:**
- Crawl, sitemap/map, batch scraping
- Screenshots, PDF parsing, structured extraction
- Agent endpoint (autonomous research)
- Change tracking, page actions, stealth mode, CAPTCHA solving
- Smart escalation (HTTP → browser)
- CLI, self-hosting, AGPL-3.0 open source
- Firecrawl compatibility API
- Branding extraction, image extraction
- Location/language targeting for scraping
- 5-10x cheaper for basic fetch operations

---

### 1.2 Exa — https://exa.ai/

**What They Do:**
Exa is a **proprietary neural search engine** built specifically for AI. Their moat is a custom search index with neural embeddings — not a wrapper around Google/Bing. They position as "the knowledge API" with semantic understanding, entity search (companies, people), and a proprietary web index updated every minute. Backed by notable investors, used by Notion, Vercel, Databricks, OpenRouter, Flatfile.

**Features:**
- **Search** — Neural/semantic search (Instant, Fast, Auto, Deep modes) with up to 1,000 results on enterprise plans
- **Contents** — Fetch full page content (text, highlights, summary) with livecrawl options
- **Answer** — LLM-generated answers with citations (like Perplexity-as-an-API)
- **Research** — Agent-based deep research (exa-research, exa-research-pro)
- **Context (Code Search)** — Find code snippets from open source repos
- **Websets** — Semantic web monitoring / dataset building
- **Company Search** — Fine-tuned company retrieval model
- **People Search** — 1B+ indexed LinkedIn/people profiles
- Crawling subpages
- Domain/path filtering, geolocation filtering, language filtering
- Livecrawl (fresh content) with "preferred" fallback mode
- Markdown contents as default
- SOC 2 Type II certified
- Zero Data Retention option
- SSO for enterprise
- OpenAI-compatible chat completions interface

**What They DON'T Have:**
- ❌ No page actions (click, scroll, type)
- ❌ No screenshots
- ❌ No PDF parsing (dedicated)
- ❌ No CAPTCHA solving
- ❌ No stealth mode / smart escalation
- ❌ No change tracking
- ❌ No branding extraction
- ❌ No batch scrape endpoint (separate from search)
- ❌ Not self-hostable (closed-source core)
- ❌ No CLI tool
- ❌ No Firecrawl API compatibility
- ❌ No BYOK AI — uses their own LLMs

**SDKs:** Python (`exa-py`), JavaScript (`exa-js`)
**Integrations:** LangChain, LlamaIndex, CrewAI, Google ADK, Browserbase, AgentOps, OpenRouter, Google Sheets
**MCP:** Yes — hosted at `mcp.exa.ai/mcp` (supports Cursor, VS Code, Claude Code, Claude Desktop, Codex, Windsurf, Zed, Gemini CLI, Warp, Kiro, Roo Code, v0, Google Antigravity — 15+ clients)

**Pricing (Pay-as-you-go):**
- $10 free credits to start
- Search: $5/1K requests (1-25 results), $25/1K (26-100 results), $15/1K (Deep)
- Contents: $1/1K pages (text, highlights, or summary — each billed separately)
- Answer: $5/1K answers
- Research: $5/1K search ops, $5-10/1K page reads, $5/1M reasoning tokens
- Custom/Enterprise with volume discounts
- Discounts for startups and education

**Effective cost per search+content:** ~$0.006/request (search + text content)

**Unique Advantages Over WebPeel:**
1. **Proprietary neural search index** — Not a wrapper around DuckDuckGo or Google. Custom ML models for semantic search. This is their fundamental moat
2. **Company & People search** — Fine-tuned models, 1B+ profiles indexed. Specific entity verticals
3. **Code search (Context)** — Specialized endpoint for finding code in open source repos
4. **Websets** — Semantic web monitoring and dataset construction
5. **Answer endpoint** — Built-in Perplexity-like Q&A with citations
6. **Enterprise trust** — SOC 2 Type II, Zero Data Retention, SSO, SLAs, used by Notion/Vercel/Databricks
7. **Search quality** — Consistently outperforms Brave/Parallel on benchmarks (62-73% vs 27-37%)
8. **Research agent** — Two-tier research with different reasoning capabilities
9. **MCP ecosystem** — Support for 15+ MCP clients

**What WebPeel Has That Exa Doesn't:**
- Full web scraping (page actions, stealth, CAPTCHA, smart escalation)
- Screenshots, PDF parsing
- Change tracking, branding extraction
- Batch scrape/crawl with async jobs
- CLI, self-hosting, AGPL-3.0 open source
- BYOK AI (no vendor lock-in on AI provider)
- Firecrawl API compatibility
- 3-10x cheaper on basic operations
- Include/exclude tags, image extraction
- Location targeting for scraping (not just search)

---

### 1.3 Tavily — https://www.tavily.com/

**What They Do:**
Tavily is the **default search tool for LangChain** and positions as "the search API built for AI agents." They raised $25M Series A (Aug 2025) and claim 1M+ developers and 100M+ monthly requests. Key partnerships with IBM (watsonx), Databricks (MCP marketplace), JetBrains, and Snowflake. They focus on being the drop-in search-for-agents solution with strong enterprise partnerships.

**Features:**
- **Search** — Basic and Advanced depth, with topic filtering (general, news), time range, domain include/exclude, country targeting, images, favicons, raw content, chunking
- **Extract** — Fetch and extract content from URLs (basic/advanced depth), supports images, markdown format
- **Crawl** — Graph-based website traversal with instructions-based discovery, parallel path exploration, depth/breadth controls, external link following
- **Map** — Generate comprehensive sitemaps with intelligent discovery
- **Research** — Comprehensive research endpoint (mini/pro models) with streaming, structured output schemas, citation formatting — "state-of-the-art" claims
- Agent Skills for Claude Code/Codex/Cursor
- Security layers: PII leakage protection, prompt injection blocking, malicious source blocking

**What They DON'T Have:**
- ❌ No screenshots
- ❌ No PDF parsing (dedicated)
- ❌ No page actions (click, scroll, type)
- ❌ No CAPTCHA solving
- ❌ No stealth mode / smart escalation
- ❌ No change tracking
- ❌ No branding extraction
- ❌ No batch scrape endpoint
- ❌ Not self-hostable / not open source
- ❌ No CLI
- ❌ No Firecrawl API compatibility
- ❌ No BYOK AI for research
- ❌ No image extraction from pages
- ❌ No async jobs (besides research)

**SDKs:** Python (`tavily-python`), JavaScript (`@tavily/core`)
**Integrations:** LangChain (official partner), LlamaIndex, CrewAI, OpenAI, Anthropic, Dify, n8n, Zapier, Make, FlowiseAI, Langflow, Vercel AI SDK, Google ADK, Composio, Pydantic AI, StackAI, Tines, Agno
**MCP:** Yes (Tavily MCP Server)
**Partnerships:** IBM watsonx, Databricks MCP Marketplace, JetBrains, Snowflake Marketplace

**Pricing:**
- Free: 1,000 credits/month (no CC required)
- Pay-as-you-go: $0.008/credit
- Project: $30/mo → 4,000 credits ($0.0075/credit)
- Bootstrap: $100/mo → 15,000 credits ($0.0067/credit)
- Startup: $220/mo → 38,000 credits ($0.0058/credit)
- Growth: $500/mo → 100,000 credits ($0.005/credit)
- Enterprise: Custom
- Free for students

**Credit costs:**
- Basic Search: 1 credit ($0.005-0.008)
- Advanced Search: 2 credits ($0.01-0.016)
- Basic Extract: 1 credit per 5 URLs ($0.001-0.0016/URL)
- Map: 1 credit per 10 pages
- Research Mini: 4-110 credits per request ($0.02-0.88)
- Research Pro: 15-250 credits per request ($0.075-2.00)

**Unique Advantages Over WebPeel:**
1. **LangChain's default search** — Massive distribution advantage. When devs build with LangChain, Tavily is the default
2. **Enterprise partnerships** — IBM, Databricks, JetBrains, Snowflake. These are TRUST signals WebPeel can't match
3. **Scale** — 1M+ developers, 100M+ monthly requests, 99.99% uptime SLA, 180ms p50 latency
4. **Research endpoint** — Streaming, structured output, citations. More mature than WebPeel's agent
5. **Security features** — PII leakage protection, prompt injection blocking, malicious source filtering — built for enterprise
6. **$25M in funding** — Can invest heavily in infrastructure, sales, partnerships
7. **Graph-based crawl** — Instructions-based intelligent crawl with natural language
8. **Student program** — Free for students (builds long-term developer loyalty)

**What WebPeel Has That Tavily Doesn't:**
- Screenshots, PDF parsing
- Page actions (click, scroll, type)
- CAPTCHA solving, stealth mode, smart escalation
- Change tracking, branding extraction
- Batch scrape with async jobs
- CLI, self-hosting, AGPL-3.0 open source
- BYOK AI for summaries/extraction
- Firecrawl API compatibility
- Image extraction from pages
- Significantly cheaper (WebPeel Pro $9/mo ≈ 1,250 ops vs Tavily $30/mo ≈ 4,000 credits)

---

### 1.4 Firecrawl — https://firecrawl.dev/

**What They Do:**
Firecrawl is the **closest direct competitor** to WebPeel. They're a Y Combinator-backed web scraping API that turns websites into LLM-ready markdown. 82.7K GitHub stars, trusted by 80,000+ companies. They claim 96% web coverage including JS-heavy and protected pages. Position: "The web data API for AI."

**Features:**
- **Scrape** — Any URL to markdown, HTML, or structured JSON. Multiple format options
- **Crawl** — Recursive crawl with depth/breadth controls, async with webhook support
- **Map** — Fast URL discovery for entire sites
- **Search** — Web search with full page content from results (web, news, images sources)
- **Agent** — Autonomous data gathering powered by Spark 1 Pro/Mini models (proprietary). Describe what you need, it searches and extracts
- **Extract** — LLM-based structured extraction with JSON schema (Pydantic/Zod support)
- **Batch Scrape** — Scrape multiple URLs in parallel
- **Change Tracking** — Detect content changes between scrapes (git-diff and JSON diff modes)
- **Document Parsing** — PDF and document support
- **Page Actions** — Click, scroll, write, wait, press, screenshot before extraction
- **Smart Wait** — Intelligent content load detection
- **Proxies** — Managed proxy rotation with enhanced mode for complex sites
- **Caching** — Selective caching with maxAge parameter (500% speed boost)
- **Screenshots** — Full page screenshots
- **Branding format** — Extract brand style guide data
- Skills/CLI — `npx skills add firecrawl/cli`

**Self-hosting:**
- ⚠️ **AGPL-3.0 license** (NOT MIT — viral copyleft, requires derivative works to be open source)
- Self-host is available BUT cloud has significant advantages: Fire-engine (proprietary scraper), managed proxies, actions, dashboard analytics
- Many features are cloud-only (the "open source vs cloud" comparison image on their docs makes this clear)

**SDKs:** Python (`firecrawl-py`), JavaScript (`@mendable/firecrawl-js`), CLI, Go, Rust (community)
**Integrations:** LangChain, LlamaIndex, OpenAI, Anthropic, Gemini, Google ADK, Vercel AI SDK, Mastra, Dify, n8n, Make, Zapier, LangGraph
**MCP:** Yes — supports Claude Code, Cursor, Windsurf, ChatGPT, Factory AI

**Pricing:**
- Free: 500 credits (one-time, not monthly!)
- Hobby: $16/mo → 3,000 credits/mo (5 concurrent, $9/extra 1K)
- Standard: $83/mo → 100,000 credits/mo (50 concurrent, $47/extra 35K)
- Growth: $333/mo → 500,000 credits/mo (100 concurrent, $177/extra 175K)

**Credit costs:**
- Scrape: 1 credit/page
- Crawl: 1 credit/page
- Map: 1 credit/page
- Search: 2 credits/10 results
- Agent: Dynamic pricing (5 free daily runs in preview)

**Unique Advantages Over WebPeel:**
1. **Brand & scale** — 82.7K GitHub stars, 80K+ companies, YC-backed. Massive ecosystem
2. **Proprietary Fire-engine** — Their scraper handles anti-bot, proxies, JS rendering at scale in ways that are hard to replicate
3. **Spark 1 Pro/Mini models** — Proprietary AI models for their agent endpoint (not BYOK — but purpose-built)
4. **Agent endpoint maturity** — More structured, with schema support (Pydantic/Zod), async job management
5. **Change tracking** — While WebPeel has it too, Firecrawl's git-diff + JSON modes are more mature
6. **Proxy infrastructure** — Managed proxies with enhanced mode, location-based routing
7. **Caching system** — maxAge parameter for 500% speed improvements
8. **Community size** — Large contributor base, extensive docs, many tutorials/cookbooks
9. **Enterprise features** — Activity logs, dashboard analytics, team management
10. **Multiple search sources** — Web, news, images in one search call

**What WebPeel Has That Firecrawl Doesn't:**
- **AGPL-3.0 license — same as Firecrawl, with commercial licensing available)
- **True local-first** — CLI works offline without any API key
- **Cheaper** — WebPeel Pro $9/mo for 1,250/wk vs Firecrawl Hobby $16/mo for 3,000/mo total. WebPeel Max $29/mo for 6,250/wk (~25K/mo) vs Firecrawl Standard $83/mo for 100K/mo
- **BYOK AI** — Use your own LLM for summaries/extraction (vs locked to Firecrawl's models)
- **Firecrawl API compatibility** — Drop-in replacement means zero migration cost
- **DuckDuckGo search** — Free, no credit cost for search (vs 2 credits per search on Firecrawl)
- **AI summary built-in** — BYOK LLM summaries on any scrape
- **Location/language targeting** for scraping
- **Stealth mode + smart escalation** — HTTP → browser auto-upgrade to save resources
- **CAPTCHA solving** built-in
- **Monthly recurring free tier** (125/week = 500/mo, recurring vs Firecrawl's one-time 500)

---

### 1.5 Jina Reader — https://jina.ai/reader / https://r.jina.ai

**What They Do:**
Jina Reader is a **URL-to-markdown API** from Jina AI (Berlin), now owned by **Elastic (NYSE: ESTC)** since October 2025. The core value prop is extreme simplicity: prepend `https://r.jina.ai/` to any URL and get clean markdown. No API key needed for basic use. They also offer `s.jina.ai` for web search (returns top-5 results with full markdown content) and `deepsearch.jina.ai` for reasoning-powered search. Reader is part of Jina's broader "Search Foundation" platform (embeddings, rerankers, ReaderLM-v2 small language model).

**Raised:** $39M total ($30M Series A, Nov 2021, led by Canaan Partners). Acquired by Elastic (NYSE: ESTC) Oct 2025.

**Features:**
- URL → markdown/HTML/text/screenshot via simple URL prefix
- Web search (`s.jina.ai`) with full content from top 5 results
- DeepSearch (multi-step reasoning search, OpenAI-compatible)
- ReaderLM-v2 (proprietary SLM for high-quality HTML→markdown/JSON, 3x token cost)
- CSS selector targeting, wait-for, exclude selectors
- PDF parsing (native)
- Image captioning via VLM
- Streaming mode for large pages
- JSON response mode
- Cookie forwarding, custom UA, custom Referer
- Proxy support (BYOP) + country-specific proxy geolocation
- Cache control / bypass
- Custom JavaScript execution before extraction
- Shadow DOM + iframe content extraction
- robots.txt respect (opt-in)
- EU compliance mode (all processing in EU)
- Token budget limiting
- Browser engine selection (quality vs speed)
- Markdown formatting controls (heading style, emphasis, links, etc.)
- OpenAI citation format
- Links/images summary sections
- MCP server at `mcp.jina.ai`

**What They DON'T Have:**
- ❌ No crawl/sitemap/map/batch
- ❌ No page actions (click, scroll, type)
- ❌ No CAPTCHA solving (explicitly does NOT bypass anti-bot)
- ❌ No stealth mode / smart escalation
- ❌ No change tracking
- ❌ No branding extraction
- ❌ No CLI tool
- ❌ No BYOK AI (uses their own ReaderLM-v2)
- ❌ Not practically self-hostable
- ❌ No Firecrawl API compatibility
- ❌ No agent/research endpoint (DeepSearch is separate)
- ❌ No dedicated SDKs

**SDKs:** None — designed to be SDK-less (URL prefix or curl with headers)
**Integrations:** LangChain, LlamaIndex (community), MCP server, OpenAI citation format, Google Colab
**MCP:** Yes (`mcp.jina.ai` — remote server with read, search, embeddings, reranking tools)

**Pricing:**
- Token-based (shared pool across all Jina APIs)
- Free: 10M tokens for new users (no CC), Reader works without API key at 20 RPM
- Paid: Pay-as-you-go tokens via Stripe (exact $/token not publicly listed)
- Reader billed by output tokens; Search costs fixed 10K+ tokens/request
- Rate limits: Free 20 RPM → Paid 500 RPM → Premium 5,000 RPM (Reader)
- Concurrency: Free 2 → Paid 50 → Premium 500
- Failed requests not charged
- Average latency: 7.9s (Reader), 2.5s (Search)

**GitHub:** jina-ai/reader — 9,806 ⭐, 755 forks, Apache-2.0 | jina-ai/MCP — 463 ⭐

**SOC 2:** Type 1 & Type 2 compliant. Processing 100B tokens/day. 4,000 max concurrent.

**Unique Advantages Over WebPeel:**
1. **Zero-friction onboarding** — URL prefix approach needs zero setup. Fastest "hello world" in the market
2. **Elastic backing (NYSE: ESTC)** — SOC 2, massive enterprise customer base (ByteDance, Alibaba, BCG, Singapore Airlines, Cloudflare). Trust signals WebPeel can't match
3. **ReaderLM-v2** — Purpose-built SLM for HTML→markdown/JSON. Higher quality conversion than rule-based approaches
4. **Image captioning** — VLM-powered alt text generation for images. Unique feature
5. **Combined search+read** — `s.jina.ai` fetches full content from top-5 search results in one call
6. **Scale** — 100B tokens/day, 4,000 concurrent. Proven at massive enterprise scale
7. **EU compliance mode** — Built-in EU data residency
8. **Broader platform** — Embeddings, rerankers, classifiers share the same token pool

**What WebPeel Has That Jina Reader Doesn't:**
- Crawl, batch, sitemap/map
- Page actions (click, scroll, type)
- CAPTCHA solving, stealth mode, smart escalation (HTTP→browser)
- Change tracking, branding extraction
- CLI (local, works offline)
- Self-hosting (AGPL-3.0, commercial licensing available)
- BYOK AI for extraction/summaries
- Firecrawl API compatibility
- Agent/research endpoint
- Significantly lower entry price ($9/mo vs opaque token pricing)
- Transparent pricing model

---

### 1.6 ScrapingBee — https://www.scrapingbee.com

**What They Do:**
ScrapingBee is a **web scraping API** that handles headless browsers, proxy rotation, and anti-bot bypass. Core value prop: send a URL, get back HTML (or markdown/text). They manage Chrome instances, proxy pools, IP rotation, geotargeting, and CAPTCHA avoidance. Unlike AI-focused competitors, ScrapingBee is a **traditional scraping tool** that recently added AI features (markdown output, ai_query extraction). Bootstrapped to $5M ARR, then acquired by **Oxylabs** (major proxy provider) in mid-2025 for an 8-figure all-cash deal.

**Funding:** Bootstrapped (no VC). Acquired by Oxylabs (part of Tesonet group) mid-2025, 8-figure all-cash.

**Features:**
- URL → HTML (default, with JS rendering)
- URL → Markdown (`return_page_markdown=true`)
- URL → Plain text (`return_page_text=true`)
- JavaScript rendering via latest headless Chrome (default, 5 credits)
- No-JS mode (`render_js=false`, 1 credit)
- **Three proxy tiers:** rotating (1-5 credits), premium (10-25 credits), stealth (75 credits)
- Geotargeting by country code
- Bring-your-own proxy support
- Session/IP stickiness
- CSS selector extraction rules (JSON output)
- AI extraction via `ai_query` (plain English → data, +5 credits)
- AI extraction via `ai_extract_rules` (schema → JSON, +5 credits)
- JavaScript scenario (click, scroll, type, wait, fill, custom JS)
- Screenshots (full page, viewport, selector-targeted)
- Google Search API (`custom_google=true`, 15 credits)
- Fast Search API (organic SERP in <1 second)
- Block ads, block resources (images/CSS)
- Custom headers, cookies, viewport
- Device emulation (desktop/mobile)
- Configurable timeout (default 140s)
- Transparent status codes
- JSON response wrapper

**What They DON'T Have:**
- ❌ No crawl/sitemap/map/batch
- ❌ No async jobs
- ❌ No change tracking
- ❌ No branding extraction
- ❌ No PDF parsing
- ❌ No image extraction/captioning
- ❌ No CLI tool
- ❌ No MCP server
- ❌ Not open source / not self-hostable
- ❌ No Firecrawl API compatibility
- ❌ No BYOK AI
- ❌ No agent/research endpoint
- ❌ No streaming mode
- ❌ No semantic web search (only Google SERP scraping)
- ❌ No LangChain/LlamaIndex integrations

**SDKs:** Python (`scrapingbee`, 29 ⭐), Node.js (`scrapingbee`, 10 ⭐), code examples for Java, Ruby, PHP, Go. Scrapy middleware.
**Integrations:** Scrapy (official middleware). No AI framework integrations.
**MCP:** No

**Pricing:**
- Free trial: 1,000 credits (one-time, no CC)
- Freelance: $49/mo → 250,000 credits, 10 concurrent
- Startup: $99/mo → 1,000,000 credits, 50 concurrent
- Business: $249/mo → 3,000,000 credits, 100 concurrent
- Business+: $599/mo → 8,000,000 credits, 200 concurrent
- Custom/Enterprise available

**Credit costs:**
- Rotating proxy, no JS: 1 credit
- Rotating proxy + JS (default): 5 credits (~$0.0005 on Startup)
- Premium proxy, no JS: 10 credits
- Premium proxy + JS: 25 credits
- Stealth proxy + JS: 75 credits
- AI features: +5 credits on top
- Google scraping: 15 credits
- Only 200/404 billed; 500 errors free

**Effective cost:** Startup plan ($99/mo, 1M credits) = $0.0005/request (1 credit) to $0.0074/request (75 credits stealth)

**GitHub:** ScrapingBee/scrapingbee-python — 29 ⭐ | scrapingbee-node — 10 ⭐ (no main OSS repo)

**Unique Advantages Over WebPeel:**
1. **Proxy infrastructure** — 6 years of proxy expertise + Oxylabs backing (one of world's largest proxy/residential IP providers). Three proxy tiers (rotating, premium, stealth). WebPeel's proxy game is newer
2. **Anti-bot bypass at scale** — Stealth proxies handle Cloudflare, Akamai, DataDome, PerimeterX. Battle-tested against the hardest sites
3. **Page actions maturity** — JS scenario (click/scroll/type/wait/fill) is well-documented and battle-tested over 6 years
4. **Documentation quality** — Excellent docs with code examples in 7 languages. 100+ blog tutorials
5. **Google SERP scraping** — Dedicated Google scraping with Fast Search API
6. **Concurrency** — Up to 200 concurrent on Business+ plan
7. **Track record** — 6 years, 2,500+ customers, 100+ Capterra reviews, $5M ARR at exit

**What WebPeel Has That ScrapingBee Doesn't:**
- **5x cheaper entry** ($9/mo vs $49/mo) with recurring free tier
- Crawl, batch, sitemap/map, async jobs
- Change tracking, branding extraction
- PDF parsing, image extraction
- CLI (local, works offline without API key)
- Self-hosting (AGPL-3.0 open source)
- BYOK AI for extraction/summaries
- MCP server, LangChain/LlamaIndex integrations
- Agent/research endpoint
- Firecrawl API compatibility (zero migration cost)
- Smart escalation (HTTP → browser auto-upgrade)
- DuckDuckGo web search (not just Google SERP)
- Streaming mode

---

## 2. Feature Comparison Matrix

| Feature | WebPeel | Firecrawl | Tavily | Exa | LinkUp | Jina Reader | ScrapingBee |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Core Scraping** | | | | | | | |
| Fetch/Scrape URL → Markdown | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fetch → HTML | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Fetch → Text | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| JS Rendering | ✅ | ✅ | ✅ | ✅ (livecrawl) | ✅ | ✅ | ✅ (default) |
| Page Actions (click/scroll/type) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Screenshots | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| PDF Parsing | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| CAPTCHA Solving | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (stealth proxies) |
| Stealth Mode | ✅ | ✅ (proxies) | ❌ | ❌ | ❌ | ❌ | ✅ (stealth proxies) |
| Smart Escalation (HTTP→Browser) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Crawling** | | | | | | | |
| Recursive Crawl | ✅ | ✅ | ✅ | ✅ (subpages) | ❌ | ❌ | ❌ |
| Sitemap/Map | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Batch Scrape | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Async Jobs | ✅ | ✅ | ✅ (research) | ✅ (research) | ❌ | ❌ | ❌ |
| **Search** | | | | | | | |
| Web Search | ✅ (DDG) | ✅ | ✅ | ✅ (neural) | ✅ | ✅ (s.jina.ai) | ❌ (SERP only) |
| Proprietary Search Index | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Deep/Reasoning Search | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (DeepSearch) | ❌ |
| Company Search | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| People Search | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Code Search | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| News/Image Sources | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ (Google) |
| **AI/Extraction** | | | | | | | |
| Structured Extraction (LLM) | ✅ | ✅ | ❌ | ❌ | ✅ (structured output) | ✅ (ReaderLM-v2) | ✅ (ai_extract) |
| AI Summary | ✅ (BYOK) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Answer/Q&A Endpoint | ❌ | ❌ | ❌ | ✅ | ✅ (via search) | ✅ (DeepSearch) | ❌ |
| Agent/Research Endpoint | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| BYOK AI (bring your own LLM) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Image Captioning | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Monitoring** | | | | | | | |
| Change Tracking | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Branding Extraction | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Image Extraction | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **Developer Experience** | | | | | | | |
| CLI Tool | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Python SDK | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| TypeScript SDK | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| MCP Server | ✅ (7 tools) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Self-Hostable | ✅ (AGPL-3.0) | ⚠️ (AGPL) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Open Source | ✅ (AGPL-3.0) | ⚠️ (AGPL) | ❌ | ❌ | ❌ | ⚠️ (Apache, not practical) | ❌ |
| Firecrawl API Compatible | ✅ | N/A | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Integrations** | | | | | | | |
| LangChain | ✅ | ✅ | ✅ (default!) | ✅ | ✅ | ✅ (community) | ❌ |
| LlamaIndex | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (community) | ❌ |
| CrewAI | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Dify | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| n8n | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Zapier / Make | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Scrapy | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Enterprise** | | | | | | | |
| SOC 2 | ❌ | ❌ | ❌ | ✅ Type II | ❌ | ✅ Type I & II | ❌ |
| SLA | ❌ | ❌ | ✅ (99.99%) | ✅ | ❌ | ❌ | ❌ |
| SSO | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Zero Data Retention | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ (opt-in) | ❌ |
| Dashboard/Analytics | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| EU Compliance | ❌ | ❌ | ❌ | ❌ | ✅ (EU-based) | ✅ (opt-in) | ✅ (GDPR) |

---

## 3. Ranking Matrix (1-5, where 5 = best)

| Dimension | WebPeel | Firecrawl | Tavily | Exa | LinkUp | Jina Reader | ScrapingBee |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Features (breadth)** | 4.5 | 5.0 | 3.5 | 4.0 | 2.0 | 3.5 | 3.5 |
| **Pricing** | 5.0 | 2.5 | 3.0 | 2.5 | 3.5 | 4.0 | 2.0 |
| **Developer Experience** | 4.0 | 4.5 | 4.0 | 4.0 | 3.5 | 4.5 | 4.0 |
| **AI-Readiness** | 4.0 | 4.5 | 4.5 | 5.0 | 3.5 | 4.5 | 2.5 |
| **Search/Data Quality** | 2.5 | 3.0 | 4.0 | 5.0 | 4.5 | 3.5 | 2.0 |
| **Enterprise Readiness** | 1.5 | 3.0 | 4.0 | 5.0 | 2.5 | 4.5 | 2.0 |
| **Open Source / Freedom** | 5.0 | 3.0 | 1.0 | 1.0 | 1.0 | 1.5 | 1.0 |
| **Scale / Reliability** | 2.0 | 4.5 | 5.0 | 4.5 | 3.0 | 5.0 | 4.0 |
| **Community / Ecosystem** | 1.5 | 5.0 | 4.5 | 4.0 | 2.5 | 3.5 | 2.5 |
| **AVERAGE** | **3.3** | **3.9** | **3.7** | **3.9** | **2.9** | **3.8** | **2.6** |

### Ranking Justification:

**Features (breadth):** WebPeel's feature set nearly matches Firecrawl's (its closest comp), with unique additions like CAPTCHA solving and smart escalation. Firecrawl edges ahead due to maturity and proprietary scraping engine. Jina Reader and ScrapingBee both score 3.5 — Jina has deep content extraction features (ReaderLM-v2, image captioning, EU mode) but lacks crawling/batch/actions; ScrapingBee has strong proxy/actions but lacks search, crawling, and AI features. Tavily and Exa are more narrowly focused on search+extract.

**Pricing:** WebPeel is the clear winner. $9/mo for 1,250 ops/week (5,000/mo) vs Firecrawl's $16/mo for 3,000/mo. Jina Reader scores 4.0 — generous free tier (10M tokens) and pay-per-use is cost-effective for light usage, but opaque pricing hurts. ScrapingBee scores lowest at 2.0 — $49/mo minimum with credit multipliers (5-75x) makes it the most expensive per-effective-request.

**Developer Experience:** Jina Reader ties for top at 4.5 — the zero-friction URL prefix approach is brilliant for onboarding, though lack of SDKs hurts for complex use cases. ScrapingBee scores 4.0 — excellent docs with 7-language examples, clear credit cost table, but no CLI/MCP.

**AI-Readiness:** Jina Reader scores 4.5 — ReaderLM-v2 for high-quality conversion, DeepSearch for reasoning, search+read combined, plus MCP server. ScrapingBee scores only 2.5 — AI features (ai_query/ai_extract_rules) are bolted-on, no MCP, no framework integrations.

**Search/Data Quality:** Jina Reader scores 3.5 — `s.jina.ai` returns full content from search results (better than DDG snippets) but it's not a proprietary index. ScrapingBee scores 2.0 — Google SERP scraping only, no semantic search at all.

**Enterprise Readiness:** Jina Reader scores 4.5 — SOC 2 Type I & II, Elastic (NYSE) backing, massive customer logos, EU compliance mode, 100B tokens/day scale. Only misses SLA/SSO to tie Exa. ScrapingBee scores 2.0 — GDPR compliant (French) but no SOC 2, no SLA, smaller scale.

**Open Source / Freedom:** WebPeel's AGPL-3.0 license matches Firecrawl. Firecrawl's AGPL is viral copyleft. Jina Reader's repo is Apache-2.0 but not practically self-hostable (depends on proprietary submodule + infrastructure), so scores 1.5. ScrapingBee is fully proprietary (1.0).

---

## 4. Honest Assessment

### Where WebPeel is STRONG 💪

1. **Price/value ratio is unbeatable** — 5-20x cheaper than every competitor. The $9/mo tier offers more weekly ops than competitors' $30-80 tiers offer monthly
2. **Fully open source (AGPL-3.0) — same license as Firecrawl, with commercial licensing available
3. **Local-first / self-hostable** — CLI works without an API key, completely offline. No vendor lock-in
4. **Firecrawl API compatibility** — Genius move. Instant migration path from the market leader. Zero switching cost
5. **BYOK AI** — No lock-in to any AI provider. Use whatever LLM you want for extraction/summaries
6. **Feature completeness for scraping** — CAPTCHA solving, smart escalation, stealth mode, page actions — WebPeel is the most complete scraping toolkit
7. **Smart escalation** — HTTP → browser auto-upgrade saves resources and is unique in the market

### Where WebPeel is WEAK 🚨

1. **Search quality** — DuckDuckGo is a hard ceiling. Every competitor with proprietary search (Exa, LinkUp) or curated search (Tavily) delivers measurably better results. This is the #1 weakness for AI use cases where search quality = output quality
2. **Brand recognition / trust** — Zero GitHub stars momentum compared to Firecrawl's 82.7K. No TechCrunch coverage, no enterprise customer logos, no VC signaling
3. **Enterprise features** — No SOC 2, no SLA, no SSO, no dashboard, no analytics. Enterprise buyers need these checkboxes
4. **Scale story** — No public metrics on uptime, latency, request volume. Competitors publish 99.99% SLAs and 180ms p50 latency
5. **Research/agent maturity** — Tavily's research endpoint has streaming + structured output + model selection. Firecrawl's agent has Pydantic/Zod schemas. WebPeel's agent endpoint is less mature
6. **Integration gap** — Missing Zapier, Make, Google Sheets, Snowflake, Google ADK. These matter for non-developer users and enterprise workflows
7. **Documentation & community** — Firecrawl has extensive cookbooks, tutorials, common-site guides. WebPeel needs to invest here
8. **No Answer/Q&A endpoint** — Exa's `/answer` and LinkUp's answer-in-search are increasingly table-stakes for AI apps. WebPeel doesn't have this
9. **Partnership deficit** — Tavily is LangChain's default, works with IBM/Databricks/Snowflake. Exa has Notion/Vercel. WebPeel has no anchor partnerships

---

## 5. Actionable Recommendations

### 🔴 Critical (Do Now)

1. **Upgrade search quality** — DuckDuckGo is the ceiling on WebPeel's AI-readiness. Options:
   - Add Brave Search as a BYOK option (users provide their own API key, $0 to WebPeel)
   - Add SearXNG as a self-hostable search backend
   - Build a `/answer` endpoint that takes search results and generates cited answers (leverage BYOK LLM)
   - Long-term: Consider building a lightweight search index for high-value domains (docs, news, companies)

2. **Zapier + Make integrations** — These unlock the non-developer market. Many enterprise workflows run through these. Relatively easy to build

3. **GitHub star campaign** — The star count signals community trust. Launch on HN, ProductHunt, Reddit. The Firecrawl compatibility angle is a great launch hook ("drop-in replacement, AGPL-3.0 licensed, 5x cheaper")

### 🟡 Important (Next Quarter)

4. **Dashboard + analytics** — Even a simple usage dashboard with API key management. Enterprise buyers and even indie devs expect this

5. **Structured research endpoint improvements** — Add streaming support, structured output schemas (Pydantic/Zod), and model selection to the agent endpoint. Match Tavily's `/research` feature set

6. **Google Sheets integration** — High-value for the "scrape data into spreadsheet" use case (lead enrichment, company research). LinkUp and Exa both have this

7. **Student/education program** — Free tier for .edu emails. Tavily does this. Builds long-term loyalty

8. **Published benchmarks** — Run WebPeel against Firecrawl, Tavily, and DDG on a standardized test set. Publish results. Show scraping success rate, latency, content quality. Transparency builds trust

### 🟢 Strategic (This Year)

9. **SOC 2 Type II** — The minimum enterprise compliance checkbox. Without it, WebPeel can't sell to regulated industries. Expensive but necessary for upmarket

10. **Partnership with one major AI framework** — CrewAI, Dify, or n8n would be the easiest targets (smaller than LangChain, looking for differentiation). Being the "default web data tool" for any framework is transformative

11. **Company/people search vertical** — Exa's biggest unique feature. Even a lightweight version (search LinkedIn via DDG + structured extraction) would cover the use case

12. **Hosted MCP with OAuth** — Exa has a hosted MCP endpoint (`mcp.exa.ai/mcp`) that works with 15+ clients. WebPeel should match this — one URL, instant setup

13. **Content licensing partnerships** — LinkUp's ethical content angle is growing. Explore partnerships with niche publishers or open content providers to differentiate search quality

---

## 6. Competitive Positioning Summary

```
                    SEARCH QUALITY
                         ↑
                         |
              LinkUp ●   |   ● Exa
                         |
                    ● Tavily
                  Jina ●  |
          ─────────────●─┼────────────── SCRAPING FEATURES →
                  WebPeel |      ● Firecrawl
                         |        ● ScrapingBee
                         |
```

---

### 1.5 Jina Reader — https://jina.ai/reader / https://r.jina.ai

**What They Do:**
Jina Reader is a URL-to-markdown API from Jina AI, a Berlin-based AI infrastructure company. Core value prop: prepend `https://r.jina.ai/` to any URL and get LLM-ready markdown back. Also offers `s.jina.ai/` for web search. It's positioned as a free, developer-friendly tool to feed better input to LLMs and RAG systems.

**Raised:** $39M total over 2 rounds. Series A: $30M (Nov 2021) from Mango Capital, Canaan, and others. Jina AI is a broader AI company (embeddings, reranking, search) — Reader is one product among many.

**Features:**
- URL-to-markdown via simple URL prefix (`r.jina.ai/`) or API headers
- Web search endpoint (`s.jina.ai/`) — returns top-5 results in markdown
- ReaderLM-v2: proprietary small model for high-quality HTML→Markdown conversion (3x token cost)
- PDF extraction from any URL
- Image captioning (AI-generated alt text)
- CSS selectors for extraction, waiting, and exclusion
- JavaScript rendering (browser engine selection)
- Cookie forwarding, custom proxy support, geo-targeting
- Streaming mode for large pages
- JSON response format with metadata
- Token budget limits
- OpenAI citation format compatibility
- Shadow DOM + iframe content extraction
- EU compliance mode
- Custom JS execution before extraction
- In-site search filtering (`site=` parameter)

**Pricing:**
- **Free tier:** Generous but rate-limited. ~20 requests per IP per time window (confirmed by our benchmark). No API key required.
- **Paid tiers:** API key unlocks higher rate limits. Exact pricing not publicly listed on their website — requires dashboard signup. Pricing is token-based.
- Reader is one of Jina's products alongside their embedding/reranking APIs — pricing bundles may apply.

**Developer Experience:**
- **Onboarding:** Extremely simple — just prepend `r.jina.ai/` to any URL. No signup needed for basic use.
- **SDKs:** No dedicated SDK (it's just HTTP GET). Works from curl, any HTTP client, or browser.
- **Docs:** Interactive API playground on jina.ai/reader. GitHub repo (jina-ai/reader) has good README.
- **GitHub:** ~7K+ stars on jina-ai/reader.
- **Community:** Active — Jina has a broader developer community around their embedding/search products.

**Strengths:**
1. **Zero-friction onboarding** — URL prefix pattern is brilliant for quick use
2. **ReaderLM-v2** — proprietary model for HTML→Markdown gives quality edge on complex pages
3. **Free tier is genuinely usable** for small-scale / dev work
4. **Broad feature set** — image captioning, PDF support, CSS selectors, JS rendering
5. **Backed by well-funded AI company** ($39M) — not going away
6. **Strong in the AI/LLM community** — well-known, frequently recommended

**Weaknesses:**
1. **Aggressive rate limiting** — free tier caps at ~20 requests/IP, blocking entire domains for abuse
2. **No local/self-hosted option** — 100% cloud API, no CLI, no offline mode
3. **Not truly open-source** — repo is the old v1; current production API is proprietary
4. **Pricing opacity** — paid tiers require signup, no public pricing page
5. **No crawl mode** — single-page only, no site-wide crawling
6. **httpbin.org blocked** — overly aggressive abuse prevention flags legitimate domains

**Benchmark Results (our test, 30 URLs):**
- Success: 16/17 valid requests (94.1%) — 13 rate-limited before completion
- Median latency: 727ms (valid requests)
- Avg quality: 0.650
- Strong on static/dynamic/SPA (100%), couldn't test documents/edge due to rate limit

**Where WebPeel Wins:**
- Self-hosted / local-first — no API dependency
- AGPL-3.0 open source — full source, commercial licensing available
- No rate limits locally
- Stealth mode / anti-bot — Jina doesn't handle protected sites well
- Price: free locally, API far cheaper at scale

**Where Jina Wins:**
- Zero-setup experience (URL prefix)
- ReaderLM-v2 quality on complex pages
- Free tier is simpler to start with
- Image captioning built-in
- Broader ecosystem (embeddings, search, reranking)

---

### 1.6 ScrapingBee — https://www.scrapingbee.com

**What They Do:**
ScrapingBee is a web scraping API that handles headless browsers, proxy rotation, and anti-bot bypassing. Value prop: "stop getting blocked." They focus on the infrastructure layer — proxies, JS rendering, geo-targeting — so developers can focus on data extraction. Recently added AI-powered extraction (plain English → structured JSON).

**Funding:** Bootstrapped to $5M ARR, then acquired in an 8-figure all-cash exit. Founded by Pierre de Wulf and Kevin Sahin (France). 2,500+ customers.

**Features:**
- Headless browser rendering (latest Chrome)
- Rotating proxies + premium proxy pool
- IP geo-targeting (country-level)
- AI web scraping (natural language → structured data)
- CSS-based extraction rules (HTML → JSON)
- JavaScript scenario execution (click, scroll, wait)
- Screenshot API (full page + partial)
- Google Search API (SERP scraping)
- HTML → Markdown/JSON/plain text conversion
- Concurrent request scaling (10-200 based on plan)
- Custom JS snippet execution

**Pricing:**
| Plan | Monthly | API Credits | Concurrent |
|------|---------|-------------|------------|
| Free trial | $0 | 1,000 | — |
| Freelance | $49/mo | 250,000 | 10 |
| Startup | $99/mo | 1,000,000 | 50 |
| Business | $249/mo | 3,000,000 | 100 |
| Business+ | $599/mo | 8,000,000 | 200 |

Note: JS rendering costs 5 credits/request. Google scraping costs 20 credits/request. AI extraction has multiplied credit costs.

**Developer Experience:**
- **Onboarding:** 1,000 free API calls, no credit card. Clean REST API.
- **SDKs:** Python, Node.js, Ruby, PHP, Go, Java, .NET
- **Docs:** Extensive documentation + blog with scraping tutorials (SEO-driven content marketing)
- **GitHub:** Not open-source. No public repo for the core product.
- **Support:** Priority email (Startup+), dedicated account manager (Business+)

**Strengths:**
1. **Proxy infrastructure** — large rotating proxy pool is their core moat
2. **Proven product-market fit** — $5M ARR, 8-figure exit, 2,500+ customers
3. **Broad language support** — SDKs for 7+ languages
4. **Google SERP API** — dedicated search scraping (though expensive at 20 credits/req)
5. **AI extraction** — natural language data extraction is compelling
6. **Extensive tutorials/blog** — great for SEO and developer education

**Weaknesses:**
1. **Expensive at scale** — $49/mo minimum, 5x credit cost for JS rendering
2. **No open source** — fully proprietary, no local option
3. **No markdown-first output** — raw HTML by default, markdown is secondary
4. **Protected site failures** — failed Cloudflare, Bloomberg, SEC in our benchmark without `render_js=True`
5. **Google domains require special flag** — `custom_google=True` at 20 credits/request
6. **Credit system is confusing** — different operations cost different credits, hard to predict spend
7. **Geo-routing quirk** — Glassdoor returned Dutch version (proxy geo mismatch)

**Benchmark Results (our test, 30 URLs):**
- Success: 24/30 (80.0%)
- Median latency: 1,613ms (slowest of all runners)
- Avg quality: 0.600
- Strong on static/dynamic/SPA (100% each)
- Weak on protected (40%) and documents (60%)
- Notable: Wikipedia took 22 seconds

**Where WebPeel Wins:**
- **Price:** Free locally, API 10-50x cheaper at scale
- **Speed:** 443ms median vs 1,613ms
- **Success rate:** 96.7% vs 80.0%
- **Open source:** AGPL-3.0 license, full source code
- **Local-first:** No API dependency, runs offline
- **Protected sites:** WebPeel's stealth mode beats ScrapingBee's default mode

**Where ScrapingBee Wins:**
- Massive proxy pool for IP rotation
- Multi-language SDK support (7+ vs WebPeel's 1)
- AI extraction (natural language → structured JSON)
- Google SERP scraping
- Established brand with 2,500+ customers
- Dedicated account management for enterprise

---

**WebPeel's ideal positioning:** "The open-source Firecrawl alternative that's 5x cheaper, AGPL-3.0 licensed, and works locally. Plus search."

**Who to target aggressively:**
- Firecrawl users frustrated with AGPL licensing or pricing
- Solo devs and small teams who need scraping without enterprise overhead
- Privacy-conscious users who want self-hosted, local-first tooling
- AI developers building with BYOK LLMs who don't want vendor lock-in

**Who to NOT fight (for now):**
- Enterprise deals requiring SOC 2 / SLAs (can't win yet)
- Use cases where search quality is everything (Exa/LinkUp's domain)
- LangChain-native workflows (Tavily owns this)
