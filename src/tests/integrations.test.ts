import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock peel to avoid network calls
vi.mock('../index.js', () => ({
  peel: vi.fn(),
}));

import { peel } from '../index.js';
import { WebPeelLoader } from '../integrations/langchain.js';
import { WebPeelReader } from '../integrations/llamaindex.js';

const mockPeel = vi.mocked(peel);

describe('WebPeelLoader (LangChain)', () => {
  beforeEach(() => {
    mockPeel.mockReset();
  });

  it('loads a single URL as Document', async () => {
    mockPeel.mockResolvedValue({
      content: '# Hello World\n\nSome content here.',
      url: 'https://example.com',
      metadata: {
        title: 'Example',
        description: 'An example page',
        wordCount: 5,
        language: 'en',
        fetchedAt: '2026-01-01T00:00:00Z',
        method: 'simple',
        contentType: 'text/html',
        statusCode: 200,
      },
    } as any);

    const loader = new WebPeelLoader({ url: 'https://example.com' });
    const docs = await loader.load();

    expect(docs).toHaveLength(1);
    expect(docs[0].pageContent).toBe('# Hello World\n\nSome content here.');
    expect(docs[0].metadata.source).toBe('https://example.com');
    expect(docs[0].metadata.title).toBe('Example');
  });

  it('loads multiple URLs', async () => {
    mockPeel.mockResolvedValue({
      content: 'Content',
      url: 'https://example.com',
      metadata: { title: 'Test' },
    } as any);

    const loader = new WebPeelLoader({
      url: 'https://example.com',
      urls: ['https://a.com', 'https://b.com'],
    });
    const docs = await loader.load();
    expect(docs).toHaveLength(2);
  });

  it('chunks content when chunk=true', async () => {
    const longContent = Array.from({ length: 20 }, (_, i) =>
      `## Section ${i}\n\n${'Lorem ipsum dolor sit amet. '.repeat(50)}`
    ).join('\n\n');

    mockPeel.mockResolvedValue({
      content: longContent,
      url: 'https://example.com',
      metadata: { title: 'Long Page' },
    } as any);

    const loader = new WebPeelLoader({
      url: 'https://example.com',
      chunk: true,
      chunkSize: 256,
    });
    const docs = await loader.load();
    expect(docs.length).toBeGreaterThan(1);
    expect(docs[0].metadata.chunkIndex).toBe(0);
    expect(docs[0].metadata.totalChunks).toBe(docs.length);
  });

  it('handles fetch errors gracefully', async () => {
    mockPeel.mockRejectedValue(new Error('Network timeout'));

    const loader = new WebPeelLoader({ url: 'https://broken.com' });
    const docs = await loader.load();

    expect(docs).toHaveLength(1);
    expect(docs[0].pageContent).toBe('');
    expect(docs[0].metadata.error).toBe('Network timeout');
  });

  it('passes options to peel()', async () => {
    mockPeel.mockResolvedValue({
      content: 'test',
      url: 'https://example.com',
      metadata: {},
    } as any);

    const loader = new WebPeelLoader({
      url: 'https://example.com',
      format: 'clean',
      render: true,
      stealth: true,
      budget: 2000,
    });
    await loader.load();

    expect(mockPeel).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
      format: 'clean',
      render: true,
      stealth: true,
      budget: 2000,
    }));
  });

  it('supports lazyLoad async generator', async () => {
    mockPeel.mockResolvedValue({
      content: 'Content',
      url: 'https://example.com',
      metadata: { title: 'Test' },
    } as any);

    const loader = new WebPeelLoader({ url: 'https://example.com' });
    const docs: any[] = [];
    for await (const doc of loader.lazyLoad()) {
      docs.push(doc);
    }
    expect(docs).toHaveLength(1);
  });
});

describe('WebPeelReader (LlamaIndex)', () => {
  beforeEach(() => {
    mockPeel.mockReset();
  });

  it('loads single URL', async () => {
    mockPeel.mockResolvedValue({
      content: 'Hello World',
      url: 'https://example.com',
      metadata: { title: 'Example', wordCount: 2 },
    } as any);

    const reader = new WebPeelReader();
    const docs = await reader.loadData('https://example.com');

    expect(docs).toHaveLength(1);
    expect(docs[0].text).toBe('Hello World');
    expect(docs[0].id_).toBe('https://example.com');
    expect(docs[0].metadata.title).toBe('Example');
  });

  it('loads array of URLs', async () => {
    mockPeel.mockResolvedValue({
      content: 'Content',
      url: 'test',
      metadata: { title: 'Test' },
    } as any);

    const reader = new WebPeelReader();
    const docs = await reader.loadData(['https://a.com', 'https://b.com']);
    expect(docs).toHaveLength(2);
  });

  it('chunks content with chunk IDs', async () => {
    const content = '## Section 1\n\n' + 'Text. '.repeat(500) + '\n\n## Section 2\n\n' + 'More text. '.repeat(500);
    mockPeel.mockResolvedValue({
      content,
      url: 'https://example.com',
      metadata: { title: 'Chunked' },
    } as any);

    const reader = new WebPeelReader({ chunk: true, chunkSize: 256 });
    const docs = await reader.loadData('https://example.com');

    expect(docs.length).toBeGreaterThan(1);
    expect(docs[0].id_).toBe('https://example.com#chunk-0');
  });

  it('handles errors gracefully', async () => {
    mockPeel.mockRejectedValue(new Error('Failed'));

    const reader = new WebPeelReader();
    const docs = await reader.loadData('https://broken.com');

    expect(docs).toHaveLength(1);
    expect(docs[0].text).toBe('');
    expect(docs[0].metadata.error).toBe('Failed');
  });
});
