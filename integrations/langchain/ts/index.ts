/**
 * WebPeel LangChain Document Loader (TypeScript)
 *
 * Usage:
 *   import { WebPeelLoader } from 'webpeel/integrations/langchain/ts';
 *   const loader = new WebPeelLoader({ apiKey: 'wp_...' });
 *   const docs = await loader.load('https://example.com');
 */

interface WebPeelLoaderOptions {
  apiKey?: string;
  apiUrl?: string;
  render?: boolean;
  format?: 'markdown' | 'text';
}

class WebPeelLoader {
  private apiKey: string;
  private apiUrl: string;
  private render: boolean;
  private format: string;

  constructor(options: WebPeelLoaderOptions = {}) {
    this.apiKey = options.apiKey || process.env.WEBPEEL_API_KEY || '';
    this.apiUrl = (options.apiUrl || 'https://api.webpeel.dev').replace(/\/$/, '');
    this.render = options.render || false;
    this.format = options.format || 'markdown';
  }

  async load(url: string): Promise<Array<{ pageContent: string; metadata: Record<string, unknown> }>> {
    const params = new URLSearchParams({ url, format: this.format });
    if (this.render) params.set('render', 'true');

    const response = await fetch(`${this.apiUrl}/v1/fetch?${params.toString()}`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
    });
    if (!response.ok) {
      throw new Error(`WebPeel fetch failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as Record<string, unknown>;
    return [{
      pageContent: (data.content as string) || '',
      metadata: {
        source: (data.url as string) || url,
        title: (data.title as string) || '',
        tokens: (data.tokens as number) || 0,
        method: (data.method as string) || 'unknown',
        ...((data.metadata as Record<string, unknown>) || {}),
      },
    }];
  }

  async loadMultiple(urls: string[]): Promise<Array<{ pageContent: string; metadata: Record<string, unknown> }>> {
    const results = await Promise.all(urls.map(url => this.load(url)));
    return results.flat();
  }

  async search(query: string, count = 5): Promise<Array<{ pageContent: string; metadata: Record<string, unknown> }>> {
    const params = new URLSearchParams({ q: query, count: String(count), scrapeResults: 'true' });
    const response = await fetch(`${this.apiUrl}/v1/search?${params.toString()}`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
    });
    if (!response.ok) {
      throw new Error(`WebPeel search failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as Record<string, unknown>;
    const results = ((data.data as Record<string, unknown>)?.web as unknown[]) || (data.results as unknown[]) || [];
    return (results as Array<Record<string, unknown>>).map(r => ({
      pageContent: (r.content as string) || (r.snippet as string) || '',
      metadata: { source: r.url as string, title: r.title as string },
    }));
  }
}

export { WebPeelLoader };
export default WebPeelLoader;
