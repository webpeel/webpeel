/**
 * handleFind — search the web, discover domain URLs, or do deep research.
 */

import { peel, peelBatch } from '../../index.js';
import type { PeelResult } from '../../types.js';
import { getBestSearchProvider, getSearchProvider, type SearchProviderId } from '../../core/search-provider.js';
import { quickAnswer } from '../../core/quick-answer.js';
import { textResult, safeStringify, timeout, type McpHandler } from './types.js';

export const handleFind: McpHandler = async (args, _ctx?) => {
  const query = args['query'] as string | undefined;
  const url = args['url'] as string | undefined;
  const depth = (args['depth'] as string | undefined) || 'quick';
  const limit = Math.min(Math.max((args['limit'] as number | undefined) ?? 5, 1), 20);

  // URL-based: map/discover pages on a domain
  if (url && !query) {
    const { mapDomain } = await import('../../core/map.js');
    const results = await Promise.race([
      mapDomain(url, { maxUrls: limit * 100 }),
      timeout<never>(600000, 'Map domain'),
    ]);
    return textResult(safeStringify(results));
  }

  if (!query) throw new Error('Either query or url is required');

  // Question-mode: if the query looks like a natural language question and depth
  // isn't forced to 'deep', use the LLM-free BM25 Q&A path (search → fetch → BM25).
  const isQuestion = /\?$/.test(query.trim()) ||
    /^(what|how|when|where|why|who|which|can|does|is|are|do|did|will|would|could|should)\b/i.test(query.trim());

  if (isQuestion && depth !== 'deep') {
    const numSources = Math.min(limit, 5);
    const { provider, apiKey } = getBestSearchProvider();
    let searchResults: Array<{ url: string; title: string; snippet: string }>;
    try {
      searchResults = (await Promise.race([
        provider.searchWeb(query, { count: numSources, apiKey }),
        timeout<never>(30000, 'Ask search'),
      ])) as Array<{ url: string; title: string; snippet: string }>;
    } catch {
      searchResults = [];
    }

    if (searchResults.length === 0) {
      return textResult(safeStringify({
        question: query,
        answer: null,
        confidence: 0,
        sources: [],
        method: 'bm25',
      }));
    }

    const fetched = await Promise.allSettled(
      searchResults.slice(0, numSources).map((r) =>
        peel(r.url, { budget: 3000, format: 'markdown', timeout: 12000 }).then((result) => ({
          result,
          searchResult: r,
        })),
      ),
    );

    const answers = fetched
      .filter((f): f is PromiseFulfilledResult<{ result: PeelResult; searchResult: typeof searchResults[0] }> => f.status === 'fulfilled')
      .map((f) => {
        const { result, searchResult } = f.value;
        const qa = quickAnswer({
          question: query,
          content: result.content || '',
          url: result.url || searchResult.url,
          maxPassages: 2,
        });
        return {
          answer: qa.answer,
          confidence: qa.confidence,
          source: {
            url: result.url || searchResult.url,
            title: result.title || searchResult.title,
            snippet: searchResult.snippet,
          },
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const best = answers[0];
    return textResult(safeStringify({
      question: query,
      answer: best?.answer || null,
      confidence: best?.confidence || 0,
      sources: answers.map((a) => ({ ...a.source, confidence: a.confidence })),
      method: 'bm25',
    }));
  }

  // Deep research mode
  if (depth === 'deep') {
    const { provider, apiKey } = getBestSearchProvider();
    const searchResults = await Promise.race([
      provider.searchWeb(query, { count: limit, apiKey }),
      timeout<never>(30000, 'Search'),
    ]) as Array<{ url: string; title?: string; snippet?: string }>;

    const results = Array.isArray(searchResults)
      ? searchResults
      : (searchResults as unknown as { results: Array<{ url: string; title?: string; snippet?: string }> }).results ?? [];
    const topN = results.slice(0, limit);

    if (topN.length === 0) {
      return textResult(safeStringify({ query, sources: [], content: '', totalTokens: 0 }));
    }

    const urls = topN.map((r) => r.url).filter(Boolean);
    const pages = await Promise.race([
      peelBatch(urls, { concurrency: 5, format: 'markdown' }),
      timeout<never>(120000, 'Batch fetch'),
    ]) as PeelResult[];

    const sources: Array<{ url: string; title: string; relevanceScore: number }> = [];
    const contentParts: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const sr = topN[i];
      const pageUrl = urls[i];
      const title = page.title || sr.title || pageUrl;
      const relevanceScore = Math.round((1 - i / Math.max(pages.length, 1)) * 100) / 100;
      sources.push({ url: pageUrl, title, relevanceScore });
      if (page.content) {
        contentParts.push(
          `## Source ${i + 1}: ${title}\n**URL:** ${pageUrl}\n\n${page.content}\n\n---\n`,
        );
        totalTokens += page.tokens || 0;
      }
    }

    return textResult(safeStringify({
      query,
      sources,
      content: contentParts.join('\n'),
      totalTokens,
    }));
  }

  // Quick search (default)
  const validProviders: SearchProviderId[] = ['duckduckgo', 'brave', 'stealth', 'google'];
  const providerId: SearchProviderId = (
    (args['provider'] as string | undefined) &&
    validProviders.includes(args['provider'] as SearchProviderId)
  )
    ? (args['provider'] as SearchProviderId)
    : 'duckduckgo';

  const searchProvider = getSearchProvider(providerId);
  const results = await Promise.race([
    searchProvider.searchWeb(query, { count: limit }),
    timeout<never>(30000, 'Search'),
  ]);

  return textResult(safeStringify(results));
};
