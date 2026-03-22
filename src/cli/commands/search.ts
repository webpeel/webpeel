/**
 * Search commands: search, sites, batch, crawl, map
 */

import type { Command } from 'commander';
import ora from 'ora';
import { readFileSync } from 'fs';
import { peel, peelBatch, cleanup } from '../../index.js';
import { checkUsage, showUsageFooter, loadConfig } from '../../cli-auth.js';
import { writeStdout, formatListingsCsv } from '../utils.js';

/**
 * Parse a date range string like "Mar29-Apr4" into an array of date strings.
 * Returns ["Mar 29", "Mar 30", ..., "Apr 4"]
 */
function parseDateRange(range: string): string[] {
  const match = range.match(/(\w{3})\s*(\d{1,2})\s*[-–to]+\s*(\w{3})\s*(\d{1,2})/i);
  if (!match) return [];

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const startMonthIdx = months.findIndex(m => m.toLowerCase() === match[1].toLowerCase().slice(0, 3));
  const endMonthIdx = months.findIndex(m => m.toLowerCase() === match[3].toLowerCase().slice(0, 3));
  if (startMonthIdx === -1 || endMonthIdx === -1) return [];

  const startDay = parseInt(match[2]);
  const endDay = parseInt(match[4]);
  const year = new Date().getFullYear();

  const dates: string[] = [];
  const start = new Date(year, startMonthIdx, startDay);
  const end = new Date(year, endMonthIdx, endDay);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const mon = months[d.getMonth()];
    dates.push(`${mon} ${d.getDate()}`);
  }
  return dates;
}

