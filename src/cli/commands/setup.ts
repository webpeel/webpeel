/**
 * `webpeel setup` — Interactive onboarding wizard.
 *
 * Walks the user through:
 *   1. API key configuration (optional — local mode is fine)
 *   2. Browser installation (Chromium via Playwright)
 *   3. LLM key for AI extraction (optional)
 *   4. Quick smoke test
 *
 * Non-interactive when piped (detects !isTTY).
 */

import type { Command } from 'commander';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { loadConfig, saveConfig } from '../../cli-auth.js';
import { cliVersion, NO_COLOR } from '../utils.js';
import { runDoctor } from './doctor.js';

// ── ANSI helpers ────────────────────────────────────────────────────────────

const bold = (s: string) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`;

// ── Prompt helper ───────────────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function confirm(rl: ReturnType<typeof createInterface>, question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(rl, `${question} ${dim(suffix)} `);
  if (answer === '') return defaultYes;
  return /^y(es)?$/i.test(answer);
}

// ── Wizard steps ────────────────────────────────────────────────────────────

async function stepApiKey(rl: ReturnType<typeof createInterface>): Promise<void> {
  const cfg = loadConfig();
  const existing = cfg.apiKey || process.env.WEBPEEL_API_KEY;

  console.log('');
  console.log(bold('Step 1: API Key'));
  console.log(dim('An API key unlocks cloud features (faster, higher limits, no browser needed).'));
  console.log(dim('WebPeel works locally without one — this is optional.'));
  console.log('');

  if (existing) {
    console.log(green(`  ✅ API key already configured: ${existing.slice(0, 8)}...${existing.slice(-4)}`));
    const change = await confirm(rl, '  Change it?', false);
    if (!change) return;
  }

  const key = await ask(rl, `  Enter API key ${dim('(or press Enter to skip)')}: `);
  if (!key) {
    console.log(dim('  Skipped — using local mode.'));
    return;
  }

  // Quick validation
  const apiUrl = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';
  process.stdout.write('  Verifying...');
  try {
    const res = await fetch(`${apiUrl}/v1/usage`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) {
      console.log(` ${yellow('invalid key')}. Skipping.`);
      console.log(dim('  Get a free key at: https://app.webpeel.dev/keys'));
      return;
    }
    if (res.ok) {
      const data = await res.json() as any;
      const plan = data?.tier || (typeof data?.plan === 'string' ? data?.plan : data?.plan?.tier) || 'free';
      cfg.apiKey = key;
      saveConfig(cfg);
      console.log(` ${green(`✅ Verified (${plan} plan)`)}`);
      return;
    }
    // Non-200, non-401 — save anyway
    cfg.apiKey = key;
    saveConfig(cfg);
    console.log(` ${yellow(`saved (API returned ${res.status})`)}`);
  } catch (e: any) {
    // Network error — save key, warn
    cfg.apiKey = key;
    saveConfig(cfg);
    console.log(` ${yellow(`saved (couldn't verify: ${e.message})`)}`);
  }
}

async function stepBrowser(rl: ReturnType<typeof createInterface>): Promise<void> {
  console.log('');
  console.log(bold('Step 2: Browser (Chromium)'));
  console.log(dim('Required for --render, --stealth, --screenshot, and JS-heavy sites.'));
  console.log('');

  let installed = false;
  try {
    const pw = await import('playwright');
    const execPath = pw.chromium.executablePath();
    installed = existsSync(execPath);
  } catch {
    // playwright not importable
  }

  if (installed) {
    console.log(green('  ✅ Chromium is already installed.'));
    return;
  }

  const install = await confirm(rl, '  Install Chromium now? (~150MB, takes ~30s)', true);
  if (!install) {
    console.log(dim('  Skipped — browser features will auto-install on first use.'));
    return;
  }

  console.log(dim('  Installing Chromium via Playwright...'));
  try {
    const { execSync } = await import('child_process');
    execSync('npx playwright install chromium', {
      stdio: 'inherit',
      timeout: 120_000,
    });
    console.log(green('  ✅ Chromium installed.'));
  } catch (e: any) {
    console.log(yellow(`  ⚠️  Install failed: ${e.message}`));
    console.log(dim('  You can install later: npx playwright install chromium'));
  }
}

async function stepLlm(rl: ReturnType<typeof createInterface>): Promise<void> {
  const cfg = loadConfig();
  const existing = cfg.llm?.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_API_KEY;

  console.log('');
  console.log(bold('Step 3: LLM Key (AI Extraction)'));
  console.log(dim('Enables --extract for structured data extraction using AI.'));
  console.log(dim('Supports OpenAI, Anthropic, or Google keys. Optional.'));
  console.log('');

  if (existing) {
    const source = cfg.llm?.apiKey ? 'config' : 'environment variable';
    console.log(green(`  ✅ LLM key found (via ${source}).`));
    const change = await confirm(rl, '  Change it?', false);
    if (!change) return;
  }

  const key = await ask(rl, `  Enter OpenAI/Anthropic/Google API key ${dim('(or Enter to skip)')}: `);
  if (!key) {
    console.log(dim('  Skipped — set later with `webpeel config set llm.apiKey <key>`.'));
    return;
  }

  if (!cfg.llm) cfg.llm = {};
  cfg.llm.apiKey = key;
  saveConfig(cfg);
  console.log(green('  ✅ LLM key saved.'));

  // Ask for model preference
  const model = await ask(rl, `  Model name ${dim('(default: gpt-4o-mini, Enter to accept)')}: `);
  if (model) {
    cfg.llm.model = model;
    saveConfig(cfg);
    console.log(green(`  ✅ Model set to ${model}.`));
  }
}

async function stepSmokeTest(rl: ReturnType<typeof createInterface>): Promise<void> {
  console.log('');
  console.log(bold('Step 4: Quick Test'));
  console.log('');

  const runTest = await confirm(rl, '  Run a quick fetch test?', true);
  if (!runTest) {
    console.log(dim('  Skipped.'));
    return;
  }

  process.stdout.write('  Fetching https://example.com...');
  try {
    // Use local peel to test
    const { peel } = await import('../../index.js');
    const start = Date.now();
    const result = await peel('https://example.com');
    const elapsed = Date.now() - start;
    const tokens = result.tokens ?? result.content.split(/\s+/).length;
    console.log(` ${green(`✅ ${tokens} tokens in ${elapsed}ms`)}`);
  } catch (e: any) {
    console.log(` ${yellow(`⚠️  ${e.message}`)}`);
    console.log(dim('  This is expected for some network configurations. CLI still works fine.'));
  }
}

// ── Main wizard ─────────────────────────────────────────────────────────────

async function runSetup(): Promise<void> {
  console.log('');
  console.log(bold('🔧 WebPeel Setup'));
  console.log(dim(`v${cliVersion} — Fast web fetcher for AI agents`));
  console.log(dim('─'.repeat(50)));

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  if (!isTTY) {
    console.log('');
    console.log('Non-interactive mode detected. Running doctor instead...');
    console.log('');
    const report = await runDoctor();
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.summary.error > 0 ? 1 : 0);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    await stepApiKey(rl);
    await stepBrowser(rl);
    await stepLlm(rl);
    await stepSmokeTest(rl);

    // Final summary — run doctor
    console.log('');
    console.log(dim('─'.repeat(50)));
    console.log(bold('📋 Final Status'));

    const report = await runDoctor();
    // Print compact summary
    for (const check of report.checks) {
      const icon = check.status === 'ok' ? green('✓') : check.status === 'warn' ? yellow('○') : check.status === 'error' ? '✗' : dim('·');
      console.log(`  ${icon} ${check.name}: ${check.detail}`);
    }

    console.log('');
    if (report.summary.error === 0) {
      console.log(green(bold('🎉 Setup complete! WebPeel is ready.')));
    } else {
      console.log(yellow('⚠️  Setup complete with some issues. Run `webpeel doctor` for details.'));
    }
    console.log('');
    console.log(dim('Quick start:'));
    console.log(cyan('  webpeel "https://news.ycombinator.com"'));
    console.log(cyan('  webpeel search "latest AI news"'));
    console.log(cyan('  webpeel doctor'));
    console.log('');
  } finally {
    rl.close();
  }
}

// ── Commander registration ──────────────────────────────────────────────────

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive setup wizard — configure API key, browser, and LLM')
    .action(async () => {
      await runSetup();
      process.exit(0);
    });
}
