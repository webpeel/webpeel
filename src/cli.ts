#!/usr/bin/env node

/**
 * WebPeel CLI
 * 
 * Usage:
 *   npx webpeel <url>                  - Fetch and convert to markdown
 *   npx webpeel <url> --json           - Output as JSON
 *   npx webpeel <url> --html           - Output raw HTML
 *   npx webpeel <url> --render         - Force browser mode
 *   npx webpeel <url> --wait 5000      - Wait 5s for JS to load
 *   npx webpeel search "query"         - DuckDuckGo search
 *   npx webpeel serve                  - Start API server (future)
 *   npx webpeel mcp                    - Start MCP server (future)
 */

import { Command } from 'commander';
import ora from 'ora';
import { writeFileSync, readFileSync } from 'fs';
import { peel, peelBatch, cleanup } from './index.js';
import type { PeelOptions, PeelResult } from './types.js';
import { checkUsage, checkFeatureAccess, showUsageFooter, handleLogin, handleLogout, handleUsage, loadConfig } from './cli-auth.js';
import { getCache, setCache, parseTTL, clearCache, cacheStats } from './cache.js';

const program = new Command();

program
  .name('webpeel')
  .description('Fast web fetcher for AI agents')
  .version('0.3.1')
  .enablePositionalOptions();

