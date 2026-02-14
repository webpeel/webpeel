/**
 * Tests for agent.ts
 * Tests autonomous web research agent logic with mocked LLM calls
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgent } from '../core/agent.js';

// Mock undici fetch for both search and LLM API calls
vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

// Mock peel function
vi.mock('../index.js', () => ({
  peel: vi.fn(),
}));

import { fetch as mockFetch } from 'undici';
import { peel as mockPeel } from '../index.js';

describe('runAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates valid search queries from prompt', async () => {
    // Mock LLM response for query generation
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['webpeel features', 'web scraping tools']
                })
              }
            }]
          })
        });
      }
      // Mock search response
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <html>
              <body>
                <div class="result">
                  <a class="result__a" href="https://example.com/1">Result 1</a>
                  <div class="result__title">Result 1</div>
                  <div class="result__snippet">Description 1</div>
                </div>
              </body>
            </html>
          `
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com/1',
      title: 'Test Page',
      content: 'Test content',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    const result = await runAgent({
      prompt: 'Find information about webpeel',
      llmApiKey: 'test-key',
      maxPages: 1,
    });

    // Should have called LLM to generate queries
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('chat/completions'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-key'
        })
      })
    );
  });

  it('respects maxIterations limit', async () => {
    // Mock LLM responses
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['query1', 'query2']
                })
              }
            }]
          })
        });
      }
      // Mock search with many results
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <html>
              <body>
                ${Array.from({ length: 20 }, (_, i) => `
                  <div class="result">
                    <a class="result__a" href="https://example.com/${i}">Result ${i}</a>
                    <div class="result__title">Result ${i}</div>
                    <div class="result__snippet">Description ${i}</div>
                  </div>
                `).join('')}
              </body>
            </html>
          `
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com',
      title: 'Test',
      content: 'Content',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    const result = await runAgent({
      prompt: 'Test prompt',
      llmApiKey: 'test-key',
      maxPages: 3, // Limit to 3 pages
    });

    // Should visit at most 3 pages (maxPages)
    expect(result.pagesVisited).toBeLessThanOrEqual(3);
  });

  it('returns compiled results', async () => {
    // Mock LLM responses
    let callCount = 0;
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        callCount++;
        // First call: generate queries
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  content: JSON.stringify({
                    queries: ['test query']
                  })
                }
              }]
            })
          });
        }
        // Second call: extract data
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  result: 'Compiled information about the topic',
                  sources: ['https://example.com/1']
                })
              }
            }]
          })
        });
      }
      // Mock search
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <html>
              <body>
                <div class="result">
                  <a class="result__a" href="https://example.com/1">Result</a>
                  <div class="result__title">Result</div>
                  <div class="result__snippet">Description</div>
                </div>
              </body>
            </html>
          `
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com/1',
      title: 'Test Page',
      content: 'Detailed content from the page',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    const result = await runAgent({
      prompt: 'Research topic XYZ',
      llmApiKey: 'test-key',
      maxPages: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.sources).toBeDefined();
    expect(Array.isArray(result.sources)).toBe(true);
  });

  it('handles LLM API errors gracefully', async () => {
    // Mock LLM API error
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: async () => 'Unauthorized'
        });
      }
      return Promise.resolve({ ok: false });
    });

    const result = await runAgent({
      prompt: 'Test prompt',
      llmApiKey: 'invalid-key',
      maxPages: 1,
    });

    expect(result.success).toBe(false);
    expect(result.data.error).toBeDefined();
  });

  it('handles network errors during page fetching', async () => {
    // Mock LLM success
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['test']
                })
              }
            }]
          })
        });
      }
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <html>
              <body>
                <div class="result">
                  <a class="result__a" href="https://example.com/1">Result</a>
                  <div class="result__title">Result</div>
                  <div class="result__snippet">Description</div>
                </div>
              </body>
            </html>
          `
        });
      }
      return Promise.resolve({ ok: false });
    });

    // Mock peel failure
    (mockPeel as any).mockRejectedValue(new Error('Network error'));

    const result = await runAgent({
      prompt: 'Test prompt',
      llmApiKey: 'test-key',
      maxPages: 1,
    });

    // Should return error result
    expect(result.success).toBe(false);
    expect(result.pagesVisited).toBe(0);
  });

  it('requires llmApiKey parameter', async () => {
    await expect(runAgent({
      prompt: 'Test',
      llmApiKey: '', // Empty key
    })).rejects.toThrow('llmApiKey is required');
  });

  it('requires prompt parameter', async () => {
    await expect(runAgent({
      prompt: '', // Empty prompt
      llmApiKey: 'test-key',
    })).rejects.toThrow('prompt is required');
  });

  it('uses custom LLM model when specified', async () => {
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['test']
                })
              }
            }]
          })
        });
      }
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => '<html><body></body></html>'
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com',
      title: 'Test',
      content: 'Content',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    await runAgent({
      prompt: 'Test',
      llmApiKey: 'test-key',
      llmModel: 'gpt-4-turbo',
      maxPages: 1,
    });

    // Check that custom model was used
    const fetchCalls = (mockFetch as any).mock.calls;
    const llmCall = fetchCalls.find((call: any) => call[0].includes('chat/completions'));
    expect(llmCall).toBeDefined();
    const body = JSON.parse(llmCall[1].body);
    expect(body.model).toBe('gpt-4-turbo');
  });

  it('uses custom API base URL when specified', async () => {
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('custom-api.com')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['test']
                })
              }
            }]
          })
        });
      }
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => '<html><body></body></html>'
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com',
      title: 'Test',
      content: 'Content',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    await runAgent({
      prompt: 'Test',
      llmApiKey: 'test-key',
      llmApiBase: 'https://custom-api.com/v1',
      maxPages: 1,
    });

    // Check that custom base URL was used
    const fetchCalls = (mockFetch as any).mock.calls;
    const llmCall = fetchCalls.find((call: any) => call[0].includes('custom-api.com'));
    expect(llmCall).toBeDefined();
  });

  it('calls onProgress callback', async () => {
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['test'],
                  result: 'Result'
                })
              }
            }]
          })
        });
      }
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <html>
              <body>
                <div class="result">
                  <a class="result__a" href="https://example.com/1">Result</a>
                  <div class="result__title">Result</div>
                  <div class="result__snippet">Description</div>
                </div>
              </body>
            </html>
          `
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com/1',
      title: 'Test',
      content: 'Content',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    const progressUpdates: any[] = [];
    
    await runAgent({
      prompt: 'Test',
      llmApiKey: 'test-key',
      maxPages: 1,
      onProgress: (progress) => {
        progressUpdates.push(progress);
      },
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.some(p => p.status === 'searching')).toBe(true);
    expect(progressUpdates.some(p => p.status === 'done')).toBe(true);
  });

  it('uses provided URLs instead of searching', async () => {
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  result: 'Extracted data'
                })
              }
            }]
          })
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://provided.com',
      title: 'Provided URL',
      content: 'Content from provided URL',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    const result = await runAgent({
      prompt: 'Extract data',
      urls: ['https://provided.com'],
      llmApiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    // Should NOT call search since URLs were provided
    const fetchCalls = (mockFetch as any).mock.calls;
    const searchCalls = fetchCalls.filter((call: any) => call[0].includes('duckduckgo'));
    expect(searchCalls.length).toBe(0);
  });

  it('respects maxCredits limit', async () => {
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['test']
                })
              }
            }]
          })
        });
      }
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <html>
              <body>
                ${Array.from({ length: 10 }, (_, i) => `
                  <div class="result">
                    <a class="result__a" href="https://example.com/${i}">Result ${i}</a>
                    <div class="result__title">Result ${i}</div>
                    <div class="result__snippet">Description ${i}</div>
                  </div>
                `).join('')}
              </body>
            </html>
          `
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockResolvedValue({
      url: 'https://example.com',
      title: 'Test',
      content: 'Content',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    });

    const result = await runAgent({
      prompt: 'Test',
      llmApiKey: 'test-key',
      maxPages: 10,
      maxCredits: 2, // Only allow 2 credits (for page fetches)
    });

    // Should stop early due to credit limit
    // Note: 1 credit for query gen + up to maxCredits for page fetches + 1 for final extraction
    expect(result.creditsUsed).toBeLessThanOrEqual(4); // Allow some flexibility
  });

  it('includes sources in result', async () => {
    (mockFetch as any).mockImplementation((url: string) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  queries: ['test'],
                  result: 'Data'
                })
              }
            }]
          })
        });
      }
      if (url.includes('duckduckgo')) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <html>
              <body>
                <div class="result">
                  <a class="result__a" href="https://source1.com">Source 1</a>
                  <div class="result__title">Source 1</div>
                  <div class="result__snippet">Description</div>
                </div>
                <div class="result">
                  <a class="result__a" href="https://source2.com">Source 2</a>
                  <div class="result__title">Source 2</div>
                  <div class="result__snippet">Description</div>
                </div>
              </body>
            </html>
          `
        });
      }
      return Promise.resolve({ ok: false });
    });

    (mockPeel as any).mockImplementation(async (url: string) => ({
      url,
      title: 'Test',
      content: 'Content',
      method: 'simple',
      elapsed: 100,
      tokens: 50,
    }));

    const result = await runAgent({
      prompt: 'Test',
      llmApiKey: 'test-key',
      maxPages: 2,
    });

    expect(result.sources).toBeDefined();
    expect(Array.isArray(result.sources)).toBe(true);
    expect(result.sources.length).toBeGreaterThan(0);
  });
});
