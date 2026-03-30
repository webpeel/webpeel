/**
 * `webpeel skill` — Manage optional capabilities.
 *
 * Lists, installs, and uninstalls optional components:
 *   - browser     — Chromium via Playwright (--render, --stealth, --screenshot)
 *   - yt-dlp      — YouTube transcript extraction (auto-detected)
 *
 * Usage:
 *   webpeel skill                     — list all skills with status
 *   webpeel skill --install browser   — install Chromium
 *   webpeel skill --uninstall browser — remove Chromium
 *   webpeel skill --json              — machine-readable output
 */

import type { Command } from 'commander';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { NO_COLOR } from '../utils.js';

// ── ANSI helpers ────────────────────────────────────────────────────────────

const bold = (s: string) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`;

// ── Skill definitions ───────────────────────────────────────────────────────

interface Skill {
  name: string;
  description: string;
  features: string;
  installed: () => boolean | Promise<boolean>;
  install: () => Promise<void>;
  uninstall: () => Promise<void>;
  installHint: string;
  uninstallHint: string;
}

async function isBrowserInstalled(): Promise<boolean> {
  try {
    const pw = await import('playwright');
    return existsSync(pw.chromium.executablePath());
  } catch {
    return false;
  }
}

function isYtdlpInstalled(): boolean {
  try {
    execSync('yt-dlp --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const SKILLS: Skill[] = [
  {
    name: 'browser',
    description: 'Chromium browser via Playwright',
    features: '--render, --stealth, --screenshot, --action, interactive sessions',
    installed: isBrowserInstalled,
    install: async () => {
      console.log(dim('Installing Chromium via Playwright...'));
      execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 120_000 });
    },
    uninstall: async () => {
      console.log(dim('Removing Playwright browsers...'));
      execSync('npx playwright uninstall', { stdio: 'inherit', timeout: 60_000 });
    },
    installHint: 'npx playwright install chromium',
    uninstallHint: 'npx playwright uninstall',
  },
  {
    name: 'yt-dlp',
    description: 'YouTube transcript & metadata extractor',
    features: 'Enhanced YouTube extraction (transcripts, metadata, chapters)',
    installed: () => isYtdlpInstalled(),
    install: async () => {
      const platform = process.platform;
      if (platform === 'darwin') {
        console.log(dim('Installing yt-dlp via Homebrew...'));
        execSync('brew install yt-dlp', { stdio: 'inherit', timeout: 120_000 });
      } else if (platform === 'linux') {
        console.log(dim('Installing yt-dlp via pip...'));
        execSync('pip3 install yt-dlp', { stdio: 'inherit', timeout: 120_000 });
      } else {
        console.log(dim('Installing yt-dlp via pip...'));
        execSync('pip install yt-dlp', { stdio: 'inherit', timeout: 120_000 });
      }
    },
    uninstall: async () => {
      const platform = process.platform;
      if (platform === 'darwin') {
        console.log(dim('Uninstalling yt-dlp via Homebrew...'));
        execSync('brew uninstall yt-dlp', { stdio: 'inherit', timeout: 60_000 });
      } else {
        console.log(dim('Uninstalling yt-dlp via pip...'));
        execSync('pip3 uninstall -y yt-dlp', { stdio: 'inherit', timeout: 60_000 });
      }
    },
    installHint: process.platform === 'darwin' ? 'brew install yt-dlp' : 'pip3 install yt-dlp',
    uninstallHint: process.platform === 'darwin' ? 'brew uninstall yt-dlp' : 'pip3 uninstall yt-dlp',
  },
];

// ── Skill status ────────────────────────────────────────────────────────────

interface SkillStatus {
  name: string;
  description: string;
  features: string;
  installed: boolean;
  installHint: string;
}

async function getSkillStatuses(): Promise<SkillStatus[]> {
  const results: SkillStatus[] = [];
  for (const skill of SKILLS) {
    const installed = await skill.installed();
    results.push({
      name: skill.name,
      description: skill.description,
      features: skill.features,
      installed,
      installHint: skill.installHint,
    });
  }
  return results;
}

// ── Commander registration ──────────────────────────────────────────────────

export function registerSkillCommand(program: Command): void {
  program
    .command('skill')
    .description('Manage optional capabilities (browser, yt-dlp)')
    .option('--install <name>', 'Install a skill')
    .option('--uninstall <name>', 'Uninstall a skill')
    .option('--json', 'Output as JSON')
    .action(async (opts: { install?: string; uninstall?: string; json?: boolean }) => {
      // ── Install mode ──────────────────────────────────────────────────
      if (opts.install) {
        const skill = SKILLS.find((s) => s.name === opts.install);
        if (!skill) {
          console.error(`Unknown skill: ${opts.install}`);
          console.error(`Available: ${SKILLS.map((s) => s.name).join(', ')}`);
          process.exit(1);
        }

        const alreadyInstalled = await skill.installed();
        if (alreadyInstalled) {
          console.log(green(`✅ ${skill.name} is already installed.`));
          process.exit(0);
        }

        try {
          await skill.install();
          const nowInstalled = await skill.installed();
          if (nowInstalled) {
            console.log(green(`✅ ${skill.name} installed successfully.`));
          } else {
            console.log(yellow(`⚠️  Install command ran but ${skill.name} not detected. Try manually: ${skill.installHint}`));
          }
        } catch (e: any) {
          console.error(red(`❌ Failed to install ${skill.name}: ${e.message}`));
          console.error(dim(`   Try manually: ${skill.installHint}`));
          process.exit(1);
        }
        process.exit(0);
      }

      // ── Uninstall mode ────────────────────────────────────────────────
      if (opts.uninstall) {
        const skill = SKILLS.find((s) => s.name === opts.uninstall);
        if (!skill) {
          console.error(`Unknown skill: ${opts.uninstall}`);
          console.error(`Available: ${SKILLS.map((s) => s.name).join(', ')}`);
          process.exit(1);
        }

        const isInstalled = await skill.installed();
        if (!isInstalled) {
          console.log(dim(`${skill.name} is not installed.`));
          process.exit(0);
        }

        try {
          await skill.uninstall();
          console.log(green(`✅ ${skill.name} uninstalled.`));
        } catch (e: any) {
          console.error(red(`❌ Failed to uninstall ${skill.name}: ${e.message}`));
          console.error(dim(`   Try manually: ${skill.uninstallHint}`));
          process.exit(1);
        }
        process.exit(0);
      }

      // ── List mode (default) ───────────────────────────────────────────
      const statuses = await getSkillStatuses();

      if (opts.json) {
        console.log(JSON.stringify(statuses, null, 2));
        process.exit(0);
      }

      console.log('');
      console.log(bold('WebPeel Skills'));
      console.log(dim('Optional capabilities that enhance WebPeel'));
      console.log('');

      for (const skill of statuses) {
        const icon = skill.installed ? green('✅') : yellow('○');
        const status = skill.installed ? green('installed') : dim('not installed');
        console.log(`  ${icon} ${bold(skill.name.padEnd(12))} ${status}`);
        console.log(`     ${skill.description}`);
        console.log(`     ${dim(`Enables: ${skill.features}`)}`);
        if (!skill.installed) {
          console.log(`     ${dim(`Install: webpeel skill --install ${skill.name}`)}`);
        }
        console.log('');
      }

      console.log(dim('Usage: webpeel skill --install <name> | --uninstall <name>'));
      console.log('');
      process.exit(0);
    });
}
