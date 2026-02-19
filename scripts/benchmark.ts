#!/usr/bin/env tsx
/**
 * WebPeel Speed Benchmark
 *
 * Measures fetch latency for a set of URLs and compares WebPeel against baseline.
 * Run with: npx tsx scripts/benchmark.ts
 *
 * Optional env vars:
 *   PROXY_URL  - Proxy URL to test proxy performance (optional)
 *   BENCH_RUNS - Number of runs per URL (default: 3)
 */

import { peel } from '../src/index.js';
import { cleanup } from '../src/core/fetcher.js';

const BENCH_URLS = [
  'https://example.com',
  'https://httpbin.org/get',
  'https://news.ycombinator.com',
  'https://en.wikipedia.org/wiki/Web_scraping',
  'https://github.com/webpeel/webpeel',
];

const RUNS = parseInt(process.env.BENCH_RUNS ?? '3', 10);
const PROXY_URL = process.env.PROXY_URL;

interface BenchResult {
  url: string;
  runs: number[];
  min: number;
  max: number;
  avg: number;
  method: string;
}

async function benchmarkUrl(url: string, proxy?: string): Promise<BenchResult> {
  const runs: number[] = [];
  let method = 'simple';

  for (let i = 0; i < RUNS; i++) {
    const start = Date.now();
    try {
      const result = await peel(url, {
        format: 'text',
        timeout: 15000,
        ...(proxy ? { proxy } : {}),
      });
      const elapsed = Date.now() - start;
      runs.push(elapsed);
      method = result.method;
    } catch (err) {
      const elapsed = Date.now() - start;
      console.error(`  ⚠️  Run ${i + 1} failed after ${elapsed}ms: ${err instanceof Error ? err.message : String(err)}`);
      runs.push(elapsed); // Include failed runs in timing
    }
  }

  const min = Math.min(...runs);
  const max = Math.max(...runs);
  const avg = Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);

  return { url, runs, min, max, avg, method };
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printResult(result: BenchResult): void {
  const shortUrl = result.url.replace(/^https?:\/\//, '').substring(0, 40);
  console.log(`  ${shortUrl.padEnd(40)} avg: ${formatMs(result.avg).padStart(7)}  min: ${formatMs(result.min).padStart(7)}  max: ${formatMs(result.max).padStart(7)}  method: ${result.method}`);
}

async function main(): Promise<void> {
  console.log('\n🚀 WebPeel Speed Benchmark');
  console.log(`   URLs: ${BENCH_URLS.length}  |  Runs per URL: ${RUNS}`);
  if (PROXY_URL) {
    console.log(`   Proxy: ${PROXY_URL}`);
  }
  console.log('');

  // ── No-proxy benchmark ───────────────────────────────────────────────────
  console.log('📊 Direct (no proxy):');
  const directResults: BenchResult[] = [];

  for (const url of BENCH_URLS) {
    process.stdout.write(`  Benchmarking ${url.substring(0, 50)}...`);
    const result = await benchmarkUrl(url);
    directResults.push(result);
    process.stdout.write('\r');
    printResult(result);
  }

  const directAvg = Math.round(directResults.reduce((a, r) => a + r.avg, 0) / directResults.length);
  console.log(`\n  Overall average: ${formatMs(directAvg)}`);

  // ── Proxy benchmark (if PROXY_URL is set) ────────────────────────────────
  if (PROXY_URL) {
    console.log('\n📊 Via proxy:');
    const proxyResults: BenchResult[] = [];

    for (const url of BENCH_URLS) {
      process.stdout.write(`  Benchmarking ${url.substring(0, 50)}...`);
      const result = await benchmarkUrl(url, PROXY_URL);
      proxyResults.push(result);
      process.stdout.write('\r');
      printResult(result);
    }

    const proxyAvg = Math.round(proxyResults.reduce((a, r) => a + r.avg, 0) / proxyResults.length);
    console.log(`\n  Overall average: ${formatMs(proxyAvg)}`);

    const overhead = proxyAvg - directAvg;
    const overheadPct = Math.round((overhead / directAvg) * 100);
    console.log(`\n  Proxy overhead: ${formatMs(overhead)} (${overheadPct > 0 ? '+' : ''}${overheadPct}%)`);
  }

  // ── Comparison baseline ───────────────────────────────────────────────────
  const FIRECRAWL_BASELINE_MS = 7000;
  console.log(`\n📈 Comparison:`);
  console.log(`  WebPeel direct avg:  ${formatMs(directAvg)}`);
  console.log(`  Firecrawl baseline:  ${formatMs(FIRECRAWL_BASELINE_MS)} (reported average)`);
  const speedup = ((FIRECRAWL_BASELINE_MS - directAvg) / FIRECRAWL_BASELINE_MS * 100).toFixed(0);
  if (directAvg < FIRECRAWL_BASELINE_MS) {
    console.log(`  ✅ WebPeel is ~${speedup}% faster than Firecrawl`);
  } else {
    console.log(`  ⚠️  WebPeel is slower than Firecrawl baseline — investigate!`);
  }

  console.log('');
  await cleanup();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
