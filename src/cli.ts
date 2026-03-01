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
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { getProfilePath, loadStorageState, touchProfile, listProfiles, deleteProfile, createProfile } from './core/profiles.js';
import { peel, peelBatch, cleanup } from './index.js';
import type { PeelOptions, PeelResult, PeelEnvelope, PageAction } from './types.js';
import { checkUsage, showUsageFooter, handleLogin, handleLogout, handleUsage, loadConfig, saveConfig } from './cli-auth.js';
import { getCache, setCache, parseTTL, clearCache, cacheStats } from './cache.js';
import { estimateTokens } from './core/markdown.js';
import { distillToBudget, budgetListings } from './core/budget.js';
import { SCHEMA_TEMPLATES, getSchemaTemplate, listSchemaTemplates } from './core/schema-templates.js';

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
        // scroll:down:500  or  scroll:bottom  or  scroll:500  or  scroll:0,1500
        const parts = value.split(':');
        const dir = parts[0];

        // Handle scroll:x,y format (e.g., scroll:0,1500)
        if (dir && dir.includes(',')) {
          const [x, y] = dir.split(',').map(Number);
          if (!isNaN(x) && !isNaN(y)) {
            return { type: 'scroll' as const, to: { x, y } };
          }
        }

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

/**
 * Format an error with actionable suggestions based on error type
 */
function formatError(error: Error, _url: string, options: any): string {
  const msg = error.message || String(error);
  const lines: string[] = [`\x1b[31m✖ ${msg}\x1b[0m`];

  if (msg.includes('net::ERR_') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    lines.push('\x1b[33m💡 Check the URL is correct and the site is accessible.\x1b[0m');
  } else if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('Navigation timeout')) {
    lines.push('\x1b[33m💡 Try increasing timeout: --timeout 60000\x1b[0m');
    if (!options.render) {
      lines.push('\x1b[33m💡 Site may need browser rendering: --render\x1b[0m');
    }
  } else if (msg.includes('blocked') || msg.includes('403') || msg.includes('Access Denied') || msg.includes('challenge')) {
    if (!options.stealth) {
      lines.push('\x1b[33m💡 Try stealth mode to bypass bot detection: --stealth\x1b[0m');
    }
    lines.push('\x1b[33m💡 Try a different user agent: --ua "Mozilla/5.0..."\x1b[0m');
  } else if (msg.includes('empty') || msg.includes('no content') || msg.includes('0 tokens')) {
    if (!options.render) {
      lines.push('\x1b[33m💡 Page may be JavaScript-rendered. Try: --render\x1b[0m');
    } else if (!options.stealth) {
      lines.push('\x1b[33m💡 Content may be behind bot detection. Try: --stealth\x1b[0m');
    }
    lines.push('\x1b[33m💡 Try waiting longer for content: --wait 5000\x1b[0m');
  } else if (msg.includes('captcha') || msg.includes('CAPTCHA') || msg.includes('Captcha')) {
    lines.push('\x1b[33m💡 This site requires CAPTCHA solving. Try a browser profile: --profile mysite --headed\x1b[0m');
  } else if (msg.includes('rate limit') || msg.includes('429')) {
    lines.push('\x1b[33m💡 Rate limited. Wait a moment and try again, or use --proxy.\x1b[0m');
  } else if (msg.toLowerCase().includes('enotfound') || msg.toLowerCase().includes('getaddrinfo')) {
    lines.push('\x1b[33m💡 Could not resolve hostname. Check the URL is correct.\x1b[0m');
  } else if (msg.toLowerCase().includes('certificate') || msg.toLowerCase().includes('ssl') || msg.toLowerCase().includes('tls')) {
    lines.push('\x1b[33m💡 SSL/TLS error. The site may have an invalid certificate.\x1b[0m');
  } else if (msg.toLowerCase().includes('usage') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('limit')) {
    lines.push('\x1b[33m💡 Run `webpeel usage` to check your quota, or `webpeel login` to authenticate.\x1b[0m');
  }

  return lines.join('\n');
}

program
  .argument('[url]', 'URL to fetch')
  .option('-r, --render', 'Use headless browser (for JS-heavy sites)')
  .option('--stealth', 'Use stealth mode to bypass bot detection (auto-enables --render)')
  .option('--cloaked', 'Use CloakBrowser stealth (requires: npm install cloakbrowser)')
  .option('--tls', 'Use PeelTLS TLS fingerprint spoofing (built-in, no install needed)')
  .option('--cycle', 'Use PeelTLS TLS fingerprint spoofing (alias for --tls)', false)
  .option('--proxy <url>', 'Proxy URL for requests (http://host:port, socks5://user:pass@host:port)')
  .option('--proxies <urls>', 'Comma-separated list of proxy URLs for rotation (tried in order on failure)', (val: string) => val.split(',').map((s: string) => s.trim()).filter(Boolean))
  .option('-w, --wait <ms>', 'Wait time after page load (ms)', parseInt)
  .option('--html', 'Output raw HTML instead of markdown')
  .option('--text', 'Output plain text instead of markdown')
  .option('--clean', 'Clean output — article content only, no links or metadata (alias for --readable with URL-stripped markdown)')
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
  .option('--full-content', 'Return full page content (disable automatic content density pruning)')
  .option('--readable', 'Reader mode — extract only the main article content, strip all noise (like browser Reader Mode)')
  .option('--full-nav', 'Keep full navigation/content (disable auto-readability when piped or in agent mode)')
  .option('--focus <query>', 'Query-focused filtering — only return content relevant to this query (BM25 ranking)')
  .option('--chunk', 'Split content into RAG-ready chunks')
  .option('--chunk-size <tokens>', 'Max tokens per chunk (default: 512)', parseInt)
  .option('--chunk-overlap <tokens>', 'Overlap tokens between chunks (default: 50)', parseInt)
  .option('--chunk-strategy <strategy>', 'Chunking strategy: section (default), paragraph, fixed')
  .option('-H, --header <header...>', 'Custom headers (e.g., "Authorization: Bearer token")')
  .option('--cookie <cookie...>', 'Cookies to set (e.g., "session=abc123")')
  .option('--cache <ttl>', 'Cache results locally (e.g., "5m", "1h", "1d") — default: 5m')
  .option('--no-cache', 'Disable automatic caching for this request')
  .option('--links', 'Output only the links found on the page')
  .option('--images', 'Output image URLs from the page')
  .option('--meta', 'Output only the page metadata (title, description, author, etc.)')
  .option('--raw', 'Return full page without smart content extraction')
  .option('--full', 'Alias for --raw — full page content, no budget')
  .option('--lite', 'Lite mode — minimal processing, maximum speed (skip pruning, budget, metadata)')
  .option('--action <actions...>', 'Page actions before scraping (e.g., "click:.btn" "wait:2000" "scroll:bottom")')
  .option('--extract <json>', 'Extract structured data using CSS selectors (JSON object of field:selector pairs)')
  .option('--llm-extract [instruction]', 'Extract structured data using LLM (optional instruction, e.g. "extract hotel names and prices")')
  .option('--extract-schema <schema>', 'JSON schema for structured extraction (requires LLM key). Pass inline JSON or @file.json')
  .option('--llm-key <key>', 'LLM API key for AI features (or use OPENAI_API_KEY env var)')
  .option('--llm-model <model>', 'LLM model to use (default: gpt-4o-mini)')
  .option('--llm-base-url <url>', 'LLM API base URL (default: https://api.openai.com/v1)')
  .option('--summary', 'Generate AI summary of content (requires --llm-key or OPENAI_API_KEY)')
  .option('--location <country>', 'ISO country code for geo-targeting (e.g., "US", "DE", "JP")')
  .option('--language <lang>', 'Language preference (e.g., "en", "de", "ja")')
  .option('--max-tokens <n>', 'Maximum token count for output (truncate if exceeded)', parseInt)
  .option('--budget <n>', 'Smart token budget — distill content to fit within N tokens (heuristic, no LLM key needed)', parseInt)
  .option('--extract-all', 'Auto-detect and extract repeated listing items (e.g., search results)')
  .option('--schema <name>', 'Force a specific extraction schema by name or domain (e.g., "booking.com", "amazon")')
  .option('--list-schemas', 'List all available extraction schemas and their supported domains')
  .option('--scroll-extract [count]', 'Scroll page N times to load lazy content (bare flag = smart auto-scroll until stable), then extract (implies --render)', (v: string) => parseInt(v, 10))
  .option('--scroll-extract-timeout <ms>', 'Total timeout in ms for auto-scroll (default: 30000, only used with bare --scroll-extract)', parseInt)
  .option('--csv', 'Output extraction results as CSV')
  .option('--table', 'Output extraction results as a formatted table')
  .option('--pages <n>', 'Follow pagination "Next" links for N pages (max 10)', (v: string) => parseInt(v, 10))
  .option('--profile <path>', 'Use a persistent browser profile directory (cookies/sessions survive between calls)')
  .option('--headed', 'Run browser in headed (visible) mode — useful for profile setup and debugging')
  .option('-q, --question <q>', 'Ask a question about the page content (BM25-powered, no LLM key needed)')
  .option('--agent', 'Agent mode: sets --json, --silent, --extract-all, and --budget 4000 (override with --budget N)')
  .option('--device <type>', 'Device emulation: desktop (default), mobile, tablet (auto-enables --render)')
  .option('--viewport <WxH>', 'Browser viewport size (e.g., "1920x1080") (auto-enables --render)', (val: string) => {
    const [w, h] = val.split('x').map(Number);
    return { width: w, height: h };
  })
  .option('--wait-until <event>', 'Page load event: domcontentloaded, networkidle, load, commit (auto-enables --render)')
  .option('--wait-selector <css>', 'Wait for CSS selector before extracting (auto-enables --render)')
  .option('--block-resources <types>', 'Block resource types, comma-separated: image,stylesheet,font,media,script (auto-enables --render)')

