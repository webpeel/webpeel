/**
 * Shared CLI utilities — config, API client, output formatting, helpers.
 * Imported by all command modules.
 */

import type { PeelResult, PeelEnvelope, PageAction, PeelOptions } from '../types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ─── CLI version ────────────────────────────────────────────────────────────

let _cliVersion = '0.0.0';
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // utils.ts compiles to dist/cli/utils.js; package.json is at dist/../../package.json
  const pkgPath = resolve(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  _cliVersion = pkg.version;
} catch { /* fallback to 0.0.0 */ }
export const cliVersion = _cliVersion;

// ─── Verb aliases ────────────────────────────────────────────────────────────

// Intercept verb-first syntax before Commander parses
// "webpeel fetch <url>" → "webpeel <url>"
// Note: 'read' is intentionally excluded — it's a registered subcommand.
export const VERB_ALIASES = new Set(['fetch', 'get', 'scrape', 'peel']);

// ─── Update check ────────────────────────────────────────────────────────────

export async function checkForUpdates(): Promise<void> {
  try {
    const res = await fetch('https://registry.npmjs.org/webpeel/latest', {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const data = await res.json() as { version: string };
    const latest = data.version;
    if (latest && latest !== cliVersion && cliVersion !== '0.0.0') {
      // Skip update notice in silent mode
      if (process.env.WEBPEEL_LOG_LEVEL !== 'silent') {
        console.error(`\n💡 WebPeel v${latest} available (you have v${cliVersion}). Update: npm i -g webpeel@latest\n`);
      }
    }
  } catch { /* silently ignore — don't slow down the user */ }
}

// ─── ANSI helpers ────────────────────────────────────────────────────────────

export const NO_COLOR = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
export const bold = (s: string) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`;
export const dim  = (s: string) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`;
export const cyan = (s: string) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`;

// ─── Parse page actions ──────────────────────────────────────────────────────

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
export function parseActions(actionStrings: string[]): PageAction[] {
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

// ─── Format error ────────────────────────────────────────────────────────────

/**
 * Format an error with actionable suggestions based on error type
 */
export function formatError(error: Error, _url: string, options: any): string {
  const msg = error.message || String(error);
  const errorType = (error as any).errorType || '';
  const lines: string[] = [`\x1b[31m✖ ${msg}\x1b[0m`];

  // Check structured errorType from API first (takes precedence over message heuristics)
  if (errorType === 'timeout' || msg.includes('took too long') || msg.includes('timeout') || msg.includes('Timeout') || msg.includes('Navigation timeout')) {
    lines.push('\x1b[33m💡 Try increasing timeout: --timeout 60000\x1b[0m');
    if (!options.render) {
      lines.push('\x1b[33m💡 Site may need browser rendering: --render\x1b[0m');
    }
  } else if (errorType === 'blocked' || msg.includes('blocking automated') || msg.includes('bot protection') || msg.includes('blocked') || msg.includes('403') || msg.includes('Access Denied') || msg.includes('challenge')) {
    if (!options.stealth) {
      lines.push('\x1b[33m💡 Try stealth mode to bypass bot detection: --stealth\x1b[0m');
    }
    lines.push('\x1b[33m💡 Try a different user agent: --ua "Mozilla/5.0..."\x1b[0m');
  } else if (errorType === 'not_found' || msg.includes('domain may not exist') || msg.includes('not found') || msg.includes('ENOTFOUND') || msg.includes('net::ERR_') || msg.includes('ECONNREFUSED')) {
    lines.push('\x1b[33m💡 Check the URL is correct and the site is accessible.\x1b[0m');
  } else if (errorType === 'network' || msg.includes('Could not reach') || msg.includes('could not connect') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    lines.push('\x1b[33m💡 Check the URL is correct and the site is accessible.\x1b[0m');
  } else if (errorType === 'server_error' || msg.includes('server error')) {
    lines.push('\x1b[33m💡 The target site returned a server error. Try again in a moment.\x1b[0m');
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

// ─── API-based fetch ─────────────────────────────────────────────────────────

/**
 * Routes ALL fetch requests through the WebPeel API.
 * CLI is a pure API client — no local Playwright.
 */
export async function fetchViaApi(url: string, options: PeelOptions, apiKey: string, apiUrl: string): Promise<any> {
  // --format is a CLI output flag; API format is always the content extraction format
  const apiFormat = (['text', 'html', 'markdown', 'md'].includes((options.format || '').toLowerCase()))
    ? (options.format!.toLowerCase() === 'md' ? 'markdown' : options.format!.toLowerCase())
    : ((options as any).html ? 'html' : (options as any).text ? 'text' : 'markdown');
  const params = new URLSearchParams({ url, format: apiFormat });
  if (options.render) params.set('render', 'true');
  if (options.stealth) params.set('stealth', 'true');
  if (options.wait) params.set('wait', String(options.wait));
  if (options.selector) params.set('selector', options.selector as string);
  if (options.readable) params.set('readable', 'true');
  if (options.summary) params.set('summary', 'true');
  if (options.budget) params.set('budget', String(options.budget));
  if ((options as any).question) params.set('question', (options as any).question);

  const res = await fetch(`${apiUrl}/v1/fetch?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60000),
  });

  if (res.status === 401) {
    throw Object.assign(new Error('API key invalid or expired. Run: webpeel auth <new-key>'), { code: 'AUTH_FAILED' });
  }
  if (res.status === 429) {
    throw Object.assign(new Error('Rate limit exceeded. Check your plan at https://app.webpeel.dev/billing'), { code: 'RATE_LIMITED' });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Sanitize error message — don't expose raw HTML (e.g. Cloudflare 502 pages)
    const isHtml = body.trimStart().startsWith('<') || body.includes('<!DOCTYPE') || body.includes('<html');
    let errorMsg: string;
    let errorType: string | undefined;
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      errorMsg = `Could not reach this website. The site may be blocking our server or timing out.`;
      errorType = res.status === 504 ? 'timeout' : 'network';
    } else if (isHtml) {
      errorMsg = `Server returned an error page (${res.status})`;
    } else {
      // Try to parse a structured JSON error response
      try {
        const json = JSON.parse(body);
        const errObj = json?.error;
        if (errObj && typeof errObj === 'object') {
          errorMsg = typeof errObj.message === 'string' ? errObj.message : (body.slice(0, 200) || 'Unknown error');
          if (typeof errObj.type === 'string') errorType = errObj.type;
        } else {
          errorMsg = body.slice(0, 200) || 'Unknown error';
        }
      } catch {
        errorMsg = body.slice(0, 200) || 'Unknown error';
      }
    }
    const err = new Error(`${errorMsg}`);
    if (errorType) (err as any).errorType = errorType;
    (err as any).statusCode = res.status;
    throw err;
  }

  const data = await res.json();
  // Map API response to PeelResult shape that the CLI already handles
  return {
    url: data.url || url,
    title: data.metadata?.title || data.title || '',
    content: data.content || '',
    method: data.method || 'simple',
    tokens: data.tokenCount || data.tokens || 0,
    elapsed: data.fetchTimeMs || data.elapsed || 0,
    tokenSavingsPercent: data.tokenSavingsPercent,
    rawTokenEstimate: data.rawTokenEstimate,
    metadata: data.metadata || {},
    links: data.links || [],
    answer: data.answer,
    summary: data.summary,
    format: options.format || 'markdown',
  };
}

