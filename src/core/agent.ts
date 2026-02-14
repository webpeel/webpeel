/**
 * Autonomous web research agent
 * Searches the web, fetches pages, and extracts structured data based on natural language prompts
 */

import { load } from 'cheerio';
import { peel } from '../index.js';

export interface AgentOptions {
  /** Natural language description of what data to extract */
  prompt: string;
  /** Optional URLs to start from */
  urls?: string[];
  /** JSON schema for structured output */
  schema?: Record<string, any>;
  /** LLM API key (BYOK - bring your own key) */
  llmApiKey: string;
  /** LLM API base URL (default: OpenAI) */
  llmApiBase?: string;
  /** LLM model (default: gpt-4o-mini) */
  llmModel?: string;
  /** Max pages to visit (default: 10) */
  maxPages?: number;
  /** Max credits/cost to spend */
  maxCredits?: number;
  /** Progress callback */
  onProgress?: (progress: AgentProgress) => void;
}

export interface AgentProgress {
  status: 'searching' | 'visiting' | 'extracting' | 'done';
  currentUrl?: string;
  pagesVisited: number;
  message: string;
}

export interface AgentResult {
  success: boolean;
  data: any;
  sources: string[];  // URLs that contributed to the result
  pagesVisited: number;
  creditsUsed: number;
}

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Search DuckDuckGo HTML and parse results
 */
async function searchWeb(query: string, limit = 10): Promise<SearchResult[]> {
  const { fetch: undiciFetch } = await import('undici');
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
  
  try {
    const response = await undiciFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });
    
    const html = await response.text();
    const $ = load(html);
    
    const results: SearchResult[] = [];
    $('.result').each((_, el) => {
      const link = $(el).find('.result__a');
      const snippet = $(el).find('.result__snippet');
      
      const url = link.attr('href');
      const title = link.text().trim();
      const desc = snippet.text().trim();
      
      if (url && title) {
        // DuckDuckGo uses redirect URLs, extract the actual URL
        try {
          const actualUrl = url.startsWith('//') 
            ? `https:${url}` 
            : url.includes('uddg=') 
              ? decodeURIComponent(url.split('uddg=')[1].split('&')[0])
              : url;
          
          results.push({
            url: actualUrl,
            title,
            snippet: desc,
          });
        } catch {
          // Skip malformed URLs
        }
      }
    });
    
    return results.slice(0, limit);
  } catch (error: any) {
    console.error('Search failed:', error);
    return [];
  }
}

/**
 * Call OpenAI-compatible LLM API
 */
async function callLLM(
  messages: Array<{ role: string; content: string }>,
  options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    schema?: Record<string, any>;
  }
): Promise<string> {
  const { apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1', schema } = options;
  const { fetch: undiciFetch } = await import('undici');
  
  const body: any = {
    model,
    messages,
    temperature: 0,
  };
  
  // Force JSON mode if schema is provided
  if (schema) {
    body.response_format = { type: 'json_object' };
  }
  
  const response = await undiciFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }
  
  const result = await response.json() as any;
  const content = result.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error('LLM returned empty response');
  }
  
  return content;
}

/**
 * Truncate content to approximately N tokens (rough estimate: 1 token ≈ 4 chars)
 */
function truncateContent(content: string, maxTokens = 3000): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n\n[Content truncated...]';
}

/**
 * Run autonomous web research agent
 */