// ─── Help System ─────────────────────────────────────────────────────────────

// Detect --help-all early, before Commander parses argv.
const isHelpAll = process.argv.slice(2).some(a => a === '--help-all');
if (isHelpAll) {
  // Translate --help-all → --help so Commander generates its standard output.
  const idx = process.argv.indexOf('--help-all');
  if (idx !== -1) process.argv[idx] = '--help';
}

// ANSI helpers (fall back gracefully when colors are disabled).
const NO_COLOR = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
const bold = (s: string) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`;
const dim  = (s: string) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`;

/**
 * Reconstruct the standard Commander help layout for --help-all and subcommands.
 * This mirrors Commander's own default formatHelp() so subcommand help keeps working.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCommanderHelp(cmd: any, helper: any): string {
  const termWidth = helper.padWidth(cmd, helper);
  const helpWidth = (helper.helpWidth as number | undefined) ?? 80;
  const pad = '  ';

  const formatItem = (term: string, description: string): string => {
    if (description) {
      const full = `${term.padEnd(termWidth + 2)}${description}`;
      return helper.wrap(full, helpWidth - pad.length, termWidth + 2) as string;
    }
    return term;
  };
  const formatList = (items: string[]) => items.join('\n').replace(/^/gm, pad);

  let out: string[] = [`Usage: ${helper.commandUsage(cmd) as string}`, ''];

  const desc = helper.commandDescription(cmd) as string;
  if (desc.length > 0) {
    out = out.concat([helper.wrap(desc, helpWidth, 0) as string, '']);
  }

  // Arguments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = (helper.visibleArguments(cmd) as any[]).map(a =>
    formatItem(helper.argumentTerm(a) as string, helper.argumentDescription(a) as string)
  );
  if (args.length > 0) out = out.concat(['Arguments:', formatList(args), '']);

  // Options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts = (helper.visibleOptions(cmd) as any[]).map(o =>
    formatItem(helper.optionTerm(o) as string, helper.optionDescription(o) as string)
  );
  if (opts.length > 0) out = out.concat(['Options:', formatList(opts), '']);

  // Subcommands
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmds = (helper.visibleCommands(cmd) as any[]).map(c =>
    formatItem(helper.subcommandTerm(c) as string, helper.subcommandDescription(c) as string)
  );
  if (cmds.length > 0) out = out.concat(['Commands:', formatList(cmds), '']);

  // Append grouped option sections only on root command (--help-all)
  if (cmd.parent === null) {
    out = out.concat([`
Output Formats:
  --json                  JSON output with full metadata
  --html                  Raw HTML output
  --text                  Plain text output
  --csv / --table         Tabular output for extractions
  -s, --silent            No spinner or progress output

Content Control:
  --readable              Reader mode — clean article content only
  --budget <n>            Smart token budget (no LLM key needed)
  --focus <query>         BM25 query-focused filtering
  --selector <css>        Extract specific CSS selector
  --only-main-content     Just main/article content
  --full-content          Disable content pruning
  -q, --question <q>      Ask a question about the content

Rendering:
  -r, --render            Browser rendering for JS-heavy sites
  --stealth               Stealth mode for bot-protected sites
  --profile <path>        Persistent browser profile
  --headed                Visible browser (for debugging)
  --action <actions>      Browser automation (click, type, scroll...)

Extraction:
  --extract <json>        CSS selector extraction
  --extract-all           Auto-detect listing items
  --schema <name>         Named extraction schema
  --llm-extract [inst]    LLM-powered extraction (BYOK)

Examples:
  $ webpeel "https://example.com"                              Basic fetch
  $ webpeel "https://youtube.com/watch?v=..." --json           YouTube transcript
  $ webpeel "https://openai.com/pricing" -q "GPT-4 cost?"     Quick answer
  $ webpeel "https://nytimes.com/article" --readable           Reader mode
  $ webpeel search "best restaurants in NYC"                   Web search
  $ webpeel hotels "Manhattan" --checkin tomorrow              Hotel search

Agent Integration:
  $ webpeel mcp                                                Start MCP server
  $ cat urls.txt | webpeel batch                               Batch from stdin
  $ webpeel pipe "https://example.com" | jq .content           Pipe-friendly JSON
  $ webpeel "https://site.com" --json --silent                 Same as pipe
  $ curl https://webpeel.dev/llms.txt                          AI-readable docs
`]);
  }

  return out.join('\n');
}

/**
 * Condensed, Anthropic-style help for the root command (default --help).
 */
function buildCondensedHelp(): string {
  const v = cliVersion;
  return [
    '',
    `  ${bold('◆ WebPeel')} ${dim(`v${v}`)}`,
    `  ${dim('The web data platform for AI agents')}`,
    '',
    `  ${bold('Usage:')}  webpeel [url] [options]`,
    `          webpeel <command> [options]`,
    '',
    `  ${bold('Examples:')}`,
    `    webpeel https://example.com            ${dim('Clean content (reader mode)')}`,
    `    webpeel read https://example.com       ${dim('Explicit reader mode')}`,
    `    webpeel screenshot https://example.com ${dim('Screenshot any page')}`,
    `    webpeel ask https://news.com "summary" ${dim('Ask about any page')}`,
    `    webpeel search "webpeel vs jina"       ${dim('Web search')}`,
    `    echo "url" | webpeel                   ${dim('Pipe mode (auto JSON)')}`,
    '',
    `  ${bold('Commands:')}`,
    `    fetch (default)       Fetch a URL as clean markdown`,
    `    read <url>            Reader mode (article content only)`,
    `    screenshot <url>      Take a screenshot`,
    `    ask <url> <question>  Ask about any page`,
    `    search <query>        Search the web (DuckDuckGo + sources)`,
    `    crawl <url>           Crawl a website`,
    `    mcp                   Start MCP server for AI tools`,
    `    ${dim('... (use --help-all for all 25+ commands)')}`,
    '',
    `  ${bold('Common Options:')}`,
    `    -r, --render          Browser rendering (JS-heavy sites)`,
    `    --stealth             Stealth mode (anti-bot bypass)`,
    `    --raw                 Full page (disable auto reader mode)`,
    `    --full                Full page, no budget limit`,
    `    --json                JSON output with metadata`,
    `    --budget: 4000)`,
    `    -q, --question <q>    Ask about the content`,
    `    -s, --silent          No spinner output`,
    '',
    `  Use ${cyan("'webpeel <command> --help'")} for command-specific options.`,
    `  Use ${cyan("'webpeel --help-all'")} for the full option reference.`,
    '',
    `  Docs: ${cyan('https://webpeel.dev/docs')}`,
    '',
  ].join('\n');
}

program.configureHelp({
  sortSubcommands: true,
  showGlobalOptions: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatHelp: (cmd: any, helper: any): string => {
    // Subcommands always get standard Commander help.
    // Root command with --help-all also gets standard full help.
    if (cmd.parent !== null || isHelpAll) {
      return buildCommanderHelp(cmd, helper);
    }
    // Root command default: beautiful condensed help.
    return buildCondensedHelp();
  },
});

