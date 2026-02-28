# WebPeel — Product Vision

*"Give me any URL and I'll tell you exactly what you need to know."*

---

## What Are We Actually Building?

Most web scraping tools treat every URL the same: fetch HTML → parse → return text. That's wrong.

A YouTube link is **a video**. A PDF link is **a document**. A Reddit thread is **a conversation**. A product page is **structured data**. An academic paper is **research**. A Twitter profile is **a person**.

**WebPeel is not a web scraper. WebPeel is a web understanding engine.**

When an AI agent hands us a URL, it's asking: *"What is this thing, and what do I need to know about it?"*

Our job is to answer that question perfectly, every time, for every URL type, on every platform.

---

## The Three Pillars

### 1. Perfect Understanding (Quality)

The #1 reason someone would pay us: **we return better content than anyone else.**

Not more content — *better* content. Token-efficient, structured, complete.

| URL Type | What most tools return | What WebPeel should return |
|----------|----------------------|---------------------------|
| YouTube video | Transcript dump (if lucky) | Structured summary: title, key points, timestamps, speaker names, topic segments |
| News article | Full page with nav/ads/comments | Clean article: headline, byline, date, body text, key quotes |
| Product page | Messy HTML dump | Structured: name, price, rating, specs, pros/cons from reviews |
| GitHub repo | README text | README + stars + language + recent activity + key files |
| Academic paper | PDF text dump | Title, authors, abstract, key findings, methodology, citations |
| Twitter/X thread | Single tweet or nothing | Full thread with context, engagement metrics, media descriptions |
| Recipe page | 10 pages of life story + recipe | Just the recipe: ingredients, steps, time, servings |
| Documentation | One page | The relevant section + linked context |

**This is the "perfect answer" vision.** Every URL type has a perfect extraction strategy. We should have 50+ domain extractors, each one hand-tuned.

### 2. Universal Access (Distribution)

WebPeel should work **everywhere an AI agent lives**:

**Already built:**
- ✅ REST API (`api.webpeel.dev`)
- ✅ CLI (`npx webpeel "url"`)
- ✅ MCP Server (18 tools for Claude, Cursor, etc.)
- ✅ npm package

**Need to build:**
- ⬜ **Browser Extension** — Chrome, Firefox, Safari, Edge, Brave, Arc, Zen
  - Click extension → extract current page → copy clean content
  - Right-click any link → "Extract with WebPeel"
  - Works offline (local extraction) + cloud fallback
- ⬜ **Python SDK** (`pip install webpeel`) — the AI/ML community lives in Python
- ⬜ **OpenAI GPT Action** — WebPeel as a tool inside ChatGPT
- ⬜ **Zapier / n8n / Make** — no-code automation
- ⬜ **VS Code Extension** — paste URL, get content inline
- ⬜ **Bookmarklet** — zero-install, works in any browser
- ⬜ **WordPress plugin** — auto-extract content for bloggers
- ⬜ **Raycast / Alfred extension** — power user workflow

The key insight: **the browser extension is the killer distribution channel.**
- Firecrawl doesn't have one
- Jina doesn't have one
- It's the most natural UX for "I'm looking at this page, extract it"
- It can work on ANY browser (Chrome extension API + Firefox WebExtension API + Safari Web Extension)
- It makes WebPeel visible — every time someone uses it, they see the brand

### 3. Intelligence (Smart Extraction)

This is where we leap past competitors. Not just "fetch content" but "understand content."

**Smart features that would make people pay:**

#### a) Auto-Format for LLMs
When an AI agent fetches a page, it's going to feed the result to an LLM. We should optimize for that:
- Strip boilerplate ruthlessly (nav, footer, sidebar, ads, cookie banners)
- Structured headers that help LLMs parse
- Key facts pulled to the top (TL;DR)
- Token count in response headers so agents can budget
- Configurable verbosity: `?detail=brief|standard|full`

#### b) Multi-Modal Understanding
- **YouTube**: Transcript + auto-generated chapter summaries + key frames described
- **Podcasts**: Transcript + speaker diarization + topic segments
- **Images**: OCR + description + alt text + EXIF data
- **PDFs**: Structured extraction with tables, figures, equations
- **Slides**: Per-slide content + speaker notes
- **Audio files**: Transcription + metadata

#### c) Follow-the-Thread
Sometimes one URL isn't enough. A Wikipedia article references 5 sources. A news story has 3 updates. A GitHub issue links to a PR.

`?depth=2` — follow key links and include their content
`?related=true` — include related context automatically

This is what "autonomous browsing" means. Not a full browser agent, but smart enough to follow the trail when the first page isn't sufficient.

#### d) Freshness Guarantee
- `?cache=false` — always fresh
- `?maxAge=1h` — cached within 1 hour is fine
- Real-time content for news, stock pages, live events
- Historical snapshots via Wayback Machine integration

---

## Who Pays and Why?

### Free Tier (500 req/week)
- Hobbyists, students, small side projects
- They discover us, try us, tell others
- The browser extension should be free forever (drives adoption)

### Pro ($9/mo — 1,250 req/week)
- Solo developers building AI tools
- Small teams with an AI chatbot
- People who tried free, hit the limit, need more
- **Why they upgrade:** They already depend on us. The quality is noticeably better than alternatives.

