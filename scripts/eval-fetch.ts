#!/usr/bin/env npx tsx
/**
 * WebPeel Fetch Endpoint Eval Suite
 * Automated test runner for GET /v1/fetch (async job-based)
 *
 * Usage:
 *   npx tsx scripts/eval-fetch.ts --production   (hits api.webpeel.dev)
 *   npx tsx scripts/eval-fetch.ts --local         (hits localhost:3000)
 *   npx tsx scripts/eval-fetch.ts --production --category=basic
 *   npx tsx scripts/eval-fetch.ts --production --category=critical
 */

// ── ANSI colors ────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// ── Config ─────────────────────────────────────────────────────────────────
const API_KEY = 'wp_live_5cf7c8362fdb0adb12619286091d76e7';
const CONCURRENCY = 3; // Lower than smart-search since fetch is heavier
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 45000;

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const BASE_URL = isLocal ? 'http://localhost:3000' : 'https://api.webpeel.dev';
const categoryFilter = args.find(a => a.startsWith('--category='))?.split('=')[1] || null;

// ── Types ──────────────────────────────────────────────────────────────────
interface GraderResult {
  pass: boolean;
  reason: string;
}

interface TestCase {
  name: string;
  category: string;
  critical?: boolean;
  skip?: boolean;
  skipReason?: string;
  url: string;
  queryParams?: Record<string, string>;
  expectError?: boolean;
  graders: Array<(result: any) => GraderResult>;
}

interface TestResult {
  name: string;
  category: string;
  pass: boolean;
  reasons: string[];
  timeMs: number;
  skipped?: boolean;
  skipReason?: string;
}

// ── Grader helpers ─────────────────────────────────────────────────────────
function expectTitle(substring: string) {
  return (res: any): GraderResult => {
    const title = res?.title || '';
    if (title.toLowerCase().includes(substring.toLowerCase())) {
      return { pass: true, reason: `title contains "${substring}" ✓` };
    }
    return { pass: false, reason: `expected title containing "${substring}", got "${title}"` };
  };
}

function expectContentLength(min: number, max?: number) {
  return (res: any): GraderResult => {
    const content = res?.content || '';
    const len = content.length;
    if (len < min) return { pass: false, reason: `content too short: ${len} chars (min: ${min})` };
    if (max && len > max) return { pass: false, reason: `content too long: ${len} chars (max: ${max})` };
    return { pass: true, reason: `content length ${len} chars ✓` };
  };
}

function expectTokensReasonable(min: number = 10, max: number = 500000) {
  return (res: any): GraderResult => {
    const tokens = res?.tokens;
    if (typeof tokens !== 'number') return { pass: false, reason: 'missing tokens field' };
    if (tokens < min) return { pass: false, reason: `tokens=${tokens} below minimum ${min}` };
    if (tokens > max) return { pass: false, reason: `tokens=${tokens} exceeds maximum ${max}` };
    return { pass: true, reason: `tokens=${tokens} ✓` };
  };
}

function expectTrustScore(minScore: number = 0, maxScore: number = 1) {
  return (res: any): GraderResult => {
    const trust = res?.trust;
    if (!trust) return { pass: false, reason: 'missing trust object' };
    if (typeof trust.score !== 'number') return { pass: false, reason: 'trust.score not a number' };
    if (trust.score < minScore || trust.score > maxScore) {
      return { pass: false, reason: `trust.score=${trust.score} outside range [${minScore}, ${maxScore}]` };
    }
    return { pass: true, reason: `trust.score=${trust.score} ✓` };
  };
}

function expectTrustSourceFields() {
  return (res: any): GraderResult => {
    const source = res?.trust?.source;
    if (!source) return { pass: false, reason: 'missing trust.source' };
    if (typeof source.score !== 'number') return { pass: false, reason: 'trust.source.score not a number' };
    if (!source.tier) return { pass: false, reason: 'missing trust.source.tier' };
    if (!source.label) return { pass: false, reason: 'missing trust.source.label' };
    return { pass: true, reason: `trust.source: tier="${source.tier}", score=${source.score} ✓` };
  };
}

