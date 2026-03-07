/**
 * Legacy tool handlers — backward-compatible implementations for all
 * pre-consolidated tool names. Each handler delegates to the appropriate
 * core module or consolidated handler.
 */

import { peel, peelBatch } from '../../index.js';
import type { PeelOptions, PeelResult, PageAction } from '../../types.js';
import { getBestSearchProvider, type SearchProviderId } from '../../core/search-provider.js';
import { quickAnswer } from '../../core/quick-answer.js';
import { answerQuestion, type LLMProviderId } from '../../core/answer.js';
import { runAgent, type AgentDepth, type AgentTopic } from '../../core/agent.js';
import { textResult, safeStringify, timeout, type McpHandler } from './types.js';
import { handleExtract } from './extract.js';
import { handleMonitor } from './monitor.js';
import { handleFind } from './find.js';

// ── webpeel_youtube ──────────────────────────────────────────────────────────

export const handleYoutube: McpHandler = async (args, _ctx?) => {
  const { getYouTubeTranscript } = await import('../../core/youtube.js');
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  const language = (args['language'] as string | undefined) || 'en';
  const transcript = await Promise.race([
    getYouTubeTranscript(url, { language }),
    timeout<never>(60000, 'YouTube transcript'),
  ]);
  return textResult(safeStringify(transcript));
};

// ── webpeel_screenshot ───────────────────────────────────────────────────────

export const handleScreenshot: McpHandler = async (args, _ctx?) => {
  const { takeScreenshot } = await import('../../core/screenshot.js');
  const {
    url,
    fullPage,
    width,
    height,
    format,
    quality,
    waitFor,
    stealth,
    actions,
  } = args as {
    url: string;
    fullPage?: boolean;
    width?: number;
    height?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    waitFor?: number;
    stealth?: boolean;
    actions?: PageAction[];
  };
  if (!url) throw new Error('url is required');
  const result = await Promise.race([
    takeScreenshot(url, {
      fullPage: fullPage || false,
      width,
      height,
      format: format || 'png',
      quality,
      waitFor,
      stealth: stealth || false,
      actions,
    }),
    timeout<never>(60000, 'Screenshot'),
  ]);
  return textResult(safeStringify({
    url: result.url,
    format: result.format,
    contentType: result.contentType,
    screenshot: result.screenshot,
  }));
};

// ── webpeel_search ───────────────────────────────────────────────────────────

export const handleSearch: McpHandler = async (args, ctx?) => {
  return handleFind({ ...args, depth: 'quick' }, ctx);
};

// ── webpeel_research ─────────────────────────────────────────────────────────

export const handleResearch: McpHandler = async (args, _ctx?) => {
  const {
    query,
    maxSources,
    maxDepth,
    llmApiKey,
    llmModel,
    llmBaseUrl,
    outputFormat,
    timeout: resTimeout,
  } = args as {
    query: string;
    maxSources?: number;
    maxDepth?: number;
    llmApiKey?: string;
    llmModel?: string;
    llmBaseUrl?: string;
    outputFormat?: 'report' | 'sources';
    timeout?: number;
  };
  if (!query) throw new Error('query is required');

  const { research } = await import('../../core/research.js');
  const result = await Promise.race([
    research({
      query,
      maxSources: maxSources ?? 5,
      maxDepth: maxDepth ?? 1,
      apiKey: llmApiKey,
      model: llmModel,
      baseUrl: llmBaseUrl,
      outputFormat: outputFormat ?? 'report',
      timeout: resTimeout ?? 60000,
    }),
    timeout<never>(180000, 'Research'),
  ]);
  return textResult(safeStringify({
    report: result.report,
    sources: result.sources,
    totalSourcesFound: result.totalSourcesFound,
    sourcesConsulted: result.sourcesConsulted,
    elapsed: result.elapsed,
    tokensUsed: result.tokensUsed,
    cost: result.cost,
  }));
};

// ── webpeel_crawl ────────────────────────────────────────────────────────────

