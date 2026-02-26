/**
 * WebPeel LangChain.js Document Loader
 *
 * Usage:
 *   import { WebPeelLoader } from 'webpeel/integrations/langchain';
 *   const loader = new WebPeelLoader({ url: 'https://example.com' });
 *   const docs = await loader.load();
 */

import { peel } from '../index.js';
import { chunkContent } from '../core/chunker.js';
import type { PeelOptions } from '../types.js';

/** LangChain Document interface (we define our own to avoid the dependency) */
export interface Document {
  pageContent: string;
  metadata: Record<string, any>;
}

export interface WebPeelLoaderOptions {
  /** URL to fetch */
  url: string;
  /** Multiple URLs to fetch */
  urls?: string[];
  /** Scraping mode: 'scrape' for single page, 'crawl' for following links */
  mode?: 'scrape' | 'crawl';
  /** Output format */
  format?: 'markdown' | 'text' | 'html' | 'clean';
  /** Use headless browser */
  render?: boolean;
  /** Stealth mode for anti-bot */
  stealth?: boolean;
  /** Token budget per page */
  budget?: number;
  /** Proxy URL */
  proxy?: string;
  /** Multiple proxies for rotation */
  proxies?: string[];
  /** CSS selector to extract */
  selector?: string;
  /** Enable chunking for RAG */
  chunk?: boolean;
  /** Max tokens per chunk (default: 512) */
  chunkSize?: number;
  /** Chunk overlap tokens (default: 50) */
  chunkOverlap?: number;
  /** Additional PeelOptions */
  peelOptions?: Partial<PeelOptions>;
}

/**
 * WebPeel Document Loader for LangChain.js
 *
 * Compatible with LangChain's BaseDocumentLoader interface.
 * Returns Document[] with pageContent and metadata.
 */
export class WebPeelLoader {
  private options: WebPeelLoaderOptions;

  constructor(options: WebPeelLoaderOptions) {
    this.options = options;
  }

  /**
   * Load documents from the configured URL(s).
   * If chunking is enabled, each chunk becomes a separate Document.
   */
  async load(): Promise<Document[]> {
    const urls = this.options.urls || [this.options.url];
    const documents: Document[] = [];

    for (const url of urls) {
      try {
        const peelOpts: Partial<PeelOptions> = {
          format: this.options.format || 'markdown',
          render: this.options.render,
          stealth: this.options.stealth,
          budget: this.options.budget,
          proxy: this.options.proxy,
          proxies: this.options.proxies,
          selector: this.options.selector,
          ...this.options.peelOptions,
        };

        // Remove undefined values
        Object.keys(peelOpts).forEach(key => {
          if ((peelOpts as any)[key] === undefined) delete (peelOpts as any)[key];
        });

        const result = await peel(url, peelOpts as PeelOptions);

        if (this.options.chunk) {
          // Split into chunks, each becomes a Document
          const chunkResult = chunkContent(result.content, {
            maxTokens: this.options.chunkSize || 512,
            overlap: this.options.chunkOverlap || 50,
            strategy: 'section',
          });

          for (const chunk of chunkResult.chunks) {
            documents.push({
              pageContent: chunk.text,
              metadata: {
                source: url,
                title: result.metadata?.title || '',
                description: result.metadata?.description || '',
                chunkIndex: chunk.index,
                totalChunks: chunkResult.totalChunks,
                section: chunk.section,
                sectionDepth: chunk.sectionDepth,
                tokenCount: chunk.tokenCount,
                wordCount: chunk.wordCount,
                fetchedAt: result.metadata?.fetchedAt || new Date().toISOString(),
                method: result.metadata?.method || 'unknown',
              },
            });
          }
        } else {
          // Single document per URL
          documents.push({
            pageContent: result.content,
            metadata: {
              source: url,
              title: result.metadata?.title || '',
              description: result.metadata?.description || '',
              wordCount: result.metadata?.wordCount || 0,
              language: result.metadata?.language || '',
              fetchedAt: result.metadata?.fetchedAt || new Date().toISOString(),
              method: result.metadata?.method || 'unknown',
              contentType: result.metadata?.contentType || '',
              statusCode: result.metadata?.statusCode || 0,
            },
          });
        }
      } catch (error) {
        // Include failed URLs as empty documents with error metadata
        documents.push({
          pageContent: '',
          metadata: {
            source: url,
            error: error instanceof Error ? error.message : String(error),
            fetchedAt: new Date().toISOString(),
          },
        });
      }
    }

    return documents;
  }

  /**
   * Lazy load documents one at a time (async generator).
   * Useful for large URL lists to avoid memory pressure.
   */
  async *lazyLoad(): AsyncGenerator<Document> {
    const docs = await this.load();
    for (const doc of docs) {
      yield doc;
    }
  }
}