function expectNoRawHtml() {
  return (res: any): GraderResult => {
    const content = res?.content || '';
    // Check for raw HTML tags that shouldn't be in markdown output
    if (/<script[\s>]/i.test(content)) return { pass: false, reason: 'content contains <script> tags' };
    if (/<style[\s>]/i.test(content)) return { pass: false, reason: 'content contains <style> tags' };
    // Allow some HTML-like markdown (e.g., <br>) but flag heavy HTML
    const htmlTagCount = (content.match(/<\/?(?:div|span|table|tr|td|th|form|input|button|iframe|object|embed)\b/gi) || []).length;
    if (htmlTagCount > 5) return { pass: false, reason: `content has ${htmlTagCount} raw HTML tags (should be markdown)` };
    return { pass: true, reason: 'content is clean markdown ✓' };
  };
}

function expectMarkdownFormat() {
  return (res: any): GraderResult => {
    const content = res?.content || '';
    // Should have some markdown features: headers, links, or lists
    const hasHeaders = /^#{1,6}\s/m.test(content);
    const hasLinks = /\[.*?\]\(.*?\)/.test(content);
    const hasList = /^[\s]*[-*]\s/m.test(content);
    const hasContent = content.length > 50;
    if (hasContent && (hasHeaders || hasLinks || hasList)) {
      return { pass: true, reason: 'content has markdown formatting ✓' };
    }
    if (hasContent) {
      // Plain text is also acceptable for simple pages
      return { pass: true, reason: 'content is plain text (acceptable) ✓' };
    }
    return { pass: false, reason: 'content too short or malformed' };
  };
}

function expectMethod(methods: string[]) {
  return (res: any): GraderResult => {
    const method = res?.method;
    if (methods.includes(method)) {
      return { pass: true, reason: `method="${method}" ✓` };
    }
    return { pass: false, reason: `expected method in [${methods.join(',')}], got "${method}"` };
  };
}

function expectJobFailed() {
  return (res: any): GraderResult => {
    // For error tests, we expect the job to fail or return error
    if (res?.__jobStatus === 'failed' || res?.error) {
      return { pass: true, reason: `job failed as expected: ${res?.error || res?.__jobStatus} ✓` };
    }
    return { pass: false, reason: 'expected job to fail, but it succeeded' };
  };
}

function expectElapsedReasonable(maxMs: number = 30000) {
  return (res: any): GraderResult => {
    const elapsed = res?.elapsed;
    if (typeof elapsed !== 'number') return { pass: false, reason: 'missing elapsed field' };
    if (elapsed > maxMs) return { pass: false, reason: `elapsed=${elapsed}ms exceeds ${maxMs}ms` };
    return { pass: true, reason: `elapsed=${elapsed}ms ✓` };
  };
}

function expectSuccess() {
  return (res: any): GraderResult => {
    if (res?.__jobStatus === 'completed') {
      return { pass: true, reason: 'job completed ✓' };
    }
    return { pass: false, reason: `job status: ${res?.__jobStatus || 'unknown'}` };
  };
}

function expectSafeBrowsing() {
  return (res: any): GraderResult => {
    const sb = res?.safeBrowsing || res?.trust?.safeBrowsing;
    if (!sb) return { pass: false, reason: 'missing safeBrowsing field' };
    if (typeof sb.safe !== 'boolean') return { pass: false, reason: 'safeBrowsing.safe is not boolean' };
    return { pass: true, reason: `safeBrowsing.safe=${sb.safe} ✓` };
  };
}