export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    prompt,
    urls: startUrls = [],
    schema,
    llmApiKey,
    llmApiBase = 'https://api.openai.com/v1',
    llmModel = 'gpt-4o-mini',
    maxPages = 10,
    maxCredits,
    onProgress,
  } = options;
  
  if (!llmApiKey) {
    throw new Error('llmApiKey is required');
  }
  
  if (!prompt) {
    throw new Error('prompt is required');
  }
  
  const maxIterations = Math.min(maxPages, 10);
  const visitedUrls = new Set<string>();
  const sources: string[] = [];
  let pagesVisited = 0;
  let creditsUsed = 0;
  
  // Collected data from all pages
  const collectedData: Array<{ url: string; content: string; title: string }> = [];
  
  const reportProgress = (status: AgentProgress['status'], message: string, currentUrl?: string) => {
    if (onProgress) {
      onProgress({
        status,
        currentUrl,
        pagesVisited,
        message,
      });
    }
  };
  
  try {
    // Step 1: Determine initial search strategy
    reportProgress('searching', 'Planning research strategy...');
    
    let urlsToVisit: string[] = [...startUrls];
    
    // If no starting URLs, ask LLM to generate search queries
    if (urlsToVisit.length === 0) {
      const planningMessages = [
        {
          role: 'system',
          content: 'You are a web research assistant. Generate 2-3 specific search queries to find information for the user\'s request. Return JSON only: {"queries": ["query1", "query2", "query3"]}',
        },
        {
          role: 'user',
          content: `Research request: ${prompt}`,
        },
      ];
      
      const planResponse = await callLLM(planningMessages, {
        apiKey: llmApiKey,
        model: llmModel,
        baseUrl: llmApiBase,
        schema: { queries: ['string'] },
      });
      
      creditsUsed++;
      
      let queries: string[] = [];
      try {
        const parsed = JSON.parse(planResponse);
        queries = parsed.queries || [];
      } catch {
        // Fallback: use the prompt as the query
        queries = [prompt];
      }
      
      // Search for URLs
      reportProgress('searching', `Searching: ${queries.join(', ')}`);
      
      for (const query of queries.slice(0, 2)) {  // Limit to 2 queries
        const results = await searchWeb(query, 5);
        urlsToVisit.push(...results.map(r => r.url));
        
        // Stop if we have enough URLs
        if (urlsToVisit.length >= maxPages) break;
      }
      
      // Deduplicate
      urlsToVisit = [...new Set(urlsToVisit)];
    }
    
    // Step 2: Visit pages and collect data
    for (const url of urlsToVisit.slice(0, maxIterations)) {
      // Check credit limit
      if (maxCredits && creditsUsed >= maxCredits) {
        reportProgress('done', 'Credit limit reached');
        break;
      }
      
      // Skip already visited URLs
      if (visitedUrls.has(url)) continue;
      
      visitedUrls.add(url);
      reportProgress('visiting', `Fetching: ${url}`, url);
      
      try {
        // Fetch the page
        const result = await peel(url, {
          format: 'markdown',
          timeout: 15000,
        });
        
        pagesVisited++;
        creditsUsed++;  // Count each page fetch as 1 credit
        
        // Truncate content to avoid token overflow
        const truncated = truncateContent(result.content, 3000);
        
        collectedData.push({
          url: result.url,
          title: result.title,
          content: truncated,
        });
        
        sources.push(result.url);
        
        reportProgress('visiting', `Fetched: ${result.title}`, url);
      } catch (error: any) {
        console.error(`Failed to fetch ${url}:`, error.message);
        // Continue with other URLs
      }
    }
    
    // Step 3: Extract and compile final data
    if (collectedData.length === 0) {
      return {
        success: false,
        data: { error: 'No data could be collected from the web' },
        sources: [],
        pagesVisited,
        creditsUsed,
      };
    }
    
    reportProgress('extracting', 'Analyzing collected data...');
    
    // Build context from all collected pages
    const context = collectedData
      .map(d => `Source: ${d.url}\nTitle: ${d.title}\n\n${d.content}`)
      .join('\n\n---\n\n');
    
    const truncatedContext = truncateContent(context, 8000);  // Larger budget for final analysis
    
    // Build system prompt
    const systemPrompt = schema
      ? `You are a web research assistant. Extract structured data from the provided web content based on the user's request. Return a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nReturn ONLY valid JSON, no explanation.`
      : `You are a web research assistant. Extract and compile information from the provided web content based on the user's request. Return a JSON object with your findings. Be comprehensive but concise. Return ONLY valid JSON, no explanation.`;
    
    const extractMessages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Research request: ${prompt}\n\nCollected data from ${collectedData.length} web pages:\n\n${truncatedContext}`,
      },
    ];
    
    const extractResponse = await callLLM(extractMessages, {
      apiKey: llmApiKey,
      model: llmModel,
      baseUrl: llmApiBase,
      schema: schema || {},
    });
    
    creditsUsed++;
    
    // Parse final result
    let finalData: any;
    try {
      finalData = JSON.parse(extractResponse);
    } catch {
      // If JSON parsing fails, return the raw response wrapped in an object
      finalData = { result: extractResponse };
    }
    
    reportProgress('done', `Completed: ${pagesVisited} pages visited`);
    
    return {
      success: true,
      data: finalData,
      sources,
      pagesVisited,
      creditsUsed,
    };
  } catch (error: any) {
    console.error('Agent error:', error);
    
    return {
      success: false,
      data: { error: error.message || 'Unknown error occurred' },
      sources,
      pagesVisited,
      creditsUsed,
    };
  }
}
