/**
 * WebPeel Deep Research Agent
 *
 * Autonomously searches the web, fetches top sources, filters content with
 * BM25, optionally follows promising links, and synthesizes a comprehensive
 * report using an LLM.
 *
 * Design principle: orchestrate existing modules (peel, bm25-filter,
 * llm-extract) — don't reinvent anything.
 */

export interface ResearchOptions {
  /** Research question or topic */
  query: string;
  /** Maximum number of sources to consult. Default: 5 */
  maxSources?: number;
  /** Maximum depth of link-following. Default: 1 (just search results; 2+ follows links) */
  maxDepth?: number;
  /** LLM API key for synthesis */
  apiKey?: string;
  /** LLM model for synthesis. Default: gpt-4o-mini */
  model?: string;
  /** LLM base URL. Default: https://api.openai.com/v1 */
  baseUrl?: string;
  /** Maximum total time in ms. Default: 60000 (1 minute) */
  timeout?: number;
  /** Output format: 'report' (markdown synthesis) or 'sources' (raw extracted data). Default: 'report' */
  outputFormat?: 'report' | 'sources';
  /** Optional callback for progress updates */
  onProgress?: (step: ResearchStep) => void;
}

export interface ResearchStep {
  phase: 'searching' | 'fetching' | 'extracting' | 'following' | 'synthesizing';
  message: string;
  sourcesFound?: number;
  sourcesFetched?: number;
}

export interface ResearchSource {
  url: string;
  title: string;
  /** Key findings from this source */
  findings: string;
  /** Relevance score (0-1) */
  relevance: number;
}

export interface ResearchResult {
  /** Synthesized research report (markdown) */
  report: string;
  /** Sources consulted */
  sources: ResearchSource[];
  /** Total sources found vs consulted */
  totalSourcesFound: number;
  sourcesConsulted: number;
  /** Time taken in ms */
  elapsed: number;
  /** Tokens used for synthesis */
  tokensUsed?: { input: number; output: number };
  /** Estimated cost in USD */
  cost?: number;
}

// Regex for markdown links: [title](url) — supports https:// and protocol-relative //
const LINK_REGEX = /\[([^\]]*)\]\(((?:https?:)?\/\/[^)]+)\)/g;

/**
 * Resolve a DDG redirect URL to the actual destination.
 * DDG HTML search uses `//duckduckgo.com/l/?uddg=https%3A%2F%2Factual-url&rut=...`
 */