// ── Test cases ─────────────────────────────────────────────────────────────
const testCases: TestCase[] = [
  // ━━━ BASIC FETCH (5+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Basic: httpbin.org returns content',
    category: 'basic',
    critical: true,
    url: 'https://httpbin.org/html',
    graders: [expectSuccess(), expectContentLength(100), expectTokensReasonable(50)],
  },
  {
    name: 'Basic: Wikipedia page has title and content',
    category: 'basic',
    critical: true,
    url: 'https://en.wikipedia.org/wiki/WebSocket',
    graders: [expectSuccess(), expectTitle('WebSocket'), expectContentLength(500), expectTokensReasonable(100)],
  },
  {
    name: 'Basic: GitHub readme fetch',
    category: 'basic',
    url: 'https://github.com/nodejs/node',
    graders: [expectSuccess(), expectContentLength(200), expectTokensReasonable(50)],
  },
  {
    name: 'Basic: news site returns reasonable content',
    category: 'basic',
    url: 'https://www.reuters.com',
    skip: true,
    skipReason: 'reuters.com frequently blocks/fails on simple fetch — needs render=true or stealth mode',
    graders: [expectSuccess(), expectContentLength(100)],
  },
  {
    name: 'Basic: method is simple or domain-api',
    category: 'basic',
    url: 'https://httpbin.org/html',
    graders: [expectSuccess(), expectMethod(['simple', 'domain-api', 'stealth', 'browser'])],
  },
  {
    name: 'Basic: elapsed time is reasonable',
    category: 'basic',
    url: 'https://httpbin.org/html',
    graders: [expectSuccess(), expectElapsedReasonable(30000)],
  },

  // ━━━ TRUST SCORES (3+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Trust: Wikipedia has trust fields',
    category: 'trust',
    critical: true,
    url: 'https://en.wikipedia.org/wiki/HTTP',
    graders: [expectSuccess(), expectTrustScore(0, 1), expectTrustSourceFields()],
  },
  {
    name: 'Trust: GitHub has trust score',
    category: 'trust',
    url: 'https://github.com/expressjs/express',
    graders: [expectSuccess(), expectTrustScore(0, 1)],
  },
  {
    name: 'Trust: httpbin has trust object',
    category: 'trust',
    url: 'https://httpbin.org/html',
    graders: [expectSuccess(), expectTrustSourceFields()],
  },

  // ━━━ CONTENT EXTRACTION (3+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Content: no script tags in output',
    category: 'content',
    critical: true,
    url: 'https://en.wikipedia.org/wiki/JavaScript',
    graders: [expectSuccess(), expectNoRawHtml()],
  },
  {
    name: 'Content: markdown formatting present',
    category: 'content',
    url: 'https://en.wikipedia.org/wiki/Markdown',
    graders: [expectSuccess(), expectMarkdownFormat()],
  },
  {
    name: 'Content: news article is clean markdown',
    category: 'content',
    url: 'https://www.reuters.com',
    skip: true,
    skipReason: 'reuters.com blocks simple fetch — needs render=true',
    graders: [expectSuccess(), expectNoRawHtml()],
  },

  // ━━━ ERROR HANDLING (3+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Error: invalid URL fails gracefully',
    category: 'error',
    critical: true,
    url: 'https://this-domain-definitely-does-not-exist-abc123xyz.com',
    expectError: true,
    graders: [expectJobFailed()],
  },
  {
    name: 'Error: unreachable host fails',
    category: 'error',
    url: 'https://192.0.2.1', // TEST-NET, guaranteed unreachable
    expectError: true,
    graders: [expectJobFailed()],
  },
  {
    name: 'Error: non-existent path returns error or empty',
    category: 'error',
    url: 'https://httpbin.org/status/404',
    expectError: true,
    graders: [expectJobFailed()],
  },

  // ━━━ SAFE BROWSING (2) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'SafeBrowsing: Wikipedia has safeBrowsing field',
    category: 'safebrowsing',
    url: 'https://en.wikipedia.org/wiki/HTTP',
    graders: [expectSuccess(), expectSafeBrowsing()],
  },
];

