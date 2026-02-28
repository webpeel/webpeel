/**
 * Browser Engine Benchmark for WebPeel
 * Tests Raw HTTP, Playwright Chromium, Playwright Firefox, and Lightpanda
 * Run with: npx tsx scripts/benchmark-engines.ts
 */

import { fetch as undiciFetch } from 'undici';
import { chromium, firefox } from 'playwright';
import puppeteer from 'puppeteer';
import { execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const execFileAsync = promisify(execFile);

const TEST_URLS = [
  'https://news.ycombinator.com',
  'https://en.wikipedia.org/wiki/Artificial_intelligence',
  'https://www.nytimes.com',
  'https://github.com/nicholasgasior',
  'https://www.reddit.com/r/programming',
  'https://html.duckduckgo.com/html/?q=web+scraping+tools',
  'https://www.bing.com/search?q=web+scraping+tools',
  'https://stackoverflow.com/questions/tagged/web-scraping',
  'https://httpbin.org/html',
  'https://example.com',
];

const TIMEOUT_MS = 15_000;

interface BenchmarkResult {
  url: string;
  engine: string;
  timeMs: number;
  contentChars: number;
  tokens: number;
  status: 'ok' | 'error';
  error?: string;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countTokens(html: string): number {
  const text = stripTags(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(t => t.length > 0).length;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const short = u.hostname + (u.pathname !== '/' ? u.pathname.slice(0, 20) : '') + 
                  (u.search ? u.search.slice(0, 15) + '...' : '');
    return short.length > 40 ? short.slice(0, 40) : short;
  } catch {
    return url.slice(0, 40);
  }
}

// ─── Raw HTTP ─────────────────────────────────────────────────────────────────

async function benchRawHTTP(url: string): Promise<BenchmarkResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await undiciFetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    clearTimeout(timer);
    const html = await response.text();
    const timeMs = Date.now() - start;
    return {
      url,
      engine: 'Raw HTTP',
      timeMs,
      contentChars: html.length,
      tokens: countTokens(html),
      status: 'ok',
    };
  } catch (err: any) {
    return {
      url,
      engine: 'Raw HTTP',
      timeMs: Date.now() - start,
      contentChars: 0,
      tokens: 0,
      status: 'error',
      error: err.message?.slice(0, 80) ?? 'unknown',
    };
  }
}

// ─── Playwright engines ───────────────────────────────────────────────────────

async function benchPlaywright(
  url: string,
  engine: 'Chromium' | 'Firefox',
  page: import('playwright').Page
): Promise<BenchmarkResult> {
  const start = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const html = await page.content();
    const timeMs = Date.now() - start;
    return {
      url,
      engine,
      timeMs,
      contentChars: html.length,
      tokens: countTokens(html),
      status: 'ok',
    };
  } catch (err: any) {
    return {
      url,
      engine,
      timeMs: Date.now() - start,
      contentChars: 0,
      tokens: 0,
      status: 'error',
      error: err.message?.slice(0, 80) ?? 'unknown',
    };
  }
}

// ─── Lightpanda ───────────────────────────────────────────────────────────────

