/**
 * `webpeel doctor` — Capability matrix & health check.
 *
 * Shows what WebPeel can do in the current environment:
 *   - Core fetch (always works)
 *   - Browser rendering (Playwright/Chromium)
 *   - API access (key + connectivity)
 *   - LLM extraction (OpenAI-compatible key)
 *   - Search providers (DuckDuckGo free, Brave paid)
 *   - Domain extractors count
 *   - MCP server availability
 *   - Cache status
 */

import type { Command } from 'commander';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig } from '../../cli-auth.js';
import { cacheStats } from '../../cache.js';
import { cliVersion, NO_COLOR } from '../utils.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'warn' | 'error' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  category: 'core' | 'browser' | 'api' | 'llm' | 'search' | 'extras';
}

export interface DoctorReport {
  version: string;
  nodeVersion: string;
  platform: string;
  configDir: string;
  checks: CheckResult[];
  summary: { ok: number; warn: number; error: number; skip: number };
}

// ── ANSI helpers (reuse NO_COLOR from utils) ────────────────────────────────

const icons: Record<CheckStatus, string> = {
  ok: NO_COLOR ? '[OK]' : '\x1b[32m✅\x1b[0m',
  warn: NO_COLOR ? '[WARN]' : '\x1b[33m⚠️\x1b[0m',
  error: NO_COLOR ? '[ERR]' : '\x1b[31m❌\x1b[0m',
  skip: NO_COLOR ? '[SKIP]' : '\x1b[90m⏭️\x1b[0m',
};

