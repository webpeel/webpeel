# CONTRIBUTING.md — Architecture Rules for Sub-Agents

**Read this FIRST before writing any code.** This file contains hard-won lessons from production bugs. Every rule exists because we shipped a broken release without it.

---

## Architecture Traps (Must Know)

### 1. TWO MCP Code Paths — Touch One, Touch Both
- **Standalone:** `src/mcp/server.ts` — runs locally via `npx webpeel-mcp`
- **HTTP route:** `src/server/routes/mcp.ts` — runs on the API server (`api.webpeel.dev/mcp`)
- **If you add a tool to one, you MUST add it to the other.**
- **If you modify a tool in one, verify the other matches.**
- Run `bash scripts/mcp-parity-check.sh` before committing — it catches mismatches.

**Why:** On 2026-03-06, `webpeel_act` was added to the standalone server but not the HTTP route. Shipped 3 broken releases before catching it.

### 2. CLI is a Pure API Client — No Local Playwright
- The CLI (`src/cli.ts`) routes ALL requests through `https://api.webpeel.dev`
- It does NOT import `peel()` locally or use Playwright
- Function `fetchViaApi()` is the core — it builds query params and calls the API
- If you need browser rendering, set `render=true` in the API call, not locally

**Why:** CLI must be <2MB install. Playwright is 150MB. Users install the CLI; the server does the heavy lifting.

### 3. Render Has a 30-Second Timeout
- Render's load balancer kills requests after 30 seconds
- Any endpoint that might take >25s needs internal timeout handling
- Browser-heavy operations (screenshot, session, act) are the main risk
- Dynamic `await import()` on cold start adds 5-10s — use static imports

**Why:** On 2026-03-06, `webpeel_act` had a redundant dynamic import that added cold-start latency, causing 502s.

### 4. CLI Pipe Auto-JSON
- When stdout is not a TTY (piped), the CLI auto-switches to JSON output
- If you add a new output flag (like `--format`), test in BOTH TTY and pipe mode
- The `isPiped` detection is in `runFetch()` around line 518

### 5. PeelResult Fields
- Token count: `result.tokens` (NOT `result.tokenCount`)
- Design analysis: `takeDesignAnalysis` is in `src/core/screenshot.js` (NOT `design-analysis.js`)
- No `viewport` property on `PeelOptions` — set width/height through the render pipeline

### 6. Check Before Adding — Never Duplicate
- Before adding badges, imports, sections, config entries, or CSS: **check if similar content already exists**
- If it does: **replace or merge**, don't add a second copy
- `grep` the file first: `grep -n "badge\|shields.io" README.md`
- This applies to ANY "add X to file Y" instruction

**Why:** On 2026-03-07, an agent added CI/npm/MIT badges to README.md without checking that npm/PyPI/stars badges already existed 5 lines below. Result: duplicate badge blocks.

### 7. Dockerfile.api Installs from npm — dist/server MUST Be in Package
- `Dockerfile.api` runs `npm install webpeel@X.Y.Z` then `node node_modules/webpeel/dist/server/app.js`
- If you remove `dist/server` from `package.json` `files[]`, the Docker container will crash on start
- On 2026-03-07: Removing dist/server from files[] to shrink npm package broke ALL Render deploys (5 consecutive failures)
- **Rule:** `dist/server` MUST stay in `package.json` `files[]`. The npm package serves both CLI users AND the Docker API server.

### 8. Test with Real URLs, Not Mocks
- Unit tests with mocks prove the code compiles. They don't prove it works.
- After your changes, test with at least 2 real URLs manually
- The e2e script is `bash scripts/e2e-verify.sh` — run it

---

## Pre-Commit Checklist (MANDATORY)

Before every `git commit`:

```bash
# 1. Build clean
npm run build

# 2. All tests pass
npm test

# 3. MCP parity (if you touched anything in mcp/ or server/routes/mcp)
bash scripts/mcp-parity-check.sh

# 4. CLI DX (if you touched cli.ts)
bash scripts/cli-dx-test.sh

# 5. E2E with real URLs
bash scripts/e2e-verify.sh
```

---

## How to Add a New MCP Tool

