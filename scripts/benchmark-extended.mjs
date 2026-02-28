#!/usr/bin/env node
/**
 * Extended benchmark: 40+ URLs across categories.
 * Success = returned content without error (any content at all).
 * "Meaningful" = >50 tokens.
 */
import { peel } from '../dist/index.js';

const URLS = [
  // === News (8) ===
  'https://www.bbc.com/news',
  'https://edition.cnn.com/',
  'https://www.reuters.com/',
  'https://techcrunch.com/',
  'https://arstechnica.com/',
  'https://www.theverge.com/',
  'https://www.wired.com/',
  'https://www.engadget.com/',

  // === Tech/Dev (8) ===
  'https://github.com/anthropics/claude-code',
  'https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git',
  'https://www.npmjs.com/package/express',
  'https://docs.python.org/3/tutorial/index.html',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  'https://go.dev/doc/',
  'https://docs.rs/tokio/latest/tokio/',
  'https://pkg.go.dev/net/http',

  // === Social/Content (6) ===
  'https://en.wikipedia.org/wiki/Artificial_intelligence',
  'https://news.ycombinator.com/',
  'https://old.reddit.com/r/programming/',
  'https://medium.com/@acubed/product-thinking-is-hard-72d08ddee4a3',
  'https://www.quora.com/What-is-the-best-programming-language-to-learn-first',
  'https://dev.to/',

  // === E-commerce (5) ===
  'https://www.amazon.com/dp/B0D1XD1ZV3',
  'https://www.bestbuy.com/site/apple-macbook-air-13-inch-laptop-m4-chip-16gb-memory-256gb/6604203.p',
  'https://www.walmart.com/',
  'https://www.target.com/',
  'https://www.etsy.com/',

  // === Academic/Reference (4) ===
  'https://arxiv.org/abs/2301.07041',
  'https://www.imdb.com/title/tt0111161/',
  'https://plato.stanford.edu/entries/artificial-intelligence/',
  'https://www.britannica.com/technology/artificial-intelligence',

  // === Blogs/Companies (5) ===
  'https://blog.cloudflare.com/',
  'https://openai.com/blog',
  'https://www.anthropic.com/',
  'https://stripe.com/docs',
  'https://vercel.com/blog',

  // === Misc/Edge Cases (5) ===
  'https://httpbin.org/html',
  'https://example.com/',
  'https://www.iana.org/domains/reserved',
  'https://news.google.com/',
  'https://www.craigslist.org/',
];

async function run() {
  console.log(`\n🔍 Extended WebPeel Benchmark — ${URLS.length} URLs\n`);
  
  const results = [];
  let done = 0;

  for (const url of URLS) {
    done++;
    const start = Date.now();
    try {
      const result = await peel(url, { timeout: 30000 });
      const elapsed = Date.now() - start;
      const content = result.markdown || result.content || '';
      const tokens = Math.round(content.split(/\s+/).filter(w => w.length > 0).length / 0.75);
      const success = content.length > 0;
      const meaningful = tokens > 50;
      
      const icon = meaningful ? '✅' : (success ? '⚠️' : '❌');
      const short = url.length > 55 ? url.substring(0, 52) + '...' : url;
      console.log(`[${String(done).padStart(2)}/${URLS.length}] ${icon} ${short.padEnd(56)} ${String(elapsed).padStart(6)}ms  ${String(tokens).padStart(6)} tok`);
      results.push({ url, elapsed, success, meaningful, tokens });
    } catch (e) {
      const elapsed = Date.now() - start;
      const short = url.length > 55 ? url.substring(0, 52) + '...' : url;
      console.log(`[${String(done).padStart(2)}/${URLS.length}] ❌ ${short.padEnd(56)} ${String(elapsed).padStart(6)}ms  ERROR: ${e.message?.substring(0, 50)}`);
      results.push({ url, elapsed, success: false, meaningful: false, tokens: 0, error: e.message?.substring(0, 80) });
    }
  }

  const total = results.length;
  const fetched = results.filter(r => r.success).length;
  const meaningful = results.filter(r => r.meaningful).length;
  
  const allTimes = results.filter(r => r.success).map(r => r.elapsed).sort((a,b) => a-b);
  const avg = Math.round(allTimes.reduce((a,b) => a+b, 0) / allTimes.length);
  const median = allTimes[Math.floor(allTimes.length / 2)];
  const p50 = allTimes[Math.floor(allTimes.length * 0.5)];
  const p90 = allTimes[Math.floor(allTimes.length * 0.9)];
  const p95 = allTimes[Math.floor(allTimes.length * 0.95)];

  // Separate simple HTTP from browser-escalated
  const simpleTimes = results.filter(r => r.success && r.elapsed < 500).map(r => r.elapsed).sort((a,b) => a-b);
  const simpleAvg = simpleTimes.length > 0 ? Math.round(simpleTimes.reduce((a,b) => a+b, 0) / simpleTimes.length) : 0;

  console.log('\n' + '═'.repeat(90));
  console.log(`\n📊 RESULTS (${total} URLs):`);
  console.log(`   Fetch success:       ${fetched}/${total} (${((fetched/total)*100).toFixed(1)}%)`);
  console.log(`   Meaningful content:  ${meaningful}/${total} (${((meaningful/total)*100).toFixed(1)}%)`);
  console.log(`   Avg time (all):      ${avg}ms`);
  console.log(`   Median time:         ${median}ms`);
  console.log(`   P90 time:            ${p90}ms`);
  console.log(`   P95 time:            ${p95}ms`);
  console.log(`   Simple HTTP avg:     ${simpleAvg}ms (${simpleTimes.length} URLs < 500ms)`);
  
  const nonMeaningful = results.filter(r => !r.meaningful);
  if (nonMeaningful.length > 0) {
    console.log(`\n   ⚠️ Non-meaningful / Failed:`);
    for (const f of nonMeaningful) {
      console.log(`      ${f.url} → ${f.error || f.tokens + ' tokens'}`);
    }
  }

  // Write results
  const fs = await import('fs');
  const summary = {
    timestamp: new Date().toISOString(),
    totalUrls: total,
    fetchSuccess: fetched,
    fetchSuccessRate: parseFloat(((fetched/total)*100).toFixed(1)),
    meaningfulContent: meaningful,
    meaningfulRate: parseFloat(((meaningful/total)*100).toFixed(1)),
    avgResponseMs: avg,
    medianResponseMs: median,
    p90Ms: p90,
    p95Ms: p95,
    simpleHttpAvgMs: simpleAvg,
    details: results,
  };
  fs.writeFileSync('scripts/benchmark-extended-results.json', JSON.stringify(summary, null, 2));
  console.log(`\n📁 Written to scripts/benchmark-extended-results.json`);
}

run().catch(console.error);