program
  .argument('[url]', 'URL to fetch')
  .option('-r, --render', 'Use headless browser (for JS-heavy sites)')
  .option('--stealth', 'Use stealth mode to bypass bot detection (auto-enables --render)')
  .option('-w, --wait <ms>', 'Wait time after page load (ms)', parseInt)
  .option('--html', 'Output raw HTML instead of markdown')
  .option('--text', 'Output plain text instead of markdown')
  .option('--json', 'Output as JSON')
  .option('-t, --timeout <ms>', 'Request timeout (ms)', parseInt, 30000)
  .option('--ua <agent>', 'Custom user agent')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--screenshot [path]', 'Take a screenshot (optionally save to file path)')
  .option('--full-page', 'Full-page screenshot (use with --screenshot)')
  .option('--selector <css>', 'CSS selector to extract (e.g., "article", ".content")')
  .option('--exclude <selectors...>', 'CSS selectors to exclude (e.g., ".sidebar" ".ads")')
  .option('-H, --header <header...>', 'Custom headers (e.g., "Authorization: Bearer token")')
  .option('--cookie <cookie...>', 'Cookies to set (e.g., "session=abc123")')
  .option('--cache <ttl>', 'Cache results locally (e.g., "5m", "1h", "1d")')
  .option('--links', 'Output only the links found on the page')
  .option('--meta', 'Output only the page metadata (title, description, author, etc.)')
  .option('--raw', 'Return full page without smart content extraction')
  .action(async (url: string | undefined, options) => {
    if (!url) {
      console.error('Error: URL is required\n');
      program.help();
      process.exit(1);
    }

    // SECURITY: Enhanced URL validation
    if (url.length > 2048) {
      console.error('Error: URL too long (max 2048 characters)');
      process.exit(1);
    }

    // Check for control characters
    if (/[\x00-\x1F\x7F]/.test(url)) {
      console.error('Error: URL contains invalid control characters');
      process.exit(1);
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        console.error('Error: Only HTTP and HTTPS protocols are allowed');
        process.exit(1);
      }
    } catch {
      console.error(`Error: Invalid URL format: ${url}`);
      process.exit(1);
    }

    // Check premium feature access (stealth requires Pro plan)
    const useStealth = options.stealth || false;
    if (useStealth) {
      const featureCheck = await checkFeatureAccess('stealth');
      if (!featureCheck.allowed) {
        console.error(featureCheck.message);
        process.exit(1);
      }
    }

    // Check usage quota
    const usageCheck = await checkUsage();
    if (!usageCheck.allowed) {
      console.error(usageCheck.message);
      process.exit(1);
    }

    // Check cache first (before spinner/network)
    let cacheTtlMs: number | undefined;
    if (options.cache) {
      try {
        cacheTtlMs = parseTTL(options.cache);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }
      
      const cached = getCache(url, { render: options.render, stealth: options.stealth, selector: options.selector, format: options.html ? 'html' : options.text ? 'text' : 'markdown' });
      if (cached) {
        if (!options.silent) {
          console.error(`\x1b[36m⚡ Cache hit\x1b[0m (TTL: ${options.cache})`);
        }
        outputResult(cached, options);
        process.exit(0);
      }
    }

    const spinner = options.silent ? null : ora('Fetching...').start();

    try {
      // Validate options
      if (options.wait && (options.wait < 0 || options.wait > 60000)) {
        console.error('Error: Wait time must be between 0 and 60000ms');
        process.exit(1);
      }

      // Parse custom headers
      let headers: Record<string, string> | undefined;
      if (options.header && options.header.length > 0) {
        headers = {};
        for (const header of options.header) {
          const colonIndex = header.indexOf(':');
          if (colonIndex === -1) {
            console.error(`Error: Invalid header format: ${header}`);
            console.error('Expected format: "Key: Value"');
            process.exit(1);
          }
          const key = header.slice(0, colonIndex).trim();
          const value = header.slice(colonIndex + 1).trim();
          headers[key] = value;
        }
      }

      // Build peel options
      // --stealth auto-enables --render (stealth requires browser)
      const useRender = options.render || options.stealth || false;
      const peelOptions: PeelOptions = {
        render: useRender,
        stealth: options.stealth || false,
        wait: options.wait || 0,
        timeout: options.timeout,
        userAgent: options.ua,
        screenshot: options.screenshot !== undefined,
        screenshotFullPage: options.fullPage || false,
        selector: options.selector,
        exclude: options.exclude,
        headers,
        cookies: options.cookie,
        raw: options.raw || false,
      };

      // Determine format
      if (options.html) {
        peelOptions.format = 'html';
      } else if (options.text) {
        peelOptions.format = 'text';
      } else {
        peelOptions.format = 'markdown';
      }

      // Fetch the page
      const result = await peel(url, peelOptions);

      if (spinner) {
        spinner.succeed(`Fetched in ${result.elapsed}ms using ${result.method} method`);
      }

      // Show usage footer for free/anonymous users
      if (usageCheck.usageInfo && !options.silent) {
        showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, useStealth);
      }

      // Handle screenshot saving
      if (options.screenshot && result.screenshot) {
        const screenshotPath = typeof options.screenshot === 'string' 
          ? options.screenshot 
          : 'screenshot.png';
        
        const screenshotBuffer = Buffer.from(result.screenshot, 'base64');
        writeFileSync(screenshotPath, screenshotBuffer);
        
        if (!options.silent) {
          console.error(`Screenshot saved to: ${screenshotPath}`);
        }

        // Remove screenshot from JSON output if saving to file
        if (typeof options.screenshot === 'string') {
          delete result.screenshot;
        }
      }

      // Store in cache if caching is enabled
      if (cacheTtlMs) {
        setCache(url, result, cacheTtlMs, { render: options.render, stealth: useStealth, selector: options.selector, format: peelOptions.format });
      }

      // Output results
      await outputResult(result, options);

      // Clean up and exit
      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) {
        spinner.fail('Failed to fetch');
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

// Search command
program
  .command('search <query>')
  .description('Search using DuckDuckGo')
  .option('-n, --count <n>', 'Number of results (1-10)', '5')
  .option('--json', 'Output as JSON')
  .option('-s, --silent', 'Silent mode')
  .action(async (query: string, options) => {
    const isJson = options.json;
    const isSilent = options.silent;
    const count = parseInt(options.count) || 5;
    
    // Check usage quota
    const usageCheck = await checkUsage();
    if (!usageCheck.allowed) {
      console.error(usageCheck.message);
      process.exit(1);
    }
    
    const spinner = isSilent ? null : ora('Searching...').start();

    try {
      // Import the search function dynamically
      const { fetch: undiciFetch } = await import('undici');
      const { load } = await import('cheerio');

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      
      const response = await undiciFetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = load(html);

      const results: Array<{ title: string; url: string; snippet: string }> = [];

      $('.result').each((_i, elem) => {
        if (results.length >= count) return;

        const $result = $(elem);
        const title = $result.find('.result__title').text().trim();
        const rawUrl = $result.find('.result__a').attr('href') || '';
        const snippet = $result.find('.result__snippet').text().trim();

        if (!title || !rawUrl) return;
        
        // Extract actual URL from DuckDuckGo redirect
        let url = rawUrl;
        try {
          const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
          const uddg = ddgUrl.searchParams.get('uddg');
          if (uddg) {
            url = decodeURIComponent(uddg);
          }
        } catch {
          // Use raw URL if parsing fails
        }

        // Validate final URL
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return;
          }
          url = parsed.href;
        } catch {
          return;
        }

        results.push({ 
          title: title.slice(0, 200), 
          url, 
          snippet: snippet.slice(0, 500) 
        });
      });

      if (spinner) {
        spinner.succeed(`Found ${results.length} results`);
      }

      // Show usage footer for free/anonymous users
      if (usageCheck.usageInfo && !isSilent) {
        showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, false);
      }

      if (isJson) {
        const jsonStr = JSON.stringify(results, null, 2);
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(jsonStr + '\n', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        for (const result of results) {
          console.log(`\n${result.title}`);
          console.log(result.url);
          console.log(result.snippet);
        }
      }

      process.exit(0);
    } catch (error) {
      if (spinner) {
        spinner.fail('Search failed');
      }

      if (error instanceof Error) {
        console.error(`\nError: ${error.message}`);
      } else {
        console.error('\nError: Unknown error occurred');
      }

      process.exit(1);
    }
  });

