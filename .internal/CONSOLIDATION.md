# WebPeel Consolidation Plan — The Swiss Army Knife

## The Problem
20 MCP tools, 74 API endpoints, massive overlap. An AI agent seeing 20 tools gets
choice paralysis. Half the tools do similar things with slightly different wrappers.

## The Principle
**An AI should never wonder "which tool do I use?"** Each tool has ONE clear job.
If two tools could answer the same question, one of them shouldn't exist.

---

## The Swiss Army Knife: 6 Blades

### 1. `webpeel_read` — Read any URL
**Absorbs:** webpeel, webpeel_fetch, webpeel_deep_fetch, webpeel_youtube, 
webpeel_summarize, webpeel_answer, webpeel_quick_answer

**Why merge:** An AI agent that wants to read a YouTube video shouldn't need to 
know a separate `webpeel_youtube` tool exists. It just calls `read("youtube.com/...")` 
and WebPeel auto-detects. Same for "summarize this page" — that's just 
`read(url, summary=true)`. Same for "what's the price on this page?" — that's 
`read(url, question="what's the price?")`.

**Parameters:**
- `url` — any URL (web, YouTube, PDF — auto-detected)
- `format` — "markdown" | "text" | "html" (default: markdown)
- `render` — browser rendering for JS-heavy sites (auto-detected by default)
- `question` — answer a specific question about the content
- `summary` — return a summary instead of full content
- `budget` — token budget for output compression

**API:** `GET/POST /v1/fetch` (unchanged, add question/summary params)

---

### 2. `webpeel_see` — See any page visually
**Absorbs:** webpeel_screenshot + ALL screenshot sub-endpoints + design-analysis + design-compare

**Why merge:** 10 screenshot endpoints is insane. "Take a screenshot" and 
"analyze the design" and "compare two pages" are all variations of "let me SEE this."

**Parameters:**
- `url` — the page to see
- `mode` — "screenshot" (default) | "design" | "compare"
- `compare_url` — second URL (for compare mode)
- `viewport` — "desktop" | "mobile" | "tablet" | {width, height}
- `full_page` — true/false
- `annotate` — label interactive elements

**API:** `POST /v1/screenshot` (keep, add mode param, deprecate sub-endpoints)

---

### 3. `webpeel_find` — Find anything on the web
**Absorbs:** webpeel_search, webpeel_research, webpeel_map

**Why merge:** "Search the web", "research a topic", and "find all URLs on a site" 
are all forms of FINDING things. An AI calls `find("best react frameworks 2026")` 
for search, `find("stripe.com", mode="sitemap")` for URL discovery.

**Parameters:**
- `query` — what to find (web search)
- `url` — find URLs on this domain (sitemap/map mode)
- `depth` — "quick" (default, single search) | "deep" (multi-source research)
- `limit` — max results

**API:** `GET /v1/search` (add depth param), `/v1/map` (keep as alias)

---

### 4. `webpeel_extract` — Extract structured data
**Absorbs:** webpeel_extract, webpeel_auto_extract, webpeel_brand

**Why merge:** "Extract brand colors" is just `extract(url, fields=["logo","colors"])`. 
"Auto-detect page type" is just `extract(url)` with no schema (auto mode).
One tool, smart defaults.

**Parameters:**
- `url` — page to extract from
- `schema` — JSON schema of what to extract (optional)
- `fields` — simple list: ["price", "title", "rating"] (optional)
- (if neither schema nor fields: auto-detect page type and extract)

**API:** `POST /v1/extract` (unchanged)

---

### 5. `webpeel_monitor` — Watch for changes
**Absorbs:** webpeel_watch, webpeel_change_track

**Why merge:** These are literally the same feature with different names. 
`change_track` is one-shot diffing, `watch` is persistent monitoring. 
Combine into one tool with a `persistent` flag.

**Parameters:**
- `url` — page to monitor
- `webhook` — URL to notify on change (makes it persistent)
- `interval` — check frequency (for persistent mode)
- `selector` — watch specific element only

**API:** `POST /v1/watch` (unchanged)

---

### 6. `webpeel_act` — Interact with a page (FUTURE)
**New tool.** Not built yet.

**Purpose:** Click, fill, navigate, submit — anything interactive.

**Parameters:**
- `url` — starting page
- `actions` — [{click: "Sign Up"}, {fill: {selector: "#email", value: "..."}}, {click: "Submit"}]
- `extract_after` — get clean content after actions
- `screenshot_after` — see the result