export const handleCrawl: McpHandler = async (args, _ctx?) => {
  const { crawl } = await import('../../core/crawler.js');
  const {
    url,
    maxPages,
    maxDepth,
    allowedDomains,
    excludePatterns,
    respectRobotsTxt,
    rateLimitMs,
    sitemapFirst,
    render,
    stealth,
  } = args as {
    url: string;
    maxPages?: number;
    maxDepth?: number;
    allowedDomains?: string[];
    excludePatterns?: string[];
    respectRobotsTxt?: boolean;
    rateLimitMs?: number;
    sitemapFirst?: boolean;
    render?: boolean;
    stealth?: boolean;
  };
  if (!url) throw new Error('url is required');
  const results = await Promise.race([
    crawl(url, {
      maxPages,
      maxDepth,
      allowedDomains,
      excludePatterns,
      respectRobotsTxt,
      rateLimitMs,
      sitemapFirst,
      render,
      stealth,
    }),
    timeout<never>(600000, 'Crawl'),
  ]);
  return textResult(safeStringify(results));
};

// ── webpeel_map ──────────────────────────────────────────────────────────────

export const handleMap: McpHandler = async (args, _ctx?) => {
  const { mapDomain } = await import('../../core/map.js');
  const { url, maxUrls, includePatterns, excludePatterns } = args as {
    url: string;
    maxUrls?: number;
    includePatterns?: string[];
    excludePatterns?: string[];
  };
  if (!url) throw new Error('url is required');
  const results = await Promise.race([
    mapDomain(url, { maxUrls, includePatterns, excludePatterns }),
    timeout<never>(600000, 'Map'),
  ]);
  return textResult(safeStringify(results));
};

// ── webpeel_batch ────────────────────────────────────────────────────────────

export const handleBatch: McpHandler = async (args, _ctx?) => {
  const { urls, concurrency, render, format, selector } = args as {
    urls: string[];
    concurrency?: number;
    render?: boolean;
    format?: 'markdown' | 'text' | 'html';
    selector?: string;
  };
  if (!urls || !Array.isArray(urls)) throw new Error('urls must be an array');
  if (urls.length === 0) throw new Error('urls cannot be empty');
  if (urls.length > 50) throw new Error('Too many URLs (max 50)');
  const options: PeelOptions & { concurrency?: number } = {
    concurrency: concurrency || 3,
    render: render || false,
    format: format || 'markdown',
    selector,
  };
  const results = await Promise.race([
    peelBatch(urls, options),
    timeout<never>(300000, 'Batch'),
  ]);
  return textResult(safeStringify(results));
};

// ── webpeel_deep_fetch ───────────────────────────────────────────────────────

export const handleDeepFetch: McpHandler = async (args, ctx?) => {
  const { query, count: countArg, format: formatArg } = args as {
    query: string;
    count?: number;
    format?: string;
  };
  if (!query) throw new Error('query is required');
  return handleFind(
    { query, depth: 'deep', limit: Math.min(Math.max(countArg ?? 5, 1), 10), format: formatArg },
    ctx,
  );
};

// ── webpeel_summarize ────────────────────────────────────────────────────────

export const handleSummarize: McpHandler = async (args, _ctx?) => {
  const { url, llmApiKey, prompt, llmModel, llmBaseUrl, render } = args as {
    url: string;
    llmApiKey: string;
    prompt?: string;
    llmModel?: string;
    llmBaseUrl?: string;
    render?: boolean;
  };
  if (!url) throw new Error('url is required');
  if (!llmApiKey) throw new Error('llmApiKey is required');
  const options: PeelOptions = {
    render: render || false,
    extract: {
      prompt: prompt || 'Summarize this webpage in 2-3 sentences.',
      llmApiKey,
      llmModel: llmModel || 'gpt-4o-mini',
      llmBaseUrl: llmBaseUrl || 'https://api.openai.com/v1',
    },
  };
  const result = await Promise.race([
    peel(url, options),
    timeout<never>(60000, 'Summarize'),
  ]) as PeelResult;
  return textResult(safeStringify({ url: result.url, title: result.title, summary: result.extracted }));
};