// Batch command
program
  .command('batch [file]')
  .description('Fetch multiple URLs from file or stdin pipe (Pro feature)')
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
    
    // Check premium feature access (batch requires Pro plan)
    const featureCheck = await checkFeatureAccess('batch');
    if (!featureCheck.allowed) {
      console.error(featureCheck.message);
      process.exit(1);
    }

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

program
  .command('crawl <url>')
  .description('Crawl a website starting from a URL (Pro feature)')
  .option('--max-pages <number>', 'Maximum number of pages to crawl (default: 10, max: 100)', parseInt, 10)
  .option('--max-depth <number>', 'Maximum depth to crawl (default: 2, max: 5)', parseInt, 2)
  .option('--allowed-domains <domains...>', 'Only crawl these domains (default: same as starting URL)')
  .option('--exclude <patterns...>', 'Exclude URLs matching these regex patterns')
  .option('--ignore-robots', 'Ignore robots.txt (default: respect robots.txt)')
  .option('--rate-limit <ms>', 'Rate limit between requests in ms (default: 1000)', parseInt, 1000)
  .option('-r, --render', 'Use headless browser for all pages')
  .option('--stealth', 'Use stealth mode for all pages')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output as JSON')
  .action(async (url: string, options) => {
    // Check premium feature access (crawl requires Pro plan)
    const featureCheck = await checkFeatureAccess('crawl');
    if (!featureCheck.allowed) {
      console.error(featureCheck.message);
      process.exit(1);
    }

    // Check usage quota
    const usageCheck = await checkUsage();
    if (!usageCheck.allowed) {
      console.error(usageCheck.message);
      process.exit(1);
    }
    
    const { crawl } = await import('./core/crawler.js');
    
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
      });

      if (spinner) {
        spinner.succeed(`Crawled ${results.length} pages`);
      }

      // Show usage footer for free/anonymous users
      if (usageCheck.usageInfo && !options.silent) {
        showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, options.stealth || false);
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
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