**API:** `POST /v1/act` (new endpoint)

---

## What Gets KILLED

| Tool | Why | Replacement |
|------|-----|-------------|
| `webpeel_hotels` | Not our job. Niche vertical. | Kill entirely |
| `agent` | Too vague, overlaps with what LLMs do | Kill entirely |
| `webpeel_batch` | Developer tool, not agent tool | Keep API, remove from MCP |
| `webpeel_crawl` | Developer tool, not agent tool | Keep API, remove from MCP |
| `webpeel_summarize` | LLMs already summarize | `webpeel_read(summary=true)` |
| `webpeel_answer` | Requires BYOK LLM key | `webpeel_read(question="...")` |
| `webpeel_quick_answer` | Same as above, no LLM | `webpeel_read(question="...")` |
| `webpeel_deep_fetch` | Confusing name, overlaps research | `webpeel_find(depth="deep")` |
| `webpeel_youtube` | Just a URL type | `webpeel_read("youtube.com/...")` |
| `webpeel_brand` | Just an extraction preset | `webpeel_extract(fields=["logo","colors"])` |
| `webpeel_change_track` | Duplicate of watch | `webpeel_monitor` |

## API Endpoint Deprecation

| Endpoint | Action |
|----------|--------|
| `/v1/screenshot/filmstrip` | Merge → `/v1/screenshot?mode=filmstrip` |
| `/v1/screenshot/animation` | Kill (nobody uses this) |
| `/v1/screenshot/audit` | Merge → `/v1/screenshot?mode=audit` |
| `/v1/screenshot/viewports` | Merge → `/v1/screenshot?viewports=[...]` |
| `/v1/screenshot/design-audit` | Merge → `/v1/screenshot?mode=design` |
| `/v1/screenshot/design-analysis` | Merge → `/v1/screenshot?mode=design` |
| `/v1/screenshot/diff` | Merge → `/v1/screenshot?diff_url=...` |
| `/v1/design-compare` | Merge → `/v1/screenshot?mode=compare` |
| `/v1/answer` | Merge → `/v1/fetch?question=...` |
| `/v1/quick-answer` | Merge → `/v1/fetch?question=...` |
| `/v1/deep-fetch` | Merge → `/v1/search?depth=deep` |
| `/v1/agent` | Kill |

**Keep existing endpoints working** (backward compat) but mark deprecated.
New docs only show the 6 core endpoints.

---

## Before & After

```
BEFORE (20 MCP tools):                AFTER (6 tools):
webpeel                          →    webpeel_read
webpeel_fetch                    →    webpeel_read
webpeel_search                   →    webpeel_find
webpeel_batch                    →    (API only)
webpeel_crawl                    →    (API only)
webpeel_map                      →    webpeel_find
webpeel_extract                  →    webpeel_extract
webpeel_brand                    →    webpeel_extract
webpeel_change_track             →    webpeel_monitor
webpeel_summarize                →    webpeel_read
webpeel_answer                   →    webpeel_read
webpeel_screenshot               →    webpeel_see
webpeel_research                 →    webpeel_find
webpeel_deep_fetch               →    webpeel_find
webpeel_youtube                  →    webpeel_read
webpeel_auto_extract             →    webpeel_extract
webpeel_quick_answer             →    webpeel_read
webpeel_watch                    →    webpeel_monitor
webpeel_hotels                   →    KILLED
agent                            →    KILLED
```

## The AI Experience

An AI agent sees 6 tools with crystal-clear descriptions:

1. **webpeel_read** — "Read any URL. Returns clean markdown. Auto-handles YouTube, PDFs, JS-heavy sites. Add question= for Q&A, summary=true for summaries."
2. **webpeel_see** — "See any page. Returns screenshot. Add mode=design for visual analysis, mode=compare to compare two pages."
3. **webpeel_find** — "Find anything on the web. Search query or discover URLs on a domain. Add depth=deep for multi-source research."
4. **webpeel_extract** — "Extract structured data. Pass a schema or field list, or let it auto-detect. Returns typed JSON."
5. **webpeel_monitor** — "Watch a URL for changes. One-shot diff or persistent webhook monitoring."
6. **webpeel_act** — "Interact with a page. Click, fill forms, navigate. Returns screenshot + extracted content after actions."

**No overlap. No confusion. Every tool is a different verb: read, see, find, extract, monitor, act.**