// ─── Help formatting ─────────────────────────────────────────────────────────

/**
 * Reconstruct the standard Commander help layout for --help-all and subcommands.
 * This mirrors Commander's own default formatHelp() so subcommand help keeps working.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCommanderHelp(cmd: any, helper: any): string {
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
export function buildCondensedHelp(): string {
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
    `    --budget <n>          Token budget (default: 4000 in pipe mode)`,
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

// ─── Time formatting ─────────────────────────────────────────────────────────

/**
 * Format a past Date relative to now (e.g. "2h ago", "5m ago").
 */
export function formatRelativeTime(past: Date): string {
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

// ─── Error classification ─────────────────────────────────────────────────────

export function classifyErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'FETCH_FAILED';

  // Check for our custom _code first (set in pre-fetch validation)
  if ((error as any)._code) return (error as any)._code;

  // Check for structured errorType from API responses (set by fetchViaApi)
  const errorType = (error as any).errorType;
  if (errorType) {
    const typeMap: Record<string, string> = {
      timeout: 'TIMEOUT',
      blocked: 'BLOCKED',
      not_found: 'NOT_FOUND',
      server_error: 'SERVER_ERROR',
      network: 'NETWORK',
      unknown: 'FETCH_FAILED',
    };
    if (typeMap[errorType]) return typeMap[errorType];
  }

  const msg = error.message.toLowerCase();
  const name = error.name || '';

  if (name === 'TimeoutError' || msg.includes('timeout') || msg.includes('timed out') || msg.includes('took too long')) {
    return 'TIMEOUT';
  }
  if (name === 'BlockedError' || msg.includes('blocked') || msg.includes('403') || msg.includes('cloudflare') || msg.includes('bot protection')) {
    return 'BLOCKED';
  }
  if (msg.includes('domain may not exist') || msg.includes('enotfound') || msg.includes('getaddrinfo') || msg.includes('dns resolution failed')) {
    return 'NOT_FOUND';
  }
  if (msg.includes('http 404') || msg.includes('page was not found')) {
    return 'NOT_FOUND';
  }
  if (msg.includes('invalid url') || msg.includes('invalid hostname') || msg.includes('only http')) {
    return 'INVALID_URL';
  }
  if (msg.includes('could not reach') || msg.includes('could not connect') || msg.includes('econnrefused')) {
    return 'NETWORK';
  }

  return 'FETCH_FAILED';
}