program
  .command('login')
  .description('Authenticate the CLI with your API key')
  .action(async () => {
    try {
      await handleLogin();
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

program
  .command('whoami')
  .description('Show your current authentication status')
  .action(async () => {
    try {
      const { loadConfig } = await import('./cli-auth.js');
      const config = loadConfig();
      if (!config.apiKey) {
        console.log('Not logged in. Run `webpeel login` to authenticate.');
      } else {
        const masked = config.apiKey.slice(0, 7) + '...' + config.apiKey.slice(-4);
        console.log(`Logged in with API key: ${masked}`);
        if (config.planTier) {
          const tierLabel = config.planTier.charAt(0).toUpperCase() + config.planTier.slice(1);
          console.log(`Plan: ${tierLabel}`);
        }
        console.log(`Config: ~/.webpeel/config.json`);
      }
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Clear your saved credentials')
  .action(() => {
    try {
      handleLogout();
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

program
  .command('usage')
  .description('Show your current usage and quota')
  .action(async () => {
    try {
      await handleUsage();
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start API server')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(async (options) => {
    const { startServer } = await import('./server/app.js');
    startServer({ port: parseInt(options.port, 10) });
  });

program
  .command('mcp')
  .description('Start MCP server for Claude Desktop / Cursor')
  .action(async () => {
    await import('./mcp/server.js');
  });

// Config command
program
  .command('config')
  .description('View or update CLI configuration')
  .argument('[key]', 'Config key to get or set')
  .argument('[value]', 'Value to set')
  .action(async (key?: string, value?: string) => {
    const config = loadConfig();
    
    if (!key) {
      // Show all config
      console.log('WebPeel CLI Configuration');
      console.log(`  Config file: ~/.webpeel/config.json`);
      console.log('');
      console.log(`  apiKey:     ${config.apiKey ? config.apiKey.slice(0, 7) + '...' + config.apiKey.slice(-4) : '(not set)'}`);
      console.log(`  planTier:   ${config.planTier || 'free'}`);
      console.log(`  anonymousUsage: ${config.anonymousUsage}`);
      const stats = cacheStats();
      console.log('');
      console.log('  Cache:');
      console.log(`    entries:  ${stats.entries}`);
      console.log(`    size:     ${(stats.sizeBytes / 1024).toFixed(1)} KB`);
      console.log(`    dir:      ${stats.dir}`);
      process.exit(0);
    }

    if (key && !value) {
      // Get a specific key
      const val = (config as any)[key];
      if (val !== undefined) {
        console.log(key === 'apiKey' && val ? val.slice(0, 7) + '...' + val.slice(-4) : val);
      } else {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
    }
    // Note: Setting config values directly is not supported for security
    // Use `webpeel login` for API key, plan is fetched from server
    process.exit(0);
  });

// Cache management command
program
  .command('cache')
  .description('Manage the local response cache')
  .argument('<action>', '"stats", "clear", or "purge" (clear expired / clear all)')
  .action(async (action: string) => {
    switch (action) {
      case 'stats': {
        const stats = cacheStats();
        console.log(`Cache: ${stats.entries} entries, ${(stats.sizeBytes / 1024).toFixed(1)} KB`);
        console.log(`Location: ${stats.dir}`);
        break;
      }
      case 'clear': {
        const cleared = clearCache(false);
        console.log(`Cleared ${cleared} expired cache entries.`);
        break;
      }
      case 'purge': {
        const cleared = clearCache(true);
        console.log(`Purged all ${cleared} cache entries.`);
        break;
      }
      default:
        console.error('Unknown cache action. Use: stats, clear, or purge');
        process.exit(1);
    }
    process.exit(0);
  });

program.parse();

// ============================================================
// Shared output helper
// ============================================================

async function outputResult(result: PeelResult, options: any): Promise<void> {
  // --links: output only links
  if (options.links) {
    if (options.json) {
      const jsonStr = JSON.stringify(result.links, null, 2);
      await writeStdout(jsonStr + '\n');
    } else {
      for (const link of result.links) {
        await writeStdout(link + '\n');
      }
    }
    return;
  }

  // --meta: output only metadata
  if (options.meta) {
    const meta = {
      url: result.url,
      title: result.title,
      method: result.method,
      elapsed: result.elapsed,
      tokens: result.tokens,
      ...result.metadata,
    };
    if (options.json) {
      await writeStdout(JSON.stringify(meta, null, 2) + '\n');
    } else {
      console.log(`Title:       ${meta.title || '(none)'}`);
      console.log(`URL:         ${meta.url}`);
      if (meta.description) console.log(`Description: ${meta.description}`);
      if (meta.author) console.log(`Author:      ${meta.author}`);
      if (meta.published) console.log(`Published:   ${meta.published}`);
      if (meta.canonical) console.log(`Canonical:   ${meta.canonical}`);
      if (meta.image) console.log(`OG Image:    ${meta.image}`);
      console.log(`Method:      ${meta.method}`);
      console.log(`Elapsed:     ${meta.elapsed}ms`);
      console.log(`Tokens:      ${meta.tokens}`);
    }
    return;
  }

  // Default: full output
  if (options.json) {
    await writeStdout(JSON.stringify(result, null, 2) + '\n');
  } else {
    await writeStdout(result.content + '\n');
  }
}

function writeStdout(data: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