// Main fetch handler — shared with the `pipe` subcommand
async function runFetch(url: string | undefined, options: any): Promise<void> {
    // Smart defaults: when piped (not a TTY), default to silent JSON + budget
    const isPiped = !process.stdout.isTTY;
    if (isPiped && !options.html && !options.text) {
      if (!options.json) options.json = true;
      if (!options.silent) options.silent = true;
      // Auto-enable readability for AI consumers — clean content by default
      if (!options.readable && !options.fullNav) {
        options.readable = true;
      }
      // Auto token budget for piped mode (AI consumers want concise content)
      if (options.budget === undefined && !options.fullContent && !options.raw && !options.full) {
        options.budget = 4000;
      }
    }

    // --full alias: sets raw + fullContent
    if (options.full) {
      options.raw = true;
      options.fullContent = true;
    }

    // Smart defaults for terminal (interactive) mode
    const isTerminal = process.stdout.isTTY && !isPiped;
    if (isTerminal && !options.raw && !options.html && !options.text) {
      // Auto-readable: clean content by default (like browser Reader Mode)
      if (!options.readable && !options.fullNav && !options.selector) {
        options.readable = true;
      }
      // Default token budget: don't flood the terminal with 20K tokens
      if (options.budget === undefined && !options.fullContent && !options.raw) {
        options.budget = 4000;
      }
    }

    // --agent sets sensible defaults for AI agents; explicit flags override
    if (options.agent) {
      if (!options.json) options.json = true;
      if (!options.silent) options.silent = true;
      if (!options.extractAll) options.extractAll = true;
      if (options.budget === undefined) options.budget = 4000;
      // Agent mode = clean content by default
      if (!options.readable && !options.fullNav) {
        options.readable = true;
      }
    }

    const isJson = options.json;

    // --- --list-schemas: print all available schemas and exit ---
    if (options.listSchemas) {
      const { loadBundledSchemas } = await import('./core/schema-extraction.js');
      const schemas = loadBundledSchemas();
      if (isJson) {
        await writeStdout(JSON.stringify(schemas.map(s => ({
          name: s.name,
          version: s.version,
          domains: s.domains,
          urlPatterns: s.urlPatterns,
        })), null, 2) + '\n');
      } else {
        console.log(`\nAvailable extraction schemas (${schemas.length}):\n`);
        for (const s of schemas) {
          console.log(`  ${s.name} (v${s.version})`);
          console.log(`    Domains: ${s.domains.join(', ')}`);
          if (s.urlPatterns && s.urlPatterns.length > 0) {
            console.log(`    URL patterns: ${s.urlPatterns.join(', ')}`);
          }
          console.log('');
        }
      }
      process.exit(0);
    }

    // --- #5: Concise error for missing URL (no help dump) ---
    if (!url || url.trim() === '') {
      if (isJson) {
        await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_request', message: 'URL is required' } }) + '\n');
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
        process.stdout.write(JSON.stringify({
          success: false,
          error: { type: code.toLowerCase(), message },
        }) + '\n');
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
        await writeStdout(JSON.stringify({ success: false, error: { type: 'rate_limited', message: usageCheck.message } }) + '\n');
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
        format: options.html ? 'html' : options.text ? 'text' : options.clean ? 'clean' : 'markdown',
        budget: null,  // Budget excluded from cache key — cache stores full content
        readable: options.readable || false,
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
        // LLM extraction from cached content
        if (options.llmExtract || options.extractSchema) {
          const { extractWithLLM } = await import('./core/llm-extract.js');
          const llmCfgCached = loadConfig();
          const llmApiKeyCached = options.llmKey || llmCfgCached.llm?.apiKey || process.env.OPENAI_API_KEY;
          if (!llmApiKeyCached) {
            console.error('Error: LLM extraction requires an API key.\nSet OPENAI_API_KEY environment variable or use --llm-key <key>');
            process.exit(1);
          }
          const llmModelCached = options.llmModel || llmCfgCached.llm?.model || process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini';
          const llmBaseUrlCached = options.llmBaseUrl || llmCfgCached.llm?.baseUrl || process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1';
          const llmInstructionCached = typeof options.llmExtract === 'string' ? options.llmExtract : undefined;
          // Parse schema if provided
          let llmSchemaCached: object | undefined;
          if (options.extractSchema) {
            let schemaStr: string = options.extractSchema;
            if (schemaStr.startsWith('@')) {
              schemaStr = readFileSync(schemaStr.slice(1), 'utf-8');
            }
            try {
              llmSchemaCached = JSON.parse(schemaStr);
            } catch {
              console.error('Error: --extract-schema must be valid JSON or a valid @file.json path');
              process.exit(1);
            }
          }
          const llmResultCached = await extractWithLLM({
            content: cachedResult.content,
            instruction: llmInstructionCached,
            schema: llmSchemaCached,
            apiKey: llmApiKeyCached,
            model: llmModelCached,
            baseUrl: llmBaseUrlCached,
          });
          await writeStdout(JSON.stringify(llmResultCached.items, null, 2) + '\n');
          if (!options.silent) {
            const { input, output } = llmResultCached.tokensUsed;
            const costStr = llmResultCached.cost !== undefined ? ` | Est. cost: $${llmResultCached.cost.toFixed(6)}` : '';
            console.error(`\n🤖 LLM extraction: ${llmResultCached.items.length} items | ${input} input + ${output} output tokens${costStr} | model: ${llmResultCached.model}`);
          }
          process.exit(0);
        }
        // --- LLM-free Quick Answer (also on cached content) ---
        if (options.question && cachedResult.content) {
          const { quickAnswer } = await import('./core/quick-answer.js');
          const qa = quickAnswer({
            question: options.question as string,
            content: cachedResult.content,
            url: cachedResult.url,
          });
          (cachedResult as any).quickAnswer = qa;

          if (!isJson) {
            const conf = (qa.confidence * 100).toFixed(0);
            await writeStdout(`\n\x1b[36m📋 ${qa.question}\x1b[0m\n\n`);
            if (qa.answer) {
              await writeStdout(`\x1b[32m💡 Answer (${conf}% confidence):\x1b[0m\n${qa.answer}\n`);
            } else {
              await writeStdout(`\x1b[33m💡 No relevant answer found (${conf}% confidence)\x1b[0m\n`);
            }
            if (qa.passages && qa.passages.length > 1) {
              await writeStdout(`\n\x1b[33m📝 Supporting evidence:\x1b[0m\n`);
              for (const p of qa.passages.slice(1, 4)) {
                await writeStdout(`  • [${(p.score * 100).toFixed(0)}%] ${p.text.substring(0, 200)}${p.text.length > 200 ? '...' : ''}\n`);
              }
            }
            await writeStdout('\n');
            await cleanup();
            process.exit(0);
          }
        }

        // --- BM25 Schema Template Extraction (cached path) ---
        if (options.schema && cachedResult.content) {
          const { getSchemaTemplate: getSchTmplCached } = await import('./core/schema-templates.js');
          const schTemplateCached = getSchTmplCached(options.schema as string);
          if (schTemplateCached) {
            const { quickAnswer: qaCached } = await import('./core/quick-answer.js');
            const { smartExtractSchemaFields: smartExtractCached } = await import('./core/schema-postprocess.js');
            const extractedCached = smartExtractCached(
              cachedResult.content,
              schTemplateCached.fields,
              qaCached,
              {
                pageTitle: (cachedResult as any).title,
                pageUrl: (cachedResult as any).url,
                metadata: (cachedResult as any).metadata as Record<string, any>,
              },
            );
            (cachedResult as any).extracted = extractedCached;
          }
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

      // --extract-schema auto-enables JSON output
      if (options.extractSchema) {
        options.json = true;
      }

      // Parse extract
      let extract: any;
      if (options.llmExtract || options.extractSchema) {
        // LLM-based extraction is handled post-fetch (after peel returns markdown).
        // Early-validate that an API key is available so we fail fast.
        const llmCfg = loadConfig();
        const llmApiKey = options.llmKey || llmCfg.llm?.apiKey || process.env.OPENAI_API_KEY;
        if (!llmApiKey) {
          throw Object.assign(new Error(
            'LLM extraction requires an API key.\n' +
            'Set OPENAI_API_KEY environment variable or use --llm-key <key>'
          ), { _code: 'FETCH_FAILED' });
        }
        // Do NOT set extract here — peel runs normally, LLM extraction happens below.
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

      // ── Resolve --profile: name → path + storage state ─────────────────
      let resolvedProfileDir: string | undefined;
      let resolvedStorageState: any | undefined;
      let resolvedProfileName: string | undefined;

      if (options.profile) {
        const profilePath = getProfilePath(options.profile);
        if (profilePath) {
          // It's a named profile in ~/.webpeel/profiles/
          resolvedProfileDir = profilePath;
          resolvedStorageState = loadStorageState(options.profile) ?? undefined;
          resolvedProfileName = options.profile;
        } else if (existsSync(options.profile)) {
          // It's a raw directory path (backward compat)
          resolvedProfileDir = options.profile;
        } else {
          exitWithJsonError(
            `Profile "${options.profile}" not found. Run "webpeel profile list" to see available profiles.`,
            'PROFILE_NOT_FOUND',
          );
        }
      }

      // Build peel options
      // --stealth auto-enables --render (stealth requires browser)
      // --action auto-enables --render (actions require browser)
      // --scroll-extract implies --render (needs browser)
      //
      // Bare --scroll-extract (no number) → smart autoScroll (detects stable height)
      // --scroll-extract N (with number) → legacy fixed N scrolls via actions
      const scrollExtractRaw = options.scrollExtract;
      const isAutoScroll = scrollExtractRaw !== undefined && typeof scrollExtractRaw !== 'number';
      const scrollExtractCount = isAutoScroll
        ? 0
        : (scrollExtractRaw !== undefined ? scrollExtractRaw : 0);

      const useRender = options.render || options.stealth || (actions && actions.length > 0) || scrollExtractCount > 0 || isAutoScroll
        || (options.device && options.device !== 'desktop')
        || !!options.viewport
        || !!options.waitUntil
        || !!options.waitSelector
        || !!options.blockResources
        || !!options.screenshot  // Auto-enable render for screenshot (needs browser)
        || false;

      // Inject scroll actions when --scroll-extract N (fixed count) is used
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
        lite: options.lite || false,
        actions,
        maxTokens: options.maxTokens,
        // Note: budget is applied AFTER caching (so cache stores full content)
        // We pass it to peel() for programmatic API compatibility, but the CLI
        // also applies it post-fetch (see below) to ensure cache stores full result.
        extract,
        images: options.images || false,
        location: locationOptions,
        profileDir: resolvedProfileDir,
        headed: options.headed || false,
        storageState: resolvedStorageState,
        proxy: options.proxy as string | undefined,
        proxies: options.proxies as string[] | undefined,
        fullPage: options.fullContent || false,
        readable: options.readable || false,
        // Smart auto-scroll (bare --scroll-extract flag)
        autoScroll: isAutoScroll
          ? { timeout: options.scrollExtractTimeout }
          : undefined,
        device: options.device as 'desktop' | 'mobile' | 'tablet' | undefined,
        viewportWidth: options.viewport ? (options.viewport as { width: number; height: number }).width : undefined,
        viewportHeight: options.viewport ? (options.viewport as { width: number; height: number }).height : undefined,
        waitUntil: options.waitUntil as 'domcontentloaded' | 'networkidle' | 'load' | 'commit' | undefined,
        waitSelector: options.waitSelector as string | undefined,
        blockResources: options.blockResources ? (options.blockResources as string).split(',').map((s: string) => s.trim()) : undefined,
        cloaked: options.cloaked ? true : undefined,
        cycle: options.cycle ? true : undefined,
        tls: (options.tls || options.cycle) ? true : undefined,
      };

      if (options.cloaked) {
        peelOptions.render = true; // CloakBrowser is a browser
      }

      // Add chunk option if requested
      if (options.chunk) {
        peelOptions.chunk = {
          maxTokens: options.chunkSize || 512,
          overlap: options.chunkOverlap || 50,
          strategy: (options.chunkStrategy as 'section' | 'paragraph' | 'fixed') || 'section',
        };
      }

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
      } else if (options.clean) {
        peelOptions.format = 'clean';
        // --clean implies readable mode (article content only, no navs/footers)
        peelOptions.readable = true;
      } else {
        peelOptions.format = 'markdown';
      }

      // Fetch the page
      const result = await peel(url, peelOptions);

      // Update lastUsed timestamp for named profiles
      if (resolvedProfileName) {
        touchProfile(resolvedProfileName);
      }

      if (spinner) {
        const domainTag = (result as any).domainData
          ? ` [${(result as any).domainData.domain}:${(result as any).domainData.type}]`
          : '';
        spinner.succeed(`Fetched in ${result.elapsed}ms using ${result.method} method${domainTag}`);
      }

      // Show metadata header
      const pageTitle = result.metadata?.title || result.title;
      if (!options.silent && !options.json && pageTitle) {
        const parts: string[] = [];
        if (result.metadata?.author) parts.push(`by ${result.metadata.author}`);
        if ((result as any).readability?.readingTime) parts.push((result as any).readability.readingTime);
        if (result.tokens) parts.push(`${result.tokens.toLocaleString()} tokens`);
        const subtitle = parts.length ? ` · ${parts.join(' · ')}` : '';
        console.error(`\x1b[36m📄 ${pageTitle}${subtitle}\x1b[0m`);
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
          readable: options.readable || false,
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

      // --- BM25 Query-Focused Filtering ---
      if (options.focus && result.content) {
        const { filterByRelevance } = await import('./core/bm25-filter.js');
        const focusResult = filterByRelevance(result.content, { query: options.focus as string });
        (result as any).content = focusResult.content;
        (result as any).tokens = estimateTokens(focusResult.content);
        if (isJson) {
          (result as any).focusQuery = options.focus;
          (result as any).focusReduction = focusResult.reductionPercent;
        }
      }

      // --- LLM-free Quick Answer ---
      if (options.question && result.content) {
        const { quickAnswer } = await import('./core/quick-answer.js');
        const qa = quickAnswer({
          question: options.question as string,
          content: result.content,
          url: result.url,
        });
        (result as any).quickAnswer = qa;

        if (!isJson) {
          // Display answer prominently in human-readable mode
          const conf = (qa.confidence * 100).toFixed(0);
          await writeStdout(`\n\x1b[36m📋 ${qa.question}\x1b[0m\n\n`);
          if (qa.answer) {
            await writeStdout(`\x1b[32m💡 Answer (${conf}% confidence):\x1b[0m\n${qa.answer}\n`);
          } else {
            await writeStdout(`\x1b[33m💡 No relevant answer found (${conf}% confidence)\x1b[0m\n`);
          }
          if (qa.passages && qa.passages.length > 1) {
            await writeStdout(`\n\x1b[33m📝 Supporting evidence:\x1b[0m\n`);
            for (const p of qa.passages.slice(1, 4)) {
              await writeStdout(`  • [${(p.score * 100).toFixed(0)}%] ${p.text.substring(0, 200)}${p.text.length > 200 ? '...' : ''}\n`);
            }
          }
          await writeStdout('\n');
          await cleanup();
          process.exit(0);
        }
      }

      // --- RAG Chunking output (chunks come from pipeline via peelOptions.chunk) ---
      if (result.chunks && result.chunks.length > 0 && !isJson) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📦 ${result.chunks.length} chunks (${options.chunkStrategy || 'section'} strategy)\n`);
        for (const chunk of result.chunks) {
          const sectionLabel = chunk.section ? ` [${chunk.section}]` : '';
          console.log(`── Chunk ${chunk.index + 1}${sectionLabel} (${chunk.tokenCount} tokens, ${chunk.wordCount} words) ──`);
          console.log(chunk.text.substring(0, 200) + (chunk.text.length > 200 ? '...' : ''));
          console.log('');
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

      // --- LLM-based extraction (post-peel) ---
      if (options.llmExtract || options.extractSchema) {
        const { extractWithLLM } = await import('./core/llm-extract.js');
        const llmCfg = loadConfig();
        const llmApiKey = options.llmKey || llmCfg.llm?.apiKey || process.env.OPENAI_API_KEY;
        const llmModel = options.llmModel || llmCfg.llm?.model || process.env.WEBPEEL_LLM_MODEL || 'gpt-4o-mini';
        const llmBaseUrl = options.llmBaseUrl || llmCfg.llm?.baseUrl || process.env.WEBPEEL_LLM_BASE_URL || 'https://api.openai.com/v1';

        const llmInstruction = typeof options.llmExtract === 'string' ? options.llmExtract : undefined;

        // Parse --extract-schema if provided
        let llmSchema: object | undefined;
        if (options.extractSchema) {
          let schemaStr: string = options.extractSchema;
          if (schemaStr.startsWith('@')) {
            schemaStr = readFileSync(schemaStr.slice(1), 'utf-8');
          }
          try {
            llmSchema = JSON.parse(schemaStr);
          } catch {
            exitWithJsonError('--extract-schema must be valid JSON or a valid @file.json path', 'FETCH_FAILED');
          }
        }

        const llmResult = await extractWithLLM({
          content: result.content,
          instruction: llmInstruction,
          schema: llmSchema,
          apiKey: llmApiKey,
          model: llmModel,
          baseUrl: llmBaseUrl,
        });

        // Output structured items as JSON
        await writeStdout(JSON.stringify(llmResult.items, null, 2) + '\n');

        // Show token usage and estimated cost
        if (!options.silent) {
          const { input, output } = llmResult.tokensUsed;
          const costStr = llmResult.cost !== undefined
            ? ` | Est. cost: $${llmResult.cost.toFixed(6)}`
            : '';
          console.error(`\n🤖 LLM extraction: ${llmResult.items.length} items | ${input} input + ${output} output tokens${costStr} | model: ${llmResult.model}`);
        }

        await cleanup();
        process.exit(0);
      }

      // --- Extract-all / pagination / output formatting ---
      const wantsExtractAll = options.extractAll || options.scrollExtract !== undefined;
      const pagesCount = Math.min(Math.max(options.pages || 1, 1), 10);

      if (wantsExtractAll) {
        const { extractListings } = await import('./core/extract-listings.js');
        const { findNextPageUrl } = await import('./core/paginate.js');
        const { findSchemaForUrl, extractWithSchema, loadBundledSchemas } = await import('./core/schema-extraction.js');

        // Resolve which schema to use (explicit --schema flag or auto-detect)
        let activeSchema = null;
        if (options.schema) {
          // Find schema by name or domain match
          const schemaQuery = options.schema.toLowerCase();
          const allSchemas = loadBundledSchemas();
          activeSchema = allSchemas.find(s =>
            s.name.toLowerCase().includes(schemaQuery) ||
            s.domains.some(d => d.toLowerCase().includes(schemaQuery))
          ) ?? null;
          if (!activeSchema && !options.silent) {
            console.error(`Warning: No schema found for "${options.schema}", falling back to auto-detection`);
          }
        } else {
          // Auto-detect from URL
          activeSchema = findSchemaForUrl(result.url || url);
        }

        // We need the raw HTML for extraction. Re-fetch with format=html if needed.
        let allListings: import('./core/extract-listings.js').ListingItem[] = [];

        // Fetch HTML for extraction
        const htmlResult = peelOptions.format === 'html'
          ? result
          : await peel(url, { ...peelOptions, format: 'html', maxTokens: undefined });

        // Try schema extraction first, fall back to generic
        if (activeSchema) {
          const schemaListings = extractWithSchema(htmlResult.content, activeSchema, result.url);
          if (schemaListings.length > 0) {
            allListings.push(...(schemaListings as import('./core/extract-listings.js').ListingItem[]));
          } else {
            // Schema returned nothing — fall back to generic
            allListings.push(...extractListings(htmlResult.content, result.url));
          }
        } else {
          allListings.push(...extractListings(htmlResult.content, result.url));
        }

        // Pagination: follow "Next" links
        if (pagesCount > 1) {
          let currentHtml = htmlResult.content;
          let currentUrl = result.url;
          for (let page = 1; page < pagesCount; page++) {
            const nextUrl = findNextPageUrl(currentHtml, currentUrl);
            if (!nextUrl) break;
            try {
              const nextResult = await peel(nextUrl, { ...peelOptions, format: 'html', maxTokens: undefined });
              let pageListings: import('./core/extract-listings.js').ListingItem[];
              if (activeSchema) {
                const schemaPage = extractWithSchema(nextResult.content, activeSchema, nextResult.url);
                pageListings = schemaPage.length > 0
                  ? (schemaPage as import('./core/extract-listings.js').ListingItem[])
                  : extractListings(nextResult.content, nextResult.url);
              } else {
                pageListings = extractListings(nextResult.content, nextResult.url);
              }
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
        // --- BM25 Schema Template Extraction (no LLM needed) ---
        if (options.schema && result.content) {
          const { getSchemaTemplate: getSchTmpl } = await import('./core/schema-templates.js');
          const schTemplate = getSchTmpl(options.schema as string);
          if (schTemplate) {
            const { quickAnswer: qa } = await import('./core/quick-answer.js');
            const { smartExtractSchemaFields } = await import('./core/schema-postprocess.js');
            const extracted = smartExtractSchemaFields(
              result.content,
              schTemplate.fields,
              qa,
              {
                pageTitle: result.title,
                pageUrl: result.url,
                metadata: result.metadata as Record<string, any>,
              },
            );
            (result as any).extracted = extracted;
          }
        }

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
        await writeStdout(JSON.stringify({ success: false, error: { type: errCode.toLowerCase(), message: errMsg } }) + '\n');
        await cleanup();
        process.exit(1);
      }

      if (error instanceof Error) {
        console.error('\n' + formatError(error, url || '', options));
      } else {
        console.error('\x1b[31m✖ Unknown error occurred\x1b[0m');
      }

      await cleanup();
      process.exit(1);
    }
}

program
  .action(async (url: string | undefined, options) => {
    await runFetch(url, options);
  });

// Read subcommand (explicit readable mode)
program
  .command('read <url>')
  .description('Read a page in clean reader mode (like browser Reader View)')
  .option('--json', 'Output as JSON')
  .option('-s, --silent', 'Silent mode')
  .option('--budget <n>', 'Token budget (default: 4000)', parseInt)
  .option('--focus <query>', 'Focus on content relevant to this query')
  .action(async (url: string, opts: any) => {
    await runFetch(url, {
      ...opts,
      readable: true,
      budget: 4000,
    });
  });

// Ask subcommand (question mode)
program
  .command('ask <url> <question>')
  .description('Ask a question about any page')
  .option('--json', 'Output as JSON')
  .option('-s, --silent', 'Silent mode')
  .action(async (url: string, question: string, opts: any) => {
    await runFetch(url, {
      ...opts,
      question,
      readable: true,
    });
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
  .option('--proxy <url>', 'Proxy URL for requests (http://host:port, socks5://user:pass@host:port)')
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
        const { buildSiteSearchUrl } = await import('./core/site-search.js');
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

      let results = await provider.searchWeb(query, {
        count: Math.min(Math.max(count, 1), 10),
        apiKey,
      });

      // Apply budget to search results if requested (trim results to fit token budget)
      if (options.budget && options.budget > 0 && results.length > 0) {
        let totalTokens = 0;
        let maxResults = 0;
        for (const r of results) {
          // Estimate ~4 chars per token for title + url + snippet
          const resultTokens = Math.ceil(
            (`${r.title || ''}\n${r.url || ''}\n${r.snippet || ''}`).length / 4
          );
          if (totalTokens + resultTokens > options.budget) break;
          totalTokens += resultTokens;
          maxResults++;
        }
        results = results.slice(0, Math.max(maxResults, 1));
      }

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
        const jsonStr = JSON.stringify({ query, results, count: results.length }, null, 2);
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
  .option('--resume', 'Resume an interrupted crawl from its last checkpoint')
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
        console.log(JSON.stringify({ pages: results, count: results.length }, null, 2));
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
          await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_url', message: 'Only HTTP and HTTPS protocols are allowed' } }) + '\n');
        } else {
          console.error('Error: Only HTTP and HTTPS protocols are allowed');
        }
        process.exit(1);
      }
    } catch {
      if (isJson) {
        await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_url', message: `Invalid URL format: ${url}` } }) + '\n');
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

// Pipe command — always JSON, no UI (agent-friendly)
program
  .command('pipe <url>')
  .description('Pipe-friendly fetch (always JSON, no UI). Alias for: webpeel <url> --json --silent')
  .option('-r, --render', 'Use headless browser')
  .option('--stealth', 'Stealth mode')
  .option('--budget <n>', 'Token budget', parseInt)
  .option('--clean', 'Clean format for AI')
  .option('-q, --question <q>', 'Quick answer')
  .option('--proxy <url>', 'Proxy URL')
  .option('--timeout <ms>', 'Timeout in ms', parseInt)
  .option('-s, --silent', 'Silent mode (always on for pipe, accepted for compatibility)')
  .action(async (url: string, opts) => {
    // Force JSON + silent — always, unconditionally
    opts.json = true;
    opts.silent = true;
    await runFetch(url, opts);
  });

// Config command  —  webpeel config [get|set] [key] [value]
program
  .command('config')
  .description('View or update CLI configuration')
  .argument('[action]', '"list", "get <key>", "set <key> <value>", or omit for overview')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Value to set')
  .action(async (action?: string, key?: string, value?: string) => {
    const config = loadConfig();

    // Settable config keys (safe for user modification)
    // Supports dot-notation for nested keys (e.g., llm.apiKey)
    const SETTABLE_KEYS: Record<string, string> = {
      braveApiKey: 'Brave Search API key',
      'llm.apiKey': 'LLM API key for AI-powered extraction (OpenAI-compatible)',
      'llm.model': 'LLM model name (default: gpt-4o-mini)',
      'llm.baseUrl': 'LLM API base URL (default: https://api.openai.com/v1)',
    };

    const maskSecret = (k: string, v: string | undefined): string => {
      if (!v) return '(not set)';
      if (k === 'apiKey' || k === 'braveApiKey' || k === 'llm.apiKey') {
        return v.slice(0, 4) + '...' + v.slice(-4);
      }
      return String(v);
    };

    /** Get a potentially nested value using dot-notation (e.g., "llm.apiKey") */
    function getNestedValue(obj: any, path: string): any {
      const parts = path.split('.');
      let cur = obj;
      for (const part of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[part];
      }
      return cur;
    }

    /** Set a potentially nested value using dot-notation (e.g., "llm.apiKey") */
    function setNestedValue(obj: any, path: string, val: string): void {
      const parts = path.split('.');
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (cur[part] == null || typeof cur[part] !== 'object') cur[part] = {};
        cur = cur[part];
      }
      cur[parts[parts.length - 1]!] = val;
    }

    if (!action || action === 'list') {
      // Show all config (also triggered by `webpeel config list`)
      console.log('WebPeel CLI Configuration');
      console.log(`  Config file: ~/.webpeel/config.json`);
      console.log('');
      console.log(`  apiKey:         ${maskSecret('apiKey', config.apiKey)}`);
      console.log(`  braveApiKey:    ${maskSecret('braveApiKey', config.braveApiKey)}`);
      console.log(`  planTier:       ${config.planTier || 'free'}`);
      console.log(`  anonymousUsage: ${config.anonymousUsage}`);
      console.log('');
      console.log('  LLM:');
      console.log(`    llm.apiKey:   ${maskSecret('llm.apiKey', config.llm?.apiKey)}`);
      console.log(`    llm.model:    ${config.llm?.model || '(not set, default: gpt-4o-mini)'}`);
      console.log(`    llm.baseUrl:  ${config.llm?.baseUrl || '(not set, default: https://api.openai.com/v1)'}`);
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

      setNestedValue(config, key, value);
      saveConfig(config);
      console.log(`✓ ${key} saved`);
      process.exit(0);
    }

    if (action === 'get') {
      const lookupKey = key || '';
      const val = getNestedValue(config, lookupKey) ?? (config as any)[lookupKey];
      if (val !== undefined) {
        console.log(maskSecret(lookupKey, String(val)));
      } else {
        console.error(`Unknown config key: ${lookupKey}`);
        process.exit(1);
      }
      process.exit(0);
    }

    // Legacy: `webpeel config <key>` — treat action as the key name
    const val = getNestedValue(config, action) ?? (config as any)[action];
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
  .description('Web research agent — LLM-free by default, add --llm-key for AI synthesis')
  .option('--llm-key <key>', 'LLM API key (or use OPENAI_API_KEY env var)')
  .option('--llm-model <model>', 'LLM model to use (default: gpt-4o-mini)')
  .option('--llm-base-url <url>', 'LLM API base URL')
  .option('--urls <urls>', 'Comma-separated starting URLs')
  .option('--max-pages <n>', 'Maximum pages to visit (default: 10)', '10')
  .option('--schema <json>', 'Schema template name (e.g. product, article) or JSON schema for structured output')
  .option('-s, --silent', 'Silent mode (no spinner)')
  .option('--json', 'Output as JSON')
  .action(async (prompt: string, options) => {
    const llmApiKey = options.llmKey || process.env.OPENAI_API_KEY;
    const urls = options.urls ? options.urls.split(',').map((u: string) => u.trim()) : undefined;

    // Parse schema (support templates)
    let schema: Record<string, string> | undefined;
    if (options.schema) {
      const template = getSchemaTemplate(options.schema);
      if (template) {
        schema = template.fields;
      } else {
        try {
          schema = JSON.parse(options.schema);
        } catch {
          console.error(`Error: --schema must be a template name (${listSchemaTemplates().join(', ')}) or valid JSON`);
          process.exit(1);
        }
      }
    }

    if (llmApiKey) {
      // Full LLM agent mode (existing code)
      const spinner = options.silent ? null : ora('Running agent research...').start();
      try {
        const { runAgent } = await import('./core/agent.js');
        const result = await runAgent({
          prompt,
          urls,
          schema,
          llmApiKey,
          llmModel: options.llmModel,
          llmApiBase: options.llmBaseUrl,
          maxPages: parseInt(options.maxPages, 10),
          onProgress: (progress) => {
            if (spinner) spinner.text = progress.message;
          },
        });
        if (spinner) spinner.succeed(`Agent finished: ${result.pagesVisited} pages`);
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
      } catch (e) {
        if (spinner) spinner.fail('Agent failed');
        console.error(e instanceof Error ? e.message : e);
        await cleanup();
        process.exit(1);
      }
    } else {
      // LLM-free mode: search + fetch + BM25 extraction
      const spinner = options.silent ? null : ora('Running LLM-free research...').start();

      try {
        // Import needed modules
        const { quickAnswer } = await import('./core/quick-answer.js');

        // Step 1: Get URLs to process
        let targetUrls: string[] = urls || [];

        // If no URLs, search the web
        if (targetUrls.length === 0) {
          if (spinner) spinner.text = 'Searching the web...';
          try {
            const { getBestSearchProvider } = await import('./core/search-provider.js');
            const { provider, apiKey: searchApiKey } = getBestSearchProvider();
            const searchResults = await provider.searchWeb(prompt, {
              count: Math.min(parseInt(options.maxPages, 10) || 5, 10),
              apiKey: searchApiKey,
            });
            targetUrls = searchResults.map((r: { url: string }) => r.url);
          } catch {
            // Fallback: try DuckDuckGo HTML
            if (spinner) spinner.text = 'Searching via DuckDuckGo...';
            try {
              const duckUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(prompt)}`;
              const searchResult = await peel(duckUrl, { budget: 4000 });
              // Extract URLs from search results content
              const urlMatches = searchResult.content.match(/https?:\/\/[^\s\)]+/g) || [];
              targetUrls = urlMatches
                .filter((u: string) => !u.includes('duckduckgo.com'))
                .slice(0, parseInt(options.maxPages, 10) || 5);
            } catch {
              // No search results
            }
          }
        }

        if (targetUrls.length === 0) {
          if (spinner) spinner.fail('No URLs found. Provide --urls or a more specific prompt.');
          process.exit(1);
        }

        if (spinner) spinner.text = `Processing ${targetUrls.length} pages...`;

        // Step 2: Fetch and extract from each URL
        const results: Array<{
          url: string;
          title: string;
          extracted: Record<string, string> | null;
          content: string;
          confidence: number;
        }> = [];

        for (const url of targetUrls) {
          try {
            if (spinner) spinner.text = `Fetching: ${url.substring(0, 60)}...`;
            const pageResult = await peel(url, { budget: 4000 });

            let extracted: Record<string, string> | null = null;
            let confidence = 0;

            if (schema) {
              // Extract each schema field using smartExtractSchemaFields
              const { smartExtractSchemaFields: smartExtractResearch } = await import('./core/schema-postprocess.js');
              extracted = smartExtractResearch(
                pageResult.content,
                schema as Record<string, string>,
                quickAnswer,
                {
                  pageTitle: (pageResult as any).title,
                  pageUrl: url,
                  metadata: (pageResult as any).metadata as Record<string, any>,
                },
              );
              // Calculate confidence from quickAnswer for any field
              for (const question of Object.values(schema)) {
                try {
                  const qa = quickAnswer({ content: pageResult.content, question: typeof question === 'string' ? question : '' });
                  confidence = Math.max(confidence, qa.confidence || 0);
                } catch { /* ignore */ }
                break; // just need one confidence estimate
              }
            } else {
              // Answer the prompt directly
              try {
                const qa = quickAnswer({ content: pageResult.content, question: prompt });
                extracted = { answer: qa.answer || '' };
                confidence = qa.confidence || 0;
              } catch {
                extracted = null;
              }
            }

            results.push({
              url,
              title: pageResult.metadata?.title || url,
              extracted,
              content: pageResult.content.substring(0, 500),
              confidence,
            });
          } catch (e) {
            // Skip failed URLs
            if (process.env.DEBUG) {
              console.debug('[webpeel]', `Failed to fetch ${url}:`, e instanceof Error ? e.message : e);
            }
          }
        }

        if (spinner) spinner.succeed(`Processed ${results.length}/${targetUrls.length} pages (LLM-free)`);

        if (options.json) {
          console.log(JSON.stringify({
            mode: 'llm-free',
            prompt,
            schema: schema || null,
            results,
            sources: results.map(r => r.url),
            pagesVisited: results.length,
          }, null, 2));
        } else {
          console.log(`\n📊 Results (${results.length} pages, LLM-free):\n`);
          for (const r of results) {
            console.log(`── ${r.title} ──`);
            console.log(`   ${r.url}`);
            if (r.extracted) {
              for (const [k, v] of Object.entries(r.extracted)) {
                if (v) console.log(`   ${k}: ${v}`);
              }
            }
            console.log(`   Confidence: ${(r.confidence * 100).toFixed(0)}%\n`);
          }
        }

        await cleanup();
        process.exit(0);
      } catch (e) {
        if (spinner) spinner.fail('Research failed');
        console.error(e instanceof Error ? e.message : e);
        await cleanup();
        process.exit(1);
      }
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
  .alias('snap')
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
  .option('--scroll-through', 'Auto-scroll page before screenshot (triggers lazy content + scroll animations)')
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
        scrollThrough: options.scrollThrough || false,
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
        await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
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
        await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
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

