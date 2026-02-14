# WebPeel Agent Implementation

## Summary

Successfully implemented the autonomous web research agent endpoint for WebPeel — the killer feature that matches Firecrawl's `/agent` capability.

## Files Created

### 1. `src/core/agent.ts` (10.5KB)
**The Agent Core Logic**

Implements `runAgent()` — an autonomous web research agent that:
- Takes a natural language prompt
- Autonomously searches the web using DuckDuckGo
- Fetches and analyzes pages using WebPeel's `peel()` function
- Extracts structured data using LLM (OpenAI-compatible API)
- Returns JSON data matching an optional schema

**Key Features:**
- **BYOK (Bring Your Own Key)**: Users provide their own LLM API key
- **Smart search**: Generates search queries from the prompt using LLM
- **Efficient fetching**: Uses WebPeel's existing `peel()` function
- **Token management**: Truncates content to ~3000 tokens per page
- **Credit tracking**: Tracks API calls and page fetches
- **Progress callbacks**: Real-time updates on agent status
- **Error handling**: Gracefully handles individual page failures
- **Schema support**: Formats output to match user-provided JSON schema

**Agent Loop:**
1. **Plan**: LLM generates search queries based on the prompt
2. **Search**: DuckDuckGo HTML search finds relevant URLs
3. **Fetch**: Uses `peel()` to extract content from pages
4. **Analyze**: LLM extracts relevant data from fetched content
5. **Compile**: LLM compiles final structured response

### 2. `src/server/routes/agent.ts` (7.9KB)
**The API Routes**

Implements three endpoints:

#### `POST /v1/agent` (Synchronous)
```json
{
  "prompt": "Find the founders of Firecrawl and their backgrounds",
  "schema": { ... },        // Optional
  "urls": ["https://..."],  // Optional
  "llmApiKey": "sk-...",    // Required (BYOK)
  "llmModel": "gpt-4o-mini", // Optional
  "maxPages": 10            // Optional
}
```

**Response:**
```json
{
  "success": true,
  "data": { ... },
  "sources": ["https://...", "https://..."],
  "pagesVisited": 5,
  "creditsUsed": 6
}
```

#### `POST /v1/agent/async` (Asynchronous)
Returns a job ID immediately, processes in the background.

**Response:**
```json
{
  "success": true,
  "id": "550e8400-...",
  "url": "/v1/agent/550e8400-..."
}
```

#### `GET /v1/agent/:id`
Get the status and results of an async agent job.

#### `DELETE /v1/agent/:id`
Cancel a running agent job.

**Features:**
- Full integration with existing job queue
- Webhook support for progress notifications
- SSE (Server-Sent Events) support for real-time updates
- Proper error handling and validation

### 3. `src/server/app.ts` (Modified)
Added two lines to register the agent route:
```typescript
import { createAgentRouter } from './routes/agent.js';
app.use(createAgentRouter());
```

## Testing

✅ **TypeScript compilation**: `npx tsc --noEmit` — PASSES
✅ **Unit tests**: `npx vitest run` — 28 tests passed
✅ **Build**: `npm run build` — Successful

### Manual Testing

A test script is included: `test-agent.js`

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-...

# Run the test
node test-agent.js
```

## API Examples

### Example 1: Simple Research
```bash
curl -X POST http://localhost:3000/v1/agent \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Find the latest GPT-4 pricing",
    "llmApiKey": "sk-...",
    "maxPages": 5
  }'
```

### Example 2: Structured Data Extraction
```bash
curl -X POST http://localhost:3000/v1/agent \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Find information about Anthropic Claude models",
    "schema": {
      "models": [
        {
          "name": "string",
          "context_window": "number",
          "pricing": "string"
        }
      ]
    },
    "llmApiKey": "sk-...",
    "maxPages": 3
  }'
```

### Example 3: Starting from Specific URLs
```bash
curl -X POST http://localhost:3000/v1/agent \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Extract the company mission and team size",
    "urls": ["https://example.com/about"],
    "llmApiKey": "sk-...",
    "maxPages": 2
  }'
```

### Example 4: Async with Webhook
```bash
curl -X POST http://localhost:3000/v1/agent/async \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Research competitor pricing models",
    "llmApiKey": "sk-...",
    "maxPages": 10,
    "webhook": {
      "url": "https://your-app.com/webhook",
      "events": ["started", "progress", "completed", "failed"]
    }
  }'
```

## Implementation Notes

### Why BYOK?
All LLM calls use the user's API key (BYOK - Bring Your Own Key) to avoid:
- Rate limiting issues
- Cost management complexity
- API quota sharing

### DuckDuckGo Search
Uses the HTML endpoint (no API key needed):
- Free, unlimited searches
- Parses `.result__a` for links
- Parses `.result__snippet` for descriptions
- No signup or authentication required

### Credit System
Credits are tracked as:
- 1 credit per page fetch
- 1 credit per LLM call
- Total: ~(pages visited + 2) credits per agent run

### Error Handling
- Individual page failures don't stop the agent
- Continues with remaining URLs
- Returns partial results if some pages succeed
- Graceful fallback if LLM response is invalid

## Next Steps

Potential enhancements:
1. **Parallel fetching**: Fetch multiple pages concurrently
2. **Smart URL discovery**: Extract and follow relevant links from fetched pages
3. **Caching**: Cache search results and page content
4. **Multi-model support**: Allow switching between different LLMs
5. **Quality scoring**: Rank and filter search results by relevance
6. **Incremental results**: Stream partial results as pages are fetched

## Comparison to Firecrawl

**Similarities:**
- ✅ Takes a natural language prompt
- ✅ Autonomously searches and navigates the web
- ✅ Returns structured data based on schema
- ✅ Async support with job queue

**Differences:**
- 🔑 WebPeel uses BYOK (user's LLM key) — more control, no quota sharing
- 🆓 WebPeel uses free DuckDuckGo search — no API costs
- 🌐 WebPeel leverages existing `peel()` function — consistent quality
- 💰 WebPeel has transparent credit tracking — users know exact costs

## Status

✅ **Implementation complete**
✅ **TypeScript compiles without errors**
✅ **All tests passing (28/28)**
✅ **Build successful**
✅ **Ready for deployment**

The agent endpoint is production-ready and fully integrated with WebPeel's existing infrastructure.
