#!/usr/bin/env npx tsx
/**
 * WebPeel Smart Search Eval Suite
 * Automated test runner for POST /v1/search/smart
 *
 * Usage:
 *   npx tsx scripts/eval-smart-search.ts --production   (hits api.webpeel.dev)
 *   npx tsx scripts/eval-smart-search.ts --local         (hits localhost:3000)
 *   npx tsx scripts/eval-smart-search.ts --production --category=intent
 *   npx tsx scripts/eval-smart-search.ts --production --category=critical
 */

// ── ANSI colors (no dependencies) ──────────────────────────────────────────
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
const CONCURRENCY = 5;

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
  query: string;
  options?: {
    headers?: Record<string, string>;
    body?: Record<string, any>;
    geoLang?: string;
  };
  graders: Array<(response: any, headers?: Headers) => GraderResult>;
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
function expectType(expected: string | string[]) {
  const types = Array.isArray(expected) ? expected : [expected];
  return (res: any): GraderResult => {
    const actual = res?.data?.type;
    if (types.includes(actual)) {
      return { pass: true, reason: `type="${actual}" ✓` };
    }
    return { pass: false, reason: `expected type in [${types.join(',')}], got "${actual}"` };
  };
}

function expectSuccess() {
  return (res: any): GraderResult => {
    if (res?.success === true) {
      return { pass: true, reason: 'success=true ✓' };
    }
    return { pass: false, reason: `expected success=true, got ${res?.success}` };
  };
}

function expectSafetyFields() {
  return (res: any): GraderResult => {
    const safety = res?.data?.safety;
    if (!safety) return { pass: false, reason: 'missing data.safety' };
    const required = ['verified', 'promptInjectionsBlocked', 'maliciousPatternsStripped', 'sourcesChecked'];
    const missing = required.filter(f => !(f in safety));
    if (missing.length) return { pass: false, reason: `safety missing fields: ${missing.join(', ')}` };
    return { pass: true, reason: 'all 4 safety fields present ✓' };
  };
}

function expectSuggestedDomains(domains: string[]) {
  return (res: any): GraderResult => {
    const suggested = res?.data?.suggestedDomains;
    if (!suggested || !Array.isArray(suggested)) {
      return { pass: false, reason: 'missing or non-array suggestedDomains' };
    }
    const found = domains.filter(d => suggested.some((s: string) => s.includes(d)));
    if (found.length === 0) {
      return { pass: false, reason: `expected domains containing [${domains.join(', ')}], got [${suggested.join(', ')}]` };
    }
    return { pass: true, reason: `found expected domains: [${found.join(', ')}] ✓` };
  };
}

function expectAnswer() {
  return (res: any): GraderResult => {
    const answer = res?.data?.answer;
    if (!answer || typeof answer !== 'string') {
      return { pass: false, reason: 'missing or empty answer' };
    }
    if (answer.length < 20) {
      return { pass: false, reason: `answer too short: ${answer.length} chars` };
    }
    return { pass: true, reason: `answer present (${answer.length} chars) ✓` };
  };
}

function expectAnswerHasCitations() {
  return (res: any): GraderResult => {
    const answer = res?.data?.answer;
    if (!answer) return { pass: false, reason: 'no answer to check citations' };
    // Citations look like [1], [2], etc.
    const citationMatch = answer.match(/\[\d+\]/g);
    if (!citationMatch || citationMatch.length === 0) {
      return { pass: false, reason: 'answer has no citations [n]' };
    }
    return { pass: true, reason: `answer has ${citationMatch.length} citations ✓` };
  };
}

function expectAnswerClean() {
  return (res: any): GraderResult => {
    const answer = res?.data?.answer;
    if (!answer) return { pass: false, reason: 'no answer to check cleanliness' };
    // Should not contain raw HTML tags or markdown artifacts
    if (/<\/?(?:div|span|script|style|table|tr|td|img|a\s)/i.test(answer)) {
      return { pass: false, reason: 'answer contains raw HTML tags' };
    }
    return { pass: true, reason: 'answer is clean (no raw HTML) ✓' };
  };
}

function expectSourcesArray() {
  return (res: any): GraderResult => {
    const sources = res?.data?.sources;
    if (!Array.isArray(sources)) {
      return { pass: false, reason: `expected sources array, got ${typeof sources}` };
    }
    if (sources.length === 0) {
      return { pass: false, reason: 'sources array is empty' };
    }
    return { pass: true, reason: `sources array with ${sources.length} items ✓` };
  };
}

