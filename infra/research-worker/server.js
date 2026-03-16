'use strict';

/**
 * WebPeel Research Worker
 * Runs on Hetzner VPS alongside SearXNG and Ollama.
 * Eliminates Render OOM + network latency for the /v1/research endpoint.
 *
 * Architecture:
 *   Render (api.webpeel.dev) → POST /v1/research (auth check)
 *     → proxy → Hetzner:3001/research (this file)
 *       → SearXNG :8888 → fetch URLs → cheerio → Ollama :11434
 */

const express = require('express');
const { load: cheerioLoad } = require('cheerio');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT                 = 3001;
const SEARXNG_URL          = 'http://localhost:8888';
const OLLAMA_URL           = 'http://localhost:11434';
const OLLAMA_MODEL         = 'webpeel';
const MAX_SOURCES_HARD_LIMIT = 8;
const DEFAULT_MAX_SOURCES  = 3;
const SEARXNG_TIMEOUT_MS   = 10_000;  // local SearXNG should be <2s
const PER_URL_TIMEOUT_MS   = 5_000;
const TOTAL_TIMEOUT_MS     = 45_000;
const HTML_CAP_BYTES       = 100_000; // cap before cheerio parse to avoid OOM

// ---------------------------------------------------------------------------
// Key-fact extraction
// Score sentences; boost by 1.5x if they contain $, %, /mo, or a year.
// ---------------------------------------------------------------------------
function extractKeyFacts(content, query, maxFacts = 8) {
  if (!content || !query) return [];

  const queryKeywords = new Set(
    query.toLowerCase().split(/\W+/).filter(w => w.length > 2)
  );
  if (queryKeywords.size === 0) return [];

  const sentences = content
    .replace(/\n{2,}/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 40 && s.length < 500);

  const scored = sentences.map(sentence => {
    const words = sentence.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    let hits = 0;
    const seen = new Set();
    for (const w of words) {
      if (queryKeywords.has(w) && !seen.has(w)) {
        hits++;
        seen.add(w);
      }
    }
    let score = hits / queryKeywords.size;
    // +1.5x for $ % /mo year-pattern (19xx/20xx)
    if (/\$[\d,]+|[\d,]+\/mo|\d+%|(19|20)\d{2}/.test(sentence)) {
      score *= 1.5;
    }
    return { sentence, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const result = [];
  for (const { sentence, score } of scored) {
    if (score === 0) break;
    const key = sentence.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(sentence);
    if (result.length >= maxFacts) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// POST /research
// ---------------------------------------------------------------------------
app.post('/research', async (req, res) => {
  const startTime = Date.now();
  const overallDeadline = startTime + TOTAL_TIMEOUT_MS;

  const { query, maxSources: requestedMax } = req.body || {};

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Missing or empty "query"' });
  }

  const cleanQuery  = query.trim().slice(0, 500);
  const maxSources  = Math.min(
    Math.max(1, typeof requestedMax === 'number' ? requestedMax : DEFAULT_MAX_SOURCES),
    MAX_SOURCES_HARD_LIMIT
  );

  console.log(`[research] query="${cleanQuery}" maxSources=${maxSources}`);

  try {
    // ── 1. SearXNG search ─────────────────────────────────────────────────
    let searchResults = [];
    try {
      const searchUrl = `${SEARXNG_URL}/search?q=${encodeURIComponent(cleanQuery)}&format=json`;
      const searchResp = await fetch(searchUrl, {
        signal: AbortSignal.timeout(SEARXNG_TIMEOUT_MS),
      });
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        searchResults = (searchData.results || []).slice(0, maxSources * 2);
        console.log(`[research] SearXNG returned ${searchResults.length} results`);
      } else {
        console.warn(`[research] SearXNG HTTP ${searchResp.status}`);
      }
    } catch (err) {
      console.warn('[research] SearXNG failed:', err.message);
    }

    // ── 2. Fetch top N URLs sequentially ──────────────────────────────────
    const sources        = [];
    const fetchedContents = [];

    for (const result of searchResults) {
      if (sources.length >= maxSources) break;
      if (Date.now() > overallDeadline - 2_000) break;

      const { url, title = '', content: snippet = '' } = result;
      if (!url) continue;

      const timeLeft  = overallDeadline - Date.now();
      const urlTimeout = Math.min(PER_URL_TIMEOUT_MS, timeLeft - 1_000);
      if (urlTimeout < 500) break;

      const fetchStart = Date.now();
      try {
        const fetchResp = await fetch(url, {
          signal: AbortSignal.timeout(urlTimeout),
          headers: { 'User-Agent': 'WebPeelBot/1.0' },
        });

        if (!fetchResp.ok) continue;

        const contentType = fetchResp.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) continue;

        // Cap raw HTML at 100KB before parsing
        const rawHtml  = (await fetchResp.text()).slice(0, HTML_CAP_BYTES);
        const fetchTime = Date.now() - fetchStart;

        const $         = cheerioLoad(rawHtml);
        $('script,style,nav,footer,header,aside,noscript,[aria-hidden]').remove();

        const pageTitle = ($('title').text() || $('h1').first().text() || title).trim().slice(0, 200);
        const rawText   = $('main, article, [role=main], body').first().text()
          .replace(/\s+/g, ' ').trim();
        const content   = rawText.slice(0, 4000);
        const wordCount = content.split(/\s+/).filter(Boolean).length;
        const sourceSnippet = content.slice(0, 500).replace(/\s+/g, ' ').trim();

        sources.push({
          url,
          title:   pageTitle.slice(0, 200),
          snippet: sourceSnippet || String(snippet).slice(0, 500),
          wordCount,
          fetchTime,
        });

        if (wordCount >= 50) {
          fetchedContents.push({ url, content });
        } else if (String(snippet).length > 20) {
          // Thin page — use title + search snippet as surrogate
          fetchedContents.push({ url, content: `${pageTitle}\n\n${snippet}` });
        }

        console.log(`[research] Fetched ${url} (${wordCount} words, ${fetchTime}ms)`);
      } catch (err) {
        console.warn(`[research] Skipped ${url}: ${err.message}`);
      }
    }

    // ── 3. Key-fact extraction ─────────────────────────────────────────────
    const allFacts   = [];
    const seenFacts  = new Set();

    for (const { content } of fetchedContents) {
      for (const fact of extractKeyFacts(content, cleanQuery, 5)) {
        const key = fact.toLowerCase().slice(0, 100);
        if (!seenFacts.has(key)) {
          seenFacts.add(key);
          allFacts.push(fact);
        }
      }
      if (allFacts.length >= 20) break;
    }

    const keyFacts = allFacts.slice(0, 8);

    // ── 4. Ollama synthesis ───────────────────────────────────────────────
    let summary;

    if (fetchedContents.length > 0 && Date.now() < overallDeadline - 1_000) {
      try {
        const sourcesText = fetchedContents
          .map((fc, i) => `[SOURCE ${i + 1}] ${fc.url}\n${fc.content.slice(0, 800)}`)
          .join('\n\n---\n\n');

        const prompt =
          'You are WebPeel Research. Answer the question using the sources. ' +
          'Cite [1],[2]. Preserve exact numbers and prices. 2-4 sentences. Plain text only.\n\n' +
          `Question: ${cleanQuery}\n\nSources:\n\n${sourcesText}`;

        const ollamaResp = await fetch(`${OLLAMA_URL}/api/generate`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            model:  OLLAMA_MODEL,
            prompt,
            stream: false,
            think:  false,
            options: {
              num_predict: 500,
              temperature: 0.3,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (ollamaResp.ok) {
          const ollamaData  = await ollamaResp.json();
          let rawSummary    = ollamaData.response || '';
          // Strip Qwen-style think tags
          rawSummary = rawSummary.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          if (rawSummary.length > 0) {
            summary = rawSummary;
            console.log(`[research] Ollama summary: ${rawSummary.length} chars`);
          }
        } else {
          console.warn(`[research] Ollama HTTP ${ollamaResp.status}`);
        }
      } catch (err) {
        console.warn('[research] Ollama failed (non-fatal):', err.message);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[research] Done in ${elapsed}ms — ${sources.length} sources, ${keyFacts.length} facts`);

    return res.json({
      success: true,
      data: {
        query: cleanQuery,
        ...(summary !== undefined ? { summary } : {}),
        sources,
        keyFacts,
        totalSources: sources.length,
        elapsed,
      },
    });
  } catch (err) {
    console.error('[research] Unexpected error:', err);
    if (res.headersSent) return;
    return res.status(500).json({ success: false, error: 'Research failed' });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[research-worker] Listening on 127.0.0.1:${PORT}`);
  console.log(`[research-worker] SearXNG: ${SEARXNG_URL}`);
  console.log(`[research-worker] Ollama:  ${OLLAMA_URL} (model: ${OLLAMA_MODEL})`);
});