### Max ($29/mo — 6,250 req/week)
- Startups with AI products
- Agencies building for clients
- Data teams doing research at scale
- **Why they upgrade:** Volume + priority processing + advanced features

### Enterprise (custom)
- Companies embedding WebPeel in their products
- SLA, dedicated support, custom extractors
- **This is where real revenue lives long-term**

### What Makes People Actually Pull Out Their Credit Card?

1. **They tried it once and it worked where others didn't** — Cloudflare bypass, YouTube transcript, clean extraction
2. **Their AI agent got better answers** — token efficiency means cheaper + more accurate LLM responses
3. **The browser extension became part of their workflow** — daily use = willingness to pay
4. **They compared output quality** — side-by-side, WebPeel returns more useful content

---

## Competitive Moat

What stops someone from copying us?

1. **50+ hand-tuned domain extractors** — each one is iterative work. Hard to replicate quickly.
2. **Browser fingerprint diversity** — Chromium + Firefox + engine rotation. We can go where others can't.
3. **Quality feedback loop** — every request teaches us what works. More users = better extraction.
4. **MCP-first** — we're building for the AI agent era, not the web scraping era. Different product.
5. **Browser extension network effects** — once people install it, switching cost is real.

What does NOT work as a moat:
- Price (race to bottom)
- Raw speed (diminishing returns)
- "We have more features" (feature lists don't sell)

**The moat is quality. Period.** If our extraction is obviously better, everything else follows.

---

## Pitfalls & Risks

### Technical
- **Anti-bot arms race**: Cloudflare, DataDome, PerimeterX update constantly. We need a sustainable approach, not hacks. Firefox helps — browser diversity is more sustainable than stealth patches.
- **YouTube/Twitter API changes**: They break scrapers regularly. Need monitoring + fast response.
- **Scale vs. quality**: Browser rendering is expensive. Need smart escalation (simple fetch first, browser only when needed).
- **Multi-modal is hard**: Video understanding, PDF parsing, image OCR — each is a deep technical problem.

### Business
- **Free tier abuse**: Bots, scrapers, competitors. Need rate limiting + abuse detection.
- **Legal gray area**: Web scraping legality varies by jurisdiction. Need clear ToS, respect robots.txt, honor opt-out.
- **Firecrawl has 86K stars**: Open source community momentum is real. We can't out-community them. But we can out-quality them.
- **Revenue timing**: Building quality takes time. Need runway to get to product-market fit before monetization pressure.

### Product
- **Trying to do everything**: The biggest risk. We should nail 10 URL types perfectly before adding 50 more.
- **Dashboard vs. API**: The dashboard is nice but it's not what pays the bills. The API + integrations are.
- **Invisible product**: Web fetching is infrastructure. Users don't see it. The browser extension makes us visible.

---

## Roadmap Priority (What to Build Next)

### Phase 1: Perfect the Core (Now → 2 weeks)
- [ ] Fix search on production (Firefox fallback — in progress ✅)
- [ ] Expand domain extractors to 25+ (cover top 25 websites by traffic)
- [ ] YouTube: full transcript + chapter detection + key points extraction
- [ ] PDF extraction via URL (detect PDF, parse, return structured)
- [ ] Quality benchmark suite: test 100 URLs daily, track extraction quality score
- [ ] Side-by-side comparison page: WebPeel vs. Firecrawl vs. Jina vs. web_fetch

### Phase 2: Browser Extension (2-4 weeks)
- [ ] Chrome extension (Manifest V3)
- [ ] Firefox extension (WebExtension API)
- [ ] Safari extension (Web Extension)
- [ ] Features: extract current page, right-click extract link, copy clean markdown
- [ ] Free forever, no login required for basic use
- [ ] Optional: save to dashboard, use API key for enhanced extraction

### Phase 3: Intelligence Layer (4-8 weeks)
- [ ] `?detail=brief` — TL;DR mode (200 tokens max)
- [ ] `?detail=full` — everything including linked context
- [ ] Multi-modal: image OCR, audio transcription
- [ ] `?format=json` — structured data extraction (product pages, recipes, events)
- [ ] Smart caching with freshness headers

### Phase 4: Distribution (8-12 weeks)
- [ ] Python SDK
- [ ] OpenAI GPT Action
- [ ] Zapier integration
- [ ] VS Code extension
- [ ] Landing page interactive demo (paste URL → live result)
- [ ] Open source the core (AGPL) for community growth

---

## The North Star Metric

**Extraction Quality Score (EQS)**

For any URL, measure:
1. **Completeness** — did we get all the meaningful content?
2. **Cleanliness** — how much noise (nav, ads, boilerplate) slipped through?
3. **Structure** — is it well-organized for LLM consumption?
4. **Token efficiency** — useful tokens / total tokens ratio
5. **Reliability** — does it work consistently? (not 200 OK with empty content)

Target: **EQS > 90%** across the top 100 websites.

If we hit that, everything else (pricing, distribution, growth) becomes easier.

---

*Last updated: 2026-02-28*
*Author: Jarvis + Jake*