// ── webpeel_answer ───────────────────────────────────────────────────────────

export const handleAnswer: McpHandler = async (args, _ctx?) => {
  const {
    question: q,
    searchProvider: sp,
    searchApiKey: sak,
    llmProvider: lp,
    llmApiKey: lak,
    llmModel: lm,
    maxSources: ms,
  } = args as {
    question: string;
    searchProvider?: string;
    searchApiKey?: string;
    llmProvider: string;
    llmApiKey: string;
    llmModel?: string;
    maxSources?: number;
  };
  if (!q) throw new Error('question is required');
  if (!lp) throw new Error('llmProvider is required');
  if (!lak) throw new Error('llmApiKey is required');
  const validLlm: LLMProviderId[] = ['openai', 'anthropic', 'google'];
  if (!validLlm.includes(lp as LLMProviderId)) throw new Error('Invalid llmProvider');
  const validSp: SearchProviderId[] = ['duckduckgo', 'brave', 'stealth', 'google'];
  const resolvedSp = (sp && validSp.includes(sp as SearchProviderId) ? sp : 'duckduckgo') as SearchProviderId;
  const result = await Promise.race([
    answerQuestion({
      question: q,
      searchProvider: resolvedSp,
      searchApiKey: sak,
      llmProvider: lp as LLMProviderId,
      llmApiKey: lak,
      llmModel: lm,
      maxSources: Math.min(Math.max(ms ?? 5, 1), 10),
      stream: false,
    }),
    timeout<never>(180000, 'Answer'),
  ]);
  return textResult(safeStringify(result));
};

// ── webpeel_quick_answer ─────────────────────────────────────────────────────

export const handleQuickAnswer: McpHandler = async (args, _ctx?) => {
  const { url, question: q, maxPassages: mpArg, render } = args as {
    url: string;
    question: string;
    maxPassages?: number;
    render?: boolean;
  };
  if (!url) throw new Error('url is required');
  if (!q) throw new Error('question is required');
  const maxPassages = typeof mpArg === 'number' ? Math.min(Math.max(mpArg, 1), 10) : 3;
  const peelResult = await Promise.race([
    peel(url, { render: render || false, format: 'markdown', budget: 8000 }),
    timeout<never>(60000, 'Quick answer fetch'),
  ]) as PeelResult;
  const qa = quickAnswer({
    question: q,
    content: peelResult.content || '',
    url: peelResult.url || url,
    maxPassages,
  });
  return textResult(safeStringify({
    url: peelResult.url || url,
    title: peelResult.title,
    question: qa.question,
    answer: qa.answer,
    confidence: qa.confidence,
    passages: qa.passages,
    method: qa.method,
  }));
};

// ── webpeel_brand ────────────────────────────────────────────────────────────

export const handleBrand: McpHandler = async (args, ctx?) => {
  return handleExtract({ ...args, _brand: true }, ctx);
};

// ── webpeel_change_track ─────────────────────────────────────────────────────

export const handleChangeTrack: McpHandler = async (args, ctx?) => {
  return handleMonitor(args, ctx);
};

// ── webpeel_watch ────────────────────────────────────────────────────────────

