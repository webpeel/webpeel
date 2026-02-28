#!/usr/bin/env node
/**
 * Real benchmark: tests WebPeel against 25+ diverse URLs.
 * Measures success rate and average response time.
 * A "success" = got meaningful content (>50 tokens of text).
 */

import { peel } from '../dist/index.js';

const URLS = [
  // News / Articles
  'https://www.bbc.com/news',
  'https://edition.cnn.com/',
  'https://www.reuters.com/',
  'https://www.nytimes.com/',
  'https://techcrunch.com/',
  
  // Tech / Dev
  'https://github.com/anthropics/claude-code',
  'https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git',
  'https://www.npmjs.com/package/express',
  'https://docs.python.org/3/tutorial/index.html',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  
  // Social / Content
  'https://en.wikipedia.org/wiki/Artificial_intelligence',
  'https://news.ycombinator.com/',
  'https://old.reddit.com/r/programming/',
  
  // E-commerce
  'https://www.amazon.com/dp/B0D1XD1ZV3',
  'https://www.bestbuy.com/site/apple-macbook-air-13-inch-laptop-m4-chip-16gb-memory-256gb/6604203.p',
  'https://www.walmart.com/',
  
  // Academic / Reference
  'https://arxiv.org/abs/2301.07041',
  'https://www.imdb.com/title/tt0111161/',
  
  // Blogs / Media
  'https://blog.cloudflare.com/',
  'https://www.theverge.com/',
  'https://arstechnica.com/',
  
  // Misc
  'https://httpbin.org/html',
  'https://example.com/',
  'https://jsonplaceholder.typicode.com/posts/1',
  'https://www.iana.org/domains/reserved',
];

async function runBenchmark() {
  console.log(`\n🔍 WebPeel Benchmark — ${URLS.length} URLs\n`);
  console.log('URL'.padEnd(70) + 'Time(ms)'.padStart(10) + '  Status   Tokens');
  console.log('─'.repeat(110));

  const results = [];

  for (const url of URLS) {
    const start = Date.now();
    let success = false;
    let tokens = 0;
    let error = '';

    try {
      const result = await peel(url, { timeout: 30000 });
      const elapsed = Date.now() - start;
      const content = result.markdown || result.content || '';
      // Count rough tokens (words / 0.75)
      tokens = Math.round(content.split(/\s+/).filter(w => w.length > 0).length / 0.75);
      success = tokens > 50;

      const status = success ? '✅' : '⚠️ low';
      const shortUrl = url.length > 68 ? url.substring(0, 65) + '...' : url;
      console.log(`${shortUrl.padEnd(70)}${String(elapsed).padStart(8)}ms  ${status.padEnd(10)} ${tokens}`);
      results.push({ url, elapsed, success, tokens, error: success ? '' : 'low content' });
    } catch (e) {
      const elapsed = Date.now() - start;
      error = e.message?.substring(0, 40) || 'unknown';
      const shortUrl = url.length > 68 ? url.substring(0, 65) + '...' : url;
      console.log(`${shortUrl.padEnd(70)}${String(elapsed).padStart(8)}ms  ❌ FAIL   ${error}`);
      results.push({ url, elapsed, success: false, tokens: 0, error });
    }
  }

  // Summary
  const total = results.length;
  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success);
  const successRate = ((successes / total) * 100).toFixed(1);

  const successTimes = results.filter(r => r.success).map(r => r.elapsed);
  const avgTime = successTimes.length > 0 
    ? Math.round(successTimes.reduce((a, b) => a + b, 0) / successTimes.length) 
    : 0;
  const medianTime = successTimes.length > 0
    ? successTimes.sort((a, b) => a - b)[Math.floor(successTimes.length / 2)]
    : 0;
  const p95Time = successTimes.length > 0
    ? successTimes.sort((a, b) => a - b)[Math.floor(successTimes.length * 0.95)]
    : 0;

  console.log('\n' + '═'.repeat(110));
  console.log(`\n📊 RESULTS:`);
  console.log(`   Total URLs tested:  ${total}`);
  console.log(`   Successes:          ${successes}`);
  console.log(`   Failures:           ${total - successes}`);
  console.log(`   Success Rate:       ${successRate}%`);
  console.log(`   Avg Response Time:  ${avgTime}ms`);
  console.log(`   Median Time:        ${medianTime}ms`);
  console.log(`   P95 Time:           ${p95Time}ms`);

  if (failures.length > 0) {
    console.log(`\n   ❌ Failed URLs:`);
    for (const f of failures) {
      console.log(`      - ${f.url} (${f.error})`);
    }
  }

  // Write JSON results for later use
  const summary = {
    timestamp: new Date().toISOString(),
    totalUrls: total,
    successes,
    failures: total - successes,
    successRate: parseFloat(successRate),
    avgResponseTimeMs: avgTime,
    medianResponseTimeMs: medianTime,
    p95ResponseTimeMs: p95Time,
    details: results,
  };

  const fs = await import('fs');
  fs.writeFileSync('scripts/benchmark-results.json', JSON.stringify(summary, null, 2));
  console.log(`\n📁 Full results written to scripts/benchmark-results.json`);
}

runBenchmark().catch(console.error);