export function registerSearchCommands(program: Command): void {

  // ── search command ────────────────────────────────────────────────────────
  program
    .command('search <query>')
    .description('Search the web (DuckDuckGo by default, or use --site for site-specific search)')
    .option('-n, --count <n>', 'Number of results (1-10)', '5')
    .option('--top <n>', 'Limit results (alias for --count)')
    .option('--provider <provider>', 'Search provider: duckduckgo (default) or brave')
    .option('--search-api-key <key>', 'API key for the search provider (or env WEBPEEL_BRAVE_API_KEY)')
    .option('--site <site>', 'Search a specific site (e.g. ebay, amazon, github). Run "webpeel sites" for full list.')
    .option('--json', 'Output as JSON')
    .option('--urls-only', 'Output only URLs, one per line (pipe-friendly)')
    .option('--table', 'Output site-search results as a formatted table (requires --site)')
    .option('--csv', 'Output site-search results as CSV (requires --site)')
    .option('--budget <n>', 'Token budget for site-search result content', parseInt)
    .option('-s, --silent', 'Silent mode')
    .option('--proxy <url>', 'Proxy URL for requests (http://host:port, socks5://user:pass@host:port)')
    .option('--fetch', 'Also fetch and include content from each result URL')
    .option('--agent', 'Agent mode: sets --json, --silent, and --budget 4000 (override with --budget N)')
    .action(async (query: string, options) => {
      // --agent sets sensible defaults for AI agents; explicit flags override
      if (options.agent) {
        if (!options.json) options.json = true;
        if (!options.silent) options.silent = true;
        if (options.budget === undefined) options.budget = 4000;
      }

      const isJson = options.json;
      const isSilent = options.silent;
      // --top overrides --count when both are provided
      const count = parseInt(options.top ?? options.count) || 5;

      // Check usage quota
      const usageCheck = await checkUsage();
      if (!usageCheck.allowed) {
        console.error(usageCheck.message);
        process.exit(1);
      }

      // ── --site: site-specific structured search ───────────────────────────
      if (options.site) {
        const spinner = isSilent ? null : ora(`Searching ${options.site}...`).start();
        try {
          const { buildSiteSearchUrl } = await import('../../core/site-search.js');
          const siteResult = buildSiteSearchUrl(options.site, query);

          // Fetch the raw HTML (needed for listing extraction)
          const htmlResult = await peel(siteResult.url, {
            format: 'html',
            timeout: 30000,
            proxy: options.proxy as string | undefined,
          });

          if (spinner) {
            spinner.succeed(`Fetched ${siteResult.site} in ${htmlResult.elapsed}ms`);
          }

          // Extract listings from the HTML
          const { extractListings } = await import('../../core/extract-listings.js');
          let listings = extractListings(htmlResult.content, siteResult.url);

          // Apply budget if requested
          if (options.budget && options.budget > 0 && listings.length > 0) {
            const { budgetListings } = await import('../../core/budget.js');
            const { maxItems } = budgetListings(listings.length, options.budget);
            listings = listings.slice(0, maxItems);
          }

          // Show usage footer
          if (usageCheck.usageInfo && !isSilent) {
            showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, false);
          }

          // Output
          if (options.csv) {
            const rows = listings.map(item => {
              const row: Record<string, string | undefined> = {};
              for (const [k, v] of Object.entries(item)) {
                if (v !== undefined) row[k] = v;
              }
              return row;
            });
            await writeStdout(formatListingsCsv(rows));
          } else if (options.table) {
            const { formatTable } = await import('../../core/table-format.js');
            const rows = listings.map(item => {
              const row: Record<string, string | undefined> = {};
              for (const [k, v] of Object.entries(item)) {
                if (v !== undefined) row[k] = v;
              }
              return row;
            });
            await writeStdout(formatTable(rows) + '\n');
          } else if (isJson) {
            const envelope = {
              site: siteResult.site,
              query: siteResult.query,
              url: siteResult.url,
              count: listings.length,
              items: listings,
              elapsed: htmlResult.elapsed,
            };
            await writeStdout(JSON.stringify(envelope, null, 2) + '\n');
          } else {
            if (listings.length === 0) {
              await writeStdout('No listings found.\n');
            } else {
              await writeStdout(`Found ${listings.length} listings on ${siteResult.site}:\n\n`);
              for (const [i, item] of listings.entries()) {
                const pricePart = item.price ? ` — ${item.price}` : '';
                process.stdout.write(`${i + 1}. ${item.title}${pricePart}\n`);
                if (item.link) process.stdout.write(`   ${item.link}\n`);
                process.stdout.write('\n');
              }
            }
          }

          await cleanup();
          process.exit(0);
        } catch (error) {
          if (spinner) spinner.fail('Site search failed');
          if (error instanceof Error) {
            console.error(`\nError: ${error.message}`);
          } else {
            console.error('\nError: Unknown error occurred');
          }
          await cleanup();
          process.exit(1);
        }
      }

      const spinner = isSilent ? null : ora('Searching...').start();

      try {
        // Route search through the WebPeel API when a key is configured
        const searchCfg = loadConfig();
        const searchApiKey = searchCfg.apiKey || process.env.WEBPEEL_API_KEY;
        const searchApiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';

        if (!searchApiKey) {
          if (spinner) spinner.fail('Authentication required');
          console.error('No API key configured. Run: webpeel auth <your-key>');
          console.error('Get a free key at: https://app.webpeel.dev/keys');
          process.exit(2);
        }

        const searchParams = new URLSearchParams({ q: query });
        searchParams.set('limit', String(Math.min(Math.max(count, 1), 10)));
        if (options.budget) searchParams.set('budget', String(options.budget));

        const searchRes = await fetch(`${searchApiUrl}/v1/search?${searchParams}`, {
          headers: { Authorization: `Bearer ${searchApiKey}` },
          signal: AbortSignal.timeout(30000),
        });

        if (searchRes.status === 401) {
          if (spinner) spinner.fail('Authentication failed');
          console.error('API key invalid or expired. Run: webpeel auth <new-key>');
          process.exit(1);
        }
        if (searchRes.status === 429) {
          if (spinner) spinner.fail('Rate limited');
          console.error('Rate limit exceeded. Check your plan at https://app.webpeel.dev/billing');
          process.exit(1);
        }
        if (!searchRes.ok) {
          const body = await searchRes.text().catch(() => '');
          throw new Error(`Search API error ${searchRes.status}: ${body.slice(0, 200)}`);
        }

        const searchData = await searchRes.json() as any;
        // API returns { success: true, data: { web: [...] } } or { results: [...] }
        let results: Array<{ title: string; url: string; snippet: string; content?: string }> =
          searchData.data?.web || searchData.data?.results || searchData.results || [];

        // Client-side ad filtering: remove DuckDuckGo ads that slip through the server
        results = results.filter(r => {
          // Filter DDG-internal URLs
          try {
            const parsed = new URL(r.url);
            if (parsed.hostname === 'duckduckgo.com') return false;
            if (
              parsed.searchParams.has('ad_domain') ||
              parsed.searchParams.has('ad_provider') ||
              parsed.searchParams.has('ad_type')
            ) return false;
          } catch { return false; }
          // Filter ad snippets
          if (r.snippet && (
            r.snippet.includes('Ad ·') ||
            r.snippet.includes('Ad Viewing ads is privacy protected by DuckDuckGo') ||
            r.snippet.toLowerCase().startsWith('ad ·')
          )) return false;
          return true;
        });

        if (spinner) {
          spinner.succeed(`Found ${results.length} results`);
        }

        // --fetch: fetch content from each result
        if (options.fetch && results.length > 0) {
          const fetchCfg = loadConfig();
          const fetchApiKey = fetchCfg.apiKey || process.env.WEBPEEL_API_KEY;
          const fetchApiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';

          if (fetchApiKey) {
            const fetchSpinner = isSilent ? null : ora(`Fetching content from ${results.length} results...`).start();
            await Promise.all(results.map(async (result) => {
              try {
                const fetchParams = new URLSearchParams({ url: result.url });
                if (options.budget) fetchParams.set('budget', String(options.budget || 2000));
                const fetchRes = await fetch(`${fetchApiUrl}/v1/fetch?${fetchParams}`, {
                  headers: { Authorization: `Bearer ${fetchApiKey}` },
                  signal: AbortSignal.timeout(20000),
                });
                if (fetchRes.ok) {
                  const fetchData = await fetchRes.json() as any;
                  result.content = fetchData.content || fetchData.data?.content || '';
                }
              } catch { /* skip on error */ }
            }));
            if (fetchSpinner) fetchSpinner.succeed('Content fetched');
          } else if (!isSilent) {
            console.error('Warning: --fetch requires API key (run: webpeel auth <key>)');
          }
        }

        // Show usage footer for free/anonymous users
        if (usageCheck.usageInfo && !isSilent) {
          showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, false);
        }

        if (options.urlsOnly) {
          // Pipe-friendly: one URL per line
          for (const result of results) {
            await writeStdout(result.url + '\n');
          }
        } else if (isJson) {
          const jsonStr = JSON.stringify({ query, results, count: results.length }, null, 2);
          await writeStdout(jsonStr + '\n');
        } else {
          // Human-readable numbered results
          if (results.length === 0) {
            await writeStdout('No results found.\n');
          } else {
            await writeStdout(`\n`);
            for (const [i, result] of results.entries()) {
              await writeStdout(`${i + 1}. ${result.title}\n`);
              await writeStdout(`   ${result.url}\n`);
              if (result.snippet) {
                await writeStdout(`   ${result.snippet}\n`);
              }
              if (result.content) {
                const preview = result.content.slice(0, 500);
                await writeStdout(`\n   --- Content ---\n${preview}${result.content.length > 500 ? '\n   [...]' : ''}\n`);
              }
              await writeStdout('\n');
            }
          }
        }

        process.exit(0);
      } catch (error) {
        if (spinner) {
          spinner.fail('Search failed');
        }

        if (error instanceof Error) {
          console.error(`\nError: ${error.message}`);

          const msg = error.message.toLowerCase();
          if (msg.includes('brave') && msg.includes('api key')) {
            console.error('\n💡 Hint: Set your Brave API key: webpeel config set braveApiKey YOUR_KEY');
            console.error('   Or use free DuckDuckGo search (default, no key needed).');
          } else if (msg.includes('timeout') || msg.includes('timed out')) {
            console.error('\n💡 Hint: Search timed out. Try a more specific query or try again.');
          }
        } else {
          console.error('\nError: Unknown error occurred');
        }

        process.exit(1);
      }
    });

  // ── sites command — list all supported site templates ────────────────────
  program
    .command('sites')
    .description('List all sites supported by "webpeel search --site <site>"')
    .option('--json', 'Output as JSON')
    .option('--category <cat>', 'Filter by category (shopping, social, tech, jobs, general, real-estate, food)')
    .action(async (options) => {
      const { listSites } = await import('../../core/site-search.js');
      let sites = listSites();

      if (options.category) {
        sites = sites.filter(s => s.category === options.category);
      }

      if (options.json) {
        await writeStdout(JSON.stringify(sites, null, 2) + '\n');
        process.exit(0);
      }

      // Group by category for pretty output
      const byCategory = new Map<string, typeof sites>();
      for (const site of sites) {
        if (!byCategory.has(site.category)) byCategory.set(site.category, []);
        byCategory.get(site.category)!.push(site);
      }

      const categoryOrder = ['shopping', 'general', 'social', 'tech', 'jobs', 'real-estate', 'food'];
      const sortedCategories = categoryOrder.filter(c => byCategory.has(c));

      console.log('\nWebPeel Site-Aware Search — supported sites\n');
      console.log('Usage: webpeel search --site <id> "<query>"\n');

      for (const cat of sortedCategories) {
        const catSites = byCategory.get(cat)!;
        const label = cat.charAt(0).toUpperCase() + cat.slice(1);
        console.log(`  ${label}:`);
        for (const s of catSites) {
          console.log(`    ${s.id.padEnd(16)} ${s.name}`);
        }
        console.log('');
      }

      process.exit(0);
    });

  // ── batch command ─────────────────────────────────────────────────────────
  program
    .command('batch [file]')
    .description('Fetch multiple URLs from file or stdin pipe')
    .option('-c, --concurrency <n>', 'Max concurrent fetches (default: 3)', '3')
    .option('-o, --output <dir>', 'Output directory (one file per URL)')
    .option('--json', 'Output as JSON array')
    .option('-s, --silent', 'Silent mode')
    .option('-r, --render', 'Use headless browser')
    .option('--selector <css>', 'CSS selector to extract')
    .action(async (file: string | undefined, options) => {
      const isJson = options.json;
      const isSilent = options.silent;
      const shouldRender = options.render;
      const selector = options.selector;

      // Check usage quota
      const usageCheck = await checkUsage();
      if (!usageCheck.allowed) {
        console.error(usageCheck.message);
        process.exit(1);
      }

      const spinner = isSilent ? null : ora('Loading URLs...').start();

      try {
        // Read URLs from file or stdin
        let urls: string[];
        if (file) {
          // Read from file
          try {
            const content = readFileSync(file, 'utf-8');
            urls = content.split('\n')
              .map(line => line.trim())
              .filter(line => line && !line.startsWith('#'));
          } catch (error) {
            throw new Error(`Failed to read file: ${file}`);
          }
        } else if (!process.stdin.isTTY) {
          // Read from stdin pipe
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          const content = Buffer.concat(chunks).toString('utf-8');
          urls = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        } else {
          throw new Error('Provide a file path or pipe URLs via stdin.\n  Example: cat urls.txt | webpeel batch');
        }

        if (urls.length === 0) {
          throw new Error('No URLs found in file');
        }

        if (spinner) {
          spinner.text = `Fetching ${urls.length} URLs (concurrency: ${options.concurrency})...`;
        }

        // Batch fetch
        const results = await peelBatch(urls, {
          concurrency: parseInt(options.concurrency) || 3,
          render: shouldRender,
          selector: selector,
        });

        if (spinner) {
          const successCount = results.filter(r => 'content' in r).length;
          spinner.succeed(`Completed: ${successCount}/${urls.length} successful`);
        }

        // Show usage footer for free/anonymous users
        if (usageCheck.usageInfo && !isSilent) {
          showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, false);
        }

        // Output results
        if (isJson) {
          const jsonStr = JSON.stringify(results, null, 2);
          await new Promise<void>((resolve, reject) => {
            process.stdout.write(jsonStr + '\n', (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } else if (options.output) {
          const { writeFileSync, mkdirSync } = await import('fs');
          const { join } = await import('path');

          // Create output directory
          mkdirSync(options.output, { recursive: true });

          results.forEach((result, i) => {
            const urlObj = new URL(urls[i]);
            const filename = `${i + 1}_${urlObj.hostname.replace(/[^a-z0-9]/gi, '_')}.md`;
            const filepath = join(options.output, filename);

            if ('content' in result) {
              writeFileSync(filepath, result.content);
            } else {
              writeFileSync(filepath, `Error: ${result.error}`);
            }
          });

          if (!isSilent) {
            console.log(`\nResults saved to: ${options.output}`);
          }
        } else {
          // Print results to stdout
          results.forEach((result, i) => {
            console.log(`\n=== ${urls[i]} ===\n`);
            if ('content' in result) {
              console.log(result.content.slice(0, 500) + '...');
            } else {
              console.log(`Error: ${result.error}`);
            }
          });
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) {
          spinner.fail('Batch fetch failed');
        }

        if (error instanceof Error) {
          console.error(`\nError: ${error.message}`);
        } else {
          console.error('\nError: Unknown error occurred');
        }

        await cleanup();
        process.exit(1);
      }
    });

  // ── crawl command ─────────────────────────────────────────────────────────
  program
    .command('crawl <url>')
    .description('Crawl a website starting from a URL')
    .option('--max-pages <number>', 'Maximum number of pages to crawl (default: 10, max: 100)', (v: string) => parseInt(v, 10), 10)
    .option('--max-depth <number>', 'Maximum depth to crawl (default: 2, max: 5)', (v: string) => parseInt(v, 10), 2)
    .option('--allowed-domains <domains...>', 'Only crawl these domains (default: same as starting URL)')
    .option('--exclude <patterns...>', 'Exclude URLs matching these regex patterns')
    .option('--ignore-robots', 'Ignore robots.txt (default: respect robots.txt)')
    .option('--rate-limit <ms>', 'Rate limit between requests in ms (default: 500)', (v: string) => parseInt(v, 10), 500)
    .option('-r, --render', 'Use headless browser for all pages')
    .option('--stealth', 'Use stealth mode for all pages')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--json', 'Output as JSON')
    .option('--resume', 'Resume an interrupted crawl from its last checkpoint')
    .action(async (url: string, options) => {
      // Check usage quota
      const usageCheck = await checkUsage();
      if (!usageCheck.allowed) {
        console.error(usageCheck.message);
        process.exit(1);
      }

      const { crawl } = await import('../../core/crawler.js');

      const spinner = options.silent ? null : ora('Crawling...').start();

      try {
        const results = await crawl(url, {
          maxPages: options.maxPages,
          maxDepth: options.maxDepth,
          allowedDomains: options.allowedDomains,
          excludePatterns: options.exclude,
          respectRobotsTxt: !options.ignoreRobots,
          rateLimitMs: options.rateLimit,
          render: options.render || false,
          stealth: options.stealth || false,
          resume: options.resume || false,
        });

        if (spinner) {
          spinner.succeed(`Crawled ${results.length} pages`);
        }

        // Show usage footer for free/anonymous users
        if (usageCheck.usageInfo && !options.silent) {
          showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, options.stealth || false);
        }

        if (options.json) {
          const totalTokens = results.reduce((sum, r) => sum + (r.tokens ?? 0), 0);
          const pages = results.map(r => ({
            url: r.url,
            title: r.title,
            tokens: r.tokens ?? 0,
            content: r.markdown,
            depth: r.depth,
            parent: r.parent,
            links: r.links,
            elapsed: r.elapsed,
            ...(r.error ? { error: r.error } : {}),
            ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}),
          }));
          console.log(JSON.stringify({ pages, totalPages: results.length, totalTokens }, null, 2));
        } else {
          results.forEach((result, i) => {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`[${i + 1}/${results.length}] ${result.title}`);
            console.log(`URL: ${result.url}`);
            console.log(`Depth: ${result.depth}${result.parent ? ` (from: ${result.parent})` : ''}`);
            console.log(`Links found: ${result.links.length}`);
            console.log(`Elapsed: ${result.elapsed}ms`);

            if (result.error) {
              console.log(`ERROR: ${result.error}`);
            } else {
              console.log(`\n${result.markdown.slice(0, 500)}${result.markdown.length > 500 ? '...' : ''}`);
            }
          });
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) {
          spinner.fail('Crawl failed');
        }

        if (error instanceof Error) {
          console.error(`\nError: ${error.message}`);
        } else {
          console.error('\nError: Unknown error occurred');
        }

        await cleanup();
        process.exit(1);
      }
    });

  // ── map command ───────────────────────────────────────────────────────────
  program
    .command('map <url>')
    .description('Discover all URLs on a domain (sitemap + crawl)')
    .option('--no-sitemap', 'Skip sitemap.xml discovery')
    .option('--no-crawl', 'Skip homepage crawl')
    .option('--max <n>', 'Maximum URLs to discover (default: 5000)', (v: string) => parseInt(v, 10), 5000)
    .option('--include <patterns...>', 'Include only URLs matching these regex patterns')
    .option('--exclude <patterns...>', 'Exclude URLs matching these regex patterns')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .action(async (url, options) => {
      const { mapDomain } = await import('../../core/map.js');
      const spinner = options.silent ? null : ora('Discovering URLs...').start();

      try {
        const result = await mapDomain(url, {
          useSitemap: options.sitemap !== false,
          crawlHomepage: options.crawl !== false,
          maxUrls: options.max,
          includePatterns: options.include,
          excludePatterns: options.exclude,
        });

        if (spinner) spinner.succeed(`Found ${result.total} URLs in ${result.elapsed}ms`);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          for (const u of result.urls) {
            console.log(u);
          }
          if (!options.silent) {
            console.error(`\nTotal: ${result.total} URLs`);
            if (result.sitemapUrls.length > 0) {
              console.error(`Sitemaps used: ${result.sitemapUrls.join(', ')}`);
            }
          }
        }
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('URL discovery failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // ── flights command ───────────────────────────────────────────────────────
  program
    .command('flights <query>')
    .description('Search for flights (via Google Flights) — e.g. "NYC to Fort Myers Apr 4"')
    .option('--one-way', 'One-way flight (default)')
    .option('--round-trip', 'Round-trip flight')
    .option('-n, --count <n>', 'Max flights to show', '10')
    .option('--dates <range>', 'Compare prices across date range (e.g., "Mar29-Apr4")')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .action(async (query: string, options) => {
      // ── --dates: compare cheapest flight across a date range ──────────────
      if (options.dates) {
        const dates = parseDateRange(options.dates);
        if (dates.length === 0) {
          console.error('Could not parse date range. Format: "Mar29-Apr4"');
          process.exit(1);
        }

        const spinner = options.silent ? null : ora(`Comparing flights across ${dates.length} dates...`).start();
        const tripType = options.roundTrip ? '' : ' one way';

        interface FlightEntry {
          date: string;
          price: string | null;
          airline: string | null;
          time: string | null;
          priceNum: number;
        }
        const rows: FlightEntry[] = [];

        for (const date of dates) {
          if (spinner) spinner.text = `Fetching flights for ${date}...`;
          try {
            const dateQuery = `Flights from ${query} ${date}${tripType}`;
            const encoded = encodeURIComponent(dateQuery);
            const url = `https://www.google.com/travel/flights?q=${encoded}`;
            const result = await peel(url, { render: true, timeout: 30000 });

            // Try to extract cheapest flight from structured data or content
            let price: string | null = null;
            let airline: string | null = null;
            let time: string | null = null;

            const flights = (result as any).domainData?.structured?.flights || [];
            if (flights.length > 0) {
              const cheapest = flights.reduce((a: any, b: any) => {
                const ap = parseFloat(String(a.price || '').replace(/[^0-9.]/g, '')) || Infinity;
                const bp = parseFloat(String(b.price || '').replace(/[^0-9.]/g, '')) || Infinity;
                return ap <= bp ? a : b;
              });
              price = cheapest.priceStr || (cheapest.price ? `$${cheapest.price}` : null);
              airline = cheapest.airline || cheapest.carrier || null;
              time = cheapest.departTime && cheapest.arriveTime 
                ? `${cheapest.departTime} → ${cheapest.arriveTime}` 
                : (cheapest.time || cheapest.departure || null);
            } else {
              // Extract from markdown content — look for price patterns
              const priceMatch = result.content.match(/\$(\d+)/);
              if (priceMatch) price = `$${priceMatch[1]}`;
              const airlineMatch = result.content.match(/\b(American|Delta|United|Southwest|Spirit|JetBlue|Alaska|Frontier|Allegiant|Sun Country)\b/i);
              if (airlineMatch) airline = airlineMatch[1];
              const timeMatch = result.content.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[–—→]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
              if (timeMatch) time = `${timeMatch[1]} → ${timeMatch[2]}`;
            }

            const priceNum = price ? parseFloat(price.replace(/[^0-9.]/g, '')) || Infinity : Infinity;
            rows.push({ date, price, airline, time, priceNum });
          } catch {
            rows.push({ date, price: null, airline: null, time: null, priceNum: Infinity });
          }
        }

        if (spinner) spinner.succeed(`Compared ${rows.length} dates`);

        if (options.json) {
          console.log(JSON.stringify({ query, dateRange: options.dates, rows }, null, 2));
        } else {
          // Find best price
          const best = rows.reduce((a, b) => a.priceNum <= b.priceNum ? a : b);

          console.log(`\n# ✈️ Flight Price Comparison — ${query}\n`);
          console.log('| Date | Airline | Time | Price |');
          console.log('|------|---------|------|-------|');
          for (const row of rows) {
            const star = row.priceNum === best.priceNum ? ' ⭐' : '';
            const priceStr = row.price ? `${row.price}${star}` : 'N/A';
            const airlineStr = row.airline || 'Unknown';
            const timeStr = row.time || '—';
            console.log(`| ${row.date} | ${airlineStr} | ${timeStr} | ${priceStr} |`);
          }
          if (best.price) {
            console.log(`\n⭐ Best price: ${best.date} — ${best.airline || 'Unknown'} ${best.price}`);
          }
        }

        await cleanup();
        process.exit(0);
      }

      // ── Single date (default) ─────────────────────────────────────────────
      const tripType = options.roundTrip ? '' : ' one way';
      const encoded = encodeURIComponent(`Flights from ${query}${tripType}`);
      const url = `https://www.google.com/travel/flights?q=${encoded}`;

      const spinner = options.silent ? null : ora(`Searching flights: ${query}...`).start();

      try {
        // render is forced automatically by SPA auto-detect, but be explicit here
        const result = await peel(url, { render: true, timeout: 30000 });

        if (spinner) spinner.succeed('Flights loaded');

        if (options.json) {
          console.log(JSON.stringify({
            query,
            url,
            flights: (result as any).domainData?.structured?.flights || [],
            source: 'Google Flights',
            content: result.content,
            tokens: result.tokens,
          }, null, 2));
        } else {
          console.log(result.content);
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Flight search failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });



  // ── rental command ────────────────────────────────────────────────────────
  program
    .command('rental <query>')
    .alias('car-rental')
    .description('Search for car rentals via Kayak — e.g. "Punta Gorda FL Apr 1-3"')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .action(async (query: string, options) => {
      // Parse location: strip date portion from query
      const location = query.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d+.*/i, '').trim();
      const encodedLocation = encodeURIComponent(location.replace(/\s+/g, '-'));

      // Parse dates: try "Apr 1-3" or "Apr 1 to Apr 3" patterns
      const year = new Date().getFullYear();
      let pickupDate = `${year}-04-01`;
      let returnDate = `${year}-04-03`;

      const rangeMatch = query.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d+)\s*[-–to]+\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+)?(\d+)/i);
      if (rangeMatch) {
        const months: Record<string, string> = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        };
        const startMonth = months[rangeMatch[1].toLowerCase().slice(0, 3)];
        const startDay = rangeMatch[2].padStart(2, '0');
        const endMonth = rangeMatch[3] ? months[rangeMatch[3].toLowerCase().slice(0, 3)] : startMonth;
        const endDay = rangeMatch[4].padStart(2, '0');
        pickupDate = `${year}-${startMonth}-${startDay}`;
        returnDate = `${year}-${endMonth}-${endDay}`;
      }

      const searchUrl = `https://www.kayak.com/cars/${encodedLocation}/${pickupDate}/${returnDate}?sort=price_a`;

      const spinner = options.silent ? null : (await import('ora')).default(`Searching car rentals: ${query}...`).start();

      try {
        const result = await peel(searchUrl, { render: true, timeout: 40000 });

        if (spinner) spinner.succeed('Car rentals loaded');

        if (options.json) {
          console.log(JSON.stringify({
            query,
            location,
            pickupDate,
            returnDate,
            url: searchUrl,
            content: result.content,
            tokens: result.tokens,
          }, null, 2));
        } else {
          console.log(result.content);
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Car rental search failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });

  // ── cars command ──────────────────────────────────────────────────────────
  program
    .command('cars <query>')
    .description('Search for cars to buy via Cars.com — e.g. "Honda Civic"')
    .option('--zip <zip>', 'ZIP code for local search', '10001')
    .option('--distance <miles>', 'Max distance in miles', '30')
    .option('--max-price <price>', 'Maximum listing price')
    .option('--min-price <price>', 'Minimum listing price')
    .option('--json', 'Output as JSON')
    .option('-s, --silent', 'Silent mode')
    .action(async (query: string, options) => {
      const zip = options.zip || '10001';
      const distance = options.distance || '30';
      const maxPrice = options.maxPrice || '';
      const minPrice = options.minPrice || '';

      const params = new URLSearchParams({
        keyword: query,
        sort: 'list_price',
        stock_type: 'all',
        zip,
        maximum_distance: distance,
      });
      if (maxPrice) params.set('list_price_max', maxPrice);
      if (minPrice) params.set('list_price_min', minPrice);

      const url = `https://www.cars.com/shopping/results/?${params.toString()}`;

      const spinner = options.silent ? null : (await import('ora')).default(`Searching cars: ${query}...`).start();

      try {
        const result = await peel(url, { timeout: 25000 });

        if (spinner) spinner.succeed('Cars loaded');

        if (options.json) {
          console.log(JSON.stringify({
            query,
            zip,
            distance,
            maxPrice,
            url,
            content: result.content,
            tokens: result.tokens,
          }, null, 2));
        } else {
          console.log(result.content);
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Car search failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });

  // ── extractors command ────────────────────────────────────────────────────
  program
    .command('extractors')
    .alias('list-extractors')
    .description('List all supported domain extractors')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const extractors = [
        // Social
        { domain: 'twitter.com / x.com',      category: 'Social',    description: 'Tweets, threads, profiles' },
        { domain: 'reddit.com',                category: 'Social',    description: 'Subreddits, posts, comments' },
        { domain: 'instagram.com',             category: 'Social',    description: 'Photos, reels, profiles' },
        { domain: 'tiktok.com',                category: 'Social',    description: 'Video metadata, captions' },
        { domain: 'pinterest.com',             category: 'Social',    description: 'Pins, boards' },
        { domain: 'linkedin.com',              category: 'Social',    description: 'Profiles, job listings' },
        { domain: 'facebook.com',              category: 'Social',    description: 'Marketplace listings' },
        // Video / Audio
        { domain: 'youtube.com',               category: 'Video',     description: 'Transcripts, metadata, comments' },
        { domain: 'twitch.tv',                 category: 'Video',     description: 'Streams, clips, channel info' },
        { domain: 'soundcloud.com',            category: 'Audio',     description: 'Tracks, playlists' },
        { domain: 'open.spotify.com',          category: 'Audio',     description: 'Tracks, albums, playlists' },
        // Tech / Dev
        { domain: 'github.com',                category: 'Dev',       description: 'Repos, issues, PRs, code' },
        { domain: 'stackoverflow.com',         category: 'Dev',       description: 'Questions, answers' },
        { domain: 'npmjs.com',                 category: 'Dev',       description: 'Package metadata, readme' },
        { domain: 'pypi.org',                  category: 'Dev',       description: 'Package metadata, readme' },
        { domain: 'dev.to',                    category: 'Dev',       description: 'Articles, comments' },
        // News / Articles
        { domain: 'news.ycombinator.com',      category: 'News',      description: 'HN posts, comments, Ask/Show HN' },
        { domain: 'medium.com',                category: 'Articles',  description: 'Articles, publications' },
        { domain: 'substack.com / *.substack.com', category: 'Articles', description: 'Newsletters, posts' },
        { domain: 'nytimes.com',               category: 'News',      description: 'Articles, headlines' },
        { domain: 'bbc.com',                   category: 'News',      description: 'Articles, headlines' },
        { domain: 'cnn.com',                   category: 'News',      description: 'Articles, headlines' },
        // Shopping / E-commerce
        { domain: 'amazon.com',                category: 'Shopping',  description: 'Products, prices, reviews' },
        { domain: 'bestbuy.com',               category: 'Shopping',  description: 'Products, prices, specs' },
        { domain: 'walmart.com',               category: 'Shopping',  description: 'Products, prices' },
        { domain: 'ebay.com',                  category: 'Shopping',  description: 'Listings, prices' },
        { domain: 'etsy.com',                  category: 'Shopping',  description: 'Handmade listings' },
        // Local / Real Estate
        { domain: 'yelp.com',                  category: 'Local',     description: 'Business info, reviews (needs YELP_API_KEY)' },
        { domain: 'craigslist.org',            category: 'Local',     description: 'Listings, classifieds' },
        { domain: 'zillow.com',                category: 'Real Estate', description: 'Property listings, estimates' },
        { domain: 'redfin.com',                category: 'Real Estate', description: 'Property listings, prices' },
        { domain: 'cars.com',                  category: 'Automotive', description: 'Car listings, prices' },
        // Knowledge / Academic
        { domain: 'en.wikipedia.org',          category: 'Knowledge', description: 'Articles, structured data' },
        { domain: 'arxiv.org',                 category: 'Academic',  description: 'Papers, abstracts, metadata' },
        { domain: 'semanticscholar.org',       category: 'Academic',  description: 'Papers, citations' },
        { domain: 'pubmed.ncbi.nlm.nih.gov',   category: 'Academic',  description: 'Medical papers, abstracts' },
        { domain: 'imdb.com',                  category: 'Knowledge', description: 'Movies, TV shows, cast' },
        { domain: 'allrecipes.com',            category: 'Knowledge', description: 'Recipes, ingredients, steps' },
        // Finance / Markets
        { domain: 'polymarket.com',            category: 'Finance',   description: 'Prediction markets' },
        { domain: 'kalshi.com',                category: 'Finance',   description: 'Prediction markets' },
        { domain: 'tradingview.com',           category: 'Finance',   description: 'Charts, indicators, ideas' },
        { domain: 'coingecko.com',             category: 'Finance',   description: 'Crypto prices, market data' },
        { domain: 'coinmarketcap.com',         category: 'Finance',   description: 'Crypto prices, market data' },
        // Sports / Betting
        { domain: 'espn.com',                  category: 'Sports',    description: 'Scores, stats, news' },
        { domain: 'draftkings.com',            category: 'Betting',   description: 'Odds, lines' },
        { domain: 'fanduel.com',               category: 'Betting',   description: 'Odds, lines' },
        { domain: 'betmgm.com',                category: 'Betting',   description: 'Odds, lines' },
        // Entertainment
        { domain: 'producthunt.com',           category: 'Tech',      description: 'Product launches, upvotes' },
        // Documents
        { domain: '*.pdf URLs',                category: 'Documents', description: 'PDF text extraction' },
        // Weather
        { domain: 'weather.com',               category: 'Weather',   description: 'Forecasts, conditions' },
        { domain: 'accuweather.com',           category: 'Weather',   description: 'Forecasts, conditions' },
        { domain: 'api.open-meteo.com',        category: 'Weather',   description: 'Free weather API' },
      ];

      if (options.json) {
        console.log(JSON.stringify(extractors, null, 2));
        return;
      }

      // Group by category
      const byCategory = new Map<string, typeof extractors>();
      for (const e of extractors) {
        if (!byCategory.has(e.category)) byCategory.set(e.category, []);
        byCategory.get(e.category)!.push(e);
      }

      console.log(`\n🔌 WebPeel Domain Extractors (${extractors.length} total)\n`);
      for (const [cat, items] of byCategory) {
        console.log(`  ${cat}`);
        for (const item of items) {
          const pad = 35;
          const domainPad = item.domain.padEnd(pad);
          console.log(`    ${domainPad} ${item.description}`);
        }
        console.log('');
      }
      console.log('  Run `webpeel <url>` to use these automatically based on the URL.');
    });
}