1. Define the tool schema in BOTH:
   - `src/mcp/server.ts` (standalone) — in the `tools` array
   - `src/server/routes/mcp.ts` (HTTP) — in the `mcpTools` array

2. Add the handler in BOTH:
   - Standalone: `if (name === 'your_tool') return handleYourTool(args);`
   - HTTP route: `if (name === 'your_tool') { ... }`

3. If it's a consolidated tool (one of the 7 public tools), it should also handle legacy name routing.

4. Run `bash scripts/mcp-parity-check.sh` — must pass.

5. Test via both paths:
   - Standalone: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"your_tool","arguments":{...}}}' | node dist/mcp/server.js`
   - HTTP: `curl -X POST https://api.webpeel.dev/mcp ...`

---

## How to Add a CLI Command

1. Check if it conflicts with existing commands: `grep "\.command(" src/cli.ts | head -30`
2. Check if it conflicts with verb aliases: `VERB_ALIASES = ['fetch', 'get', 'scrape', 'peel']`
3. Test backward compatibility: old flags (`--json`, `--text`, `--html`) must still work
4. Run `bash scripts/cli-dx-test.sh` — must pass

---

## File Map (Key Files)

```
src/cli.ts                    — CLI entry point (4500+ lines)
src/index.ts                  — Library entry: peel(), peelBatch(), WebPeel class
src/types.ts                  — PeelResult, PeelOptions, all interfaces
src/mcp/server.ts             — Standalone MCP server (npx webpeel-mcp)
src/server/app.ts             — Express app, route registration
src/server/routes/mcp.ts      — HTTP MCP endpoint (/mcp)
src/server/routes/ask.ts      — /v1/ask (LLM-free Q&A)
src/server/routes/session.ts  — /v1/session (stateful browser)
src/core/pipeline.ts          — Core fetch pipeline
src/core/quick-answer.ts      — BM25 sentence scoring (quickAnswer)
src/core/screenshot.js        — takeDesignAnalysis, takeDesignComparison
src/core/search-provider.ts   — getBestSearchProvider(), search providers
src/core/map.ts               — mapDomain()
src/core/youtube.ts           — getYouTubeTranscript()
scripts/mcp-parity-check.sh   — MCP tool sync verification
scripts/cli-dx-test.sh        — CLI new-user experience test
scripts/pre-publish.sh        — Pre-publish quality gate
scripts/e2e-verify.sh         — End-to-end real-URL verification
```

---

---

## Target Architecture (Phase 1)

We're moving from duplicated code to a shared handler registry:

### Current (BAD — causes bugs):
```
src/mcp/server.ts        ← 7 handlers (standalone, stdio transport)
src/server/routes/mcp.ts ← 26 handlers (HTTP, SSE transport)
                            Same tools, different implementations. Drift guaranteed.
```

### Target (GOOD — single source of truth):
```
src/mcp/handlers/          ← ALL tool logic lives here
  ├── read.ts              ← handleRead() — fetch, YouTube, question
  ├── see.ts               ← handleSee() — screenshot, design analysis, compare
  ├── find.ts              ← handleFind() — search, map, Q&A
  ├── extract.ts           ← handleExtract() — structured extraction
  ├── monitor.ts           ← handleMonitor() — watch, change detection
  ├── act.ts               ← handleAct() — browser interaction
  └── index.ts             ← exports registry: { name → handler }

src/mcp/server.ts          ← stdio transport (imports from handlers/)
src/server/routes/mcp.ts   ← HTTP/SSE transport (imports from handlers/)
```

Both transports import the SAME handlers. No duplication. No drift. Parity check becomes unnecessary because parity is structural.

### CLI Target:
```
src/cli/                   ← Modular CLI
  ├── index.ts             ← Commander setup, verb alias intercept
  ├── commands/fetch.ts    ← runFetch()
  ├── commands/search.ts   ← search, map
  ├── commands/screenshot.ts
  ├── commands/auth.ts     ← auth, status, doctor
  ├── commands/webask.ts   ← webask
  └── utils.ts             ← shared: config, API client, output formatting
```

---

_This file is updated after every production bug. If you find a new trap, add it here._