function resolveDdgRedirect(rawUrl: string): string | null {
  try {
    // Normalize protocol-relative URLs
    const normalised = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const parsed = new URL(normalised);

    if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname === '/l/') {
      const target = parsed.searchParams.get('uddg');
      if (target) return target;
    }

    // Not a DDG redirect — return as-is if it's a real http(s) URL
    if (normalised.startsWith('http://') || normalised.startsWith('https://')) {
      return normalised;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract unique non-DDG links from markdown content.
 * Handles DDG redirect URLs by extracting the actual destination from the `uddg` param.
 */
function extractLinks(markdown: string, visitedUrls: Set<string>): Array<{ title: string; url: string }> {
  const found: Array<{ title: string; url: string }> = [];
  const regex = new RegExp(LINK_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const [, title, rawUrl] = match;
    if (!rawUrl) continue;

    const resolvedUrl = resolveDdgRedirect(rawUrl);
    if (!resolvedUrl) continue;
    if (resolvedUrl.includes('duckduckgo.com')) continue;
    if (visitedUrls.has(resolvedUrl)) continue;

    found.push({ title: title || '', url: resolvedUrl });
    visitedUrls.add(resolvedUrl);
  }
  return found;
}

/**
 * Conduct autonomous multi-step web research on a topic.
 */
export async function research(options: ResearchOptions): Promise<ResearchResult> {
  const {
    query,
    maxSources = 5,
    maxDepth = 1,
    timeout = 60000,
    outputFormat = 'report',
    onProgress,
  } = options;

  const startTime = Date.now();
  const sources: ResearchSource[] = [];
  const visitedUrls = new Set<string>();

  // Lazy imports so users who don't call research() don't pay the cost
  const { peel } = await import('../index.js');
  const { filterByRelevance, computeRelevanceScore } = await import('./bm25-filter.js');

  // -------------------------------------------------------------------------
  // Phase 1: Search
  // -------------------------------------------------------------------------
  onProgress?.({ phase: 'searching', message: `Searching for: ${query}` });

  let searchUrls: Array<{ title: string; url: string }> = [];

  try {
    const searchResult = await peel(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        format: 'markdown',
        timeout: 10000,
      },
    );
    searchUrls = extractLinks(searchResult.content, visitedUrls);
  } catch {
    // Search failed — proceed with empty list; will produce sources-only report
  }

  // -------------------------------------------------------------------------
  // Phase 2: Fetch top sources in parallel
  // -------------------------------------------------------------------------
  const sourcesToFetch = searchUrls.slice(0, maxSources);

  onProgress?.({
    phase: 'fetching',
    message: `Fetching ${sourcesToFetch.length} sources`,
    sourcesFound: searchUrls.length,
  });

  const fetchPromises = sourcesToFetch.map(async ({ title, url }) => {
    try {
      // Guard: bail if we've burned more than 70% of the time budget
      if (Date.now() - startTime > timeout * 0.7) return null;

      const result = await peel(url, {
        format: 'markdown',
        timeout: 15000,
        budget: 3000,
      });

      // Phase 3 (inline): BM25 filter content to query + compute relevance
      const filtered = filterByRelevance(result.content, { query });
      const relevance = computeRelevanceScore(result.content, query);

      return {
        url,
        title: result.title || title || url,
        findings: filtered.content.slice(0, 4000),
        relevance,
      } satisfies ResearchSource;
    } catch {
      return null;
    }
  });

  const fetchResults = await Promise.allSettled(fetchPromises);
  for (const r of fetchResults) {
    if (r.status === 'fulfilled' && r.value) {
      sources.push(r.value);
    }
  }

  // Sort by relevance (descending)
  sources.sort((a, b) => b.relevance - a.relevance);

  onProgress?.({
    phase: 'extracting',
    message: `Extracted content from ${sources.length} sources`,
    sourcesFetched: sources.length,
  });

  // -------------------------------------------------------------------------
  // Phase 4: Follow promising links (only when maxDepth > 1)
  // -------------------------------------------------------------------------
  if (maxDepth > 1 && sources.length > 0 && Date.now() - startTime < timeout * 0.5) {
    onProgress?.({ phase: 'following', message: 'Following promising links for deeper research' });

    const topSources = sources.slice(0, 2);

    for (const source of topSources) {
      const linkedUrls = extractLinks(source.findings, visitedUrls).slice(0, 2);

      for (const { url: followUrl } of linkedUrls) {
        if (Date.now() - startTime > timeout * 0.7) break;

        try {
          const followResult = await peel(followUrl, {
            format: 'markdown',
            timeout: 10000,
            budget: 2000,
          });

          const filtered = filterByRelevance(followResult.content, { query });
          const followRelevance = computeRelevanceScore(followResult.content, query);

          sources.push({
            url: followUrl,
            title: followResult.title || followUrl,
            findings: filtered.content.slice(0, 3000),
            // Slightly lower weight for follow-up links
            relevance: followRelevance * 0.8,
          });
        } catch {
          // skip failed follow-ups
        }
      }
    }

    sources.sort((a, b) => b.relevance - a.relevance);
  }

  // -------------------------------------------------------------------------
  // Phase 5: Synthesize
  // -------------------------------------------------------------------------
  let report = '';
  let tokensUsed: { input: number; output: number } | undefined;
  let cost: number | undefined;

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

  if (outputFormat === 'report' && apiKey && sources.length > 0) {
    onProgress?.({ phase: 'synthesizing', message: 'Synthesizing research report' });

    const model = options.model ?? 'gpt-4o-mini';
    const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';

    const sourceSummaries = sources
      .slice(0, 8)
      .map((s, i) =>
        `Source ${i + 1}: ${s.title}\nURL: ${s.url}\nRelevance: ${Math.round(s.relevance * 100)}%\n\n${s.findings.slice(0, 2000)}`,
      )
      .join('\n\n---\n\n');

    const synthPrompt = `Based on the following web research sources, write a comprehensive research report answering this question:

"${query}"

Sources:
${sourceSummaries}

Instructions:
1. Synthesize information from ALL relevant sources
2. Include specific data points, numbers, and facts
3. Cite sources using [Source N] format
4. If sources disagree, note the conflicting information
5. End with a "Sources" section listing all URLs
6. Write in markdown format
7. Be thorough but concise`;

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a research analyst. Produce well-structured, factual research reports based on the provided web sources. Always cite your sources.',
            },
            { role: 'user', content: synthPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        report = data.choices?.[0]?.message?.content ?? '';
        tokensUsed = {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
        };

        const { estimateCost } = await import('./llm-extract.js');
        cost = estimateCost(model, tokensUsed.input, tokensUsed.output);
      }
    } catch {
      // LLM call failed — fall back to sources format
    }
  }

  // If synthesis wasn't attempted or failed, produce raw sources report
  if (!report) {
    report = sources
      .map(
        (s, i) =>
          `## Source ${i + 1}: ${s.title}\n**URL:** ${s.url}\n**Relevance:** ${Math.round(s.relevance * 100)}%\n\n${s.findings.slice(0, 2000)}`,
      )
      .join('\n\n---\n\n');
  }

  return {
    report,
    sources: sources.map(s => ({
      url: s.url,
      title: s.title,
      findings: s.findings.slice(0, 500),
      relevance: s.relevance,
    })),
    totalSourcesFound: searchUrls.length,
    sourcesConsulted: sources.length,
    elapsed: Date.now() - startTime,
    tokensUsed,
    cost,
  };
}
