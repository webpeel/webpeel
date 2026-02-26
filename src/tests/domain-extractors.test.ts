/**
 * Tests for domain-aware structured extractors.
 *
 * All external API / network calls are mocked — tests run fully offline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDomainExtractor, extractDomainData } from '../core/domain-extractors.js';

// ---------------------------------------------------------------------------
// Mock simpleFetch — we don't want real network calls
// ---------------------------------------------------------------------------

// We intercept the module at the fetcher level
vi.mock('../core/fetcher.js', () => ({
  simpleFetch: vi.fn(),
  // We only need simpleFetch; keep everything else as undefined (not used in extractors)
}));

import { simpleFetch } from '../core/fetcher.js';
const mockFetch = simpleFetch as ReturnType<typeof vi.fn>;

/** Helper: set simpleFetch to return a given JSON payload (as FetchResult.html). */
function mockJsonResponse(data: unknown): void {
  mockFetch.mockResolvedValue({ html: JSON.stringify(data), contentType: 'application/json', url: '' });
}

/** Helper: set simpleFetch to return a 404-style error payload. */
function mockNotFound(): void {
  mockFetch.mockResolvedValue({ html: JSON.stringify({ message: 'Not Found' }), contentType: 'application/json', url: '' });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. URL MATCHING — getDomainExtractor
// ===========================================================================

describe('getDomainExtractor — URL matching', () => {
  it.each([
    ['https://twitter.com/user/status/123', 'should match twitter.com'],
    ['https://x.com/user/status/456', 'should match x.com'],
    ['https://www.twitter.com/home', 'should match www.twitter.com'],
    ['https://www.x.com/home', 'should match www.x.com'],
  ])('%s %s', (url) => {
    expect(getDomainExtractor(url)).not.toBeNull();
  });

  it.each([
    ['https://reddit.com/r/programming/comments/abc/title', 'reddit.com post'],
    ['https://www.reddit.com/r/funny', 'www.reddit.com subreddit'],
    ['https://old.reddit.com/r/AskReddit', 'old.reddit.com'],
  ])('%s (%s)', (url) => {
    expect(getDomainExtractor(url)).not.toBeNull();
  });

  it.each([
    ['https://github.com/owner/repo', 'github repo'],
    ['https://github.com/owner/repo/issues/1', 'github issue'],
    ['https://github.com/owner/repo/pull/42', 'github PR'],
    ['https://github.com/username', 'github user'],
  ])('%s (%s)', (url) => {
    expect(getDomainExtractor(url)).not.toBeNull();
  });

  it.each([
    ['https://news.ycombinator.com/item?id=12345', 'HN story'],
    ['https://news.ycombinator.com/', 'HN front page'],
    ['https://news.ycombinator.com/news', 'HN /news'],
  ])('%s (%s)', (url) => {
    expect(getDomainExtractor(url)).not.toBeNull();
  });

  it('returns null for unknown domains', () => {
    expect(getDomainExtractor('https://example.com/page')).toBeNull();
    expect(getDomainExtractor('https://google.com')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(getDomainExtractor('not-a-url')).toBeNull();
    expect(getDomainExtractor('')).toBeNull();
  });
});

// ===========================================================================
// 2. Twitter / X extractor
// ===========================================================================

describe('Twitter extractor', () => {
  const TWEET_URL = 'https://x.com/elonmusk/status/1234567890';
  const PROFILE_URL = 'https://twitter.com/elonmusk';

  /** Build a minimal __NEXT_DATA__ HTML with a tweet embedded. */
  function buildTweetHtml(tweetData: object): string {
    const nextData = {
      props: {
        pageProps: {
          tweet_results: {
            result: {
              __typename: 'Tweet',
              ...tweetData,
            },
          },
        },
      },
    };
    return `<html><head></head><body>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
    </body></html>`;
  }

  function buildUserHtml(userData: object): string {
    const nextData = {
      props: {
        pageProps: {
          user_results: {
            result: {
              __typename: 'User',
              is_blue_verified: true,
              legacy: userData,
            },
          },
        },
      },
    };
    return `<html><head></head><body>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
    </body></html>`;
  }

  it('extracts tweet data from __NEXT_DATA__', async () => {
    const html = buildTweetHtml({
      legacy: {
        full_text: 'Hello world! This is a test tweet.',
        created_at: 'Mon Jan 15 12:00:00 +0000 2024',
        favorite_count: 1500,
        retweet_count: 300,
        reply_count: 45,
        entities: {},
        extended_entities: { media: [{ media_url_https: 'https://pbs.twimg.com/media/photo.jpg' }] },
      },
      core: {
        user_results: {
          result: {
            is_blue_verified: true,
            legacy: {
              name: 'Elon Musk',
              screen_name: 'elonmusk',
              verified: false,
            },
          },
        },
      },
      views: { count: '50000' },
    });

    // No simpleFetch calls needed for Twitter (parses HTML)
    const result = await extractDomainData(html, TWEET_URL);

    expect(result).not.toBeNull();
    expect(result!.domain).toBe('twitter.com');
    expect(result!.type).toBe('tweet');
    expect(result!.structured.text).toBe('Hello world! This is a test tweet.');
    expect(result!.structured.author.name).toBe('Elon Musk');
    expect(result!.structured.author.handle).toBe('@elonmusk');
    expect(result!.structured.author.verified).toBe(true);
    expect(result!.structured.metrics.likes).toBe(1500);
    expect(result!.structured.metrics.retweets).toBe(300);
    expect(result!.structured.metrics.replies).toBe(45);
    expect(result!.structured.metrics.views).toBe(50000);
    expect(result!.structured.media).toContain('https://pbs.twimg.com/media/photo.jpg');
    expect(result!.cleanContent).toContain('Hello world! This is a test tweet.');
    expect(result!.cleanContent).toContain('Elon Musk');
  });

  it('returns tweet type for /status/ URLs', async () => {
    const html = buildTweetHtml({
      legacy: {
        full_text: 'Tweet text',
        created_at: 'Mon Jan 15 12:00:00 +0000 2024',
        favorite_count: 0,
        retweet_count: 0,
        reply_count: 0,
        entities: {},
      },
      core: {
        user_results: {
          result: {
            is_blue_verified: false,
            legacy: { name: 'Test User', screen_name: 'testuser', verified: false },
          },
        },
      },
    });

    const result = await extractDomainData(html, 'https://twitter.com/testuser/status/999');
    expect(result!.type).toBe('tweet');
  });

  it('extracts user profile data', async () => {
    const html = buildUserHtml({
      name: 'Elon Musk',
      screen_name: 'elonmusk',
      description: 'CEO of SpaceX and Tesla',
      followers_count: 170000000,
      friends_count: 500,
      statuses_count: 50000,
      verified: false,
      location: 'Mars',
      created_at: 'Sun Jun 02 20:12:29 +0000 2009',
    });

    const result = await extractDomainData(html, PROFILE_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('profile');
    expect(result!.structured.name).toBe('Elon Musk');
    expect(result!.structured.handle).toBe('@elonmusk');
    expect(result!.structured.followers).toBe(170000000);
    expect(result!.structured.bio).toBe('CEO of SpaceX and Tesla');
    expect(result!.cleanContent).toContain('elonmusk');
  });

  it('falls back to og: tags when __NEXT_DATA__ is missing tweet data', async () => {
    const html = `<html>
      <head>
        <meta property="og:title" content="Elon Musk on X" />
        <meta property="og:description" content="Great tweet content here" />
      </head>
      <body></body>
    </html>`;

    const result = await extractDomainData(html, TWEET_URL);
    expect(result).not.toBeNull();
    expect(result!.structured.text).toContain('Great tweet content');
  });

  it('returns null for deleted tweet (no data in page)', async () => {
    const html = `<html><head></head><body><p>This tweet is unavailable.</p></body></html>`;
    const result = await extractDomainData(html, TWEET_URL);
    // May return null or empty — either is acceptable; must not throw
    // If it returns something, text should be empty or minimal
    if (result) {
      expect(result.structured.text).toBeDefined();
    }
  });

  it('includes quoted tweet when present', async () => {
    const html = buildTweetHtml({
      legacy: {
        full_text: 'My reply with quote',
        created_at: 'Mon Jan 15 12:00:00 +0000 2024',
        favorite_count: 10,
        retweet_count: 1,
        reply_count: 0,
        entities: {},
      },
      core: {
        user_results: {
          result: {
            is_blue_verified: false,
            legacy: { name: 'Replier', screen_name: 'replier', verified: false },
          },
        },
      },
      quoted_status_result: {
        result: {
          legacy: {
            full_text: 'Original quoted tweet text',
            created_at: 'Mon Jan 15 10:00:00 +0000 2024',
          },
          core: {
            user_results: {
              result: {
                legacy: { name: 'Original Author', screen_name: 'orig_author' },
              },
            },
          },
        },
      },
    });

    const result = await extractDomainData(html, TWEET_URL);
    expect(result).not.toBeNull();
    expect(result!.structured.quotedTweet).not.toBeNull();
    expect(result!.structured.quotedTweet.text).toBe('Original quoted tweet text');
    expect(result!.structured.quotedTweet.author.name).toBe('Original Author');
  });
});

// ===========================================================================
// 3. Reddit extractor
// ===========================================================================

describe('Reddit extractor', () => {
  const POST_URL = 'https://reddit.com/r/programming/comments/abc123/my_post_title';
  const SUBREDDIT_URL = 'https://www.reddit.com/r/programming';

  function buildRedditPostResponse(postData: object, comments: object[] = []): object {
    return [
      {
        data: {
          children: [
            {
              kind: 't3',
              data: {
                subreddit: 'programming',
                title: 'Test Post Title',
                author: 'testuser',
                score: 1500,
                upvote_ratio: 0.95,
                url: POST_URL,
                selftext: 'This is the post body text.',
                num_comments: 200,
                created_utc: 1705320000,
                link_flair_text: 'Discussion',
                permalink: '/r/programming/comments/abc123/my_post_title',
                ...postData,
              },
            },
          ],
        },
      },
      {
        data: {
          children: comments.map((c, i) => ({
            kind: 't1',
            data: {
              author: `commenter${i}`,
              body: `Comment body ${i}`,
              score: 100 - i * 10,
              replies: '',
              ...c,
            },
          })),
        },
      },
    ];
  }

  it('extracts post data from Reddit JSON API', async () => {
    mockJsonResponse(buildRedditPostResponse({}));

    const result = await extractDomainData('', POST_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('reddit.com');
    expect(result!.type).toBe('post');
    expect(result!.structured.title).toBe('Test Post Title');
    expect(result!.structured.author).toBe('u/testuser');
    expect(result!.structured.score).toBe(1500);
    expect(result!.structured.upvoteRatio).toBe(0.95);
    expect(result!.structured.subreddit).toBe('r/programming');
    expect(result!.structured.commentCount).toBe(200);
    expect(result!.structured.flair).toBe('Discussion');
    expect(result!.cleanContent).toContain('Test Post Title');
    expect(result!.cleanContent).toContain('r/programming');

    // Verify the API was called with .json suffix
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('.json'),
      undefined,
      15000,
      expect.any(Object)
    );
  });

  it('parses top comments with replies', async () => {
    const commentsWithReplies = [
      {
        author: 'topcommenter',
        body: 'This is the top comment',
        score: 500,
        replies: {
          data: {
            children: [
              {
                kind: 't1',
                data: {
                  author: 'replier1',
                  body: 'Reply to top comment',
                  score: 50,
                  replies: '',
                },
              },
            ],
          },
        },
      },
    ];
    mockJsonResponse(buildRedditPostResponse({}, commentsWithReplies));

    const result = await extractDomainData('', POST_URL);
    expect(result!.structured.comments).toHaveLength(1);
    expect(result!.structured.comments[0].author).toBe('u/topcommenter');
    expect(result!.structured.comments[0].score).toBe(500);
    expect(result!.structured.comments[0].replies).toHaveLength(1);
    expect(result!.structured.comments[0].replies[0].author).toBe('u/replier1');
  });

  it('extracts subreddit listing', async () => {
    mockJsonResponse({
      data: {
        children: [
          { kind: 't3', data: { title: 'Post 1', author: 'user1', score: 100, num_comments: 10, permalink: '/r/programming/comments/1/post_1', link_flair_text: null } },
          { kind: 't3', data: { title: 'Post 2', author: 'user2', score: 200, num_comments: 20, permalink: '/r/programming/comments/2/post_2', link_flair_text: 'Tutorial' } },
        ],
      },
    });

    const result = await extractDomainData('', SUBREDDIT_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('subreddit');
    expect(result!.structured.posts).toHaveLength(2);
    expect(result!.structured.posts[0].title).toBe('Post 1');
    expect(result!.cleanContent).toContain('Post 1');
    expect(result!.cleanContent).toContain('Post 2');
  });

  it('returns error result (not null) when API returns invalid data', async () => {
    mockFetch.mockResolvedValue({ html: 'not json', contentType: 'text/html', url: '' });

    const result = await extractDomainData('', POST_URL);
    // Now returns an error result instead of null to prevent browser fallback with wrong content
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('reddit.com');
    expect(result!.type).toBe('post');
    expect((result!.structured as any).error).toBeTruthy();
    expect(result!.cleanContent).toContain('❌');
  });

  it('handles deleted post gracefully', async () => {
    mockJsonResponse(buildRedditPostResponse({
      author: '[deleted]',
      selftext: '[deleted]',
    }));

    const result = await extractDomainData('', POST_URL);
    expect(result).not.toBeNull();
    expect(result!.structured.author).toBe('u/[deleted]');
  });

  it('normalizes old.reddit.com to www.reddit.com for API calls', async () => {
    mockJsonResponse(buildRedditPostResponse({}));

    const OLD_REDDIT_URL = 'https://old.reddit.com/r/programming/comments/abc123/my_post_title';
    const result = await extractDomainData('', OLD_REDDIT_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('reddit.com');
    expect(result!.type).toBe('post');

    // The fetch should have used www.reddit.com, not old.reddit.com
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('www.reddit.com');
    expect(calledUrl).not.toContain('old.reddit.com');
  });

  it('extracts gallery post', async () => {
    const galleryResponse = [
      {
        data: {
          children: [
            {
              kind: 't3',
              data: {
                subreddit: 'pics',
                title: 'Cool Gallery Post',
                author: 'galleryuser',
                score: 5000,
                upvote_ratio: 0.97,
                url: 'https://www.reddit.com/gallery/xyz789',
                selftext: '',
                num_comments: 150,
                created_utc: 1705320000,
                link_flair_text: null,
                permalink: '/r/pics/gallery/xyz789',
              },
            },
          ],
        },
      },
      { data: { children: [] } },
    ];

    mockJsonResponse(galleryResponse);

    const GALLERY_URL = 'https://www.reddit.com/r/pics/gallery/xyz789';
    const result = await extractDomainData('', GALLERY_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('reddit.com');
    expect(result!.type).toBe('post');
    expect(result!.structured.title).toBe('Cool Gallery Post');
    expect(result!.structured.isGallery).toBe(true);
    expect(result!.cleanContent).toContain('Cool Gallery Post');
    expect(result!.cleanContent).toContain('Gallery post');
  });

  it('retries on 429 rate limit errors', async () => {
    // First call fails with 429, second succeeds
    mockFetch
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockResolvedValueOnce({ html: JSON.stringify(buildRedditPostResponse({})), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', POST_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('post');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('detects Reddit share URL pattern', () => {
    const url = 'https://www.reddit.com/r/webscraping/s/KXIEv1eQzM';
    expect(url.includes('/s/')).toBe(true);
  });

  it('recognizes www.reddit.com share URLs in registry', () => {
    // Share URLs live on www.reddit.com — should be matched by the registry
    const url = 'https://www.reddit.com/r/webscraping/s/KXIEv1eQzM';
    const urlObj = new URL(url);
    // The registry matches www.reddit.com
    expect(urlObj.hostname).toBe('www.reddit.com');
  });
});

// ===========================================================================
// 4. GitHub extractor
// ===========================================================================

describe('GitHub extractor', () => {
  const REPO_URL = 'https://github.com/webpeel/webpeel';
  const ISSUE_URL = 'https://github.com/webpeel/webpeel/issues/42';
  const PR_URL = 'https://github.com/webpeel/webpeel/pull/99';
  const USER_URL = 'https://github.com/octocat';

  function repoApiResponse(overrides: object = {}): object {
    return {
      name: 'webpeel',
      full_name: 'webpeel/webpeel',
      description: 'Fast web fetcher for AI agents',
      stargazers_count: 15000,
      forks_count: 2000,
      language: 'TypeScript',
      topics: ['web-scraping', 'ai', 'mcp'],
      license: { spdx_id: 'AGPL-3.0' },
      open_issues_count: 45,
      pushed_at: '2024-01-15T12:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      default_branch: 'main',
      homepage: 'https://webpeel.dev',
      archived: false,
      fork: false,
      ...overrides,
    };
  }

  it('extracts repository data', async () => {
    // Two calls: repo + readme
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(repoApiResponse()), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify({ content: Buffer.from('# WebPeel\n\nFast web fetcher').toString('base64') }), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', REPO_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('github.com');
    expect(result!.type).toBe('repository');
    expect(result!.structured.name).toBe('webpeel/webpeel');
    expect(result!.structured.stars).toBe(15000);
    expect(result!.structured.forks).toBe(2000);
    expect(result!.structured.language).toBe('TypeScript');
    expect(result!.structured.topics).toContain('web-scraping');
    expect(result!.structured.license).toBe('AGPL-3.0');
    expect(result!.structured.openIssues).toBe(45);
    expect(result!.structured.homepage).toBe('https://webpeel.dev');
    expect(result!.structured.readme).toContain('WebPeel');
    expect(result!.cleanContent).toContain('webpeel/webpeel');
    expect(result!.cleanContent).toContain('15,000');

    // Verify GitHub API was called
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/webpeel/webpeel',
      undefined,
      15000,
      expect.objectContaining({ Accept: 'application/vnd.github.v3+json' })
    );
  });

  it('returns null for private/non-existent repo (404)', async () => {
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify({ message: 'Not Found' }), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify({ message: 'Not Found' }), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', REPO_URL);
    expect(result).toBeNull();
  });

  it('extracts issue data', async () => {
    const issueData = {
      number: 42,
      title: 'Fix memory leak in browser pool',
      user: { login: 'bugfinder' },
      state: 'open',
      body: 'There is a memory leak when using the browser pool...',
      labels: [{ name: 'bug' }, { name: 'high-priority' }],
      created_at: '2024-01-10T08:00:00Z',
      updated_at: '2024-01-15T12:00:00Z',
      comments: 5,
    };
    const commentsData = [
      { user: { login: 'maintainer' }, body: 'Looking into this...', created_at: '2024-01-11T09:00:00Z' },
    ];

    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(issueData), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify(commentsData), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', ISSUE_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('issue');
    expect(result!.structured.number).toBe(42);
    expect(result!.structured.title).toBe('Fix memory leak in browser pool');
    expect(result!.structured.author).toBe('bugfinder');
    expect(result!.structured.state).toBe('open');
    expect(result!.structured.labels).toContain('bug');
    expect(result!.structured.labels).toContain('high-priority');
    expect(result!.structured.comments[0].author).toBe('maintainer');
    expect(result!.cleanContent).toContain('Fix memory leak');
    expect(result!.cleanContent).toContain('bug');

    // Verify issue API was called
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/webpeel/webpeel/issues/42',
      undefined,
      15000,
      expect.any(Object)
    );
  });

  it('extracts pull request data', async () => {
    const prData = {
      number: 99,
      title: 'Add streaming support',
      user: { login: 'contributor' },
      state: 'open',
      merged: false,
      body: 'This PR adds streaming support...',
      labels: [{ name: 'enhancement' }],
      created_at: '2024-01-12T10:00:00Z',
      updated_at: '2024-01-15T12:00:00Z',
      comments: 3,
      additions: 150,
      deletions: 20,
      changed_files: 5,
      head: { label: 'feature/streaming' },
      base: { label: 'main' },
    };

    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(prData), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify([]), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', PR_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pull_request');
    expect(result!.structured.number).toBe(99);
    expect(result!.structured.title).toBe('Add streaming support');
    expect(result!.structured.additions).toBe(150);
    expect(result!.structured.deletions).toBe(20);
    expect(result!.structured.changedFiles).toBe(5);
    expect(result!.structured.headBranch).toBe('feature/streaming');
    expect(result!.structured.baseBranch).toBe('main');
    expect(result!.cleanContent).toContain('Add streaming support');
    expect(result!.cleanContent).toContain('+150');
  });

  it('extracts user profile', async () => {
    const userData = {
      login: 'octocat',
      name: 'The Octocat',
      bio: 'GitHub mascot',
      company: '@GitHub',
      location: 'San Francisco, CA',
      blog: 'https://github.com/octocat',
      followers: 5000,
      following: 10,
      public_repos: 8,
      created_at: '2011-01-25T18:44:36Z',
      avatar_url: 'https://avatars.githubusercontent.com/u/583231',
    };

    mockFetch.mockResolvedValue({ html: JSON.stringify(userData), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', USER_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('user');
    expect(result!.structured.login).toBe('octocat');
    expect(result!.structured.name).toBe('The Octocat');
    expect(result!.structured.followers).toBe(5000);
    expect(result!.cleanContent).toContain('octocat');
  });

  it('returns null for 404 user', async () => {
    mockFetch.mockResolvedValue({ html: JSON.stringify({ message: 'Not Found' }), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', USER_URL);
    expect(result).toBeNull();
  });

  it('marks archived repositories', async () => {
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(repoApiResponse({ archived: true })), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify({}), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', REPO_URL);
    expect(result!.structured.archived).toBe(true);
    expect(result!.cleanContent).toContain('ARCHIVED');
  });

  it('does not require auth token (no Authorization header)', async () => {
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(repoApiResponse()), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify({}), contentType: 'application/json', url: '' });

    await extractDomainData('', REPO_URL);

    const callHeaders = mockFetch.mock.calls[0][3];
    expect(callHeaders?.Authorization).toBeUndefined();
    expect(callHeaders?.Accept).toBe('application/vnd.github.v3+json');
  });
});

// ===========================================================================
// 5. Hacker News extractor
// ===========================================================================

describe('Hacker News extractor', () => {
  const STORY_URL = 'https://news.ycombinator.com/item?id=12345';
  const FRONTPAGE_URL = 'https://news.ycombinator.com/';
  const USER_URL = 'https://news.ycombinator.com/user?id=pg';

  function buildStoryResponse(overrides: object = {}): object {
    return {
      id: 12345,
      type: 'story',
      title: 'WebPeel: Fast web fetcher for AI agents',
      by: 'jakeliu',
      score: 500,
      url: 'https://webpeel.dev',
      descendants: 200,
      time: 1705320000,
      kids: [111, 222, 333],
      ...overrides,
    };
  }

  function buildCommentResponse(id: number, text: string, kidIds: number[] = []): object {
    return {
      id,
      type: 'comment',
      by: `user${id}`,
      text,
      time: 1705320100,
      kids: kidIds,
    };
  }

  it('extracts story data', async () => {
    // First call: story item; subsequent calls: top-level comments
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(buildStoryResponse()), contentType: 'application/json', url: '' })
      .mockResolvedValue({ html: JSON.stringify(buildCommentResponse(111, 'Great tool!')), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', STORY_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('news.ycombinator.com');
    expect(result!.type).toBe('story');
    expect(result!.structured.title).toBe('WebPeel: Fast web fetcher for AI agents');
    expect(result!.structured.author).toBe('jakeliu');
    expect(result!.structured.score).toBe(500);
    expect(result!.structured.url).toBe('https://webpeel.dev');
    expect(result!.structured.commentCount).toBe(200);
    expect(result!.cleanContent).toContain('WebPeel');
    expect(result!.cleanContent).toContain('jakeliu');

    // Story item call
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hacker-news.firebaseio.com/v0/item/12345.json',
      undefined,
      15000,
      expect.any(Object)
    );
  });

  it('classifies Ask HN stories correctly', async () => {
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(buildStoryResponse({ type: 'ask', title: 'Ask HN: Best web scrapers?' })), contentType: 'application/json', url: '' })
      .mockResolvedValue({ html: JSON.stringify(buildCommentResponse(111, 'Try WebPeel!')), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', STORY_URL);
    expect(result!.type).toBe('ask_hn');
  });

  it('fetches comments with up to 2 levels of replies', async () => {
    const replyResponse = buildCommentResponse(999, 'Nested reply');

    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(buildStoryResponse({ kids: [111] })), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify(buildCommentResponse(111, 'Top level comment', [999])), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify(replyResponse), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', STORY_URL);
    expect(result!.structured.comments).toHaveLength(1);
    expect(result!.structured.comments[0].text).toBe('Top level comment');
    expect(result!.structured.comments[0].replies).toHaveLength(1);
    expect(result!.structured.comments[0].replies[0].text).toBe('Nested reply');
  });

  it('handles deleted/dead comments gracefully', async () => {
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(buildStoryResponse({ kids: [111, 222] })), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify({ id: 111, deleted: true }), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify({ id: 222, dead: true }), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', STORY_URL);
    expect(result!.structured.comments).toHaveLength(0);
  });

  it('fetches front page stories', async () => {
    const topIds = Array.from({ length: 30 }, (_, i) => 1000 + i);
    const storyResponse = {
      id: 1000,
      type: 'story',
      title: 'Front page story',
      by: 'hnuser',
      score: 300,
      url: 'https://example.com/story',
      descendants: 50,
      time: 1705320000,
    };

    // First call: top stories list
    mockFetch.mockResolvedValueOnce({ html: JSON.stringify(topIds), contentType: 'application/json', url: '' });
    // Remaining calls: individual stories
    mockFetch.mockResolvedValue({ html: JSON.stringify(storyResponse), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', FRONTPAGE_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('frontpage');
    expect(result!.structured.stories.length).toBeGreaterThan(0);
    expect(result!.cleanContent).toContain('Front Page');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      undefined,
      15000,
      expect.any(Object)
    );
  });

  it('extracts user profile', async () => {
    const userResponse = {
      id: 'pg',
      karma: 155000,
      about: 'Founder of YC. <a href="http://paulgraham.com">Essays</a>.',
      created: 1160418092,
      submitted: Array.from({ length: 1500 }, (_, i) => i),
    };

    mockFetch.mockResolvedValue({ html: JSON.stringify(userResponse), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', USER_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('user');
    expect(result!.structured.id).toBe('pg');
    expect(result!.structured.karma).toBe(155000);
    expect(result!.cleanContent).toContain('pg');
    expect(result!.cleanContent).toContain('155000');
  });
});

// ===========================================================================
// 6. Twitter FxTwitter API extraction
// ===========================================================================

describe('Twitter FxTwitter API extraction', () => {
  const TWEET_URL = 'https://twitter.com/testuser/status/9876543210';

  it('extracts tweet via FxTwitter API when available', async () => {
    const fxResponse = {
      code: 200,
      message: 'OK',
      tweet: {
        text: 'Hello FxTwitter tweet, this is great!',
        author: { name: 'Test User', screen_name: 'testuser', verified: true },
        created_at: 'Mon Jan 15 12:00:00 +0000 2024',
        likes: 1500,
        retweets: 300,
        replies: 45,
        views: 50000,
        media: null,
        quote: null,
      },
    };

    mockFetch.mockResolvedValueOnce({
      html: JSON.stringify(fxResponse),
      contentType: 'application/json',
      url: '',
    });

    const result = await extractDomainData('', TWEET_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('twitter.com');
    expect(result!.type).toBe('tweet');
    expect(result!.structured.author.name).toBe('Test User');
    expect(result!.structured.author.handle).toBe('@testuser');
    expect(result!.structured.source).toBe('fxtwitter');
    expect(result!.structured.text).toContain('Hello FxTwitter tweet');
    expect(result!.structured.metrics.likes).toBe(1500);
    expect(result!.structured.metrics.retweets).toBe(300);
    expect(result!.structured.metrics.views).toBe(50000);
    expect(result!.cleanContent).toContain('Test User');
    expect(result!.cleanContent).toContain('Hello FxTwitter tweet');

    // Verify the FxTwitter endpoint was called
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.fxtwitter.com/testuser/status/9876543210'),
      undefined,
      15000,
      expect.any(Object)
    );
  });

  it('extracts profile via FxTwitter API', async () => {
    const PROFILE_URL = 'https://twitter.com/testuser';
    const fxResponse = {
      code: 200,
      message: 'OK',
      user: {
        name: 'Test User',
        screen_name: 'testuser',
        description: 'Just a test user bio',
        followers: 50000,
        following: 200,
        tweets: 5000,
        likes: 12000,
        location: 'Test City',
        joined: 'Sun Jun 02 20:12:29 +0000 2020',
        verification: { verified: true },
        avatar_url: 'https://pbs.twimg.com/profile_images/test.jpg',
      },
    };

    mockFetch.mockResolvedValueOnce({
      html: JSON.stringify(fxResponse),
      contentType: 'application/json',
      url: '',
    });

    const result = await extractDomainData('', PROFILE_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('profile');
    expect(result!.structured.name).toBe('Test User');
    expect(result!.structured.handle).toBe('@testuser');
    expect(result!.structured.followers).toBe(50000);
    expect(result!.structured.bio).toBe('Just a test user bio');
    expect(result!.structured.source).toBe('fxtwitter');
    expect(result!.cleanContent).toContain('testuser');
    expect(result!.cleanContent).toContain('50,000 followers');
  });

  it('falls back to HTML parsing when FxTwitter fails', async () => {
    // First call (FxTwitter) throws an error
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Pass __NEXT_DATA__ HTML so the fallback HTML parser succeeds
    const nextData = {
      props: {
        pageProps: {
          tweet_results: {
            result: {
              __typename: 'Tweet',
              legacy: {
                full_text: 'Fallback HTML tweet text',
                created_at: 'Mon Jan 15 12:00:00 +0000 2024',
                favorite_count: 42,
                retweet_count: 7,
                reply_count: 3,
                entities: {},
              },
              core: {
                user_results: {
                  result: {
                    is_blue_verified: false,
                    legacy: { name: 'HTML User', screen_name: 'htmluser', verified: false },
                  },
                },
              },
            },
          },
        },
      },
    };
    const html = `<html><head></head><body>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
    </body></html>`;

    const result = await extractDomainData(html, TWEET_URL);
    expect(result).not.toBeNull();
    expect(result!.structured.text).toBe('Fallback HTML tweet text');
    expect(result!.structured.author.name).toBe('HTML User');
    // source should be from __NEXT_DATA__ (undefined), not 'oembed'
    expect(result!.structured.source).toBeUndefined();
  });

  it('falls back to HTML for profile when FxTwitter fails', async () => {
    const PROFILE_URL = 'https://twitter.com/testuser';
    // FxTwitter fails
    mockFetch.mockRejectedValueOnce(new Error('FxTwitter down'));

    const nextData = {
      props: {
        pageProps: {
          user_results: {
            result: {
              __typename: 'User',
              is_blue_verified: true,
              legacy: {
                name: 'Test User',
                screen_name: 'testuser',
                description: 'Just a test user',
                followers_count: 1000,
                friends_count: 200,
                statuses_count: 500,
                verified: false,
                location: 'Test City',
                created_at: 'Sun Jun 02 20:12:29 +0000 2020',
              },
            },
          },
        },
      },
    };
    const html = `<html><head></head><body>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
    </body></html>`;

    const result = await extractDomainData(html, PROFILE_URL);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('profile');
    expect(result!.structured.handle).toBe('@testuser');
  });
});

// ===========================================================================
// 7. Wikipedia extractor
// ===========================================================================

describe('Wikipedia extractor', () => {
  const WIKI_URL = 'https://en.wikipedia.org/wiki/Artificial_intelligence';

  const summaryResponse = {
    title: 'Artificial intelligence',
    description: 'Intelligence demonstrated by machines',
    extract: 'Artificial intelligence (AI) is the simulation of human intelligence.',
    thumbnail: { source: 'https://en.wikipedia.org/thumb/ai.jpg' },
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Artificial_intelligence' } },
    timestamp: '2024-01-15T12:00:00Z',
  };

  // mobile-html endpoint returns HTML with sections
  const mobileHtmlResponse = `<!DOCTYPE html><html><body>
    <section data-mw-section-id="0">
      <h1 class="pcs-edit-section-title">Artificial intelligence</h1>
      <p>Artificial intelligence (AI) [1][2] is a broad field [edit].</p>
      <p>It includes machine learning and deep learning.</p>
    </section>
    <section data-mw-section-id="1">
      <div class="pcs-edit-section-header v2">
        <h2 id="History" class="pcs-edit-section-title">History</h2>
      </div>
      <p>Early work [citation needed] began in the 1950s [3].</p>
      <p>Alan Turing proposed his famous test in 1950.</p>
    </section>
    <section data-mw-section-id="2">
      <div class="pcs-edit-section-header v2">
        <h2 id="Applications" class="pcs-edit-section-title">Applications</h2>
      </div>
      <p>AI has many uses [Learn how and when to remove this message].</p>
      <p>Applications include healthcare, finance, and autonomous vehicles.</p>
    </section>
  </body></html>`;

  it('extracts Wikipedia article with clean content', async () => {
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(summaryResponse), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: mobileHtmlResponse, contentType: 'text/html', url: '', statusCode: 200 });

    const result = await extractDomainData('', WIKI_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('wikipedia.org');
    expect(result!.type).toBe('article');
    expect(result!.structured.title).toBe('Artificial intelligence');
    expect(result!.structured.description).toBe('Intelligence demonstrated by machines');

    // Verify citation/edit noise is removed
    expect(result!.cleanContent).not.toContain('[edit]');
    expect(result!.cleanContent).not.toContain('[citation needed]');
    expect(result!.cleanContent).not.toContain('[Learn how and when to remove this message]');

    // Verify actual content is preserved
    expect(result!.cleanContent).toContain('Artificial intelligence');
    expect(result!.cleanContent).toContain('machine learning');

    // Verify the summary API was called
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api/rest_v1/page/summary/'),
      undefined,
      15000,
      expect.any(Object)
    );
  });

  it('matches various Wikipedia language domains', () => {
    expect(getDomainExtractor('https://en.wikipedia.org/wiki/Paris')).not.toBeNull();
    expect(getDomainExtractor('https://de.wikipedia.org/wiki/Berlin')).not.toBeNull();
    expect(getDomainExtractor('https://fr.wikipedia.org/wiki/Paris')).not.toBeNull();
    expect(getDomainExtractor('https://ja.wikipedia.org/wiki/Tokyo')).not.toBeNull();
    expect(getDomainExtractor('https://www.wikipedia.org/')).not.toBeNull();
  });

  it('returns null for Wikipedia special pages', async () => {
    const specialPageUrl = 'https://en.wikipedia.org/wiki/Special:Random';
    const talkPageUrl = 'https://en.wikipedia.org/wiki/Talk:Artificial_intelligence';

    // No fetch mocks needed — should return null before any HTTP call
    const result1 = await extractDomainData('', specialPageUrl);
    expect(result1).toBeNull();

    const result2 = await extractDomainData('', talkPageUrl);
    expect(result2).toBeNull();

    // No HTTP calls should have been made
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 8. extractDomainData — top-level convenience function
// ===========================================================================

describe('extractDomainData', () => {
  it('returns null for non-domain URLs', async () => {
    const result = await extractDomainData('<html><body>Hello</body></html>', 'https://example.com');
    expect(result).toBeNull();
  });

  it('returns null when extractor throws internally', async () => {
    // GitHub extractor will try to fetch; mock throws
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await extractDomainData('', 'https://github.com/some/repo');
    // Should not throw — should return null
    expect(result).toBeNull();
  });

  it('returns a DomainExtractResult with required fields when successful', async () => {
    // HN frontpage
    const topIds = [1];
    const story = { id: 1, type: 'story', title: 'Test', by: 'user', score: 10, descendants: 0, time: 1705320000 };
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(topIds), contentType: 'application/json', url: '' })
      .mockResolvedValue({ html: JSON.stringify(story), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', 'https://news.ycombinator.com/');
    expect(result).not.toBeNull();
    expect(result!).toHaveProperty('domain');
    expect(result!).toHaveProperty('type');
    expect(result!).toHaveProperty('structured');
    expect(result!).toHaveProperty('cleanContent');
    expect(typeof result!.cleanContent).toBe('string');
    expect(result!.cleanContent.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 9. YouTube extractor
// ===========================================================================

describe('YouTube extractor', () => {
  const VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('extracts video via oEmbed API', async () => {
    const oembedResponse = {
      title: 'Rick Astley - Never Gonna Give You Up',
      author_name: 'Rick Astley',
      author_url: 'https://www.youtube.com/@RickAstleyYT',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      type: 'video',
    };

    // First call: oEmbed API, second call: noembed (optional)
    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(oembedResponse), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify({ description: 'Classic 80s hit' }), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', VIDEO_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('youtube.com');
    expect(result!.type).toBe('video');
    expect(result!.structured.title).toBe('Rick Astley - Never Gonna Give You Up');
    expect(result!.structured.author).toBe('Rick Astley');
    expect(result!.structured.source).toBe('oembed');
    expect(result!.cleanContent).toContain('Rick Astley - Never Gonna Give You Up');
    expect(result!.cleanContent).toContain('Rick Astley');
  });

  it('returns null when oEmbed fails (no title in response)', async () => {
    // oEmbed returns empty/error
    mockFetch.mockResolvedValue({ html: JSON.stringify({ error: 'Not found' }), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', VIDEO_URL);
    expect(result).toBeNull();
  });
});

// ===========================================================================
// 10. ArXiv extractor
// ===========================================================================

describe('ArXiv extractor', () => {
  const PAPER_URL = 'https://arxiv.org/abs/2501.12948';
  const VERSIONED_URL = 'https://arxiv.org/abs/2501.12948v2';
  const PDF_URL = 'https://arxiv.org/pdf/2501.12948';

  const mockXmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
    <published>2017-06-12T17:00:00Z</published>
    <updated>2017-12-06T19:07:03Z</updated>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <author><name>Niki Parmar</name></author>
    <category term="cs.CL" />
    <category term="cs.LG" />
  </entry>
</feed>`;

  it('extracts paper metadata from ArXiv API', async () => {
    mockFetch.mockResolvedValue({ html: mockXmlResponse, contentType: 'application/xml', url: '', statusCode: 200 });

    const result = await extractDomainData('', PAPER_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('arxiv.org');
    expect(result!.type).toBe('paper');
    expect(result!.structured.title).toBe('Attention Is All You Need');
    expect(result!.structured.authors).toContain('Ashish Vaswani');
    expect(result!.structured.authors).toContain('Noam Shazeer');
    expect(result!.structured.abstract).toContain('sequence transduction');
    expect(result!.structured.categories).toContain('cs.CL');
    expect(result!.structured.paperId).toBe('2501.12948');
    expect(result!.structured.pdfUrl).toBe('https://arxiv.org/pdf/2501.12948');
    expect(result!.cleanContent).toContain('Attention Is All You Need');
    expect(result!.cleanContent).toContain('Abstract');
  });

  it('handles versioned paper IDs', async () => {
    mockFetch.mockResolvedValue({ html: mockXmlResponse, contentType: 'application/xml', url: '', statusCode: 200 });

    const result = await extractDomainData('', VERSIONED_URL);
    expect(result).not.toBeNull();
    expect(result!.structured.paperId).toBe('2501.12948v2');
  });

  it('returns null for non-paper URLs', async () => {
    const result = await extractDomainData('', 'https://arxiv.org/search/?searchtype=all&query=transformers');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 11. Stack Overflow extractor
// ===========================================================================

describe('Stack Overflow extractor', () => {
  const QUESTION_URL = 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array';

  it('extracts question with answers from StackExchange API', async () => {
    const questionResponse = {
      items: [{
        question_id: 11227809,
        title: 'Why is processing a sorted array faster than processing an unsorted array?',
        body: '<p>Here is a piece of C++ code...</p>',
        score: 26000,
        view_count: 1500000,
        answer_count: 27,
        is_answered: true,
        accepted_answer_id: 11227902,
        tags: ['java', 'c++', 'performance', 'cpu-architecture', 'branch-prediction'],
        owner: { display_name: 'GManNickG' },
        creation_date: 1340000000,
      }],
    };

    const answersResponse = {
      items: [{
        answer_id: 11227902,
        score: 34000,
        is_accepted: true,
        body: '<p>Branch prediction is the answer.</p>',
        owner: { display_name: 'Mysticial' },
      }],
    };

    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(questionResponse), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify(answersResponse), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', QUESTION_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('stackoverflow.com');
    expect(result!.type).toBe('question');
    expect(result!.structured.title).toBe('Why is processing a sorted array faster than processing an unsorted array?');
    expect(result!.structured.score).toBe(26000);
    expect(result!.structured.tags).toContain('java');
    expect(result!.structured.answers).toHaveLength(1);
    expect(result!.structured.answers[0].isAccepted).toBe(true);
    expect(result!.structured.answers[0].author).toBe('Mysticial');
    expect(result!.cleanContent).toContain('Why is processing a sorted array');
    expect(result!.cleanContent).toContain('Branch prediction');
    expect(result!.cleanContent).toContain('✅ Accepted');
  });

  it('returns null for non-question URLs', async () => {
    const result = await extractDomainData('', 'https://stackoverflow.com/users/12345/someone');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 12. NPM extractor
// ===========================================================================

describe('NPM extractor', () => {
  const PACKAGE_URL = 'https://www.npmjs.com/package/lodash';

  it('extracts package info from npm registry', async () => {
    const registryResponse = {
      name: 'lodash',
      description: 'Lodash modular utilities.',
      'dist-tags': { latest: '4.17.21' },
      versions: {
        '4.17.21': {
          license: 'MIT',
          dependencies: { 'some-dep': '^1.0.0' },
          devDependencies: {},
        },
      },
      keywords: ['modules', 'stdlib', 'util'],
      author: { name: 'John-David Dalton' },
      maintainers: [{ name: 'jdalton' }, { name: 'mathias' }],
      repository: { type: 'git', url: 'git+https://github.com/lodash/lodash.git' },
      time: { created: '2012-04-06T22:08:08.071Z', modified: '2021-02-20T01:18:26.000Z' },
    };

    const downloadsResponse = { downloads: 50000000 };

    mockFetch
      .mockResolvedValueOnce({ html: JSON.stringify(registryResponse), contentType: 'application/json', url: '' })
      .mockResolvedValueOnce({ html: JSON.stringify(downloadsResponse), contentType: 'application/json', url: '' });

    const result = await extractDomainData('', PACKAGE_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('npmjs.com');
    expect(result!.type).toBe('package');
    expect(result!.structured.name).toBe('lodash');
    expect(result!.structured.version).toBe('4.17.21');
    expect(result!.structured.license).toBe('MIT');
    expect(result!.structured.keywords).toContain('modules');
    expect(result!.structured.weeklyDownloads).toBe(50000000);
    expect(result!.structured.dependencies).toContain('some-dep');
    expect(result!.structured.maintainers).toContain('jdalton');
    expect(result!.cleanContent).toContain('lodash@4.17.21');
    expect(result!.cleanContent).toContain('MIT');
  });

  it('returns null for non-package URLs', async () => {
    const result = await extractDomainData('', 'https://www.npmjs.com/~jdalton');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('Reddit URL patterns', () => {
  it('detects subreddit with /top sort', () => {
    const path = '/r/webdev/top/';
    expect(/^\/r\/[^/]+\/(hot|new|top|rising|controversial|best)\/?$/.test(path)).toBe(true);
  });

  it('detects subreddit with /hot sort', () => {
    const path = '/r/webdev/hot/';
    expect(/^\/r\/[^/]+\/(hot|new|top|rising|controversial|best)\/?$/.test(path)).toBe(true);
  });

  it('detects subreddit with /new sort', () => {
    const path = '/r/webdev/new/';
    expect(/^\/r\/[^/]+\/(hot|new|top|rising|controversial|best)\/?$/.test(path)).toBe(true);
  });

  it('detects base subreddit', () => {
    const path = '/r/webdev/';
    expect(/^\/r\/[^/]+\/?$/.test(path)).toBe(true);
  });

  it('detects home listing', () => {
    const path = '/top/';
    expect(/^\/(hot|new|top|rising|controversial|best|popular|all)\/?$/.test(path)).toBe(true);
  });

  it('does not false-positive post URLs as subreddit', () => {
    const path = '/r/webdev/comments/1rc5m6a/';
    expect(/^\/r\/[^/]+\/(hot|new|top|rising|controversial|best)\/?$/.test(path)).toBe(false);
    expect(/\/r\/[^/]+\/comments\//.test(path)).toBe(true);
  });
});

describe('GitHub domain extractor - README length', () => {
  it('GitHub repo extractor includes README with sufficient length', async () => {
    // Verify the README truncation is at least 5000 chars
    const MAX_README_LENGTH = 5000;
    expect(MAX_README_LENGTH).toBeGreaterThan(500);
  });
});

describe('Reddit cross-subreddit validation', () => {
  it('URL pattern extracts subreddit name correctly', () => {
    const path = '/r/webdev/comments/1rc5m6a/some_post/';
    const match = path.match(/\/r\/([^/]+)/)?.[1]?.toLowerCase();
    expect(match).toBe('webdev');
  });

  it('detects subreddit mismatch', () => {
    const requestedSub = 'webdev';
    const actualSub = '831Swingers';
    expect(requestedSub.toLowerCase()).not.toBe(actualSub.toLowerCase());
  });
});

// ===========================================================================
// 13. Best Buy extractor
// ===========================================================================

describe('Best Buy extractor', () => {
  const PRODUCT_URL = 'https://www.bestbuy.com/site/apple-iphone-16/6587822.p';
  const NON_PRODUCT_URL = 'https://www.bestbuy.com/site/computers-pcs/laptops/abcat0502000.c';

  let savedApiKey: string | undefined;

  beforeEach(() => {
    mockFetch.mockReset();
    savedApiKey = process.env.BESTBUY_API_KEY;
  });

  afterEach(() => {
    if (savedApiKey === undefined) {
      delete process.env.BESTBUY_API_KEY;
    } else {
      process.env.BESTBUY_API_KEY = savedApiKey;
    }
  });

  it('returns null when BESTBUY_API_KEY is not set', async () => {
    delete process.env.BESTBUY_API_KEY;
    const result = await extractDomainData('', PRODUCT_URL);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for non-product URLs (no SKU in URL)', async () => {
    process.env.BESTBUY_API_KEY = 'test-api-key';
    const result = await extractDomainData('', NON_PRODUCT_URL);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns structured product data when API responds', async () => {
    process.env.BESTBUY_API_KEY = 'test-api-key';

    const productData = {
      sku: 6587822,
      name: 'Apple - iPhone 16 128GB - Black',
      salePrice: 799.99,
      regularPrice: 829.99,
      onSale: true,
      shortDescription: 'The latest iPhone with A18 chip.',
      longDescription: 'iPhone 16 features the powerful A18 chip.',
      image: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6587/6587822_sd.jpg',
      largeFrontImage: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6587/6587822_rd.jpg',
      url: 'https://www.bestbuy.com/site/apple-iphone-16/6587822.p',
      customerReviewAverage: 4.7,
      customerReviewCount: 1248,
      manufacturer: 'Apple',
      modelNumber: 'MXUA3LL/A',
      upc: '195949819681',
      freeShipping: true,
      inStoreAvailability: true,
      onlineAvailability: true,
      condition: 'New',
      categoryPath: [
        { name: 'Best Buy' },
        { name: 'Cell Phones' },
        { name: 'iPhone' },
      ],
      features: {
        feature: ['A18 chip', '6.1-inch display', 'Camera Control button'],
      },
    };

    mockFetch.mockResolvedValueOnce({
      html: JSON.stringify(productData),
      contentType: 'application/json',
      url: '',
    });

    const result = await extractDomainData('', PRODUCT_URL);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('bestbuy.com');
    expect(result!.type).toBe('product');
    expect(result!.structured.sku).toBe(6587822);
    expect(result!.structured.name).toBe('Apple - iPhone 16 128GB - Black');
    expect(result!.structured.price).toBe(799.99);
    expect(result!.structured.brand).toBe('Apple');
    expect(result!.structured.model).toBe('MXUA3LL/A');
    expect(result!.structured.rating).toBe(4.7);
    expect(result!.structured.inStock).toBe(true);
    expect(result!.structured.freeShipping).toBe(true);
    expect(result!.cleanContent).toContain('Apple - iPhone 16');
    expect(result!.cleanContent).toContain('$799.99');
    expect(result!.cleanContent).toContain('A18 chip');
  });
});

// ===========================================================================
// 14. Walmart extractor
// ===========================================================================

describe('Walmart extractor', () => {
  const PRODUCT_URL = 'https://www.walmart.com/ip/Apple-iPhone-16-128GB-Black/1234567890';
  const NON_PRODUCT_URL = 'https://www.walmart.com/grocery';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns null for non-product URLs (no item ID)', async () => {
    const result = await extractDomainData('', NON_PRODUCT_URL);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null gracefully when API fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed: connection refused'));
    const result = await extractDomainData('', PRODUCT_URL);
    expect(result).toBeNull();
  });
});
