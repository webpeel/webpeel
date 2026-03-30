/**
 * Auth commands: auth, status, doctor, login, whoami, logout, usage, config, cache
 */

import type { Command } from 'commander';
import { handleLogin, handleLogout, handleUsage, loadConfig, saveConfig } from '../../cli-auth.js';
import { clearCache, cacheStats } from '../../cache.js';
import { loginToProfile } from '../../core/profiles.js';
// cliVersion moved to doctor.ts

export function registerAuthCommands(program: Command): void {

  // ── auth command ──────────────────────────────────────────────────────────
  program
    .command('auth [key]')
    .description('Set and verify your WebPeel API key')
    .option('--json', 'Output as JSON')
    .action(async (key: string | undefined, opts: { json?: boolean }) => {
      const config = loadConfig();

      // If no key provided, show current auth status (or error if not set)
      if (!key) {
        const currentKey = config.apiKey;
        if (!currentKey) {
          if (opts.json) {
            console.log(JSON.stringify({ authenticated: false, error: 'No API key set. Run: webpeel auth <key>' }));
          } else {
            console.error('No API key set. Run: webpeel auth <your-key>');
            console.error('Get a free key at: https://app.webpeel.dev/keys');
          }
          process.exit(2);
        }
        // Fall through to verify current key
        key = currentKey;
      }

      // Save the key first
      config.apiKey = key;
      saveConfig(config);

      // Verify by calling the API
      const apiUrl = (process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev');
      try {
        const res = await fetch(`${apiUrl}/v1/usage`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });

        if (res.status === 401) {
          if (opts.json) {
            console.log(JSON.stringify({ authenticated: false, error: 'Invalid API key' }));
          } else {
            console.error('❌ Invalid API key. Get a valid key at: https://app.webpeel.dev/keys');
          }
          // Revert the key save
          config.apiKey = undefined;
          saveConfig(config);
          process.exit(2);
        }

        if (res.ok) {
          const data = await res.json() as any;
          const plan = data.tier || (typeof data.plan === 'string' ? data.plan : data.plan?.tier) || 'free';
          const used = data.used ?? data.totalRequests ?? data.weekly?.used ?? 0;
          const limit = data.limit ?? data.weeklyLimit ?? data.weekly?.limit ?? 500;
          const remaining = limit - used;

          if (opts.json) {
            console.log(JSON.stringify({
              authenticated: true,
              plan,
              used,
              limit,
              remaining,
              keyPrefix: key.slice(0, 12) + '...',
            }));
          } else {
            console.log(`✅ API key verified`);
            console.log(`   Plan: ${plan}`);
            console.log(`   Usage: ${used} / ${limit} this week (${remaining} remaining)`);
            console.log(`   Key: ${key.slice(0, 12)}...`);
          }
          process.exit(0);
        }

        // Non-200 non-401 — still save key but warn
        if (opts.json) {
          console.log(JSON.stringify({ authenticated: 'unknown', warning: `API returned ${res.status}` }));
        } else {
          console.log(`⚠️  Key saved but couldn't verify (API returned ${res.status})`);
        }
      } catch (e: any) {
        if (opts.json) {
          console.log(JSON.stringify({ authenticated: 'unknown', warning: 'Network error', error: e.message }));
        } else {
          console.log(`⚠️  Key saved but couldn't verify (network error: ${e.message})`);
        }
      }
    });

  // ── status command ────────────────────────────────────────────────────────
  program
    .command('status')
    .description('Check authentication status and API usage')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const config = loadConfig();
      const key = config.apiKey;

      if (!key) {
        if (opts.json) {
          console.log(JSON.stringify({ authenticated: false, error: 'No API key configured' }));
        } else {
          console.error('Not authenticated. Run: webpeel auth <your-key>');
          console.error('Get a free key at: https://app.webpeel.dev/keys');
        }
        process.exit(2);
      }

      const apiUrl = (process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev');
      try {
        const [healthRes, usageRes] = await Promise.all([
          fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null),
          fetch(`${apiUrl}/v1/usage`, {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(8000),
          }),
        ]);

        const apiOnline = healthRes?.ok ?? false;

        if (usageRes.status === 401) {
          if (opts.json) {
            console.log(JSON.stringify({ authenticated: false, apiOnline, error: 'API key is invalid or expired' }));
          } else {
            console.error('❌ API key is invalid. Run: webpeel auth <new-key>');
          }
          process.exit(2);
        }

        const usage = usageRes.ok ? await usageRes.json() as any : null;
        const plan = usage?.tier || (typeof usage?.plan === 'string' ? usage?.plan : usage?.plan?.tier) || 'free';
        const used = usage?.used ?? usage?.totalRequests ?? usage?.weekly?.used ?? 0;
        const limit = usage?.limit ?? usage?.weeklyLimit ?? usage?.weekly?.limit ?? 500;
        const remaining = limit - used;

        if (opts.json) {
          console.log(JSON.stringify({
            authenticated: true,
            apiOnline,
            plan,
            used,
            limit,
            remaining,
            keyPrefix: key.slice(0, 12) + '...',
          }));
        } else {
          console.log(`✅ Authenticated`);
          console.log(`   API: ${apiOnline ? '🟢 online' : '🔴 offline'}`);
          console.log(`   Plan: ${plan}`);
          console.log(`   Usage: ${used} / ${limit} this week (${remaining} remaining)`);
          console.log(`   Key: ${key.slice(0, 12)}...`);
        }
      } catch (e: any) {
        if (opts.json) {
          console.log(JSON.stringify({ authenticated: 'unknown', error: e.message }));
        } else {
          console.error(`❌ Could not reach API: ${e.message}`);
        }
        process.exit(1);
      }
    });

  // ── doctor command — moved to cli/commands/doctor.ts ────────────────────

  // ── login command ─────────────────────────────────────────────────────────
  // Two modes:
  //   webpeel login             — interactive API key authentication (existing)
  //   webpeel login <domain>    — browser login: open site, log in, save cookies as profile
  program
    .command('login [domain]')
    .description('Authenticate: no args = API key auth; with domain = browser login (saves cookies as a named profile)')
    .option('--profile <name>', 'Profile name to save under (defaults to the domain)')
    .action(async (domain: string | undefined, opts: { profile?: string }) => {
      try {
        if (domain) {
          // ── Browser login mode ──────────────────────────────────────────
          const url = domain.startsWith('http') ? domain : `https://${domain}`;
          // Extract hostname for profile name default (e.g. "instagram.com" from "https://www.instagram.com/")
          let defaultProfileName: string;
          try {
            const hostname = new URL(url).hostname;
            // Strip "www." prefix for cleaner profile names
            defaultProfileName = hostname.replace(/^www\./, '');
          } catch {
            defaultProfileName = domain;
          }
          const profileName = opts.profile || defaultProfileName;

          await loginToProfile(url, profileName);
          process.exit(0);
        } else {
          // ── API key auth mode (original behavior) ───────────────────────
          await handleLogin();
          process.exit(0);
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // ── whoami command ────────────────────────────────────────────────────────
  program
    .command('whoami')
    .description('Show your current authentication status')
    .action(async () => {
      try {
        const { loadConfig: loadCfg } = await import('../../cli-auth.js');
        const config = loadCfg();
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

  // ── logout command ────────────────────────────────────────────────────────
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

  // ── usage command ─────────────────────────────────────────────────────────
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

  // ── config command ────────────────────────────────────────────────────────
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
        apiKey: 'WebPeel API key (tip: use `webpeel auth <key>` to set and verify in one step)',
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
        if (!config.apiKey) {
          console.log('');
          console.log('  Tip: Run `webpeel auth <your-key>` to set and verify your API key.');
          console.log('       Get a free key at: https://app.webpeel.dev/keys');
        }
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

  // ── cache command ─────────────────────────────────────────────────────────
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
}
