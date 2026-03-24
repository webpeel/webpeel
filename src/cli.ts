#!/usr/bin/env node

/**
 * WebPeel CLI — Entry point
 *
 * Registers all command groups and starts the Commander program.
 * The heavy implementation lives in src/cli/commands/*.ts
 *
 * Usage:
 *   npx webpeel <url>                  - Fetch and convert to markdown
 *   npx webpeel <url> --json           - Output as JSON
 *   npx webpeel <url> --render         - Force browser mode
 *   npx webpeel search "query"         - DuckDuckGo search
 *   npx webpeel mcp                    - Start MCP server
 *   npx webpeel --help                 - Condensed help
 *   npx webpeel --help-all             - Full option reference
 */

// ── Auto-load .env from cwd (lightweight, no dotenv dependency) ──────────────
// Must happen BEFORE any imports that read env vars (e.g., WEBPEEL_API_KEY)
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
{
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

import { Command } from 'commander';
import {
  VERB_ALIASES,
  cliVersion,
  checkForUpdates,
  buildCommanderHelp,
  buildCondensedHelp,
} from './cli/utils.js';
import { registerFetchCommands } from './cli/commands/fetch.js';
import { registerSearchCommands } from './cli/commands/search.js';
import { registerInteractCommands } from './cli/commands/interact.js';
import { registerAuthCommands } from './cli/commands/auth.js';
import { registerScreenshotCommands } from './cli/commands/screenshot.js';
import { registerJobsCommands } from './cli/commands/jobs.js';
import { registerMonitorCommands } from './cli/commands/monitor.js';
import { registerGuideCommand } from './cli/commands/guide.js';

// ── Early silent/log-level detection (must happen before any async module code) ──
// Set WEBPEEL_LOG_LEVEL early so logger checks see it when async IIFEs fire.
if (!process.env.WEBPEEL_LOG_LEVEL && process.argv.includes('--silent')) {
  process.env.WEBPEEL_LOG_LEVEL = 'silent';
}

// ── Verb alias intercept (before Commander parses) ────────────────────────────
// "webpeel fetch <url>" → "webpeel <url>"
// Note: 'read' is intentionally excluded — it's a registered subcommand.
if (process.argv.length >= 3 && VERB_ALIASES.has(process.argv[2]?.toLowerCase())) {
  process.argv.splice(2, 1);
}

// ── --help-all detection (must happen before Commander parses) ────────────────
const isHelpAll = process.argv.slice(2).some(a => a === '--help-all');
if (isHelpAll) {
  const idx = process.argv.indexOf('--help-all');
  if (idx !== -1) process.argv[idx] = '--help';
}

// ── Program setup ─────────────────────────────────────────────────────────────
const program = new Command();

program
  .name('webpeel')
  .description('Fast web fetcher for AI agents')
  .version(cliVersion)
  .enablePositionalOptions();

// ── Help formatting ───────────────────────────────────────────────────────────
program.configureHelp({
  sortSubcommands: true,
  showGlobalOptions: false,
  formatHelp: (cmd: any, helper: any): string => {
    if (cmd.parent !== null || isHelpAll) {
      return buildCommanderHelp(cmd, helper);
    }
    return buildCondensedHelp();
  },
});

// ── Update check (non-blocking, background) ───────────────────────────────────
void checkForUpdates();

// ── Register all command groups ───────────────────────────────────────────────
registerFetchCommands(program);
registerSearchCommands(program);
registerInteractCommands(program);
registerAuthCommands(program);
registerScreenshotCommands(program);
registerJobsCommands(program);
registerMonitorCommands(program);
registerGuideCommand(program);

// ── Parse ─────────────────────────────────────────────────────────────────────
program.parse();