// ─── Output envelope ─────────────────────────────────────────────────────────

export interface OutputExtra {
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
export function buildEnvelope(result: PeelResult, extra: OutputExtra): PeelEnvelope & Record<string, unknown> {
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

// ─── Output result ───────────────────────────────────────────────────────────

export async function outputResult(result: PeelResult, options: any, extra: OutputExtra = {}): Promise<void> {
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
    // Note: elapsed/method/tokens are placed at the END so `tail -3` shows perf metrics
    const output: Record<string, any> = {
      url: result.url,
      title: result.metadata?.title || result.title || null,
      fetchedAt: new Date().toISOString(),
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
    if ((result as any).tokenSavingsPercent !== undefined) output.tokenSavingsPercent = (result as any).tokenSavingsPercent;
    if ((result as any).rawTokenEstimate !== undefined) output.rawTokenEstimate = (result as any).rawTokenEstimate;
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

    // Perf metrics at the end — `tail -3` shows: elapsed | method | tokens
    output.elapsed = result.elapsed;
    output.method = result.method || 'simple';
    output.tokens = result.tokens || 0;

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
    // Append timing summary to stderr (always — doesn't pollute stdout pipe)
    {
      const totalMs = result.timing?.total ?? result.elapsed;
      const method = result.method || 'simple';
      process.stderr.write(`\n--- ${totalMs}ms | ${method} | ${result.tokens} tokens ---\n`);
    }
  }
}

// ─── Write helpers ────────────────────────────────────────────────────────────

export function writeStdout(data: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ─── Listings / CSV / table helpers ──────────────────────────────────────────

/**
 * Convert an array of listing items to CSV.
 */
export function formatListingsCsv(items: Array<Record<string, string | undefined>>): string {
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
export function normaliseExtractedToRows(extracted: Record<string, any>): Array<Record<string, string | undefined>> {
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

// ─── Branding helpers ────────────────────────────────────────────────────────

/** Helper function to extract colors from content */
export function extractColors(content: string): string[] {
  const colors: string[] = [];
  const hexRegex = /#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}/g;
  const matches = content.match(hexRegex);
  if (matches) {
    colors.push(...[...new Set(matches)].slice(0, 10));
  }
  return colors;
}

/** Helper function to extract font information */
export function extractFonts(content: string): string[] {
  const fonts: string[] = [];
  const fontRegex = /font-family:\s*([^;}"'\n]+)/gi;
  let match;
  while ((match = fontRegex.exec(content)) !== null) {
    fonts.push(match[1].trim());
  }
  return [...new Set(fonts)].slice(0, 5);
}