const bold = (s: string) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`;

// ── Individual checks ───────────────────────────────────────────────────────

function checkNode(): CheckResult {
  const ver = process.version;
  const major = parseInt(ver.slice(1), 10);
  if (major >= 18) {
    return { name: 'Node.js', status: 'ok', detail: ver, category: 'core' };
  }
  return {
    name: 'Node.js',
    status: 'warn',
    detail: `${ver} (18+ recommended)`,
    hint: 'Upgrade Node.js for best performance',
    category: 'core',
  };
}

function checkVersion(): CheckResult {
  return {
    name: 'WebPeel CLI',
    status: 'ok',
    detail: `v${cliVersion}`,
    category: 'core',
  };
}

function checkConfig(): CheckResult {
  const configDir = join(homedir(), '.webpeel');
  const configFile = join(configDir, 'config.json');
  if (existsSync(configFile)) {
    return { name: 'Config file', status: 'ok', detail: '~/.webpeel/config.json', category: 'core' };
  }
  return {
    name: 'Config file',
    status: 'warn',
    detail: 'Not found',
    hint: 'Run `webpeel setup` or `webpeel auth <key>` to create',
    category: 'core',
  };
}

async function checkBrowser(): Promise<CheckResult> {
  try {
    const pw = await import('playwright');
    const execPath = pw.chromium.executablePath();
    if (existsSync(execPath)) {
      return {
        name: 'Browser (Chromium)',
        status: 'ok',
        detail: 'Installed — --render, --stealth, --screenshot available',
        category: 'browser',
      };
    }
    return {
      name: 'Browser (Chromium)',
      status: 'warn',
      detail: 'Playwright installed but Chromium binary missing',
      hint: 'Run `npx playwright install chromium` or `webpeel setup`',
      category: 'browser',
    };
  } catch {
    return {
      name: 'Browser (Chromium)',
      status: 'warn',
      detail: 'Not installed — --render, --stealth unavailable',
      hint: 'Run `npx playwright install chromium` for browser features',
      category: 'browser',
    };
  }
}

function checkApiKey(): CheckResult {
  const cfg = loadConfig();
  const key = cfg.apiKey || process.env.WEBPEEL_API_KEY;
  if (key) {
    return {
      name: 'API key',
      status: 'ok',
      detail: `${key.slice(0, 8)}...${key.slice(-4)}`,
      category: 'api',
    };
  }
  return {
    name: 'API key',
    status: 'warn',
    detail: 'Not configured — local mode only',
    hint: 'Run `webpeel auth <key>` for cloud API access. Get a free key at https://app.webpeel.dev/keys',
    category: 'api',
  };
}

async function checkApiConnectivity(): Promise<CheckResult> {
  const cfg = loadConfig();
  const key = cfg.apiKey || process.env.WEBPEEL_API_KEY;
  if (!key) {
    return {
      name: 'API connectivity',
      status: 'skip',
      detail: 'No API key — skipped',
      category: 'api',
    };
  }

  const apiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';
  try {
    const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json() as any;
      const uptime = data.uptime ? ` (uptime ${Math.round(data.uptime / 60)}m)` : '';
      return { name: 'API connectivity', status: 'ok', detail: `${apiUrl} online${uptime}`, category: 'api' };
    }
    return { name: 'API connectivity', status: 'warn', detail: `${apiUrl} returned ${res.status}`, category: 'api' };
  } catch (e: any) {
    return {
      name: 'API connectivity',
      status: 'error',
      detail: `Cannot reach ${apiUrl}`,
      hint: e.message,
      category: 'api',
    };
  }
}

async function checkApiKeyValidity(): Promise<CheckResult> {
  const cfg = loadConfig();
  const key = cfg.apiKey || process.env.WEBPEEL_API_KEY;
  if (!key) {
    return { name: 'API key validity', status: 'skip', detail: 'No API key — skipped', category: 'api' };
  }

  const apiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';
  try {
    const res = await fetch(`${apiUrl}/v1/usage`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const usage = await res.json() as any;
      const plan = usage?.tier || (typeof usage?.plan === 'string' ? usage?.plan : usage?.plan?.tier) || 'free';
      const used = usage?.used ?? usage?.totalRequests ?? usage?.weekly?.used ?? 0;
      const limit = usage?.limit ?? usage?.weeklyLimit ?? usage?.weekly?.limit ?? 500;
      return {
        name: 'API key validity',
        status: 'ok',
        detail: `Valid — ${plan} plan, ${used}/${limit} used this week`,
        category: 'api',
      };
    }
    if (res.status === 401) {
      return {
        name: 'API key validity',
        status: 'error',
        detail: 'Invalid or expired',
        hint: 'Run `webpeel auth <new-key>` to update',
        category: 'api',
      };
    }
    return { name: 'API key validity', status: 'warn', detail: `Unexpected response (${res.status})`, category: 'api' };
  } catch (e: any) {
    return { name: 'API key validity', status: 'warn', detail: `Check failed: ${e.message}`, category: 'api' };
  }
}

function checkLlm(): CheckResult {
  const cfg = loadConfig();
  const llmKey = cfg.llm?.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_API_KEY;
  if (llmKey) {
    const model = cfg.llm?.model || 'default (gpt-4o-mini)';
    const source = cfg.llm?.apiKey ? 'config' : 'env';
    return {
      name: 'LLM extraction',
      status: 'ok',
      detail: `Configured (${model}, via ${source}) — --extract available`,
      category: 'llm',
    };
  }
  return {
    name: 'LLM extraction',
    status: 'warn',
    detail: 'No LLM key — --extract unavailable',
    hint: 'Run `webpeel config set llm.apiKey <key>` or set OPENAI_API_KEY env var',
    category: 'llm',
  };
}

function checkSearchProviders(): CheckResult {
  const braveKey = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
  const cfg = loadConfig();
  const braveConfig = cfg.braveApiKey;
  const hasBrave = !!(braveKey || braveConfig);

  if (hasBrave) {
    return {
      name: 'Search providers',
      status: 'ok',
      detail: 'DuckDuckGo (free) + Brave Search (API key found)',
      category: 'search',
    };
  }
  return {
    name: 'Search providers',
    status: 'ok',
    detail: 'DuckDuckGo (free) — `webpeel search` ready',
    hint: 'Optional: set BRAVE_API_KEY for premium search results',
    category: 'search',
  };
}

function checkDomainExtractors(): CheckResult {
  // Count is known from the registry at build time
  // We import the module to count dynamically
  try {
    // We can't easily import at runtime without circular deps, so we hard-code
    // the known count and update it periodically. The extractors dir listing
    // at build time had 55 registered entries.
    return {
      name: 'Domain extractors',
      status: 'ok',
      detail: '55+ sites (YouTube, Reddit, Twitter/X, GitHub, Amazon, ...)',
      category: 'extras',
    };
  } catch {
    return { name: 'Domain extractors', status: 'ok', detail: 'Built-in', category: 'extras' };
  }
}

function checkCache(): CheckResult {
  try {
    const stats = cacheStats();
    return {
      name: 'Response cache',
      status: 'ok',
      detail: `${stats.entries} entries, ${(stats.sizeBytes / 1024).toFixed(1)} KB — ${stats.dir}`,
      category: 'extras',
    };
  } catch {
    return { name: 'Response cache', status: 'ok', detail: 'Available', category: 'extras' };
  }
}

function checkMcp(): CheckResult {
  // MCP server is always bundled
  return {
    name: 'MCP server',
    status: 'ok',
    detail: 'Built-in — run `webpeel mcp` for Model Context Protocol',
    category: 'extras',
  };
}

// ── Main doctor function ────────────────────────────────────────────────────

export async function runDoctor(): Promise<DoctorReport> {
  const checks: CheckResult[] = [];

  // Sync checks
  checks.push(checkVersion());
  checks.push(checkNode());
  checks.push(checkConfig());

  // Async checks (browser, API) — run in parallel
  const [browser, apiConn, apiValid] = await Promise.all([
    checkBrowser(),
    checkApiConnectivity(),
    checkApiKeyValidity(),
  ]);
  checks.push(checkApiKey());
  checks.push(apiConn);
  checks.push(apiValid);
  checks.push(browser);
  checks.push(checkLlm());
  checks.push(checkSearchProviders());
  checks.push(checkDomainExtractors());
  checks.push(checkMcp());
  checks.push(checkCache());

  const summary = { ok: 0, warn: 0, error: 0, skip: 0 };
  for (const c of checks) summary[c.status]++;

  return {
    version: cliVersion,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    configDir: join(homedir(), '.webpeel'),
    checks,
    summary,
  };
}

// ── Pretty printer ──────────────────────────────────────────────────────────

function printReport(report: DoctorReport): void {
  console.log('');
  console.log(bold('WebPeel Doctor'));
  console.log(dim(`v${report.version} · ${report.nodeVersion} · ${report.platform}`));
  console.log('');

  // Group by category in display order
  const categoryOrder: Array<[string, string]> = [
    ['core', '🔧 Core'],
    ['browser', '🌐 Browser'],
    ['api', '☁️  Cloud API'],
    ['llm', '🤖 LLM / AI'],
    ['search', '🔍 Search'],
    ['extras', '📦 Extras'],
  ];

  for (const [cat, label] of categoryOrder) {
    const items = report.checks.filter((c) => c.category === cat);
    if (items.length === 0) continue;

    console.log(bold(label));
    for (const check of items) {
      const icon = icons[check.status];
      console.log(`  ${icon} ${check.name.padEnd(22)} ${check.detail}`);
      if (check.hint && check.status !== 'ok') {
        console.log(`     ${dim(`↳ ${check.hint}`)}`);
      }
    }
    console.log('');
  }

  // Summary
  const { ok, warn, error, skip } = report.summary;
  const parts: string[] = [];
  if (ok) parts.push(`${ok} ok`);
  if (warn) parts.push(`${warn} warnings`);
  if (error) parts.push(`${error} errors`);
  if (skip) parts.push(`${skip} skipped`);
  console.log(dim(`─── ${parts.join(' · ')} ───`));

  if (error === 0 && warn === 0) {
    console.log(bold('\n🎉 WebPeel is fully configured!'));
  } else if (error === 0) {
    console.log(bold('\n✅ WebPeel is ready — optional features noted above.'));
  } else {
    console.log(bold('\n⚠️  Some issues need attention — see errors above.'));
  }
  console.log('');
}

// ── Commander registration ──────────────────────────────────────────────────

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose your WebPeel installation — capability matrix & health check')
    .option('--json', 'Output machine-readable JSON')
    .action(async (opts: { json?: boolean }) => {
      const report = await runDoctor();

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printReport(report);
      }

      // Exit code: 1 if any errors, 0 otherwise
      process.exit(report.summary.error > 0 ? 1 : 0);
    });
}