// ── Fetch with polling ─────────────────────────────────────────────────────
async function fetchAndPoll(url: string, queryParams?: Record<string, string>): Promise<any> {
  const params = new URLSearchParams({ url, ...(queryParams || {}) });
  const fetchUrl = `${BASE_URL}/v1/fetch?${params}`;

  const res = await fetch(fetchUrl, {
    headers: { 'X-Api-Key': API_KEY },
  });
  const body = await res.json() as any;

  if (!body.success || !body.jobId) {
    return { __jobStatus: 'failed', error: body.error || 'no jobId returned' };
  }

  // Poll for completion
  const pollUrl = `${BASE_URL}${body.pollUrl}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(pollUrl, {
      headers: { 'X-Api-Key': API_KEY },
    });
    const pollBody = await pollRes.json() as any;

    if (pollBody.status === 'completed' && pollBody.result) {
      return { ...pollBody.result, __jobStatus: 'completed' };
    }
    if (pollBody.status === 'failed') {
      return { __jobStatus: 'failed', error: pollBody.error || 'job failed' };
    }
    // still processing, keep polling
  }

  return { __jobStatus: 'timeout', error: `polling timed out after ${POLL_TIMEOUT_MS}ms` };
}

// ── Runner ─────────────────────────────────────────────────────────────────
async function runTestCase(tc: TestCase): Promise<TestResult> {
  if (tc.skip) {
    return { name: tc.name, category: tc.category, pass: true, reasons: [], timeMs: 0, skipped: true, skipReason: tc.skipReason };
  }

  const start = Date.now();
  try {
    const result = await fetchAndPoll(tc.url, tc.queryParams);

    const reasons: string[] = [];
    let allPass = true;

    for (const grader of tc.graders) {
      const r = grader(result);
      reasons.push(r.pass ? `${c.green}✓${c.reset} ${r.reason}` : `${c.red}✗${c.reset} ${r.reason}`);
      if (!r.pass) allPass = false;
    }

    return { name: tc.name, category: tc.category, pass: allPass, reasons, timeMs: Date.now() - start };
  } catch (err: any) {
    return {
      name: tc.name,
      category: tc.category,
      pass: false,
      reasons: [`${c.red}✗${c.reset} Error: ${err.message}`],
      timeMs: Date.now() - start,
    };
  }
}

// ── Concurrency limiter ────────────────────────────────────────────────────
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<any>): Promise<any[]> {
  const results: any[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.cyan}━━━ WebPeel Fetch Eval Suite ━━━${c.reset}`);
  console.log(`${c.gray}Target: ${BASE_URL}${c.reset}`);
  console.log(`${c.gray}Category: ${categoryFilter || 'all'}${c.reset}`);
  console.log(`${c.gray}Concurrency: ${CONCURRENCY}${c.reset}`);
  console.log(`${c.gray}Poll timeout: ${POLL_TIMEOUT_MS / 1000}s per job${c.reset}\n`);

  // Filter test cases
  let filtered = testCases;
  if (categoryFilter === 'critical') {
    filtered = testCases.filter(tc => tc.critical);
  } else if (categoryFilter) {
    filtered = testCases.filter(tc => tc.category === categoryFilter);
  }

  if (filtered.length === 0) {
    console.log(`${c.red}No test cases match category "${categoryFilter}"${c.reset}`);
    console.log(`${c.dim}Available categories: ${[...new Set(testCases.map(t => t.category))].join(', ')}, critical${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.bold}Running ${filtered.length} tests...${c.reset}\n`);
  const startAll = Date.now();

  const results = await runWithConcurrency(filtered, CONCURRENCY, runTestCase);

  // ── Report ─────────────────────────────────────────────────────────────
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;
  let currentCategory = '';

  for (const r of results as TestResult[]) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      console.log(`\n${c.bold}${c.blue}── ${currentCategory.toUpperCase()} ──${c.reset}`);
    }

    if (r.skipped) {
      console.log(`  ${c.yellow}⏭  ${r.name}${c.reset} ${c.dim}(skipped: ${r.skipReason})${c.reset}`);
      skipCount++;
      continue;
    }

    const icon = r.pass ? `${c.green}✅` : `${c.red}❌`;
    const time = `${c.dim}(${r.timeMs}ms)${c.reset}`;
    console.log(`  ${icon} ${r.name}${c.reset} ${time}`);

    for (const reason of r.reasons) {
      console.log(`      ${reason}`);
    }

    if (r.pass) passCount++;
    else failCount++;
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const totalMs = Date.now() - startAll;
  console.log(`\n${c.bold}${c.cyan}━━━ Summary ━━━${c.reset}`);
  console.log(`  ${c.green}Passed: ${passCount}${c.reset}`);
  if (failCount > 0) console.log(`  ${c.red}Failed: ${failCount}${c.reset}`);
  if (skipCount > 0) console.log(`  ${c.yellow}Skipped: ${skipCount}${c.reset}`);
  console.log(`  ${c.dim}Total: ${passCount + failCount + skipCount} tests in ${(totalMs / 1000).toFixed(1)}s${c.reset}\n`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
  process.exit(1);
});