function findLightpanda(): string | null {
  const candidates = [
    '/usr/local/bin/lightpanda',
    path.join(PROJECT_ROOT, 'bin', 'lightpanda'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Check PATH
  try {
    const result = require('child_process').execSync('which lightpanda 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch {}
  return null;
}

async function benchLightpanda(
  url: string,
  page: any /* puppeteer Page */
): Promise<BenchmarkResult> {
  const start = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const html = await page.content();
    const timeMs = Date.now() - start;
    return {
      url,
      engine: 'Lightpanda',
      timeMs,
      contentChars: html.length,
      tokens: countTokens(html),
      status: 'ok',
    };
  } catch (err: any) {
    return {
      url,
      engine: 'Lightpanda',
      timeMs: Date.now() - start,
      contentChars: 0,
      tokens: 0,
      status: 'error',
      error: err.message?.slice(0, 80) ?? 'unknown',
    };
  }
}

// ─── Table rendering ──────────────────────────────────────────────────────────

function renderTable(results: BenchmarkResult[]): string {
  const rows: string[] = [
    '| URL | Engine | Time (ms) | Content (chars) | Tokens | Status |',
    '|-----|--------|-----------|-----------------|--------|--------|',
  ];
  for (const r of results) {
    const statusCol = r.status === 'ok' ? '✅ ok' : `❌ ${r.error ?? 'error'}`;
    rows.push(
      `| ${shortUrl(r.url)} | ${r.engine} | ${r.timeMs} | ${r.contentChars.toLocaleString()} | ${r.tokens.toLocaleString()} | ${statusCol} |`
    );
  }
  return rows.join('\n');
}

function renderSummary(results: BenchmarkResult[]): string {
  const engines = ['Raw HTTP', 'Chromium', 'Firefox', 'Lightpanda'];
  const lines = ['', '## Engine Averages', ''];
  for (const engine of engines) {
    const subset = results.filter(r => r.engine === engine);
    if (subset.length === 0) {
      lines.push(`  **${engine}:** not available`);
      continue;
    }
    const ok = subset.filter(r => r.status === 'ok');
    const successPct = Math.round((ok.length / subset.length) * 100);
    const avgMs = ok.length > 0
      ? Math.round(ok.reduce((sum, r) => sum + r.timeMs, 0) / ok.length)
      : 0;
    const avgChars = ok.length > 0
      ? Math.round(ok.reduce((sum, r) => sum + r.contentChars, 0) / ok.length)
      : 0;
    const avgTokens = ok.length > 0
      ? Math.round(ok.reduce((sum, r) => sum + r.tokens, 0) / ok.length)
      : 0;
    lines.push(`  **${engine}:** ${avgMs}ms avg, ${successPct}% success, avg ${avgChars.toLocaleString()} chars, avg ${avgTokens.toLocaleString()} tokens`);
  }
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allResults: BenchmarkResult[] = [];
  
  console.log('# WebPeel Browser Engine Benchmark\n');
  console.log(`Testing ${TEST_URLS.length} URLs × 4 engines (where available)\n`);
  console.log(`Timeout: ${TIMEOUT_MS}ms per page\n`);
  console.log('---\n');

  // ── 1. Raw HTTP ──────────────────────────────────────────────────────────────
  console.log('## Running: Raw HTTP...');
  for (const url of TEST_URLS) {
    process.stdout.write(`  ${shortUrl(url)} ... `);
    const result = await benchRawHTTP(url);
    allResults.push(result);
    console.log(result.status === 'ok' ? `${result.timeMs}ms (${result.contentChars.toLocaleString()} chars)` : `ERROR: ${result.error}`);
  }

  // ── 2. Playwright Chromium ───────────────────────────────────────────────────
  console.log('\n## Running: Playwright Chromium...');
  let chromiumBrowser: import('playwright').Browser | null = null;
  try {
    chromiumBrowser = await chromium.launch({ headless: true });
    const chromiumPage = await chromiumBrowser.newPage();
    for (const url of TEST_URLS) {
      process.stdout.write(`  ${shortUrl(url)} ... `);
      const result = await benchPlaywright(url, 'Chromium', chromiumPage);
      allResults.push(result);
      console.log(result.status === 'ok' ? `${result.timeMs}ms (${result.contentChars.toLocaleString()} chars)` : `ERROR: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`  Failed to launch Chromium: ${err.message}`);
    for (const url of TEST_URLS) {
      allResults.push({ url, engine: 'Chromium', timeMs: 0, contentChars: 0, tokens: 0, status: 'error', error: 'launch failed' });
    }
  } finally {
    await chromiumBrowser?.close().catch(() => {});
  }

  // ── 3. Playwright Firefox ────────────────────────────────────────────────────
  // Note: rebrowser-playwright's Firefox backend has an uncaught exception bug
  // on some page navigations. We guard with a process-level handler.
  console.log('\n## Running: Playwright Firefox...');
  let firefoxBrowser: import('playwright').Browser | null = null;
  let firefoxFatalError: string | null = null;
  
  // Intercept uncaught exceptions from FF internals so they don't crash the process
  const ffUncaughtHandler = (err: Error) => {
    firefoxFatalError = err.message?.slice(0, 120) ?? 'uncaught exception';
    // Don't re-throw; just capture and let the loop handle it
  };
  process.on('uncaughtException', ffUncaughtHandler);

  try {
    firefoxBrowser = await firefox.launch({ headless: true });
    for (const url of TEST_URLS) {
      if (firefoxFatalError) {
        allResults.push({ url, engine: 'Firefox', timeMs: 0, contentChars: 0, tokens: 0, status: 'error', error: firefoxFatalError });
        continue;
      }
      process.stdout.write(`  ${shortUrl(url)} ... `);
      // Create a fresh context+page per URL to isolate crashes
      let ctx: import('playwright').BrowserContext | null = null;
      let result: BenchmarkResult;
      try {
        ctx = await firefoxBrowser.newContext();
        const ffPage = await ctx.newPage();
        result = await benchPlaywright(url, 'Firefox', ffPage);
      } catch (pageErr: any) {
        result = {
          url, engine: 'Firefox', timeMs: 0, contentChars: 0, tokens: 0,
          status: 'error', error: pageErr.message?.slice(0, 80) ?? 'page error',
        };
      } finally {
        await ctx?.close().catch(() => {});
      }
      allResults.push(result);
      console.log(result.status === 'ok' ? `${result.timeMs}ms (${result.contentChars.toLocaleString()} chars)` : `ERROR: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`  Failed to launch Firefox: ${err.message}`);
    for (const url of TEST_URLS) {
      allResults.push({ url, engine: 'Firefox', timeMs: 0, contentChars: 0, tokens: 0, status: 'error', error: 'launch failed' });
    }
  } finally {
    await firefoxBrowser?.close().catch(() => {});
    process.removeListener('uncaughtException', ffUncaughtHandler);
  }

  // ── 4. Lightpanda ────────────────────────────────────────────────────────────
  console.log('\n## Running: Lightpanda...');
  const lightpandaBin = findLightpanda();
  let lightpandaProc: ReturnType<typeof spawn> | null = null;
  let lightpandaAvailable = false;

  if (!lightpandaBin) {
    console.log('  Lightpanda binary not found — skipping');
    for (const url of TEST_URLS) {
      allResults.push({ url, engine: 'Lightpanda', timeMs: 0, contentChars: 0, tokens: 0, status: 'error', error: 'not available' });
    }
  } else {
    console.log(`  Found binary at: ${lightpandaBin}`);
    // Launch Lightpanda CDP server
    try {
      lightpandaProc = spawn(lightpandaBin, ['serve', '--host', '127.0.0.1', '--port', '9222'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
      
      // Wait for server to be ready
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Lightpanda startup timeout')), 10_000);
        let output = '';
        lightpandaProc!.stdout?.on('data', (d: Buffer) => {
          output += d.toString();
          if (output.includes('9222') || output.includes('listening') || output.includes('ready')) {
            clearTimeout(timer);
            resolve();
          }
        });
        lightpandaProc!.stderr?.on('data', (d: Buffer) => {
          output += d.toString();
          if (output.includes('9222') || output.includes('listening') || output.includes('ready')) {
            clearTimeout(timer);
            resolve();
          }
        });
        lightpandaProc!.on('error', (err) => { clearTimeout(timer); reject(err); });
        lightpandaProc!.on('exit', (code) => {
          if (code !== null) { clearTimeout(timer); reject(new Error(`Lightpanda exited with code ${code}`)); }
        });
        // Give it 3 seconds regardless
        setTimeout(() => { clearTimeout(timer); resolve(); }, 3000);
      });

      // Try to connect
      const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:9222' });
      const page = await browser.newPage();
      lightpandaAvailable = true;
      console.log('  Lightpanda CDP connected ✓');

      for (const url of TEST_URLS) {
        process.stdout.write(`  ${shortUrl(url)} ... `);
        const result = await benchLightpanda(url, page);
        allResults.push(result);
        console.log(result.status === 'ok' ? `${result.timeMs}ms (${result.contentChars.toLocaleString()} chars)` : `ERROR: ${result.error}`);
      }

      await browser.disconnect().catch(() => {});
    } catch (err: any) {
      console.log(`  Lightpanda failed: ${err.message}`);
      for (const url of TEST_URLS) {
        allResults.push({ url, engine: 'Lightpanda', timeMs: 0, contentChars: 0, tokens: 0, status: 'error', error: `startup failed: ${err.message?.slice(0, 60)}` });
      }
    } finally {
      if (lightpandaProc) {
        try { lightpandaProc.kill('SIGTERM'); } catch {}
        lightpandaProc = null;
      }
    }
  }

  // ── Results table ─────────────────────────────────────────────────────────────
  console.log('\n---\n');
  console.log('## Results\n');
  const table = renderTable(allResults);
  console.log(table);

  const summary = renderSummary(allResults);
  console.log(summary);

  // ── Save to file ──────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const fileContent = `# WebPeel Browser Engine Benchmark\n\n_Run at: ${now}_\n_Timeout: ${TIMEOUT_MS}ms per page_\n\n## Results\n\n${table}\n${summary}\n`;
  
  const outPath = path.join(PROJECT_ROOT, '.internal', 'benchmark-results.md');
  const { writeFile } = await import('fs/promises');
  await writeFile(outPath, fileContent, 'utf8');
  console.log(`\n\n_Results saved to .internal/benchmark-results.md_`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