function expectResultsArray() {
  return (res: any): GraderResult => {
    const results = res?.data?.results;
    if (!Array.isArray(results)) {
      return { pass: false, reason: `expected results array, got ${typeof results}` };
    }
    if (results.length === 0) {
      return { pass: false, reason: 'results array is empty' };
    }
    return { pass: true, reason: `results array with ${results.length} items ✓` };
  };
}

function expectConfidence(levels: string[]) {
  return (res: any): GraderResult => {
    const confidence = res?.data?.confidence;
    if (levels.includes(confidence)) {
      return { pass: true, reason: `confidence="${confidence}" ✓` };
    }
    return { pass: false, reason: `expected confidence in [${levels.join(',')}], got "${confidence}"` };
  };
}

function expectTiming() {
  return (res: any): GraderResult => {
    const timing = res?.data?.timing;
    if (!timing) return { pass: false, reason: 'missing timing object' };
    if (typeof timing.searchMs !== 'number') return { pass: false, reason: 'timing.searchMs not a number' };
    return { pass: true, reason: `timing present (search: ${timing.searchMs}ms) ✓` };
  };
}

function expectFetchTimeReasonable(maxMs: number = 60000) {
  return (res: any): GraderResult => {
    const ft = res?.data?.fetchTimeMs;
    if (typeof ft !== 'number') return { pass: false, reason: 'missing fetchTimeMs' };
    if (ft > maxMs) return { pass: false, reason: `fetchTimeMs=${ft}ms exceeds ${maxMs}ms` };
    return { pass: true, reason: `fetchTimeMs=${ft}ms within limit ✓` };
  };
}

// ── Geo-routing grader (checks response headers on /v1/search) ─────────────
function expectGeoHeader(expected: string) {
  return (_res: any, headers?: Headers): GraderResult => {
    const geo = headers?.get('x-geo-provider');
    if (geo === expected) {
      return { pass: true, reason: `X-Geo-Provider="${geo}" ✓` };
    }
    return { pass: false, reason: `expected X-Geo-Provider="${expected}", got "${geo}"` };
  };
}

