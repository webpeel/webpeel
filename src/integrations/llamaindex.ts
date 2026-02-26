/**
 * WebPeel LlamaIndex Reader
 *
 * Usage:
 *   import { WebPeelReader } from 'webpeel/integrations/llamaindex';
 *   const reader = new WebPeelReader();
 *   const docs = await reader.loadData('https://example.com');
 */

import { peel } from '../index.js';
import { chunkContent } from '../core/chunker.js';
import type { PeelOptions } from '../types.js';

/** LlamaIndex Document interface */
export interface LlamaDocument {
  text: string;
  metadata: Record<string, any>;
  id_?: string;
}

export interface WebPeelReaderOptions {
  /** Output format */
  format?: 'markdown' | 'text' | 'html' | 'clean';
  /** Use headless browser */
  render?: boolean;
  /** Stealth mode */
  stealth?: boolean;
  /** Token budget */
  budget?: number;
  /** Enable chunking */
  chunk?: boolean;
  /** Max tokens per chunk */
  chunkSize?: number;
  /** Chunk overlap */
  chunkOverlap?: number;
  /** Proxy URL */
  proxy?: string;
  /** Multiple proxies */
  proxies?: string[];
  /** Additional PeelOptions */
  peelOptions?: Partial<PeelOptions>;
}

/**
 * WebPeel Reader for LlamaIndex
 *
 * Compatible with LlamaIndex's BaseReader interface.
 */
export class WebPeelReader {
  private options: WebPeelReaderOptions;

  constructor(options: WebPeelReaderOptions = {}) {
    this.options = options;
  }

  /**
   * Load data from one or more URLs.
   */
  async loadData(urlOrUrls: string | string[]): Promise<LlamaDocument[]> {
    const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
    const documents: LlamaDocument[] = [];

    for (const url of urls) {
      try {
        const peelOpts: Partial<PeelOptions> = {
          format: this.options.format || 'markdown',
          render: this.options.render,
          stealth: this.options.stealth,
          budget: this.options.budget,
          proxy: this.options.proxy,
          proxies: this.options.proxies,
          ...this.options.peelOptions,
        };

        Object.keys(peelOpts).forEach(key => {
          if ((peelOpts as any)[key] === undefined) delete (peelOpts as any)[key];
        });

        const result = await peel(url, peelOpts as PeelOptions);

        if (this.options.chunk) {
          const chunkResult = chunkContent(result.content, {
            maxTokens: this.options.chunkSize || 512,
            overlap: this.options.chunkOverlap || 50,
            strategy: 'section',
          });

          for (const chunk of chunkResult.chunks) {
            documents.push({
              text: chunk.text,
              id_: `${url}#chunk-${chunk.index}`,
              metadata: {
                url,
                title: result.metadata?.title || '',
                chunkIndex: chunk.index,
                totalChunks: chunkResult.totalChunks,
                section: chunk.section,
                tokenCount: chunk.tokenCount,
              },
            });
          }
        } else {
          documents.push({
            text: result.content,
            id_: url,
            metadata: {
              url,
              title: result.metadata?.title || '',
              description: result.metadata?.description || '',
              wordCount: result.metadata?.wordCount || 0,
              language: result.metadata?.language || '',
            },
          });
        }
      } catch (error) {
        documents.push({
          text: '',
          id_: url,
          metadata: {
            url,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return documents;
  }
}
