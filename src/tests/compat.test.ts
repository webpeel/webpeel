/**
 * Tests for Firecrawl compatibility routes
 * Tests POST /v1/scrape, /v1/crawl, /v1/search, /v1/map
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { createCompatRouter } from '../server/routes/compat.js';

// Mock the peel function
vi.mock('../index.js', () => ({
  peel: vi.fn(),
}));

// Mock the crawl function
vi.mock('../core/crawler.js', () => ({
  crawl: vi.fn(),
}));

// Mock the mapDomain function
vi.mock('../core/map.js', () => ({
  mapDomain: vi.fn(),
}));

// Mock the job queue
vi.mock('../server/job-queue.js', () => ({
  jobQueue: {
    createJob: vi.fn(),
    updateJob: vi.fn(),
    getJob: vi.fn(),
  },
}));

// Mock undici for search tests
vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

import { peel as mockPeel } from '../index.js';
import { crawl as mockCrawl } from '../core/crawler.js';
import { mapDomain as mockMapDomain } from '../core/map.js';
import { jobQueue as mockJobQueue } from '../server/job-queue.js';
import { fetch as mockFetch } from 'undici';

describe('Firecrawl compatibility routes', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create Express app with compat router
    app = express();
    app.use(express.json());
    app.use(createCompatRouter());
  });

  describe('POST /v1/scrape', () => {
    it('returns Firecrawl format', async () => {
      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com',
        title: 'Test Page',
        content: '# Test Content\n\nThis is test content.',
        method: 'simple',
        elapsed: 100,
        tokens: 50,
        metadata: {
          description: 'Test description',
          author: 'John Doe',
        },
        links: ['https://example.com/link1'],
      });

      const response = await request(app)
        .post('/v1/scrape')
        .send({ url: 'https://example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.markdown).toContain('Test Content');
      expect(response.body.data.metadata).toBeDefined();
      expect(response.body.data.metadata.title).toBe('Test Page');
      expect(response.body.data.metadata.description).toBe('Test description');
    });

    it('handles formats array', async () => {
      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com',
        title: 'Test',
        content: '# Test',
        method: 'simple',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: ['https://example.com/link'],
        images: [{ src: 'https://example.com/img.jpg', alt: 'Image' }],
        screenshot: Buffer.from('screenshot').toString('base64'),
      });

      const response = await request(app)
        .post('/v1/scrape')
        .send({
          url: 'https://example.com',
          formats: ['markdown', 'html', 'links', 'screenshot', 'images']
        });

      expect(response.status).toBe(200);
      expect(response.body.data.markdown).toBeDefined();
      expect(response.body.data.html).toBeDefined();
      expect(response.body.data.links).toBeDefined();
      expect(response.body.data.screenshot).toBeDefined();
      expect(response.body.data.images).toBeDefined();
    });

    it('returns 400 for missing URL', async () => {
      const response = await request(app)
        .post('/v1/scrape')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('url');
    });

    it('returns 400 for invalid URL', async () => {
      const response = await request(app)
        .post('/v1/scrape')
        .send({ url: 123 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('url');
    });

    it('handles onlyMainContent parameter', async () => {
      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com',
        title: 'Test',
        content: 'Content',
        method: 'simple',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: [],
      });

      await request(app)
        .post('/v1/scrape')
        .send({
          url: 'https://example.com',
          onlyMainContent: false
        });

      // Should pass raw: true to peel when onlyMainContent is false
      expect(mockPeel).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ raw: true })
      );
    });

    it('handles includeTags and excludeTags', async () => {
      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com',
        title: 'Test',
        content: 'Content',
        method: 'simple',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: [],
      });

      await request(app)
        .post('/v1/scrape')
        .send({
          url: 'https://example.com',
          includeTags: ['article'],
          excludeTags: ['nav', 'footer']
        });

      expect(mockPeel).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          includeTags: ['article'],
          excludeTags: ['nav', 'footer']
        })
      );
    });

    it('handles waitFor parameter', async () => {
      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com',
        title: 'Test',
        content: 'Content',
        method: 'browser',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: [],
      });

      await request(app)
        .post('/v1/scrape')
        .send({
          url: 'https://example.com',
          waitFor: 2000
        });

      expect(mockPeel).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          render: true,
          wait: 2000
        })
      );
    });

    it('handles actions parameter', async () => {
      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com',
        title: 'Test',
        content: 'Content',
        method: 'browser',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: [],
      });

      await request(app)
        .post('/v1/scrape')
        .send({
          url: 'https://example.com',
          actions: [
            { type: 'click', selector: 'button' },
            { type: 'wait', milliseconds: 1000 }
          ]
        });

      expect(mockPeel).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({ type: 'click' }),
            expect.objectContaining({ type: 'wait' })
          ])
        })
      );
    });

    it('returns 500 on error', async () => {
      (mockPeel as any).mockRejectedValue(new Error('Fetch failed'));

      const response = await request(app)
        .post('/v1/scrape')
        .send({ url: 'https://example.com' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /v1/crawl', () => {
    it('returns job ID', async () => {
      (mockJobQueue.createJob as any).mockReturnValue({
        id: 'job-123',
        type: 'crawl',
        status: 'queued',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      });

      const response = await request(app)
        .post('/v1/crawl')
        .send({ url: 'https://example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.id).toBe('job-123');
    });

    it('returns 400 for missing URL', async () => {
      const response = await request(app)
        .post('/v1/crawl')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('url');
    });

    it('returns 400 for invalid URL', async () => {
      const response = await request(app)
        .post('/v1/crawl')
        .send({ url: 'not-a-url' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('handles limit parameter', async () => {
      (mockJobQueue.createJob as any).mockReturnValue({
        id: 'job-123',
        type: 'crawl',
        status: 'queued',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      });

      await request(app)
        .post('/v1/crawl')
        .send({
          url: 'https://example.com',
          limit: 50
        });

      expect(mockJobQueue.createJob).toHaveBeenCalledWith('crawl', undefined);
    });

    it('handles maxDepth parameter', async () => {
      (mockJobQueue.createJob as any).mockReturnValue({
        id: 'job-123',
        type: 'crawl',
        status: 'queued',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      });

      await request(app)
        .post('/v1/crawl')
        .send({
          url: 'https://example.com',
          maxDepth: 2
        });

      expect(mockJobQueue.createJob).toHaveBeenCalled();
    });
  });

  describe('GET /v1/crawl/:id', () => {
    it('returns job status', async () => {
      (mockJobQueue.getJob as any).mockReturnValue({
        id: 'job-123',
        type: 'crawl',
        status: 'processing',
        completed: 5,
        total: 10,
        creditsUsed: 5,
        expiresAt: Date.now() + 3600000,
        data: [],
      });

      const response = await request(app)
        .get('/v1/crawl/job-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('scraping'); // Mapped from 'processing'
      expect(response.body.completed).toBe(5);
      expect(response.body.total).toBe(10);
      expect(response.body.creditsUsed).toBe(5);
    });

    it('returns 404 for non-existent job', async () => {
      (mockJobQueue.getJob as any).mockReturnValue(null);

      const response = await request(app)
        .get('/v1/crawl/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('returns completed job with data', async () => {
      (mockJobQueue.getJob as any).mockReturnValue({
        id: 'job-123',
        type: 'crawl',
        status: 'completed',
        completed: 10,
        total: 10,
        creditsUsed: 10,
        expiresAt: Date.now() + 3600000,
        data: [
          { url: 'https://example.com/1', markdown: 'Content 1' },
          { url: 'https://example.com/2', markdown: 'Content 2' },
        ],
      });

      const response = await request(app)
        .get('/v1/crawl/job-123');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('POST /v1/search', () => {
    it('returns search results array', async () => {
      (mockFetch as any).mockResolvedValue({
        ok: true,
        text: async () => `
          <html>
            <body>
              <div class="result">
                <a class="result__a" href="https://example.com/1">Result 1</a>
                <div class="result__title">Result 1</div>
                <div class="result__snippet">Description 1</div>
              </div>
              <div class="result">
                <a class="result__a" href="https://example.com/2">Result 2</a>
                <div class="result__title">Result 2</div>
                <div class="result__snippet">Description 2</div>
              </div>
            </body>
          </html>
        `
      });

      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com/1',
        title: 'Result 1',
        content: 'Content 1',
        method: 'simple',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: [],
      });

      const response = await request(app)
        .post('/v1/search')
        .send({ query: 'test query' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('returns 400 for missing query', async () => {
      const response = await request(app)
        .post('/v1/search')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('query');
    });

    it('handles limit parameter', async () => {
      (mockFetch as any).mockResolvedValue({
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

      (mockPeel as any).mockResolvedValue({
        url: 'https://example.com',
        title: 'Result',
        content: 'Content',
        method: 'simple',
        elapsed: 100,
        tokens: 50,
        metadata: {},
        links: [],
      });

      const response = await request(app)
        .post('/v1/search')
        .send({
          query: 'test',
          limit: 3
        });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(3);
    });

    it('handles search errors gracefully', async () => {
      (mockFetch as any).mockRejectedValue(new Error('Search failed'));

      const response = await request(app)
        .post('/v1/search')
        .send({ query: 'test' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /v1/map', () => {
    it('returns links array', async () => {
      (mockMapDomain as any).mockResolvedValue({
        urls: [
          'https://example.com/page1',
          'https://example.com/page2',
          'https://example.com/page3',
        ]
      });

      const response = await request(app)
        .post('/v1/map')
        .send({ url: 'https://example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.links).toBeDefined();
      expect(Array.isArray(response.body.links)).toBe(true);
      expect(response.body.links).toHaveLength(3);
    });

    it('returns 400 for missing URL', async () => {
      const response = await request(app)
        .post('/v1/map')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('url');
    });

    it('returns 400 for invalid URL', async () => {
      const response = await request(app)
        .post('/v1/map')
        .send({ url: 'not-a-valid-url' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('handles limit parameter', async () => {
      (mockMapDomain as any).mockResolvedValue({
        urls: ['https://example.com/1', 'https://example.com/2']
      });

      await request(app)
        .post('/v1/map')
        .send({
          url: 'https://example.com',
          limit: 100
        });

      expect(mockMapDomain).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ maxUrls: 100 })
      );
    });

    it('handles search parameter', async () => {
      (mockMapDomain as any).mockResolvedValue({
        urls: ['https://example.com/blog/post']
      });

      await request(app)
        .post('/v1/map')
        .send({
          url: 'https://example.com',
          search: 'blog'
        });

      expect(mockMapDomain).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ search: 'blog' })
      );
    });

    it('handles map errors gracefully', async () => {
      (mockMapDomain as any).mockRejectedValue(new Error('Map failed'));

      const response = await request(app)
        .post('/v1/map')
        .send({ url: 'https://example.com' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Error response format', () => {
    it('matches Firecrawl error format', async () => {
      (mockPeel as any).mockRejectedValue(new Error('Test error'));

      const response = await request(app)
        .post('/v1/scrape')
        .send({ url: 'https://example.com' });

      expect(response.body).toEqual({
        success: false,
        error: expect.any(String)
      });
    });
  });
});