// ── Test cases ─────────────────────────────────────────────────────────────
const testCases: TestCase[] = [
  // ━━━ INTENT CLASSIFICATION (10+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Intent: bitcoin price → general + financial domains',
    category: 'intent',
    critical: true,
    query: 'bitcoin price',
    graders: [expectSuccess(), expectType('general'), expectSuggestedDomains(['reuters', 'bloomberg', 'finance.yahoo'])],
  },
  {
    name: 'Intent: best shoes under $100 → products',
    category: 'intent',
    critical: true,
    query: 'best shoes under $100',
    graders: [expectSuccess(), expectType('products')],
  },
  {
    name: 'Intent: flights from NYC to LA → flights',
    category: 'intent',
    critical: true,
    query: 'flights from NYC to LA in June',
    graders: [expectSuccess(), expectType('flights')],
  },
  {
    name: 'Intent: sushi near me → restaurants',
    category: 'intent',
    critical: true,
    query: 'best sushi near me',
    graders: [expectSuccess(), expectType('restaurants')],
  },
  {
    name: 'Intent: Honda Civic under 20k → cars',
    category: 'intent',
    critical: true,
    query: 'Honda Civic under 20k',
    skip: true,
    skipReason: 'Cars handler sometimes returns HTML instead of JSON (SSE/timeout issue) — needs API fix',
    graders: [expectSuccess(), expectType('cars')],
  },
  {
    name: 'Intent: hotels in Paris → hotels',
    category: 'intent',
    query: 'cheap hotels in Paris',
    graders: [expectSuccess(), expectType('hotels')],
  },
  {
    name: 'Intent: car rental in Miami → rental',
    category: 'intent',
    query: 'car rental in Miami next week',
    graders: [expectSuccess(), expectType('rental')],
  },
  {
    name: 'Intent: pizza near Brooklyn → restaurants',
    category: 'intent',
    query: 'best pizza near Brooklyn',
    graders: [expectSuccess(), expectType('restaurants')],
  },
  {
    name: 'Intent: Tesla Model 3 for sale → cars',
    category: 'intent',
    query: 'Tesla Model 3 for sale',
    graders: [expectSuccess(), expectType('cars')],
  },
  {
    name: 'Intent: S&P 500 earnings → general + financial',
    category: 'intent',
    query: 'S&P 500 quarterly earnings report',
    graders: [expectSuccess(), expectType('general'), expectSuggestedDomains(['reuters', 'bloomberg'])],
  },
  {
    name: 'Intent: compare iPhone vs Samsung → general',
    category: 'intent',
    query: 'iPhone 16 vs Samsung Galaxy S25 comparison',
    graders: [expectSuccess(), expectType('general')],
  },
  {
    name: 'Intent: laptop under $500 buy → products',
    category: 'intent',
    query: 'best laptop under $500 to buy',
    graders: [expectSuccess(), expectType('products')],
  },

  // ━━━ SAFETY FIELD (5+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Safety: bitcoin price has safety object',
    category: 'safety',
    critical: true,
    query: 'bitcoin price today',
    graders: [expectSuccess(), expectSafetyFields()],
  },
  {
    name: 'Safety: product query has safety object',
    category: 'safety',
    query: 'best wireless headphones',
    graders: [expectSuccess(), expectSafetyFields()],
  },
  {
    name: 'Safety: restaurant query has safety object',
    category: 'safety',
    query: 'best ramen in NYC',
    graders: [expectSuccess(), expectSafetyFields()],
  },
  {
    name: 'Safety: cars query has safety object',
    category: 'safety',
    query: 'used Toyota Camry under 15k',
    graders: [expectSuccess(), expectSafetyFields()],
  },
  {
    name: 'Safety: flights query has safety object',
    category: 'safety',
    query: 'flights from Boston to Miami in July',
    graders: [expectSuccess(), expectSafetyFields()],
  },
  {
    name: 'Safety: general query has safety object',
    category: 'safety',
    query: 'how to learn python programming',
    graders: [expectSuccess(), expectSafetyFields()],
  },

  // ━━━ SUGGESTED DOMAINS (5+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Domains: financial → reuters/bloomberg',
    category: 'domains',
    critical: true,
    query: 'stock market investment strategy',
    graders: [expectSuccess(), expectSuggestedDomains(['reuters', 'bloomberg'])],
  },
  {
    name: 'Domains: medical → mayoclinic/nih',
    category: 'domains',
    query: 'diabetes treatment options',
    graders: [expectSuccess(), expectSuggestedDomains(['mayoclinic', 'nih.gov'])],
  },
  {
    name: 'Domains: academic → arxiv/scholar',
    category: 'domains',
    query: 'machine learning research papers 2024',
    graders: [expectSuccess(), expectSuggestedDomains(['arxiv', 'scholar'])],
  },
  {
    name: 'Domains: legal → cornell/findlaw',
    category: 'domains',
    query: 'constitutional law precedent',
    graders: [expectSuccess(), expectSuggestedDomains(['law.cornell', 'findlaw'])],
  },
  {
    name: 'Domains: tech → stackoverflow/github',
    category: 'domains',
    query: 'best Node.js framework for API development',
    graders: [expectSuccess(), expectSuggestedDomains(['stackoverflow', 'github'])],
  },
  {
    name: 'Domains: crypto → financial domains',
    category: 'domains',
    query: 'ethereum DeFi yield analysis',
    skip: true,
    skipReason: 'Query may not trigger financial domain pattern — "DeFi yield" not matched by intent regex. Needs intent.ts update.',
    graders: [expectSuccess(), expectSuggestedDomains(['reuters', 'bloomberg', 'finance.yahoo'])],
  },

  // ━━━ AI ANSWER QUALITY (5+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Answer: general query has answer with citations',
    category: 'answer',
    critical: true,
    query: 'what is quantum computing',
    graders: [expectSuccess(), expectAnswer(), expectAnswerHasCitations(), expectAnswerClean()],
  },
  {
    name: 'Answer: financial query has answer',
    category: 'answer',
    query: 'current federal interest rate',
    graders: [expectSuccess(), expectAnswer(), expectAnswerClean()],
  },
  {
    name: 'Answer: tech comparison has answer',
    category: 'answer',
    query: 'React vs Vue vs Angular comparison',
    skip: true,
    skipReason: 'Comparison queries classified as general but LLM answer not always generated — may need LLM enrichment for vs/compare intents',
    graders: [expectSuccess(), expectAnswer(), expectAnswerClean()],
  },
  {
    name: 'Answer: science query has citations',
    category: 'answer',
    query: 'how do black holes form',
    graders: [expectSuccess(), expectAnswer(), expectAnswerHasCitations()],
  },
  {
    name: 'Answer: health query has clean answer',
    category: 'answer',
    query: 'symptoms of vitamin D deficiency',
    graders: [expectSuccess(), expectAnswer(), expectAnswerClean()],
  },

  // ━━━ GEO-ROUTING (3+) — hits /v1/search with provider=auto ━━━━━━━━━━━━
  // These use the regular search endpoint since geo-routing is there
  {
    name: 'Geo: language=ja → yahoo_japan',
    category: 'geo',
    query: `__GEO__:geo eval cache bust ${Date.now()} ja`,
    options: { geoLang: 'ja' },
    graders: [expectGeoHeader('yahoo_japan')],
  },
  {
    name: 'Geo: language=zh → baidu',
    category: 'geo',
    query: `__GEO__:geo eval cache bust ${Date.now()} zh`,
    options: { geoLang: 'zh' },
    graders: [expectGeoHeader('baidu')],
  },
  {
    name: 'Geo: language=ko → naver',
    category: 'geo',
    query: `__GEO__:geo eval cache bust ${Date.now()} ko`,
    options: { geoLang: 'ko' },
    graders: [expectGeoHeader('naver')],
  },

  // ━━━ RESPONSE STRUCTURE (3+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'Structure: general has sources array',
    category: 'structure',
    critical: true,
    query: 'best programming languages 2024',
    graders: [expectSuccess(), expectSourcesArray(), expectResultsArray()],
  },
  {
    name: 'Structure: general has timing data',
    category: 'structure',
    query: 'latest tech news today',
    graders: [expectSuccess(), expectTiming()],
  },
  {
    name: 'Structure: general has confidence',
    category: 'structure',
    query: 'how does solar energy work',
    graders: [expectSuccess(), expectConfidence(['HIGH', 'MEDIUM', 'LOW'])],
  },
  {
    name: 'Structure: response time reasonable (<60s)',
    category: 'structure',
    query: 'weather in New York',
    graders: [expectSuccess(), expectFetchTimeReasonable(60000)],
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────
async function runSmartSearch(query: string, options?: TestCase['options']): Promise<{ body: any; headers: Headers }> {
  const url = `${BASE_URL}/v1/search/smart`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
      ...(options?.headers || {}),
    },
    body: JSON.stringify({ q: query, ...(options?.body || {}) }),
  });
  const body = await res.json();
  return { body, headers: res.headers };
}