export const handleWatch: McpHandler = async (args, ctx?) => {
  const action = args['action'] as string | undefined;
  const pool = ctx?.pool;

  // If pool is available (HTTP route), use WatchManager
  if (pool) {
    const { WatchManager } = await import('../../core/watch-manager.js');
    const wm = new WatchManager(pool as ConstructorParameters<typeof WatchManager>[0]);
    const accountId = ctx?.accountId || 'anonymous';

    if (action === 'create') {
      const watch = await wm.create(accountId, args['url'] as string, {
        webhookUrl: args['webhookUrl'] as string | undefined,
        checkIntervalMinutes: (args['intervalMinutes'] as number) || 60,
        selector: args['selector'] as string | undefined,
      });
      return textResult(safeStringify(watch));
    }
    if (action === 'list') {
      const watches = await wm.list(accountId);
      return textResult(safeStringify(watches));
    }
    if (action === 'check') {
      const result = await wm.check(args['id'] as string);
      return textResult(safeStringify(result));
    }
    if (action === 'delete') {
      await wm.delete(args['id'] as string);
      return textResult(safeStringify({ success: true }));
    }
    return textResult(safeStringify({ error: `Unknown watch action: ${action}` }));
  }

  // Standalone fallback (no pool)
  if (!action || action === 'list' || action === 'check' || action === 'delete') {
    return textResult(safeStringify({
      message:
        'URL watching requires the hosted API (api.webpeel.dev). ' +
        'Use webpeel_monitor for one-time change detection.',
    }));
  }
  if (action === 'create') {
    return handleMonitor({
      url: args['url'] as string,
      webhook: args['webhookUrl'] as string | undefined,
    }, ctx);
  }
  return textResult(safeStringify({
    message: 'URL watching requires the hosted API (api.webpeel.dev).',
  }));
};

// ── webpeel_hotels ───────────────────────────────────────────────────────────

export const handleHotels: McpHandler = async (args, _ctx?) => {
  const { searchHotels, parseDate, addDays } = await import('../../core/hotel-search.js');
  const destination = args['destination'] as string;
  if (!destination) {
    return textResult(safeStringify({ error: 'Missing destination' }));
  }
  const checkin = args['checkin']
    ? parseDate(args['checkin'] as string)
    : parseDate('tomorrow');
  const checkout = args['checkout']
    ? parseDate(args['checkout'] as string)
    : addDays(checkin, 1);
  const sort = (
    ['price', 'rating', 'value'].includes(args['sort'] as string)
      ? args['sort']
      : 'price'
  ) as 'price' | 'rating' | 'value';
  const limit = Math.max(1, Math.min(50, (args['limit'] as number) || 20));
  const result = await searchHotels({ destination, checkin, checkout, sort, limit, stealth: true });
  return textResult(safeStringify({
    destination,
    checkin,
    checkout,
    sources: result.sources,
    count: result.results.length,
    results: result.results.slice(0, limit),
  }));
};

// ── webpeel_design_analysis ──────────────────────────────────────────────────

export const handleDesignAnalysis: McpHandler = async (args, _ctx?) => {
  const { takeDesignAnalysis } = await import('../../core/screenshot.js');
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');
  const result = await Promise.race([
    takeDesignAnalysis(url, {}),
    timeout<never>(90000, 'Design analysis'),
  ]) as { url: string; analysis: unknown };
  return textResult(safeStringify({ url: result.url, analysis: result.analysis }));
};

// ── webpeel_design_compare ───────────────────────────────────────────────────

export const handleDesignCompare: McpHandler = async (args, _ctx?) => {
  const { takeDesignComparison } = await import('../../core/screenshot.js');
  const url1 = args['url1'] as string;
  const url2 = args['url2'] as string;
  if (!url1 || typeof url1 !== 'string') throw new Error('url1 is required');
  if (!url2 || typeof url2 !== 'string') throw new Error('url2 is required');
  if (url1.length > 2048) throw new Error('url1 too long');
  if (url2.length > 2048) throw new Error('url2 too long');
  if (url1 === url2) throw new Error('url1 and url2 must be different URLs');
  const result = await Promise.race([
    takeDesignComparison(url1, url2, {}),
    timeout<never>(120000, 'Design comparison'),
  ]) as {
    subjectUrl: string;
    referenceUrl: string;
    comparison: {
      score: number;
      summary: string;
      gaps: unknown[];
      subjectAnalysis: unknown;
      referenceAnalysis: unknown;
    };
  };
  return textResult(safeStringify({
    subjectUrl: result.subjectUrl,
    referenceUrl: result.referenceUrl,
    score: result.comparison.score,
    summary: result.comparison.summary,
    gaps: result.comparison.gaps,
    subjectAnalysis: result.comparison.subjectAnalysis,
    referenceAnalysis: result.comparison.referenceAnalysis,
  }));
};