// ============================================================
// Profile management commands
// ============================================================

const profileCmd = program
  .command('profile')
  .description('Manage named browser profiles (saved login sessions)');

profileCmd
  .command('create <name>')
  .description('Create a new profile interactively (launches browser, log in, press Ctrl+C when done)')
  .option('--description <text>', 'Optional description for this profile')
  .action(async (name: string, opts) => {
    try {
      await createProfile(name, opts.description);
      process.exit(0);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

profileCmd
  .command('list')
  .description('List all saved browser profiles')
  .action(() => {
    const profiles = listProfiles();
    if (profiles.length === 0) {
      console.log('No profiles found.');
      console.log('');
      console.log('Create one with:');
      console.log('  webpeel profile create <name>');
      console.log('');
      console.log('Then use it with:');
      console.log('  webpeel <url> --profile <name>');
      process.exit(0);
    }

    console.log('');
    console.log('Saved profiles:');
    console.log('');

    // Column widths
    const nameW = Math.max(8, ...profiles.map((p) => p.name.length));
    const domainsW = Math.max(10, ...profiles.map((p) => (p.domains.join(', ') || '(none)').length));

    const header =
      'Name'.padEnd(nameW) + '  ' +
      'Domains'.padEnd(domainsW) + '  ' +
      'Last Used'.padEnd(12) + '  ' +
      'Created';
    console.log(header);
    console.log('─'.repeat(header.length + 4));

    for (const p of profiles) {
      const domainsStr = p.domains.length > 0 ? p.domains.join(', ') : '(none)';
      const lastUsed = formatRelativeTime(new Date(p.lastUsed));
      const created = new Date(p.created).toISOString().split('T')[0];
      console.log(
        p.name.padEnd(nameW) + '  ' +
        domainsStr.padEnd(domainsW) + '  ' +
        lastUsed.padEnd(12) + '  ' +
        created,
      );
    }
    console.log('');
    process.exit(0);
  });

profileCmd
  .command('show <name>')
  .description('Show details for a profile')
  .action((name: string) => {
    const profilePath = getProfilePath(name);
    if (!profilePath) {
      console.error(`Error: Profile "${name}" not found.`);
      console.error('Run "webpeel profile list" to see available profiles.');
      process.exit(1);
    }

    try {
      const meta = JSON.parse(readFileSync(`${profilePath}/metadata.json`, 'utf-8'));
      console.log('');
      console.log(`Profile: ${meta.name}`);
      if (meta.description) console.log(`Description: ${meta.description}`);
      console.log(`Created:     ${new Date(meta.created).toLocaleString()}`);
      console.log(`Last used:   ${new Date(meta.lastUsed).toLocaleString()}`);
      console.log(`Domains:     ${meta.domains.length > 0 ? meta.domains.join(', ') : '(none)'}`);
      console.log(`Directory:   ${profilePath}`);
      console.log('');
      process.exit(0);
    } catch (e) {
      console.error(`Error reading profile: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a saved profile')
  .action((name: string) => {
    const deleted = deleteProfile(name);
    if (deleted) {
      console.log(`Profile "${name}" deleted.`);
      process.exit(0);
    } else {
      console.error(`Error: Profile "${name}" not found.`);
      console.error('Run "webpeel profile list" to see available profiles.');
      process.exit(1);
    }
  });

// ── Hotels command ─────────────────────────────────────────────────────────────

program
  .command('hotels <destination>')
  .description('Search multiple travel sites for hotels (Kayak, Booking.com, Google Travel)')
  .option('--checkin <date>', 'Check-in date (ISO or relative, e.g. "tomorrow", "2026-02-20"). Default: tomorrow')
  .option('--checkout <date>', 'Check-out date (ISO or relative). Default: checkin + 1 day')
  .option('--sort <method>', 'Sort by: price, rating, value (default: price)', 'price')
  .option('--limit <n>', 'Max results (default: 20)', '20')
  .option('--source <name...>', 'Only use specific source(s): kayak, booking, google (repeatable)')
  .option('--json', 'Output as JSON')
  .option('--stealth', 'Use stealth mode for all sources')
  .option('--proxy <url>', 'Proxy URL for requests (http://host:port, socks5://user:pass@host:port)')
  .option('-s, --silent', 'Suppress progress messages')
  .action(async (destination: string, options) => {
    const isJson = options.json as boolean;
    const isSilent = options.silent as boolean;

    // Build checkin/checkout
    const { parseDate, addDays: hotelAddDays } = await import('./core/hotel-search.js');
    let checkinStr: string;
    let checkoutStr: string;
    try {
      checkinStr = parseDate(options.checkin ?? 'tomorrow');
      checkoutStr = options.checkout
        ? parseDate(options.checkout)
        : hotelAddDays(checkinStr, 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isJson) {
        await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_request', message: msg } }) + '\n');
      } else {
        console.error(`Error: ${msg}`);
      }
      process.exit(1);
    }

    const sortMethod = (['price', 'rating', 'value'].includes(options.sort as string)
      ? options.sort
      : 'price') as 'price' | 'rating' | 'value';

    const limit = Math.max(1, parseInt(options.limit as string, 10) || 20);

    const sources: string[] | undefined = options.source
      ? (Array.isArray(options.source) ? options.source : [options.source]) as string[]
      : undefined;

    // Spinner per-source progress (non-silent, non-JSON)
    let searchSpinner: import('ora').Ora | null = null;
    if (!isSilent && !isJson) {
      searchSpinner = ora(`Searching hotels in ${destination}...`).start();
    } else if (!isSilent && !isJson) {
      console.error(`⏳ Searching kayak.com...`);
      console.error(`⏳ Searching booking.com...`);
      console.error(`⏳ Searching google.com...`);
    }

    try {
      const { searchHotels } = await import('./core/hotel-search.js');

      const result = await searchHotels({
        destination,
        checkin: checkinStr!,
        checkout: checkoutStr!,
        sort: sortMethod,
        limit,
        sources,
        stealth: options.stealth as boolean | undefined,
        silent: isSilent,
        proxy: options.proxy as string | undefined,
      });

      if (searchSpinner) searchSpinner.stop();

      // Show per-source status
      if (!isSilent && !isJson) {
        for (const src of result.sources) {
          if (src.status === 'ok') {
            console.error(`✅ ${src.name}: ${src.count} hotels found`);
          } else {
            console.error(`❌ ${src.name}: ${src.status}${src.error ? ' — ' + src.error : ''}`);
          }
        }
      }

      if (isJson) {
        await writeStdout(JSON.stringify(result, null, 2) + '\n');
        await cleanup();
        process.exit(0);
      }

      // Human-readable table output
      const { formatDate: fmtDate } = {
        formatDate: (iso: string): string => {
          const d = new Date(iso + 'T12:00:00Z');
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        },
      };

      const ci = fmtDate(result.checkin);
      const co = fmtDate(result.checkout);

      console.log(`\n🏨 Hotels in ${result.destination}`);
      console.log(`   ${ci} → ${co} | Sorted by ${sortMethod}\n`);

      if (result.results.length === 0) {
        console.log('   No hotels found.\n');
      } else {
        const colNum = 3;
        const colName = 42;
        const colPrice = 8;
        const colRating = 8;
        const colSource = 10;
        const padEnd = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);
        const padStart = (s: string, w: number) => s.padStart(w);

        console.log(
          ` ${padStart('#', colNum)}  ${padEnd('Hotel', colName)}  ${padEnd('Price', colPrice)}  ${padEnd('Rating', colRating)}  ${padEnd('Source', colSource)}`
        );

        result.results.forEach((hotel, i) => {
          const priceStr = hotel.priceDisplay || '—';
          const ratingStr = hotel.rating !== null ? String(hotel.rating) : '—';
          console.log(
            ` ${padStart(String(i + 1), colNum)}  ${padEnd(hotel.name, colName)}  ${padEnd(priceStr, colPrice)}  ${padEnd(ratingStr, colRating)}  ${padEnd(hotel.source, colSource)}`
          );
        });

        console.log('');
        const sourceSummary = result.sources
          .map(s => `${s.name} (${s.count} ${s.status === 'ok' ? '✅' : s.status === 'blocked' ? '🚫' : '❌'})`)
          .join(' | ');
        console.log(`Sources: ${sourceSummary}`);
      }

      console.log('');
      await cleanup();
      process.exit(0);
    } catch (error) {
      if (searchSpinner) searchSpinner.fail('Hotel search failed');
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (isJson) {
        await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
      } else {
        console.error(`\nError: ${msg}`);
      }
      await cleanup();
      process.exit(1);
    }
  });

// ============================================================
// research command — autonomous multi-step web research
// ============================================================

program
  .command('research <query>')
  .description('Conduct autonomous multi-step web research on a topic and synthesize a report')
  .option('--max-sources <n>', 'Maximum sources to consult (default: 5)', '5')
  .option('--max-depth <n>', 'Link-following depth (default: 1)', '1')
  .option('--format <f>', 'Output format: report (default) or sources', 'report')
  .option('--llm-key <key>', 'LLM API key for synthesis (or env OPENAI_API_KEY)')
  .option('--llm-model <model>', 'LLM model for synthesis (default: gpt-4o-mini)')
  .option('--llm-base-url <url>', 'LLM API base URL (default: https://api.openai.com/v1)')
  .option('--timeout <ms>', 'Max research time in ms (default: 40000)', '60000')
  .option('--json', 'Output result as JSON')
  .option('-s, --silent', 'Suppress progress output')
  .action(async (query: string, options) => {
    const isSilent = !!options.silent;
    const isJson = !!options.json;
    const maxSources = parseInt(options.maxSources) || 5;
    const maxDepth = parseInt(options.maxDepth) || 1;
    const timeout = parseInt(options.timeout) || 60000;
    const outputFormat = options.format === 'sources' ? 'sources' : 'report';
    const apiKey = options.llmKey || process.env.OPENAI_API_KEY;
    const model = options.llmModel;
    const baseUrl = options.llmBaseUrl;

    const phaseIcons: Record<string, string> = {
      searching: '🔍',
      fetching: '📄',
      extracting: '🧠',
      following: '🔗',
      synthesizing: '✍️',
    };

    try {
      const { research } = await import('./core/research.js');

      const result = await research({
        query,
        maxSources,
        maxDepth,
        timeout,
        outputFormat: outputFormat as 'report' | 'sources',
        apiKey,
        model,
        baseUrl,
        onProgress: (step) => {
          if (!isSilent && !isJson) {
            const icon = phaseIcons[step.phase] ?? '⚙️';
            const extra = step.sourcesFound !== undefined
              ? ` (found ${step.sourcesFound})`
              : step.sourcesFetched !== undefined
                ? ` (${step.sourcesFetched} fetched)`
                : '';
            process.stderr.write(`${icon} ${step.message}${extra}...\n`);
          }
        },
      });

      if (isJson) {
        await writeStdout(JSON.stringify(result, null, 2) + '\n');
      } else {
        await writeStdout(result.report + '\n');
        if (!isSilent) {
          const elapsed = (result.elapsed / 1000).toFixed(1);
          const cost = result.cost !== undefined ? ` | cost: $${result.cost.toFixed(4)}` : '';
          process.stderr.write(
            `\n📊 ${result.sourcesConsulted} sources consulted (${result.totalSourcesFound} found) | ${elapsed}s${cost}\n`,
          );
        }
      }

      await cleanup();
      process.exit(0);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (isJson) {
        await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
      } else {
        console.error(`\nError: ${msg}`);
      }
      await cleanup();
      process.exit(1);
    }
  });

// Schema templates listing command
program
  .command('schemas')
  .description('List available extraction schema templates')
  .action(() => {
    console.log('\nAvailable schema templates:\n');
    for (const [key, template] of Object.entries(SCHEMA_TEMPLATES)) {
      console.log(`  ${key.padEnd(12)} ${template.description}`);
      console.log(`  ${''.padEnd(12)} Fields: ${Object.keys(template.fields).join(', ')}`);
      console.log('');
    }
    console.log('Usage: webpeel "https://example.com" --schema product');
    console.log('       webpeel "https://example.com" --schema \'{"field":"description"}\'');
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
    // Build clean JSON output with guaranteed top-level fields
    const output: Record<string, any> = {
      url: result.url,
      title: result.metadata?.title || result.title || null,
      tokens: result.tokens || 0,
      fetchedAt: new Date().toISOString(),
      method: result.method || 'simple',
      elapsed: result.elapsed,
      content: result.content,
    };

    // Add optional fields only if present (filter out undefined/null values from metadata)
    if (result.metadata) {
      const cleanMeta: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(result.metadata)) {
        if (v !== undefined && v !== null) cleanMeta[k] = v;
      }
      if (Object.keys(cleanMeta).length > 0) output.metadata = cleanMeta;
    }
    if (result.links?.length) output.links = result.links;
    if ((result as any).images?.length) output.images = (result as any).images;
    if ((result as any).structured) output.structured = (result as any).structured;
    if ((result as any).domainData) output.domainData = (result as any).domainData;
    if ((result as any).readability) output.readability = (result as any).readability;
    if ((result as any).quickAnswer) output.quickAnswer = (result as any).quickAnswer;
    if ((result as any).quality) output.quality = (result as any).quality;
    if (result.contentType) output.contentType = result.contentType;
    if ((result as any).chunks) output.chunks = (result as any).chunks;
    if ((result as any).totalChunks) output.totalChunks = (result as any).totalChunks;
    if ((result as any).warning) output.warning = (result as any).warning;
    if ((result as any).focusQuery) output.focusQuery = (result as any).focusQuery;
    if ((result as any).focusReduction) output.focusReduction = (result as any).focusReduction;
    if ((result as any).extracted) output.extracted = (result as any).extracted;
    if (extra.cached) output.cached = true;
    if (extra.truncated) output.truncated = true;
    if (extra.totalAvailable !== undefined) output.totalAvailable = extra.totalAvailable;

    output._meta = { version: cliVersion, method: result.method || 'simple', timing: result.timing, serverMarkdown: (result as any).serverMarkdown || false };

    await writeStdout(JSON.stringify(output, null, 2) + '\n');
  } else {
    // Smart terminal header (interactive mode only)
    const isTerminalOutput = process.stdout.isTTY && !options.silent;
    if (isTerminalOutput) {
      const meta = result.metadata || {};
      const parts: string[] = [];
      if ((meta as any).title || result.title) parts.push(`\x1b[1m${(meta as any).title || result.title}\x1b[0m`);
      if ((meta as any).author) parts.push(`By ${(meta as any).author}`);
      if ((meta as any).wordCount) parts.push(`${(meta as any).wordCount} words`);
      const totalMs = result.timing?.total ?? result.elapsed;
      if (totalMs) parts.push(`${totalMs}ms`);
      if (parts.length > 0) {
        await writeStdout(`\n  ${parts.join(' · ')}\n`);
        await writeStdout('  ' + '─'.repeat(60) + '\n\n');
      }
    }
    // Stream content immediately to stdout — consumer gets it without waiting
    await writeStdout(result.content + '\n');
    // Append timing summary to stderr so it doesn't pollute piped content
    if (!options.silent) {
      const totalMs = result.timing?.total ?? result.elapsed;
      process.stderr.write(`\n--- ${result.tokens} tokens · ${totalMs}ms ---\n`);
    }
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