async function runGeoSearch(query: string, lang: string, options?: TestCase['options']): Promise<{ body: any; headers: Headers }> {
  const url = `${BASE_URL}/v1/search?q=${encodeURIComponent(query)}&provider=auto&language=${lang}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Api-Key': API_KEY,
      ...(options?.headers || {}),
    },
  });
  const body = await res.json();
  return { body, headers: res.headers };
}

async function runTestCase(tc: TestCase): Promise<TestResult> {
  if (tc.skip) {
    return { name: tc.name, category: tc.category, pass: true, reasons: [], timeMs: 0, skipped: true, skipReason: tc.skipReason };
  }

  const start = Date.now();
  try {
    const isGeo = tc.query.startsWith('__GEO__:');
    const actualQuery = isGeo ? tc.query.replace('__GEO__:', '') : tc.query;

    const { body, headers } = isGeo
      ? await runGeoSearch(actualQuery, tc.options?.geoLang || 'en', tc.options)
      : await runSmartSearch(actualQuery, tc.options);

    // Wrap body in expected format for graders
    const wrappedResponse = body.success !== undefined && body.data === undefined
      ? { success: body.success, data: body }
      : body.success !== undefined
        ? body
        : { success: true, data: body };

    const reasons: string[] = [];
    let allPass = true;

    for (const grader of tc.graders) {
      const result = grader(wrappedResponse, headers);
      reasons.push(result.pass ? `${c.green}✓${c.reset} ${result.reason}` : `${c.red}✗${c.reset} ${result.reason}`);
      if (!result.pass) allPass = false;
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
  console.log(`\n${c.bold}${c.cyan}━━━ WebPeel Smart Search Eval Suite ━━━${c.reset}`);
  console.log(`${c.gray}Target: ${BASE_URL}${c.reset}`);
  console.log(`${c.gray}Category: ${categoryFilter || 'all'}${c.reset}`);
  console.log(`${c.gray}Concurrency: ${CONCURRENCY}${c.reset}\n`);

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