// ── webpeel_auto_extract ─────────────────────────────────────────────────────

export const handleAutoExtract: McpHandler = async (args, ctx?) => {
  return handleExtract(args, ctx);
};

// ── webpeel_agent / agent ────────────────────────────────────────────────────

export const handleAgent: McpHandler = async (args, _ctx?) => {
  const llmApiKey = args['llmApiKey'] as string | undefined;

  // LLM mode — delegate to runAgent
  if (llmApiKey) {
    const prompt = args['prompt'] as string;
    if (!prompt) throw new Error('prompt is required');
    const result = await Promise.race([
      runAgent({
        prompt,
        llmApiKey,
        llmModel: args['llmModel'] as string | undefined,
        depth: ((args['depth'] as AgentDepth) || 'basic'),
        topic: ((args['topic'] as AgentTopic) || 'general'),
        urls: args['urls'] as string[] | undefined,
        maxSources: (args['maxSources'] as number) || (args['maxResults'] as number) || undefined,
        outputSchema: args['outputSchema'] as Record<string, unknown> | undefined,
      }),
      timeout<never>(180000, 'Agent'),
    ]);
    return textResult(safeStringify(result));
  }

  // LLM-free mode — search + fetch + BM25 extraction
  const urlsArg = (args['urls'] as string[]) || [];
  const searchArg = args['search'] as string | undefined;
  if (urlsArg.length === 0 && !searchArg) {
    return textResult(safeStringify({
      message: 'This tool has been deprecated. Use the webpeel tool instead.',
    }));
  }

  const promptArg = args['prompt'] as string | undefined;
  const schema = args['schema'] as Record<string, string> | undefined;
  const budgetArg = (args['budget'] as number) || 4000;
  const maxResults = Math.min((args['maxResults'] as number) || 5, 20);

  const targetUrls: string[] = [...urlsArg];
  if (searchArg) {
    try {
      const { provider, apiKey } = getBestSearchProvider();
      const searchResults = await provider.searchWeb(searchArg, {
        count: Math.max(maxResults, 5),
        apiKey,
      });
      for (const r of searchResults) {
        if (!targetUrls.includes(r.url)) targetUrls.push(r.url);
      }
    } catch { /* continue with provided URLs */ }
  }

  const urlsToFetch = targetUrls.slice(0, maxResults);
  const agentResults: Array<{
    url: string;
    title: string;
    extracted: Record<string, string> | null;
    content: string;
    confidence: number;
  }> = [];

  await Promise.all(
    urlsToFetch.map(async (u) => {
      try {
        const page = (await peel(u, { budget: budgetArg, format: 'markdown' })) as PeelResult;
        const content = page.content || '';
        const title = page.title || u;
        let extracted: Record<string, string> | null = null;
        let confidence = 0;

        if (schema && Object.keys(schema).length > 0) {
          extracted = {};
          let total = 0;
          for (const [field] of Object.entries(schema)) {
            const question = promptArg
              ? `${promptArg} — specifically: what is the ${field}?`
              : `What is the ${field}?`;
            const qa = quickAnswer({ question, content, maxPassages: 1, url: u });
            extracted[field] = qa.answer || '';
            total += qa.confidence;
          }
          if ('source' in schema) extracted['source'] = u;
          confidence = Object.keys(schema).length > 0 ? total / Object.keys(schema).length : 0;
        } else if (promptArg) {
          const qa = quickAnswer({ question: promptArg, content, maxPassages: 3, url: u });
          confidence = qa.confidence;
        }

        agentResults.push({
          url: u,
          title,
          extracted,
          content: content.slice(0, 500) + (content.length > 500 ? '…' : ''),
          confidence,
        });
      } catch { /* skip failed URLs */ }
    }),
  );

  return textResult(safeStringify({
    success: true,
    data: { results: agentResults, totalSources: agentResults.length },
  }));
};
