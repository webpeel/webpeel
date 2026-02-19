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
import type { PeelOptions, PeelResult, PeelEnvelope, PageAction } from './types.js';
import { checkUsage, showUsageFooter, handleLogin, handleLogout, handleUsage, loadConfig, saveConfig } from './cli-auth.js';
import { getCache, setCache, parseTTL, clearCache, cacheStats } from './cache.js';
import { estimateTokens } from './core/markdown.js';
import { distillToBudget, budgetListings } from './core/budget.js';

const program = new Command();

// Read version from package.json dynamically
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
let cliVersion = '0.0.0';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  cliVersion = pkg.version;
} catch { /* fallback */ }

program
  .name('webpeel')
  .description('Fast web fetcher for AI agents')
  .version(cliVersion)
  .enablePositionalOptions();

// Check for updates (non-blocking, runs in background)
async function checkForUpdates(): Promise<void> {
  try {
    const res = await fetch('https://registry.npmjs.org/webpeel/latest', {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const data = await res.json() as { version: string };
    const latest = data.version;
    if (latest && latest !== cliVersion && cliVersion !== '0.0.0') {
      console.error(`\n💡 WebPeel v${latest} available (you have v${cliVersion}). Update: npm i -g webpeel@latest\n`);
    }
  } catch { /* silently ignore — don't slow down the user */ }
}
// Fire and forget — don't await, don't block
void checkForUpdates();

/**
 * Parse action strings into PageAction array
 * Formats:
 *   click:.selector         — click an element
 *   type:.selector=text     — type text into an input
 *   fill:.selector=text     — fill an input (replaces existing value)
 *   scroll:down:500         — scroll direction + amount
 *   scroll:bottom           — scroll to bottom (legacy)
 *   scroll:top              — scroll to top (legacy)
 *   wait:2000               — wait N ms
 *   press:Enter             — press a keyboard key
 *   hover:.selector         — hover over an element
 *   waitFor:.selector       — wait for a selector to appear
 *   select:.selector=value  — select dropdown option
 *   screenshot              — take a screenshot
 */
function parseActions(actionStrings: string[]): PageAction[] {
  return actionStrings.map(str => {
    const [type, ...rest] = str.split(':');
    const value = rest.join(':');
    
    switch (type) {
      case 'wait': 
        return { type: 'wait' as const, ms: parseInt(value) || 1000 };
      case 'click': 
        return { type: 'click' as const, selector: value };
      case 'scroll': {
        // scroll:down:500  or  scroll:bottom  or  scroll:500
        const parts = value.split(':');
        const dir = parts[0];
        
        if (dir === 'top' || dir === 'bottom') {
          return { type: 'scroll' as const, to: dir };
        }
        if (dir === 'down' || dir === 'up' || dir === 'left' || dir === 'right') {
          const amount = parseInt(parts[1] || '500', 10);
          return { type: 'scroll' as const, direction: dir as 'down' | 'up' | 'left' | 'right', amount };
        }
        // Bare number: absolute position
        const num = parseInt(dir, 10);
        if (!isNaN(num)) {
          return { type: 'scroll' as const, to: num };
        }
        // Default: scroll to bottom
        return { type: 'scroll' as const, to: 'bottom' as const };
      }
      case 'type': {
        const [sel, ...text] = value.split('=');
        return { type: 'type' as const, selector: sel, value: text.join('=') };
      }
      case 'fill': {
        const [sel, ...text] = value.split('=');
        return { type: 'fill' as const, selector: sel, value: text.join('=') };
      }
      case 'select': {
        const [sel, ...vals] = value.split('=');
        return { type: 'select' as const, selector: sel, value: vals.join('=') };
      }
      case 'press': 
        return { type: 'press' as const, key: value };
      case 'hover': 
        return { type: 'hover' as const, selector: value };
      case 'waitFor': 
        return { type: 'waitForSelector' as const, selector: value };
      case 'wait-for': 
        return { type: 'waitForSelector' as const, selector: value, timeout: 10000 };
      case 'screenshot': 
        return { type: 'screenshot' as const };
      default: 
        throw new Error(`Unknown action type: ${type}`);
    }
  });
}

program
  .argument('[url]', 'URL to fetch')
  .option('-r, --render', 'Use headless browser (for JS-heavy sites)')
  .option('--stealth', 'Use stealth mode to bypass bot detection (auto-enables --render)')
  .option('-w, --wait <ms>', 'Wait time after page load (ms)', parseInt)
  .option('--html', 'Output raw HTML instead of markdown')
  .option('--text', 'Output plain text instead of markdown')
  .option('--json', 'Output as JSON')
  .option('-t, --timeout <ms>', 'Request timeout (ms)', (v: string) => parseInt(v, 10), 30000)
  .option('--ua <agent>', 'Custom user agent')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--screenshot [path]', 'Take a screenshot (optionally save to file path)')
  .option('--full-page', 'Full-page screenshot (use with --screenshot)')
  .option('--selector <css>', 'CSS selector to extract (e.g., "article", ".content")')
  .option('--exclude <selectors...>', 'CSS selectors to exclude (e.g., ".sidebar" ".ads")')
  .option('--include-tags <tags>', 'Comma-separated HTML tags/selectors to include (e.g., "main,article,.content")')
  .option('--exclude-tags <tags>', 'Comma-separated HTML tags/selectors to exclude (e.g., "nav,footer,aside")')
  .option('--only-main-content', 'Shortcut for --include-tags main,article')
  .option('-H, --header <header...>', 'Custom headers (e.g., "Authorization: Bearer token")')
  .option('--cookie <cookie...>', 'Cookies to set (e.g., "session=abc123")')
  .option('--cache <ttl>', 'Cache results locally (e.g., "5m", "1h", "1d") — default: 5m')
  .option('--no-cache', 'Disable automatic caching for this request')
  .option('--links', 'Output only the links found on the page')
  .option('--images', 'Output image URLs from the page')
  .option('--meta', 'Output only the page metadata (title, description, author, etc.)')
  .option('--raw', 'Return full page without smart content extraction')
  .option('--action <actions...>', 'Page actions before scraping (e.g., "click:.btn" "wait:2000" "scroll:bottom")')
  .option('--extract <json>', 'Extract structured data using CSS selectors (JSON object of field:selector pairs)')
  .option('--llm-extract <prompt>', 'AI-powered extraction using LLM (requires OPENAI_API_KEY env var)')
  .option('--llm-key <key>', 'LLM API key for AI features (or use OPENAI_API_KEY env var)')
  .option('--summary', 'Generate AI summary of content (requires --llm-key or OPENAI_API_KEY)')
  .option('--location <country>', 'ISO country code for geo-targeting (e.g., "US", "DE", "JP")')
  .option('--language <lang>', 'Language preference (e.g., "en", "de", "ja")')
  .option('--max-tokens <n>', 'Maximum token count for output (truncate if exceeded)', parseInt)
  .option('--budget <n>', 'Smart token budget — distill content to fit within N tokens (heuristic, no LLM key needed)', parseInt)
  .option('--extract-all', 'Auto-detect and extract repeated listing items (e.g., search results)')
  .option('--scroll-extract [count]', 'Scroll page N times to load lazy content, then extract (implies --render)', (v: string) => parseInt(v, 10))
  .option('--csv', 'Output extraction results as CSV')
  .option('--table', 'Output extraction results as a formatted table')
  .option('--pages <n>', 'Follow pagination "Next" links for N pages (max 10)', (v: string) => parseInt(v, 10))
  .option('--profile <path>', 'Use a persistent browser profile directory (cookies/sessions survive between calls)')
  .option('--headed', 'Run browser in headed (visible) mode — useful for profile setup and debugging')
  .option('--agent', 'Agent mode: sets --json, --silent, --extract-all, and --budget 4000 (override with --budget N)')
  .action(async (url: string | undefined, options) => {
    // --agent sets sensible defaults for AI agents; explicit flags override
    if (options.agent) {
      if (!options.json) options.json = true;
      if (!options.silent) options.silent = true;
      if (!options.extractAll) options.extractAll = true;
      if (options.budget === undefined) options.budget = 4000;
    }

    const isJson = options.json;

    // --- #5: Concise error for missing URL (no help dump) ---
    if (!url || url.trim() === '') {
      if (isJson) {
        await writeStdout(JSON.stringify({ error: 'URL is required', code: 'URL_REQUIRED' }) + '\n');
      } else {
        console.error('Error: URL is required');
        console.error('Usage: webpeel <url> [options]');
        console.error('Run "webpeel --help" for full usage.');
      }
      process.exit(1);
    }

    // --- #6: Helper to output JSON errors and exit ---
    function exitWithJsonError(message: string, code: string): never {
      if (isJson) {
        process.stdout.write(JSON.stringify({ error: message, code }) + '\n');
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
    }

    // SECURITY: Enhanced URL validation
    if (url.length > 2048) {
      exitWithJsonError('URL too long (max 2048 characters)', 'INVALID_URL');
    }

    // Check for control characters
    if (/[\x00-\x1F\x7F]/.test(url)) {
      exitWithJsonError('URL contains invalid control characters', 'INVALID_URL');
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        exitWithJsonError('Only HTTP and HTTPS protocols are allowed', 'INVALID_URL');
      }
    } catch {
      exitWithJsonError(`Invalid URL format: ${url}`, 'INVALID_URL');
    }

    const useStealth = options.stealth || false;

    // Check usage quota
    const usageCheck = await checkUsage();
    if (!usageCheck.allowed) {
      if (isJson) {
        await writeStdout(JSON.stringify({ error: usageCheck.message, code: 'BLOCKED' }) + '\n');
        process.exit(1);
      }
      console.error(usageCheck.message);
      process.exit(1);
    }

    // Check cache first (before spinner/network)
    // Default: 5m TTL for all CLI fetches unless --no-cache is set
    let cacheTtlMs: number | undefined;
    const cacheDisabled = options.cache === false; // --no-cache sets options.cache to false
    const explicitTtl: string | undefined = typeof options.cache === 'string' ? options.cache : undefined;

    if (!cacheDisabled) {
      const ttlStr = explicitTtl || '5m';
      try {
        cacheTtlMs = parseTTL(ttlStr);
      } catch (e) {
        exitWithJsonError((e as Error).message, 'FETCH_FAILED');
      }

      const cacheOptions = {
        render: options.render,
        stealth: options.stealth,
        selector: options.selector,
        format: options.html ? 'html' : options.text ? 'text' : 'markdown',
        budget: null,  // Budget excluded from cache key — cache stores full content
      };

      const cachedResult = getCache(url, cacheOptions);
      if (cachedResult) {
        if (!options.silent) {
          console.error(`\x1b[36m⚡ Cache hit\x1b[0m (TTL: ${ttlStr})`);
        }
        // Apply budget to cached content (cache stores full, budget is post-process)
        if (options.budget && options.budget > 0 && cachedResult.content) {
          const { distillToBudget } = await import('./core/budget.js');
          const fmt: 'markdown' | 'text' | 'json' =
            options.text ? 'text' : 'markdown';
          (cachedResult as any).content = distillToBudget(cachedResult.content, options.budget, fmt);
          (cachedResult as any).tokens = Math.ceil(cachedResult.content.length / 4);
        }
        await outputResult(cachedResult as PeelResult, options, { cached: true });
        process.exit(0);
      }
    }

    const spinner = options.silent ? null : ora('Fetching...').start();

    try {
      // Validate options
      if (options.wait && (options.wait < 0 || options.wait > 60000)) {
        throw Object.assign(new Error('Wait time must be between 0 and 60000ms'), { _code: 'FETCH_FAILED' });
      }

      // Parse custom headers
      let headers: Record<string, string> | undefined;
      if (options.header && options.header.length > 0) {
        headers = {};
        for (const header of options.header) {
          const colonIndex = header.indexOf(':');
          if (colonIndex === -1) {
            throw Object.assign(new Error(`Invalid header format: ${header}. Expected "Key: Value"`), { _code: 'FETCH_FAILED' });
          }
          const key = header.slice(0, colonIndex).trim();
          const value = header.slice(colonIndex + 1).trim();
          headers[key] = value;
        }
      }

      // Parse actions
      let actions: PageAction[] | undefined;
      if (options.action && options.action.length > 0) {
        try {
          actions = parseActions(options.action);
        } catch (e) {
          throw Object.assign(new Error((e as Error).message), { _code: 'FETCH_FAILED' });
        }
      }

      // Parse extract
      let extract: any;
      if (options.llmExtract) {
        // LLM-based extraction
        extract = {
          prompt: options.llmExtract,
          llmApiKey: process.env.OPENAI_API_KEY,
          llmModel: process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini',
          llmBaseUrl: process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1',
        };
        if (!extract.llmApiKey) {
          throw Object.assign(new Error('--llm-extract requires OPENAI_API_KEY environment variable'), { _code: 'FETCH_FAILED' });
        }
      } else if (options.extract) {
        // CSS-based extraction
        try {
          extract = { selectors: JSON.parse(options.extract) };
        } catch {
          throw Object.assign(new Error('--extract must be valid JSON (e.g., \'{"title": "h1", "price": ".price"}\')'), { _code: 'FETCH_FAILED' });
        }
      }

      // Validate maxTokens
      if (options.maxTokens !== undefined) {
        if (isNaN(options.maxTokens) || options.maxTokens < 100) {
          throw Object.assign(new Error('--max-tokens must be at least 100'), { _code: 'FETCH_FAILED' });
        }
      }

      // Parse include-tags and exclude-tags
      let includeTags: string[] | undefined;
      let excludeTags: string[] | undefined;
      
      if (options.onlyMainContent) {
        includeTags = ['main', 'article'];
      } else if (options.includeTags) {
        includeTags = options.includeTags.split(',').map((t: string) => t.trim());
      }
      
      if (options.excludeTags) {
        excludeTags = options.excludeTags.split(',').map((t: string) => t.trim());
      }

      // Build location options
      let locationOptions: { country?: string; languages?: string[] } | undefined;
      if (options.location || options.language) {
        locationOptions = {};
        if (options.location) {
          locationOptions.country = options.location;
        }
        if (options.language) {
          locationOptions.languages = [options.language];
        }
      }

      // Build peel options
      // --stealth auto-enables --render (stealth requires browser)
      // --action auto-enables --render (actions require browser)
      // --scroll-extract implies --render (needs browser)
      const scrollExtractCount = options.scrollExtract !== undefined
        ? (typeof options.scrollExtract === 'number' ? options.scrollExtract : 3)
        : 0;
      const useRender = options.render || options.stealth || (actions && actions.length > 0) || scrollExtractCount > 0 || false;
      // Inject scroll actions when --scroll-extract is used
      if (scrollExtractCount > 0) {
        const scrollActions: PageAction[] = [];
        for (let i = 0; i < scrollExtractCount; i++) {
          scrollActions.push({ type: 'scroll', to: 'bottom' });
          scrollActions.push({ type: 'wait', ms: 1500 });
        }
        actions = actions ? [...actions, ...scrollActions] : scrollActions;
      }

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
        includeTags,
        excludeTags,
        headers,
        cookies: options.cookie,
        raw: options.raw || false,
        actions,
        maxTokens: options.maxTokens,
        // Note: budget is applied AFTER caching (so cache stores full content)
        // We pass it to peel() for programmatic API compatibility, but the CLI
        // also applies it post-fetch (see below) to ensure cache stores full result.
        extract,
        images: options.images || false,
        location: locationOptions,
        profileDir: options.profile || undefined,
        headed: options.headed || false,
      };

      // Add summary option if requested
      if (options.summary) {
        const llmApiKey = options.llmKey || process.env.OPENAI_API_KEY;
        if (!llmApiKey) {
          throw Object.assign(new Error('--summary requires --llm-key or OPENAI_API_KEY environment variable'), { _code: 'FETCH_FAILED' });
        }
        peelOptions.summary = true;
        peelOptions.llm = {
          apiKey: llmApiKey,
          model: process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini',
          baseUrl: process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1',
        };
      }

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

      // Store full result in cache (before budget distillation so cache is reusable)
      if (cacheTtlMs && !cacheDisabled) {
        setCache(url, result, cacheTtlMs, {
          render: options.render,
          stealth: useStealth,
          selector: options.selector,
          format: peelOptions.format,
          budget: null,  // Budget excluded — cache stores full content, budget applied post-cache
        });
      }

      // Apply smart budget distillation AFTER caching (cache always stores full content)
      // When --agent is set, always apply budget even with --extract-all (listings will be budgeted
      // separately, but if no listings are found the content itself still needs trimming).
      const skipBudgetForExtract = (options.extractAll || options.scrollExtract !== undefined) && !options.agent;
      let contentTruncated = false;
      if (options.budget && options.budget > 0 && !skipBudgetForExtract) {
        const budgetFormat: 'markdown' | 'text' | 'json' =
          peelOptions.format === 'text' ? 'text' : 'markdown';
        const distilled = distillToBudget(result.content, options.budget, budgetFormat);
        if (distilled !== result.content) {
          contentTruncated = true;
          (result as any).content = distilled;
          (result as any).tokens = estimateTokens(distilled);
        }
      }

      // --- #4: Content quality warning ---
      const isHtmlContent = result.contentType ? result.contentType.toLowerCase().includes('html') : true;
      const isRedirect = false; // peel() follows redirects — final result is always 200
      if (result.tokens < 20 && !useRender && isHtmlContent && !isRedirect) {
        const warningMsg = `Low content detected (${result.tokens} tokens). Try: webpeel ${url} --render`;
        if (isJson) {
          (result as any).warning = warningMsg;
        } else {
          console.error(`⚠ ${warningMsg}`);
        }
      }

      // --- Extract-all / pagination / output formatting ---
      const wantsExtractAll = options.extractAll || options.scrollExtract !== undefined;
      const pagesCount = Math.min(Math.max(options.pages || 1, 1), 10);

      if (wantsExtractAll) {
        const { extractListings } = await import('./core/extract-listings.js');
        const { findNextPageUrl } = await import('./core/paginate.js');

        // We need the raw HTML for extraction. Re-fetch with format=html if needed.
        let allListings: import('./core/extract-listings.js').ListingItem[] = [];

        // Fetch HTML for extraction
        const htmlResult = peelOptions.format === 'html'
          ? result
          : await peel(url, { ...peelOptions, format: 'html', maxTokens: undefined });

        allListings.push(...extractListings(htmlResult.content, result.url));

        // Pagination: follow "Next" links
        if (pagesCount > 1) {
          let currentHtml = htmlResult.content;
          let currentUrl = result.url;
          for (let page = 1; page < pagesCount; page++) {
            const nextUrl = findNextPageUrl(currentHtml, currentUrl);
            if (!nextUrl) break;
            try {
              const nextResult = await peel(nextUrl, { ...peelOptions, format: 'html', maxTokens: undefined });
              const pageListings = extractListings(nextResult.content, nextResult.url);
              allListings.push(...pageListings);
              currentHtml = nextResult.content;
              currentUrl = nextResult.url;
            } catch {
              break; // Stop paginating on error
            }
          }
        }

        // Apply budget to listings if requested
        let listingsTruncated = false;
        let totalAvailableListings: number | undefined;
        if (options.budget && options.budget > 0 && allListings.length > 0) {
          const { maxItems, truncated, totalAvailable } = budgetListings(allListings.length, options.budget);
          if (truncated) {
            listingsTruncated = true;
            totalAvailableListings = totalAvailable;
            allListings = allListings.slice(0, maxItems);
          }
        }

        // Output based on format flags
        if (options.csv) {
          const csvOutput = formatListingsCsv(allListings);
          await writeStdout(csvOutput);
        } else if (options.table) {
          const { formatTable } = await import('./core/table-format.js');
          const tableRows = allListings.map(item => {
            const row: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(item)) {
              if (v !== undefined) row[k] = v;
            }
            return row;
          });
          await writeStdout(formatTable(tableRows) + '\n');
        } else if (isJson) {
          // Use unified envelope for JSON output
          const structured = allListings as unknown as Record<string, unknown>[];
          const envelope = buildEnvelope(result, {
            cached: false,
            structured,
            truncated: listingsTruncated || undefined,
            totalAvailable: totalAvailableListings,
          });
          // Also include legacy fields for backward compat
          (envelope as any).listings = allListings;
          (envelope as any).count = allListings.length;
          await writeStdout(JSON.stringify(envelope, null, 2) + '\n');
        } else {
          // Formatted text output
          if (allListings.length === 0) {
            await writeStdout('No listings found.\n');
          } else {
            const truncNote = listingsTruncated && totalAvailableListings
              ? ` (${totalAvailableListings} total — budget limited to ${allListings.length})`
              : '';
            await writeStdout(`Found ${allListings.length} listings${truncNote}:\n\n`);
            allListings.forEach((item, i) => {
              const pricePart = item.price ? ` — ${item.price}` : '';
              const line = `${i + 1}. ${item.title}${pricePart}\n`;
              process.stdout.write(line);
              if (item.link) {
                process.stdout.write(`   ${item.link}\n`);
              }
              process.stdout.write('\n');
            });
          }
        }
      } else if (options.csv || options.table) {
        // CSV / table output for --extract (CSS selector extraction)
        if (result.extracted) {
          const rows = normaliseExtractedToRows(result.extracted);
          if (options.csv) {
            await writeStdout(formatListingsCsv(rows));
          } else {
            const { formatTable } = await import('./core/table-format.js');
            await writeStdout(formatTable(rows) + '\n');
          }
        } else {
          console.error('--csv / --table require --extract-all or --extract to produce structured data.');
        }
      } else {
        // Output results (default path)
        await outputResult(result, options, {
          cached: false,
          truncated: contentTruncated || undefined,
        });
      }

      // Clean up and exit
      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) {
        spinner.fail('Failed to fetch');
      }

      // --- #6: Consistent JSON error output ---
      if (isJson) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        const errCode = classifyErrorCode(error);
        await writeStdout(JSON.stringify({ error: errMsg, code: errCode }) + '\n');
        await cleanup();
        process.exit(1);
      }

      if (error instanceof Error) {
        console.error(`\nError: ${error.message}`);
        
        // Provide actionable hints based on error type
        const msg = error.message.toLowerCase();
        if (msg.includes('timeout') || msg.includes('timed out')) {
          console.error('\n💡 Hint: Try --render for JS-heavy sites, or --wait 5000 to wait longer.');
        } else if (msg.includes('blocked') || msg.includes('403') || msg.includes('cloudflare')) {
          console.error('\n💡 Hint: Try --stealth to bypass bot detection (uses more credits).');
        } else if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
          console.error('\n💡 Hint: Could not resolve hostname. Check the URL is correct.');
        } else if (msg.includes('econnrefused') || msg.includes('econnreset')) {
          console.error('\n💡 Hint: Connection refused. The site may be down or blocking requests.');
        } else if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) {
          console.error('\n💡 Hint: SSL/TLS error. The site may have an invalid certificate.');
        } else if (msg.includes('usage') || msg.includes('quota') || msg.includes('limit')) {
          console.error('\n💡 Hint: Run `webpeel usage` to check your quota, or `webpeel login` to authenticate.');
        }
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
  .action(async (query: string, options) => {
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
        const { buildSiteSearchUrl } = await import('./core/site-search.js');
        const siteResult = buildSiteSearchUrl(options.site, query);

        // Fetch the raw HTML (needed for listing extraction)
        const htmlResult = await peel(siteResult.url, {
          format: 'html',
          timeout: 30000,
        });

        if (spinner) {
          spinner.succeed(`Fetched ${siteResult.site} in ${htmlResult.elapsed}ms`);
        }

        // Extract listings from the HTML
        const { extractListings } = await import('./core/extract-listings.js');
        let listings = extractListings(htmlResult.content, siteResult.url);

        // Apply budget if requested
        if (options.budget && options.budget > 0 && listings.length > 0) {
          const { budgetListings } = await import('./core/budget.js');
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
          const { formatTable } = await import('./core/table-format.js');
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
      const { getSearchProvider } = await import('./core/search-provider.js');
      type SearchProviderId = import('./core/search-provider.js').SearchProviderId;

      // Resolve provider
      const providerId = (options.provider || 'duckduckgo') as SearchProviderId;
      const config = loadConfig();
      const apiKey = options.searchApiKey
        || process.env.WEBPEEL_BRAVE_API_KEY
        || config.braveApiKey
        || undefined;

      const provider = getSearchProvider(providerId);

      const results = await provider.searchWeb(query, {
        count: Math.min(Math.max(count, 1), 10),
        apiKey,
      });

      if (spinner) {
        spinner.succeed(`Found ${results.length} results (${providerId})`);
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
        const jsonStr = JSON.stringify(results, null, 2);
        await writeStdout(jsonStr + '\n');
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

// Sites command — list all supported site templates
program
  .command('sites')
  .description('List all sites supported by "webpeel search --site <site>"')
  .option('--json', 'Output as JSON')
  .option('--category <cat>', 'Filter by category (shopping, social, tech, jobs, general, real-estate, food)')
  .action(async (options) => {
    const { listSites } = await import('./core/site-search.js');
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

// Batch command
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

program
  .command('crawl <url>')
  .description('Crawl a website starting from a URL')
  .option('--max-pages <number>', 'Maximum number of pages to crawl (default: 10, max: 100)', (v: string) => parseInt(v, 10), 10)
  .option('--max-depth <number>', 'Maximum depth to crawl (default: 2, max: 5)', (v: string) => parseInt(v, 10), 2)
  .option('--allowed-domains <domains...>', 'Only crawl these domains (default: same as starting URL)')
  .option('--exclude <patterns...>', 'Exclude URLs matching these regex patterns')
  .option('--ignore-robots', 'Ignore robots.txt (default: respect robots.txt)')
  .option('--rate-limit <ms>', 'Rate limit between requests in ms (default: 1000)', (v: string) => parseInt(v, 10), 1000)
  .option('-r, --render', 'Use headless browser for all pages')
  .option('--stealth', 'Use stealth mode for all pages')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output as JSON')
  .action(async (url: string, options) => {
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
    const { mapDomain } = await import('./core/map.js');
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
        for (const url of result.urls) {
          console.log(url);
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

// Watch command - monitor a URL for changes / assertion failures
program
  .command('watch <url>')
  .description('Monitor a URL for changes and assertion failures')
  .option('--interval <duration>', 'Check interval (e.g. 30s, 5m, 1h)', '5m')
  .option('--assert <condition...>', 'Assertion(s) to check (e.g. "status=200" "body.health=ok")')
  .option('--webhook <url>', 'POST this URL on assertion failure or content change')
  .option('-t, --timeout <ms>', 'Per-request timeout in ms', (v: string) => parseInt(v, 10), 10000)
  .option('--max-checks <n>', 'Stop after N checks (default: unlimited)', (v: string) => parseInt(v, 10))
  .option('--json', 'Output each check as NDJSON to stdout')
  .option('-s, --silent', 'Only output on failures/changes')
  .option('-r, --render', 'Use browser rendering for checks')
  .action(async (url: string, options) => {
    const { watch: runWatch, parseDuration, parseAssertion } = await import('./core/watch.js');
    type WatchOptions = import('./core/watch.js').WatchOptions;

    // Validate URL
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

    // Parse interval
    let intervalMs: number;
    try {
      intervalMs = parseDuration(options.interval);
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }

    // Parse assertions
    const assertions: import('./core/watch.js').Assertion[] = [];
    if (options.assert && Array.isArray(options.assert)) {
      for (const expr of options.assert as string[]) {
        try {
          assertions.push(parseAssertion(expr));
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exit(1);
        }
      }
    }

    if (!options.json && !options.silent) {
      const intervalLabel = options.interval;
      const assertLabel = assertions.length > 0
        ? ` with ${assertions.length} assertion(s)`
        : '';
      process.stderr.write(
        `Watching ${url} every ${intervalLabel}${assertLabel}. Press Ctrl+C to stop.\n`,
      );
    }

    const watchOptions: WatchOptions = {
      url,
      intervalMs,
      assertions,
      webhookUrl: options.webhook,
      timeout: options.timeout,
      maxChecks: options.maxChecks,
      render: options.render || false,
      json: options.json || false,
      silent: options.silent || false,
    };

    try {
      await runWatch(watchOptions);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }

    process.exit(0);
  });

// Diff command - semantic diff against last snapshot
program
  .command('diff <url>')
  .description('Show semantic diff between current content and the last tracked snapshot')
  .option('--last', 'Compare against last tracked snapshot (default)')
  .option('--against <snapshot-url>', 'Compare against the snapshot stored for a different URL')
  .option('--fields <fields>', 'For JSON responses: only diff these fields (comma-separated dot-notation)')
  .option('--json', 'Output diff as JSON')
  .option('-r, --render', 'Use browser rendering')
  .option('-t, --timeout <ms>', 'Request timeout in ms', (v: string) => parseInt(v, 10), 30000)
  .option('-s, --silent', 'Silent mode (no spinner)')
  .action(async (url: string, options) => {
    const isJson = options.json;

    // Validate URL
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        if (isJson) {
          await writeStdout(JSON.stringify({ error: 'Only HTTP and HTTPS protocols are allowed', code: 'INVALID_URL' }) + '\n');
        } else {
          console.error('Error: Only HTTP and HTTPS protocols are allowed');
        }
        process.exit(1);
      }
    } catch {
      if (isJson) {
        await writeStdout(JSON.stringify({ error: `Invalid URL format: ${url}`, code: 'INVALID_URL' }) + '\n');
      } else {
        console.error(`Error: Invalid URL format: ${url}`);
      }
      process.exit(1);
    }

    const spinner = options.silent ? null : ora('Fetching and diffing...').start();

    try {
      const { diffUrl } = await import('./core/diff.js');

      const fields = options.fields
        ? (options.fields as string).split(',').map((f: string) => f.trim()).filter(Boolean)
        : undefined;

      const result = await diffUrl(url, {
        render: options.render || false,
        timeout: options.timeout,
        fields,
      });

      if (spinner) {
        spinner.succeed(`Diff completed in ${result.changed ? 'CHANGED' : 'no change'}`);
      }

      if (isJson) {
        await writeStdout(JSON.stringify(result, null, 2) + '\n');
      } else {
        // Human-readable output
        const ago = result.previousTimestamp
          ? formatRelativeTime(new Date(result.previousTimestamp))
          : 'unknown';
        console.log(`\nComparing ${result.url} (now vs ${ago})\n`);

        if (!result.changed) {
          console.log('  No changes detected.');
        } else {
          for (const change of result.changes) {
            const label = change.field ?? change.path ?? '(unknown)';
            if (change.type === 'modified') {
              console.log(`  Modified: ${label}  ${change.before} → ${change.after}`);
            } else if (change.type === 'added') {
              console.log(`  Added:    ${label}  ${change.after}`);
            } else if (change.type === 'removed') {
              console.log(`  Removed:  ${label}  ${change.before}`);
            }
          }
        }

        console.log(`\nSummary: ${result.summary}`);
      }

      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) spinner.fail('Diff failed');
      if (isJson) {
        await writeStdout(JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          code: 'FETCH_FAILED',
        }) + '\n');
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

// Config command  —  webpeel config [get|set] [key] [value]
program
  .command('config')
  .description('View or update CLI configuration')
  .argument('[action]', '"get <key>", "set <key> <value>", or omit for overview')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Value to set')
  .action(async (action?: string, key?: string, value?: string) => {
    const config = loadConfig();

    // Settable config keys (safe for user modification)
    const SETTABLE_KEYS: Record<string, string> = {
      braveApiKey: 'Brave Search API key',
    };

    const maskSecret = (k: string, v: string | undefined): string => {
      if (!v) return '(not set)';
      if (k === 'apiKey' || k === 'braveApiKey') return v.slice(0, 4) + '...' + v.slice(-4);
      return String(v);
    };
    
    if (!action) {
      // Show all config
      console.log('WebPeel CLI Configuration');
      console.log(`  Config file: ~/.webpeel/config.json`);
      console.log('');
      console.log(`  apiKey:         ${maskSecret('apiKey', config.apiKey)}`);
      console.log(`  braveApiKey:    ${maskSecret('braveApiKey', config.braveApiKey)}`);
      console.log(`  planTier:       ${config.planTier || 'free'}`);
      console.log(`  anonymousUsage: ${config.anonymousUsage}`);
      const stats = cacheStats();
      console.log('');
      console.log('  Cache:');
      console.log(`    entries:  ${stats.entries}`);
      console.log(`    size:     ${(stats.sizeBytes / 1024).toFixed(1)} KB`);
      console.log(`    dir:      ${stats.dir}`);
      console.log('');
      console.log('  Settable keys: ' + Object.keys(SETTABLE_KEYS).join(', '));
      console.log('  Usage: webpeel config set <key> <value>');
      process.exit(0);
    }

    if (action === 'set') {
      if (!key) {
        console.error('Usage: webpeel config set <key> <value>');
        console.error('Settable keys: ' + Object.keys(SETTABLE_KEYS).join(', '));
        process.exit(1);
      }

      if (!(key in SETTABLE_KEYS)) {
        console.error(`Cannot set "${key}". Settable keys: ${Object.keys(SETTABLE_KEYS).join(', ')}`);
        process.exit(1);
      }

      if (!value) {
        console.error(`Usage: webpeel config set ${key} <value>`);
        process.exit(1);
      }

      (config as any)[key] = value;
      saveConfig(config);
      console.log(`✓ ${key} saved`);
      process.exit(0);
    }

    if (action === 'get') {
      const lookupKey = key || '';
      const val = (config as any)[lookupKey];
      if (val !== undefined) {
        console.log(maskSecret(lookupKey, String(val)));
      } else {
        console.error(`Unknown config key: ${lookupKey}`);
        process.exit(1);
      }
      process.exit(0);
    }

    // Legacy: `webpeel config <key>` — treat action as the key name
    const val = (config as any)[action];
    if (val !== undefined) {
      console.log(maskSecret(action, String(val)));
    } else {
      console.error(`Unknown config key or action: ${action}`);
      console.error('Usage: webpeel config [get|set] [key] [value]');
      process.exit(1);
    }
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

// Brand command - extract branding/design system
program
  .command('brand <url>')
  .description('Extract branding and design system from a URL')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output as JSON (default)')
  .action(async (url: string, options) => {
    const spinner = options.silent ? null : ora('Extracting branding...').start();
    
    try {
      const result = await peel(url, {
        extract: {
          selectors: {
            primaryColor: 'meta[name="theme-color"]',
            title: 'title',
            logo: 'img[class*="logo"], img[alt*="logo"]',
          },
        },
      });
      
      if (spinner) {
        spinner.succeed(`Extracted branding in ${result.elapsed}ms`);
      }
      
      // Extract branding data from metadata and page
      const branding = {
        url: result.url,
        title: result.title,
        colors: extractColors(result.content),
        fonts: extractFonts(result.content),
        extracted: result.extracted,
        metadata: result.metadata,
      };
      
      console.log(JSON.stringify(branding, null, 2));
      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) spinner.fail('Branding extraction failed');
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await cleanup();
      process.exit(1);
    }
  });

// Track command - track changes on a URL
program
  .command('track <url>')
  .description('Track changes on a URL (saves snapshot for use with `webpeel diff`)')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output as JSON')
  .option('-r, --render', 'Use browser rendering')
  .action(async (url: string, options) => {
    const spinner = options.silent ? null : ora('Fetching and tracking...').start();
    
    try {
      // changeTracking: true saves the snapshot to ~/.webpeel/snapshots/ so that
      // `webpeel diff` can compare against it later.
      const result = await peel(url, {
        render: options.render || false,
        changeTracking: true,
      });
      
      if (spinner) {
        spinner.succeed(`Tracked in ${result.elapsed}ms`);
      }
      
      const changeStatus = result.changeTracking?.changeStatus ?? 'new';
      const previousScrapeAt = result.changeTracking?.previousScrapeAt ?? null;

      if (options.json) {
        await writeStdout(JSON.stringify({
          url: result.url,
          title: result.title,
          fingerprint: result.fingerprint,
          tokens: result.tokens,
          contentType: result.contentType,
          changeStatus,
          previousScrapeAt,
          lastChecked: new Date().toISOString(),
        }, null, 2) + '\n');
      } else {
        console.log(`URL: ${result.url}`);
        console.log(`Title: ${result.title}`);
        console.log(`Fingerprint: ${result.fingerprint}`);
        console.log(`Tokens: ${result.tokens}`);
        console.log(`Status: ${changeStatus}`);
        if (previousScrapeAt) console.log(`Previous check: ${previousScrapeAt}`);
        console.log(`Last checked: ${new Date().toISOString()}`);
        console.log('\nSnapshot saved. Run `webpeel diff <url> --last` to compare future changes.');
      }
      
      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) spinner.fail('Tracking failed');
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await cleanup();
      process.exit(1);
    }
  });

// Summarize command - AI-powered summary
program
  .command('summarize <url>')
  .description('Generate an AI-powered summary of a URL')
  .option('--llm-key <key>', 'LLM API key (or use OPENAI_API_KEY env var)')
  .option('--llm-model <model>', 'LLM model to use (default: gpt-4o-mini)')
  .option('--llm-base-url <url>', 'LLM API base URL (default: https://api.openai.com/v1)')
  .option('--prompt <prompt>', 'Custom summary prompt')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output as JSON')
  .action(async (url: string, options) => {
    const llmApiKey = options.llmKey || process.env.OPENAI_API_KEY;
    
    if (!llmApiKey) {
      console.error('Error: --llm-key or OPENAI_API_KEY environment variable is required');
      process.exit(1);
    }
    
    const spinner = options.silent ? null : ora('Fetching and summarizing...').start();
    
    try {
      const result = await peel(url, {
        extract: {
          prompt: options.prompt || 'Summarize this webpage in 2-3 sentences.',
          llmApiKey,
          llmModel: options.llmModel || 'gpt-4o-mini',
          llmBaseUrl: options.llmBaseUrl || 'https://api.openai.com/v1',
        },
      });
      
      if (spinner) {
        spinner.succeed(`Summarized in ${result.elapsed}ms`);
      }
      
      if (options.json) {
        console.log(JSON.stringify({
          url: result.url,
          title: result.title,
          summary: result.extracted,
        }, null, 2));
      } else {
        console.log(`\n${result.title}\n`);
        console.log(result.extracted);
      }
      
      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) spinner.fail('Summary generation failed');
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await cleanup();
      process.exit(1);
    }
  });

// Agent command - autonomous web research
program
  .command('agent <prompt>')
  .description('Autonomous web research — finds and extracts data from the web using AI')
  .option('--llm-key <key>', 'LLM API key (or use OPENAI_API_KEY env var)')
  .option('--llm-model <model>', 'LLM model to use (default: gpt-4o-mini)')
  .option('--llm-base-url <url>', 'LLM API base URL')
  .option('--urls <urls>', 'Comma-separated starting URLs')
  .option('--max-pages <n>', 'Maximum pages to visit (default: 10)', '10')
  .option('--schema <json>', 'JSON schema for structured output')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output as JSON')
  .action(async (prompt: string, options) => {
    const llmApiKey = options.llmKey || process.env.OPENAI_API_KEY;

    if (!llmApiKey) {
      console.error('Error: --llm-key or OPENAI_API_KEY environment variable is required');
      process.exit(1);
    }

    const spinner = options.silent ? null : ora('Running agent research...').start();

    try {
      const { runAgent } = await import('./core/agent.js');

      let schema: Record<string, any> | undefined;
      if (options.schema) {
        try {
          schema = JSON.parse(options.schema);
        } catch {
          console.error('Error: --schema must be valid JSON');
          process.exit(1);
        }
      }

      const result = await runAgent({
        prompt,
        urls: options.urls ? options.urls.split(',').map((u: string) => u.trim()) : undefined,
        schema,
        llmApiKey,
        llmModel: options.llmModel,
        llmApiBase: options.llmBaseUrl,
        maxPages: parseInt(options.maxPages, 10),
        onProgress: (progress) => {
          if (spinner) {
            spinner.text = progress.message;
          }
        },
      });

      if (spinner) {
        spinner.succeed(`Agent finished: ${result.pagesVisited} pages, ${result.creditsUsed} credits`);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\nSources (${result.sources.length}):`);
        result.sources.forEach(s => console.log(`  • ${s}`));
        console.log(`\nResults:`);
        console.log(JSON.stringify(result.data, null, 2));
      }

      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) spinner.fail('Agent research failed');
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await cleanup();
      process.exit(1);
    }
  });

// ── Jobs command group ─────────────────────────────────────────────────────

const jobsCmd = program
  .command('jobs')
  .description('Job board operations: search listings and auto-apply (LinkedIn, Indeed, Glassdoor, Upwork)')
  .argument('[keywords]', 'Search keywords — shorthand for "jobs search <keywords>"')
  .option('-l, --location <location>', 'Location filter')
  .option('-s, --source <source>', 'Job board: glassdoor, indeed, linkedin, or upwork (default: linkedin)', 'linkedin')
  .option('-n, --limit <number>', 'Max results (default: 25)', '25')
  .option('-d, --details <number>', 'Fetch full details for top N results (default: 0)', '0')
  .option('--json', 'Output raw JSON')
  .option('--timeout <ms>', 'Request timeout in ms (default: 30000)', '30000')
  .option('--silent', 'Silent mode (no spinner)')
  .action(async (keywords: string | undefined, options) => {
    // Default action: when called as `webpeel jobs <keywords>`, act as search
    if (!keywords) {
      jobsCmd.help();
      process.exit(0);
    }
    // Delegate to shared search logic
    await runJobSearch(keywords, options);
  });

// ── Shared job-search logic (used by both `jobs` default and `jobs search`) ───

async function runJobSearch(keywords: string, options: {
  location?: string;
  source?: string;
  limit?: string;
  details?: string;
  json?: boolean;
  timeout?: string;
  silent?: boolean;
}): Promise<void> {
  const spinner = options.silent ? null : ora('Searching jobs...').start();

  try {
    const { searchJobs } = await import('./core/jobs.js');
    type JobDetail = import('./core/jobs.js').JobDetail;

    const VALID_SOURCES = ['glassdoor', 'indeed', 'linkedin', 'upwork'] as const;
    type ValidSource = typeof VALID_SOURCES[number];
    const source: ValidSource = (VALID_SOURCES.includes((options.source ?? 'linkedin') as ValidSource)
      ? options.source
      : 'linkedin') as ValidSource;
    const limit = Math.min(Math.max(parseInt(options.limit ?? '25', 10) || 25, 1), 100);
    const fetchDetails = Math.min(Math.max(parseInt(options.details ?? '0', 10) || 0, 0), limit);
    const timeout = parseInt(options.timeout ?? '30000', 10) || 30000;

    const result = await searchJobs({
      keywords,
      location: options.location,
      source,
      limit,
      fetchDetails,
      timeout,
    });

    if (spinner) spinner.stop();

    if (options.json) {
      await writeStdout(JSON.stringify(result, null, 2) + '\n');
      process.exit(0);
    }

    const totalLabel = result.totalFound >= 1000
      ? `${(result.totalFound / 1000).toFixed(0).replace(/\.0$/, '')}k+`
      : String(result.totalFound);

    const locationLabel = options.location ? ` in ${options.location}` : '';
    console.log(`\n🔍 Found ${totalLabel} ${keywords} jobs${locationLabel} (${result.source})\n`);

    if (result.jobs.length === 0) {
      console.log('  No jobs found.\n');
      process.exit(0);
    }

    const colNum = 3;
    const colTitle = 40;
    const colCompany = 18;
    const colLocation = 16;
    const colSalary = 14;
    const colPosted = 10;

    const pad = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);
    const rpad = (s: string, w: number) => s.padStart(w);

    console.log(
      ` ${rpad('#', colNum)}  ${pad('Title', colTitle)}  ${pad('Company', colCompany)}  ${pad('Location', colLocation)}  ${pad('Salary/Budget', colSalary)}  ${pad('Posted', colPosted)}`
    );

    result.jobs.forEach((job, i) => {
      const titleStr = job.title + (job.remote ? ' 🏠' : '');
      const salaryStr = job.salary ?? ('budget' in job ? (job as any).budget : '') ?? '';
      console.log(
        ` ${rpad(String(i + 1), colNum)}  ${pad(titleStr, colTitle)}  ${pad(job.company, colCompany)}  ${pad(job.location, colLocation)}  ${pad(salaryStr, colSalary)}  ${pad(job.postedAt ?? '', colPosted)}`
      );
    });

    const timeSec = (result.timeTakenMs / 1000).toFixed(1);
    const detailsNote = fetchDetails > 0 ? ` | Details: ${result.detailsFetched} fetched` : '';
    console.log(`\nFetched ${result.jobs.length} jobs in ${timeSec}s${detailsNote}\n`);

    const detailedJobs = result.jobs.filter((j): j is JobDetail => 'description' in j);
    for (let i = 0; i < detailedJobs.length; i++) {
      const job = detailedJobs[i]!;
      console.log(`━━━ Job #${i + 1}: ${job.title} ━━━`);
      const metaParts = [`Company: ${job.company}`, `Location: ${job.location}`];
      if (job.salary) metaParts.push(`Salary: ${job.salary}`);
      console.log(metaParts.join(' | '));

      const typeParts: string[] = [];
      if (job.employmentType) typeParts.push(`Type: ${job.employmentType}`);
      if (job.experienceLevel) typeParts.push(`Level: ${job.experienceLevel}`);
      if (job.postedAt) typeParts.push(`Posted: ${job.postedAt}`);
      if (typeParts.length > 0) console.log(typeParts.join(' | '));

      if (job.description) {
        console.log(`\nDescription:\n  ${job.description.slice(0, 500).replace(/\n/g, '\n  ')}`);
      }
      if (job.requirements && job.requirements.length > 0) {
        console.log(`\nRequirements:`);
        job.requirements.forEach(r => console.log(`  • ${r}`));
      }
      if (job.responsibilities && job.responsibilities.length > 0) {
        console.log(`\nResponsibilities:`);
        job.responsibilities.forEach(r => console.log(`  • ${r}`));
      }
      if (job.benefits && job.benefits.length > 0) {
        console.log(`\nBenefits:`);
        job.benefits.forEach(b => console.log(`  • ${b}`));
      }
      if (job.applyUrl) {
        console.log(`\nApply: ${job.applyUrl}`);
      }
      console.log('');
    }

    process.exit(0);
  } catch (error) {
    if (spinner) (spinner as any).fail?.('Job search failed');
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// jobs search <keywords>  — explicit subcommand (same logic as default action)
jobsCmd
  .command('search <keywords>')
  .description('Search job boards for listings (LinkedIn, Indeed, Glassdoor, Upwork)')
  .alias('s')
  .option('-l, --location <location>', 'Location filter')
  .option('-s, --source <source>', 'Job board: glassdoor, indeed, linkedin, or upwork (default: linkedin)', 'linkedin')
  .option('-n, --limit <number>', 'Max results (default: 25)', '25')
  .option('-d, --details <number>', 'Fetch full details for top N results (default: 0)', '0')
  .option('--json', 'Output raw JSON')
  .option('--timeout <ms>', 'Request timeout in ms (default: 30000)', '30000')
  .option('--silent', 'Silent mode (no spinner)')
  .action(async (keywords: string, options) => {
    await runJobSearch(keywords, options);
  });

// ── jobs apply <url>  ─────────────────────────────────────────────────────────
// Stealth automated job application using human behavior simulation
jobsCmd
  .command('apply <url>')
  .description('Stealth automated job application using human behavior simulation')
  .option('--profile <path>', 'Path to profile JSON file', `${process.env.HOME ?? '~'}/.webpeel/profile.json`)
  .option('--resume <path>', 'Path to resume PDF (overrides profile.resumePath)')
  .option('--mode <mode>', 'Submission mode: auto | review | dry-run (default: review)', 'review')
  .option('--session-dir <path>', 'Browser session directory (preserves login cookies)')
  .option('--llm-key <key>', 'LLM API key for custom question answers')
  .option('--llm-provider <name>', 'LLM provider: openai | anthropic (default: openai)', 'openai')
  .option('--daily-limit <n>', 'Max applications per day (default: 8)', '8')
  .option('--no-warmup', 'Skip browsing warmup phase')
  .option('--json', 'Output result as JSON')
  .option('--silent', 'Minimal output')
  .action(async (url: string, options) => {
    const isSilent = options.silent as boolean;
    const isJson = options.json as boolean;
    const mode = (['auto', 'review', 'dry-run'].includes(options.mode as string)
      ? options.mode
      : 'review') as 'auto' | 'review' | 'dry-run';

    if (!isSilent) {
      console.log(`\n🤖 WebPeel Auto-Apply — mode: ${mode}`);
      console.log(`   URL: ${url}\n`);
    }

    // Load profile
    const profilePath = options.profile as string;
    let profile: import('./core/apply.js').ApplyProfile;
    try {
      const raw = readFileSync(profilePath, 'utf-8');
      profile = JSON.parse(raw) as import('./core/apply.js').ApplyProfile;
    } catch {
      console.error(`Error: Could not load profile from ${profilePath}`);
      console.error(`Run "webpeel jobs apply-setup" to create a profile.`);
      process.exit(1);
    }

    if (options.resume) {
      profile.resumePath = options.resume as string;
    }

    const spinner = isSilent ? null : ora('Applying...').start();

    try {
      const { applyToJob } = await import('./core/apply.js');

      const result = await applyToJob({
        url,
        profile,
        mode,
        sessionDir: options.sessionDir as string | undefined,
        llmKey: options.llmKey as string | undefined,
        llmProvider: options.llmProvider as string,
        dailyLimit: parseInt(options.dailyLimit as string, 10) || 8,
        warmup: options.warmup !== false,
        onProgress: isSilent
          ? undefined
          : (event) => {
              if (spinner) spinner.text = `[${event.stage}] ${event.message}`;
              else console.log(`  [${event.stage}] ${event.message}`);
            },
      });

      if (spinner) spinner.stop();

      if (isJson) {
        await writeStdout(JSON.stringify(result, null, 2) + '\n');
        process.exit(result.error ? 1 : 0);
      }

      const statusIcon = result.submitted ? '✅' : result.error ? '❌' : '📋';
      console.log(
        `\n${statusIcon} ${
          result.submitted
            ? 'Application submitted!'
            : result.error
              ? `Error: ${result.error}`
              : 'Application completed (not submitted)'
        }`
      );
      if (result.job.title || result.job.company) {
        console.log(`   ${result.job.title}${result.job.company ? ` @ ${result.job.company}` : ''}`);
      }
      console.log(`\n   Fields filled: ${result.fieldsFilled}`);
      if (result.llmAnswers > 0) console.log(`   LLM answers: ${result.llmAnswers}`);
      if (result.fieldsSkipped.length > 0) console.log(`   Skipped: ${result.fieldsSkipped.join(', ')}`);
      if (result.warnings.length > 0 && !isSilent) {
        console.log(`\n   Warnings:`);
        result.warnings.forEach(w => console.log(`   ⚠️  ${w}`));
      }
      console.log(`   Time: ${(result.elapsed / 1000).toFixed(1)}s\n`);

      process.exit(result.error ? 1 : 0);
    } catch (error) {
      if (spinner) spinner.fail('Application failed');
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// ── jobs apply-setup  ─────────────────────────────────────────────────────────
// Interactive wizard to create ~/.webpeel/profile.json
jobsCmd
  .command('apply-setup')
  .description('Interactive setup wizard — creates ~/.webpeel/profile.json')
  .action(async () => {
    const { createInterface } = await import('readline');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise(resolve => rl.question(q, ans => resolve(ans.trim())));

    console.log('\n🤖 WebPeel Apply Setup — Create your applicant profile\n');
    console.log('This creates ~/.webpeel/profile.json used by "webpeel jobs apply".\n');

    try {
      const name = await ask('Full name: ');
      const email = await ask('Email address: ');
      const phone = await ask('Phone number: ');
      const linkedin = await ask('LinkedIn URL (optional, press Enter to skip): ');
      const website = await ask('Portfolio/website URL (optional): ');
      const location = await ask('City, State (e.g. San Francisco, CA): ');
      const workAuth = await ask(
        'Work authorization (e.g. US Citizen, Permanent Resident, H-1B, Need Sponsorship): '
      );
      const yearsExp = await ask('Years of experience: ');
      const currentTitle = await ask('Current/most recent job title: ');
      const skills = await ask('Skills (comma-separated, e.g. TypeScript, React, Node.js): ');
      const education = await ask('Education (e.g. B.S. Computer Science, MIT): ');
      const resumePath = await ask('Path to resume PDF (e.g. /Users/you/resume.pdf): ');
      const summary = await ask('Professional summary (1-3 sentences): ');
      const salaryMin = await ask('Minimum desired salary (optional, e.g. 120000): ');
      const salaryMax = await ask('Maximum desired salary (optional, e.g. 180000): ');
      const relocate = await ask('Willing to relocate? (y/n): ');
      const sponsorship = await ask('Need visa sponsorship? (y/n): ');

      rl.close();

      const profileData: import('./core/apply.js').ApplyProfile = {
        name,
        email,
        phone,
        ...(linkedin ? { linkedin } : {}),
        ...(website ? { website } : {}),
        location,
        workAuthorization: workAuth,
        yearsExperience: parseInt(yearsExp, 10) || 0,
        currentTitle,
        skills: skills.split(',').map(s => s.trim()).filter(Boolean),
        education,
        resumePath,
        summary,
        ...(salaryMin && salaryMax
          ? { salaryRange: { min: parseInt(salaryMin, 10), max: parseInt(salaryMax, 10) } }
          : {}),
        willingToRelocate: relocate.toLowerCase().startsWith('y'),
        needsSponsorship: sponsorship.toLowerCase().startsWith('y'),
      };

      const { mkdirSync: mk, writeFileSync: wf, existsSync: ex } = await import('fs');
      const { join: j } = await import('path');
      const { homedir: hd } = await import('os');

      const webpeelDir = j(hd(), '.webpeel');
      if (!ex(webpeelDir)) mk(webpeelDir, { recursive: true });
      const profilePath = j(webpeelDir, 'profile.json');
      wf(profilePath, JSON.stringify(profileData, null, 2), 'utf-8');

      console.log(`\n✅ Profile saved to: ${profilePath}`);
      console.log('\nNext steps:');
      console.log('  1. Apply to a job: webpeel jobs apply https://linkedin.com/jobs/view/...');
      console.log(
        '     (First run opens a browser — log in to LinkedIn, then the session is saved)\n'
      );
    } catch (error) {
      rl.close();
      console.error(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// ── jobs apply-history  ───────────────────────────────────────────────────────
// View application history from ~/.webpeel/applications.json
jobsCmd
  .command('apply-history')
  .description('View application history from ~/.webpeel/applications.json')
  .option('--json', 'Output as JSON')
  .option('--limit <n>', 'Number of recent applications to show (default: 20)', '20')
  .action(async (options) => {
    const isJson = options.json as boolean;
    const limit = parseInt(options.limit as string, 10) || 20;

    try {
      const { loadApplications } = await import('./core/apply.js');
      const allApps = loadApplications();
      const apps = allApps.slice().reverse().slice(0, limit);

      if (isJson) {
        await writeStdout(JSON.stringify(apps, null, 2) + '\n');
        process.exit(0);
      }

      if (apps.length === 0) {
        console.log('\nNo applications yet. Use "webpeel jobs apply <url>" to start.\n');
        process.exit(0);
      }

      console.log(`\n📋 Application History (${apps.length} of ${allApps.length} total)\n`);

      const colDate = 22;
      const colStatus = 10;
      const colTitle = 35;
      const colCompany = 20;
      const colMode = 8;
      const pad = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));

      console.log(
        ` ${pad('Applied', colDate)}  ${pad('Status', colStatus)}  ${pad('Title', colTitle)}  ${pad('Company', colCompany)}  ${pad('Mode', colMode)}`
      );
      console.log(
        ` ${'-'.repeat(colDate)}  ${'-'.repeat(colStatus)}  ${'-'.repeat(colTitle)}  ${'-'.repeat(colCompany)}  ${'-'.repeat(colMode)}`
      );

      for (const app of apps) {
        const date = new Date(app.appliedAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const statusEmoji =
          { applied: '📤', interview: '🎯', offer: '🎉', rejected: '❌', withdrawn: '🚫' }[
            app.status
          ] ?? '';

        console.log(
          ` ${pad(date, colDate)}  ${pad(`${statusEmoji} ${app.status}`, colStatus)}  ${pad(app.title, colTitle)}  ${pad(app.company, colCompany)}  ${pad(app.mode, colMode)}`
        );
      }

      const today = new Date().toISOString().slice(0, 10);
      const todayCount = allApps.filter(a => a.appliedAt.startsWith(today)).length;
      console.log(`\n  Today: ${todayCount} application(s)\n`);

      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// Queue command - list active async jobs (crawl, batch)
program
  .command('queue')
  .description('List active async jobs (crawl, batch)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const config = loadConfig();
      
      if (!config.apiKey) {
        console.error('Error: API key required. Run `webpeel login` first.');
        process.exit(1);
      }
      
      const { fetch: undiciFetch } = await import('undici');
      
      const response = await undiciFetch(`${process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev'}/v1/jobs`, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`API error: HTTP ${response.status}`);
      }
      
      const data = await response.json() as any;
      const jobs = data.jobs || data;
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        if (!Array.isArray(jobs) || jobs.length === 0) {
          console.log('No active jobs.');
        } else {
          console.log(`Active Jobs (${jobs.length}):\n`);
          for (const job of jobs) {
            console.log(`ID: ${job.id}`);
            console.log(`Type: ${job.type}`);
            console.log(`Status: ${job.status}`);
            console.log(`URL: ${job.url}`);
            console.log(`Created: ${job.createdAt}`);
            console.log('---');
          }
        }
      }
      
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// Job command - get job status
program
  .command('job <id>')
  .description('Get status of a specific job')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    try {
      const config = loadConfig();
      
      if (!config.apiKey) {
        console.error('Error: API key required. Run `webpeel login` first.');
        process.exit(1);
      }
      
      const { fetch: undiciFetch } = await import('undici');
      
      const response = await undiciFetch(`${process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev'}/v1/jobs/${id}`, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`API error: HTTP ${response.status}`);
      }
      
      const job = await response.json() as any;
      
      if (options.json) {
        console.log(JSON.stringify(job, null, 2));
      } else {
        console.log(`Job ID: ${job.id}`);
        console.log(`Type: ${job.type}`);
        console.log(`Status: ${job.status}`);
        console.log(`URL: ${job.url}`);
        console.log(`Created: ${job.createdAt}`);
        
        if (job.completedAt) {
          console.log(`Completed: ${job.completedAt}`);
        }
        
        if (job.error) {
          console.log(`Error: ${job.error}`);
        }
        
        if (job.results) {
          console.log(`\nResults: ${job.results.length} items`);
          if (job.type === 'crawl' && job.results.length > 0) {
            console.log('\nFirst 5 URLs:');
            for (const result of job.results.slice(0, 5)) {
              console.log(`  - ${result.url}`);
            }
          }
        }
      }
      
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// Answer command - search + fetch + LLM-generated answer
program
  .command('answer <question>')
  .description('Ask a question, search the web, and get an AI-generated answer with citations (BYOK)')
  .option('--provider <provider>', 'Search provider: duckduckgo (default) or brave')
  .option('--search-api-key <key>', 'Search provider API key (or env WEBPEEL_BRAVE_API_KEY)')
  .option('--llm <provider>', 'LLM provider: openai, anthropic, or google (required)')
  .option('--llm-api-key <key>', 'LLM API key (or env OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY)')
  .option('--llm-model <model>', 'LLM model name (optional, uses provider default)')
  .option('--max-sources <n>', 'Maximum sources to fetch (1-10, default 5)', '5')
  .option('--json', 'Output as JSON')
  .option('-s, --silent', 'Silent mode')
  .action(async (question: string, options) => {
    const spinner = options.silent ? null : ora('Thinking...').start();

    try {
      const { answerQuestion } = await import('./core/answer.js');
      type LLMProviderId = import('./core/answer.js').LLMProviderId;
      type SearchProviderId = import('./core/search-provider.js').SearchProviderId;

      const config = loadConfig();

      const llmProvider = (options.llm as LLMProviderId | undefined);
      if (!llmProvider || !['openai', 'anthropic', 'google'].includes(llmProvider)) {
        console.error('Error: --llm is required (openai, anthropic, or google)');
        process.exit(1);
      }

      const llmApiKey = options.llmApiKey
        || process.env.OPENAI_API_KEY
        || process.env.ANTHROPIC_API_KEY
        || process.env.GOOGLE_API_KEY
        || '';

      if (!llmApiKey) {
        console.error('Error: --llm-api-key is required (or set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY)');
        process.exit(1);
      }

      const searchProvider = (options.provider || 'duckduckgo') as SearchProviderId;
      const searchApiKey = options.searchApiKey
        || process.env.WEBPEEL_BRAVE_API_KEY
        || config.braveApiKey
        || undefined;

      const maxSources = Math.min(Math.max(parseInt(options.maxSources) || 5, 1), 10);

      if (spinner) spinner.text = 'Searching the web...';

      const result = await answerQuestion({
        question,
        searchProvider,
        searchApiKey,
        llmProvider,
        llmApiKey,
        llmModel: options.llmModel,
        maxSources,
        stream: false,
      });

      if (spinner) spinner.succeed('Done');

      if (options.json) {
        const jsonStr = JSON.stringify(result, null, 2);
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(jsonStr + '\n', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        console.log(`\n${result.answer}`);
        console.log(`\nSources:`);
        result.citations.forEach((c, i) => {
          console.log(`  [${i + 1}] ${c.title}`);
          console.log(`      ${c.url}`);
        });
        console.log(`\nModel: ${result.llmModel} (${result.llmProvider})`);
      }

      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) spinner.fail('Answer generation failed');
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await cleanup();
      process.exit(1);
    }
  });

// Screenshot command
program
  .command('screenshot <url>')
  .description('Take a screenshot of a URL and save as PNG/JPEG')
  .option('--full-page', 'Capture full page (not just viewport)')
  .option('--width <px>', 'Viewport width in pixels (default: 1280)', parseInt)
  .option('--height <px>', 'Viewport height in pixels (default: 720)', parseInt)
  .option('--format <fmt>', 'Image format: png (default) or jpeg', 'png')
  .option('--quality <n>', 'JPEG quality 1-100 (ignored for PNG)', parseInt)
  .option('-w, --wait <ms>', 'Wait time after page load (ms)', parseInt)
  .option('-t, --timeout <ms>', 'Request timeout (ms)', (v: string) => parseInt(v, 10), 30000)
  .option('--stealth', 'Use stealth mode to bypass bot detection')
  .option('--action <actions...>', 'Page actions before screenshot (e.g., "click:.btn" "wait:2000")')
  .option('-o, --output <path>', 'Output file path (default: screenshot.png)')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output base64 JSON instead of binary file')
  .action(async (url: string, options) => {
    // Validate URL
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

    // Check usage quota
    const usageCheck = await checkUsage();
    if (!usageCheck.allowed) {
      console.error(usageCheck.message);
      process.exit(1);
    }

    const spinner = options.silent ? null : ora('Taking screenshot...').start();

    try {
      // Validate format
      const format = options.format?.toLowerCase();
      if (format && !['png', 'jpeg', 'jpg'].includes(format)) {
        console.error('Error: --format must be png, jpeg, or jpg');
        process.exit(1);
      }

      // Parse actions
      let actions: PageAction[] | undefined;
      if (options.action && options.action.length > 0) {
        try {
          actions = parseActions(options.action);
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exit(1);
        }
      }

      const { takeScreenshot } = await import('./core/screenshot.js');

      const result = await takeScreenshot(url, {
        fullPage: options.fullPage || false,
        width: options.width,
        height: options.height,
        format: format || 'png',
        quality: options.quality,
        waitFor: options.wait,
        timeout: options.timeout,
        stealth: options.stealth || false,
        actions,
      });

      if (spinner) {
        spinner.succeed(`Screenshot taken (${result.format})`);
      }

      // Show usage footer for free/anonymous users
      if (usageCheck.usageInfo && !options.silent) {
        showUsageFooter(usageCheck.usageInfo, usageCheck.isAnonymous || false, true);
      }

      if (options.json) {
        // Output JSON with base64
        const jsonStr = JSON.stringify({
          url: result.url,
          format: result.format,
          contentType: result.contentType,
          screenshot: result.screenshot,
        }, null, 2);
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(jsonStr + '\n', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        // Save to file
        const ext = result.format === 'jpeg' ? 'jpg' : 'png';
        const outputPath = options.output || `screenshot.${ext}`;
        const buffer = Buffer.from(result.screenshot, 'base64');
        writeFileSync(outputPath, buffer);

        if (!options.silent) {
          console.error(`Screenshot saved to: ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
        }
      }

      await cleanup();
      process.exit(0);
    } catch (error) {
      if (spinner) {
        spinner.fail('Screenshot failed');
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

// ── Top-level Apply command group ──────────────────────────────────────────
//
// webpeel apply <url>          — submit a job application
// webpeel apply init           — interactive profile setup wizard
// webpeel apply status         — show application stats
// webpeel apply list           — list tracked applications (with filters)
// webpeel apply rate           — show rate-governor status

const applyCmd = program
  .command('apply')
  .description('Auto-apply pipeline: submit applications, track history, manage rate limits');

// apply <url>  — auto-apply to a job posting
applyCmd
  .command('submit <url>')
  .description('Auto-apply to a job posting')
  .alias('s')
  .option('--profile-path <path>', 'Path to apply profile JSON', `${process.env.HOME ?? '~'}/.webpeel/profile.json`)
  .option('--browser-profile <path>', 'Path to persistent browser data dir', `${process.env.HOME ?? '~'}/.webpeel/browser-profile`)
  .option('--headed', 'Run browser visibly (default for apply)')
  .option('--headless', 'Run browser invisibly')
  .option('--confirm', 'Pause for confirmation before submit (default: true)')
  .option('--no-confirm', 'Skip confirmation, auto-submit')
  .option('--dry-run', 'Go through flow but do not submit')
  .option('--generate-cover', 'Generate tailored cover letter (needs OPENAI_API_KEY)')
  .option('--timeout <ms>', 'Timeout in ms (default: 300000)', '300000')
  .option('--json', 'Output result as JSON')
  .option('--silent', 'Silent mode')
  .action(async (url: string, options) => {
    const isSilent = options.silent as boolean;
    const isJson = options.json as boolean;

    // Load profile
    const profilePath = options.profilePath as string;
    let profile: import('./core/apply.js').ApplyProfile;
    try {
      const raw = readFileSync(profilePath, 'utf-8');
      profile = JSON.parse(raw) as import('./core/apply.js').ApplyProfile;
    } catch {
      const msg = `Could not load profile from ${profilePath}. Run "webpeel apply init" to create one.`;
      if (isJson) {
        await writeStdout(JSON.stringify({ error: msg }) + '\n');
      } else {
        console.error(`Error: ${msg}`);
      }
      process.exit(1);
    }

    const spinner = isSilent ? null : ora('Applying...').start();

    try {
      const { applyToJob } = await import('./core/apply.js');

      const result = await applyToJob({
        url,
        profile,
        // Use sessionDir for persistent session storage (renamed from browserProfile)
        sessionDir: options.browserProfile as string | undefined,
        // Map dryRun flag → mode: 'dry-run'
        mode: (options.dryRun ? 'dry-run' : (options.noConfirm ? 'auto' : 'review')) as 'auto' | 'review' | 'dry-run',
        timeout: parseInt(options.timeout as string, 10) || 300_000,
      });

      if (spinner) spinner.stop();

      // Normalize result to a consistent output shape
      const success = result.submitted && !result.error;
      const jobTitle = result.job?.title ?? '';
      const jobCompany = result.job?.company ?? '';

      if (isJson) {
        await writeStdout(JSON.stringify(result, null, 2) + '\n');
        process.exit(success ? 0 : 1);
      }

      const icon = success ? '✅' : '❌';
      console.log(`\n${icon} ${success ? 'Application submitted!' : `Failed: ${result.error ?? 'Unknown error'}`}`);
      if (jobTitle) console.log(`   ${jobTitle}${jobCompany ? ` @ ${jobCompany}` : ''}`);
      if (options.dryRun) console.log('   (Dry run — not submitted)');
      console.log(`   Time: ${(result.elapsed / 1000).toFixed(1)}s\n`);

      process.exit(success ? 0 : 1);
    } catch (error) {
      if (spinner) spinner.fail('Application failed');
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (isJson) {
        await writeStdout(JSON.stringify({ error: msg }) + '\n');
      } else {
        console.error(`Error: ${msg}`);
      }
      process.exit(1);
    }
  });

// apply init  — interactive profile setup
applyCmd
  .command('init')
  .description('Interactive profile setup — creates ~/.webpeel/profile.json')
  .action(async () => {
    const { createInterface } = await import('readline');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

    console.log('\n🤖 WebPeel Apply Setup — Create your applicant profile\n');
    console.log('This creates ~/.webpeel/profile.json used by "webpeel apply submit".\n');

    try {
      const name = await ask('Full name: ');
      const email = await ask('Email address: ');
      const phone = await ask('Phone number (optional): ');
      const resumePath = await ask('Path to resume PDF (e.g. /Users/you/resume.pdf): ');
      const currentTitle = await ask('Current/most recent job title: ');
      const yearsExp = await ask('Years of experience: ');
      const skills = await ask('Skills (comma-separated, e.g. TypeScript, React, Node.js): ');
      const education = await ask('Education (e.g. B.S. Computer Science, MIT): ');
      const location = await ask('City, State (e.g. San Francisco, CA): ');
      const workAuth = await ask('Work authorization (e.g. US Citizen, Permanent Resident, H-1B, Need Sponsorship): ');
      const linkedinUrl = await ask('LinkedIn URL (optional): ');
      const websiteUrl = await ask('Portfolio/website URL (optional): ');
      const desiredSalary = await ask('Desired salary (optional, e.g. $150,000): ');

      rl.close();

      const { mkdirSync: mk, writeFileSync: wf } = await import('fs');
      const { join: j } = await import('path');
      const { homedir: hd } = await import('os');

      const webpeelDir = j(hd(), '.webpeel');
      mk(webpeelDir, { recursive: true });

      const profile = {
        name,
        email,
        ...(phone ? { phone } : {}),
        resumePath,
        currentTitle,
        yearsExperience: parseInt(yearsExp, 10) || 0,
        skills: skills.split(',').map((s: string) => s.trim()).filter(Boolean),
        education,
        location,
        workAuthorization: workAuth,
        ...(linkedinUrl ? { linkedinUrl } : {}),
        ...(websiteUrl ? { websiteUrl } : {}),
        ...(desiredSalary ? { desiredSalary } : {}),
      };

      const profilePath = j(webpeelDir, 'profile.json');
      wf(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

      console.log(`\n✅ Profile saved to: ${profilePath}`);
      console.log('\nNext steps:');
      console.log('  • Apply to a job:  webpeel apply submit <url>');
      console.log('  • Dry run first:   webpeel apply submit <url> --dry-run');
      console.log('  • View stats:      webpeel apply status\n');
    } catch (error) {
      rl.close();
      console.error(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// apply status  — application stats summary
applyCmd
  .command('status')
  .description('Show application stats')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const { ApplicationTracker } = await import('./core/application-tracker.js');
      const tracker = new ApplicationTracker();
      const stats = tracker.stats();

      if (options.json) {
        await writeStdout(JSON.stringify(stats, null, 2) + '\n');
        process.exit(0);
      }

      console.log('\n📊 Application Stats\n');
      console.log(`  Total:     ${stats.total}`);
      console.log(`  Today:     ${stats.today}`);
      console.log(`  This week: ${stats.thisWeek}`);

      if (Object.keys(stats.byPlatform).length > 0) {
        console.log('\n  By Platform:');
        for (const [platform, count] of Object.entries(stats.byPlatform)) {
          console.log(`    ${platform.padEnd(12)} ${count}`);
        }
      }

      if (Object.keys(stats.byStatus).length > 0) {
        console.log('\n  By Status:');
        for (const [status, count] of Object.entries(stats.byStatus)) {
          console.log(`    ${status.padEnd(12)} ${count}`);
        }
      }

      console.log('');
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// apply list  — list applications with optional filters
applyCmd
  .command('list')
  .description('List tracked applications')
  .option('--platform <platform>', 'Filter by platform (e.g. linkedin, upwork)')
  .option('--status <status>', 'Filter by status (applied, interview, rejected, offer, ...)')
  .option('--since <date>', 'Filter to applications on or after this date (YYYY-MM-DD)')
  .option('--json', 'Output as JSON')
  .option('--limit <n>', 'Max records to show (default: 50)', '50')
  .action(async (options) => {
    try {
      const { ApplicationTracker } = await import('./core/application-tracker.js');
      const tracker = new ApplicationTracker();
      const limit = parseInt(options.limit as string, 10) || 50;
      const records = tracker.list({
        platform: options.platform as string | undefined,
        status: options.status as string | undefined,
        since: options.since as string | undefined,
      }).slice(0, limit);

      if (options.json) {
        await writeStdout(JSON.stringify(records, null, 2) + '\n');
        process.exit(0);
      }

      if (records.length === 0) {
        console.log('\nNo applications found.\n');
        process.exit(0);
      }

      console.log(`\n📋 Applications (${records.length})\n`);

      const colDate = 12;
      const colStatus = 10;
      const colTitle = 35;
      const colCompany = 20;
      const pad = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);

      console.log(` ${'Date'.padEnd(colDate)}  ${'Status'.padEnd(colStatus)}  ${'Title'.padEnd(colTitle)}  ${'Company'.padEnd(colCompany)}`);
      console.log(` ${'-'.repeat(colDate)}  ${'-'.repeat(colStatus)}  ${'-'.repeat(colTitle)}  ${'-'.repeat(colCompany)}`);

      for (const r of records) {
        const dateStr = r.appliedAt.slice(0, 10);
        console.log(` ${pad(dateStr, colDate)}  ${pad(r.status, colStatus)}  ${pad(r.title, colTitle)}  ${pad(r.company, colCompany)}`);
      }

      console.log('');
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// apply rate  — rate governor status
applyCmd
  .command('rate')
  .description('Show rate governor status (daily limits, cooldown, next allowed time)')
  .option('--json', 'Output as JSON')
  .option('--reset-cooldown', 'Clear any active cooldown (manual override)')
  .action(async (options) => {
    try {
      const { RateGovernor, formatDuration } = await import('./core/rate-governor.js');
      const governor = new RateGovernor();

      if (options.resetCooldown) {
        governor.resetCooldown();
        console.log('✅ Cooldown cleared.');
        process.exit(0);
      }

      const state = governor.getState();
      const config = governor.getConfig();
      const check = governor.canApply();

      if (options.json) {
        await writeStdout(JSON.stringify({
          state,
          config,
          canApply: check.allowed,
          reason: check.reason,
          waitMs: check.waitMs,
          nextDelayMs: governor.getNextDelay(),
        }, null, 2) + '\n');
        process.exit(0);
      }

      console.log('\n⏱  Rate Governor Status\n');
      console.log(`  Today's applications: ${state.todayCount} / ${config.maxPerDay}`);
      console.log(`  Total applications:   ${state.totalApplications}`);
      console.log(`  Can apply now:        ${check.allowed ? '✅ Yes' : '❌ No'}`);
      if (!check.allowed && check.reason) {
        console.log(`  Reason:               ${check.reason}`);
      }
      if (!check.allowed && check.waitMs) {
        console.log(`  Wait time:            ${formatDuration(check.waitMs)}`);
      }
      if (state.cooldownUntil > 0) {
        const remaining = state.cooldownUntil - Date.now();
        console.log(`  Cooldown:             Active (${formatDuration(Math.max(0, remaining))} remaining)`);
      }
      console.log(`  Min delay:            ${formatDuration(config.minDelayMs)}`);
      console.log(`  Max delay:            ${formatDuration(config.maxDelayMs)}`);
      console.log(`  Active hours:         ${config.activeHours[0]}:00 – ${config.activeHours[1]}:00`);
      console.log(`  Weekdays only:        ${config.weekdaysOnly ? 'Yes' : 'No'}`);
      console.log('');

      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

program.parse();

// ============================================================
// Time formatting helper
// ============================================================

/**
 * Format a past Date relative to now (e.g. "2h ago", "5m ago").
 */
function formatRelativeTime(past: Date): string {
  const diffMs = Date.now() - past.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

// ============================================================
// Error classification for JSON error output (#6)
// ============================================================

function classifyErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'FETCH_FAILED';

  // Check for our custom _code first (set in pre-fetch validation)
  if ((error as any)._code) return (error as any)._code;

  const msg = error.message.toLowerCase();
  const name = error.name || '';

  if (name === 'TimeoutError' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'TIMEOUT';
  }
  if (name === 'BlockedError' || msg.includes('blocked') || msg.includes('403') || msg.includes('cloudflare')) {
    return 'BLOCKED';
  }
  if (msg.includes('enotfound') || msg.includes('getaddrinfo') || msg.includes('dns resolution failed') || msg.includes('not found')) {
    return 'DNS_FAILED';
  }
  if (msg.includes('invalid url') || msg.includes('invalid hostname') || msg.includes('only http')) {
    return 'INVALID_URL';
  }

  return 'FETCH_FAILED';
}

// ============================================================
// Envelope builder — unified JSON output schema
// ============================================================

interface OutputExtra {
  /** Was this result served from the local cache? */
  cached?: boolean;
  /** Structured listings data (from --extract-all) */
  structured?: Record<string, unknown>[];
  /** Was content distilled/truncated to fit a budget? */
  truncated?: boolean;
  /** Total items available before budget limiting (listings only) */
  totalAvailable?: number;
}

/**
 * Build a unified PeelEnvelope from a PeelResult.
 *
 * All existing PeelResult fields are spread first (backward compatibility),
 * then canonical envelope fields override/extend them.
 */
function buildEnvelope(result: PeelResult, extra: OutputExtra): PeelEnvelope & Record<string, unknown> {
  const envelope: PeelEnvelope & Record<string, unknown> = {
    // Spread all PeelResult fields for backward compatibility
    ...(result as unknown as Record<string, unknown>),
    // Required envelope fields (override PeelResult where they overlap)
    url: result.url,
    status: 200,
    content: result.content,
    metadata: {
      title: result.title,
      ...(result.metadata as Record<string, unknown>),
    },
    tokens: result.tokens,
    cached: extra.cached ?? false,
    elapsed: result.elapsed,
  };

  // Optional envelope fields — only include when meaningful
  if (extra.structured !== undefined) envelope.structured = extra.structured;
  if (extra.truncated) envelope.truncated = true;
  if (extra.totalAvailable !== undefined) envelope.totalAvailable = extra.totalAvailable;

  return envelope;
}

// ============================================================
// Shared output helper
// ============================================================

async function outputResult(result: PeelResult, options: any, extra: OutputExtra = {}): Promise<void> {
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

  // --images: output only image URLs
  if (options.images) {
    // Extract image URLs from links that point to images
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];
    const imageUrls = result.links.filter(link => {
      const urlLower = link.toLowerCase();
      return imageExtensions.some(ext => urlLower.includes(ext));
    });
    
    if (options.json) {
      const jsonStr = JSON.stringify(imageUrls, null, 2);
      await writeStdout(jsonStr + '\n');
    } else {
      for (const imageUrl of imageUrls) {
        await writeStdout(imageUrl + '\n');
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
      cached: extra.cached ?? false,
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
      console.log(`Cached:      ${meta.cached}`);
    }
    return;
  }

  // Default: full output
  if (options.json) {
    const envelope = buildEnvelope(result, extra);
    await writeStdout(JSON.stringify(envelope, null, 2) + '\n');
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

/**
 * Convert an array of listing items to CSV.
 */
function formatListingsCsv(items: Array<Record<string, string | undefined>>): string {
  if (items.length === 0) return '';

  // Collect all keys
  const keySet = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (item[key] !== undefined) keySet.add(key);
    }
  }
  const keys = Array.from(keySet);

  const escapeCsv = (s: string | undefined): string => {
    if (s === undefined || s === null) return '""';
    const str = String(s);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return '"' + str + '"';
  };

  const lines: string[] = [keys.join(',')];
  for (const item of items) {
    lines.push(keys.map(k => escapeCsv(item[k])).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Normalise the result of --extract (which may be a flat object or contain
 * arrays) into an array of row objects suitable for CSV / table rendering.
 */
function normaliseExtractedToRows(extracted: Record<string, any>): Array<Record<string, string | undefined>> {
  // If every value is an array of the same length, zip them into rows
  const values = Object.values(extracted);
  const allArrays = values.length > 0 && values.every(v => Array.isArray(v));
  if (allArrays) {
    const length = (values[0] as any[]).length;
    const rows: Array<Record<string, string | undefined>> = [];
    for (let i = 0; i < length; i++) {
      const row: Record<string, string | undefined> = {};
      for (const key of Object.keys(extracted)) {
        const val = (extracted[key] as any[])[i];
        row[key] = val != null ? String(val) : undefined;
      }
      rows.push(row);
    }
    return rows;
  }

  // Otherwise treat as a single row
  const row: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(extracted)) {
    row[k] = v != null ? String(v) : undefined;
  }
  return [row];
}

// Helper function to extract colors from content
function extractColors(content: string): string[] {
  const colors: string[] = [];
  const hexRegex = /#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}/g;
  const matches = content.match(hexRegex);
  if (matches) {
    colors.push(...[...new Set(matches)].slice(0, 10));
  }
  return colors;
}

// Helper function to extract font information
function extractFonts(content: string): string[] {
  const fonts: string[] = [];
  const fontRegex = /font-family:\s*([^;}"'\n]+)/gi;
  let match;
  while ((match = fontRegex.exec(content)) !== null) {
    fonts.push(match[1].trim());
  }
  return [...new Set(fonts)].slice(0, 5);
}
