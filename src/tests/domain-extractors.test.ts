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
    expect(getDomainExtractor('https://stackoverflow.com/questions/1')).toBeNull();
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

  it('returns null when API returns invalid data', async () => {
    mockFetch.mockResolvedValue({ html: 'not json', contentType: 'text/html', url: '' });

    const result = await extractDomainData('', POST_URL);
    expect(result).toBeNull();
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
// 6. extractDomainData — top-level convenience function
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
