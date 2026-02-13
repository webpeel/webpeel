/**
 * CLI Authentication & Usage Tracking
 * 
 * Handles:
 * - Anonymous usage (25 free fetches)
 * - API key authentication
 * - Usage checking against API
 * - Config file management (~/.webpeel/config.json)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as readline from 'readline';

// Config file location: ~/.webpeel/config.json
const CONFIG_DIR = join(homedir(), '.webpeel');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// API base URL (configurable via env var)
const API_BASE_URL = process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev';

interface CLIConfig {
  apiKey?: string;
  anonymousUsage: number;  // count of fetches without login
  lastReset: string;       // ISO date of last anonymous counter reset
  planTier?: string;       // cached plan tier (free/pro/max)
  planCachedAt?: string;   // ISO date when plan was last verified
}

interface UsageCheckResult {
  allowed: boolean;
  message?: string;
  isAnonymous?: boolean;
  usageInfo?: {
    used: number;
    limit: number;
    remaining: number;
  };
}

interface APIUsageResponse {
  plan: {
    tier: string;
    weeklyLimit: number;
    burstLimit: number;
  };
  weekly: {
    used: number;
    limit: number;
    remaining: number;
    resetsAt: string;
    percentUsed: number;
  };
  burst: {
    used: number;
    limit: number;
    resetsIn: string;
  };
  canFetch: boolean;
  upgradeUrl: string;
}

/**
 * Load config from ~/.webpeel/config.json
 */
export function loadConfig(): CLIConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return {
        anonymousUsage: 0,
        lastReset: getLastMonday().toISOString(),
      };
    }

    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as CLIConfig;
    
    // Ensure lastReset exists
    if (!config.lastReset) {
      config.lastReset = getLastMonday().toISOString();
    }

    return config;
  } catch (error) {
    // If config is corrupted, start fresh
    return {
      anonymousUsage: 0,
      lastReset: getLastMonday().toISOString(),
    };
  }
}

/**
 * Save config to ~/.webpeel/config.json
 */
export function saveConfig(config: CLIConfig): void {
  try {
    // Ensure directory exists
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Warning: Failed to save config: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete config file
 */
export function deleteConfig(): void {
  try {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
    }
  } catch (error) {
    console.error(`Warning: Failed to delete config: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the last Monday 00:00 UTC (start of current week)
 */
function getLastMonday(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Days since last Monday
  const lastMonday = new Date(now);
  lastMonday.setUTCDate(now.getUTCDate() - diff);
  lastMonday.setUTCHours(0, 0, 0, 0);
  return lastMonday;
}

/**
 * Check if anonymous usage counter needs to be reset (weekly reset)
 */
function shouldResetAnonymousUsage(config: CLIConfig): boolean {
  const lastReset = new Date(config.lastReset);
  const currentWeekStart = getLastMonday();
  return lastReset < currentWeekStart;
}

/**
 * Check usage quota before making a request
 */
export async function checkUsage(): Promise<UsageCheckResult> {
  const config = loadConfig();

  // Check if anonymous usage needs reset
  if (shouldResetAnonymousUsage(config)) {
    config.anonymousUsage = 0;
    config.lastReset = getLastMonday().toISOString();
    saveConfig(config);
  }

  // Anonymous user - allow first 25 fetches
  if (!config.apiKey) {
    const limit = 25;
    const used = config.anonymousUsage;
    const remaining = limit - used;

    if (used >= limit) {
      return {
        allowed: false,
        message: `You've used your ${limit} free fetches.\n\nSign up for free at https://app.webpeel.dev/signup to get 125 fetches/week.\nOr run: webpeel login\n`,
      };
    }

    // Increment usage counter
    config.anonymousUsage++;
    saveConfig(config);

    return {
      allowed: true,
      isAnonymous: true,
      usageInfo: {
        used: used + 1,
        limit,
        remaining: remaining - 1,
      },
    };
  }

  // Authenticated user - check with API
  try {
    const response = await fetch(`${API_BASE_URL}/v1/cli/usage`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          allowed: false,
          message: `Authentication failed. Your API key may be invalid.\n\nRun: webpeel logout\nThen: webpeel login\n`,
        };
      }
      // If API returns other errors, allow gracefully
      return { allowed: true };
    }

    const data = await response.json() as APIUsageResponse;

    // Check burst limit
    if (data.burst.used >= data.burst.limit) {
      return {
        allowed: false,
        message: `Burst limit reached (${data.burst.used}/${data.burst.limit}). Resets in ${data.burst.resetsIn}.\nUpgrade: ${data.upgradeUrl}`,
      };
    }

    // Quick canFetch check from API
    if (!data.canFetch) {
      return {
        allowed: false,
        message: `Weekly limit reached (${data.weekly.used}/${data.weekly.limit}).\nResets: ${data.weekly.resetsAt}\nUpgrade: ${data.upgradeUrl}`,
      };
    }

    // Cache plan tier for offline feature gating
    const planName = (data.plan?.tier || 'free').toLowerCase();
    config.planTier = planName;
    config.planCachedAt = new Date().toISOString();
    saveConfig(config);

    return {
      allowed: true,
      isAnonymous: false,
      usageInfo: {
        used: data.weekly.used,
        limit: data.weekly.limit,
        remaining: data.weekly.remaining,
      },
    };
  } catch (error) {
    // If API is unreachable, allow the request (graceful degradation)
    return { allowed: true };
  }
}

// Premium features that require a paid plan
export type PremiumFeature = 'stealth' | 'crawl' | 'batch';

const FEATURE_LABELS: Record<PremiumFeature, string> = {
  stealth: 'Stealth mode (anti-bot bypass)',
  crawl: 'Crawl mode (multi-page)',
  batch: 'Batch mode (bulk URLs)',
};

/**
 * Check if user has access to a premium feature.
 * Returns { allowed: true } for paid users, or a helpful upgrade message.
 * 
 * Priority:
 * 1. No API key → blocked (must sign up)
 * 2. Has API key + cached plan → check plan tier
 * 3. Has API key + no cache → check API, then cache
 * 4. API unreachable + cached plan within 7 days → use cache
 * 5. API unreachable + stale cache → allow gracefully (trust the user)
 */
export async function checkFeatureAccess(feature: PremiumFeature): Promise<{ allowed: boolean; message?: string }> {
  const config = loadConfig();

  // No API key → must sign up and subscribe
  if (!config.apiKey) {
    return {
      allowed: false,
      message: `⚡ ${FEATURE_LABELS[feature]} requires a Pro plan ($9/mo).\n\n` +
        `  Basic fetch is free — stealth, crawl, and batch are Pro features.\n\n` +
        `  Sign up:  https://app.webpeel.dev/signup\n` +
        `  Pricing:  https://webpeel.dev/#pricing\n` +
        `  Login:    webpeel login\n`,
    };
  }

  // Try to get fresh plan info from API
  try {
    const response = await fetch(`${API_BASE_URL}/v1/cli/usage`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json() as APIUsageResponse;
      const planName = (data.plan?.tier || 'free').toLowerCase();
      
      // Cache for offline use
      config.planTier = planName;
      config.planCachedAt = new Date().toISOString();
      saveConfig(config);

      if (planName === 'free') {
        return {
          allowed: false,
          message: `⚡ ${FEATURE_LABELS[feature]} requires a Pro plan ($9/mo).\n\n` +
            `  You're on the Free plan. Upgrade to unlock stealth, crawl, and batch.\n\n` +
            `  Upgrade:  https://app.webpeel.dev/billing\n` +
            `  Pricing:  https://webpeel.dev/#pricing\n`,
        };
      }

      // Pro or Max — allowed
      return { allowed: true };
    }
  } catch {
    // API unreachable — fall through to cache check
  }

  // API unreachable — use cached plan if recent (within 7 days)
  if (config.planTier && config.planCachedAt) {
    const cacheAge = Date.now() - new Date(config.planCachedAt).getTime();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    if (cacheAge < SEVEN_DAYS) {
      if (config.planTier === 'free') {
        return {
          allowed: false,
          message: `⚡ ${FEATURE_LABELS[feature]} requires a Pro plan ($9/mo).\n\n` +
            `  Upgrade:  https://app.webpeel.dev/billing\n`,
        };
      }
      return { allowed: true };
    }
  }

  // Stale cache or no cache, API unreachable — allow gracefully (trust paying users)
  return { allowed: true };
}

/**
 * Show usage footer after successful fetch (for free/anonymous users only)
 */
export function showUsageFooter(
  usageInfo: { used: number; limit: number; remaining: number } | undefined,
  isAnonymous: boolean,
  stealth: boolean = false
): void {
  if (!usageInfo) return;

  // Only show footer for anonymous or free users
  if (isAnonymous) {
    const costText = stealth ? ' (costs 5 credits)' : '';
    console.error(`⚡ ${usageInfo.remaining}/${usageInfo.limit} free fetches remaining${costText}. Run \`webpeel login\` to get 125/week free.`);
  } else if (usageInfo.limit <= 125) {
    // Free tier authenticated users
    const costText = stealth ? ' (costs 5 credits)' : '';
    console.error(`⚡ ${usageInfo.remaining}/${usageInfo.limit} fetches remaining this week${costText}.`);
  }
  // Don't show footer for paid users
}

/**
 * Prompt user for API key via stdin
 */
export async function promptForApiKey(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter your API key (get one at https://app.webpeel.dev/keys): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Login command - save API key to config
 */
export async function handleLogin(): Promise<void> {
  const config = loadConfig();

  if (config.apiKey) {
    console.log('You are already logged in.');
    console.log('Run `webpeel logout` first if you want to use a different API key.');
    return;
  }

  console.log('\nWebPeel CLI Authentication');
  console.log('==========================\n');
  
  const apiKey = await promptForApiKey();

  if (!apiKey) {
    console.error('Error: API key cannot be empty');
    process.exit(1);
  }

  // Validate API key format (should start with wp_)
  if (!apiKey.startsWith('wp_')) {
    console.error('Warning: API key should start with "wp_". Make sure you entered it correctly.');
  }

  // Save to config
  config.apiKey = apiKey;
  saveConfig(config);

  console.log('\n✓ Successfully logged in!');
  console.log('Run `webpeel usage` to check your quota.');
}

/**
 * Logout command - remove API key from config
 */
export function handleLogout(): void {
  const config = loadConfig();

  if (!config.apiKey) {
    console.log('You are not logged in.');
    return;
  }

  deleteConfig();
  console.log('✓ Logged out successfully');
}

/**
 * Usage command - show current quota
 */
export async function handleUsage(): Promise<void> {
  const config = loadConfig();

  // Check for weekly reset
  if (shouldResetAnonymousUsage(config)) {
    config.anonymousUsage = 0;
    config.lastReset = getLastMonday().toISOString();
    saveConfig(config);
  }

  // Anonymous user
  if (!config.apiKey) {
    const limit = 25;
    const used = config.anonymousUsage;
    const remaining = limit - used;
    const nextMonday = new Date(getLastMonday());
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

    console.log('\nWebPeel Usage (Anonymous)');
    console.log('=========================\n');
    console.log(`Plan: Anonymous (25 free fetches/week)`);
    console.log(`Used this week: ${used}/${limit}`);
    console.log(`Remaining: ${remaining}`);
    console.log(`Resets: ${nextMonday.toUTCString()}`);
    console.log('\n💡 Run `webpeel login` to get 125 fetches/week for free!');
    console.log('   Or sign up at https://app.webpeel.dev/signup\n');
    return;
  }

  // Authenticated user - fetch from API
  try {
    const response = await fetch(`${API_BASE_URL}/v1/cli/usage`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 401) {
        console.error('Error: Authentication failed. Your API key may be invalid.');
        console.error('Run `webpeel logout` and `webpeel login` to re-authenticate.');
        process.exit(1);
      }
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json() as APIUsageResponse;
    const tierLabel = data.plan.tier.charAt(0).toUpperCase() + data.plan.tier.slice(1);

    console.log('\nWebPeel Usage');
    console.log('=============\n');
    console.log(`Plan: ${tierLabel} (${data.weekly.limit}/week)`);
    console.log(`Used this week: ${data.weekly.used}/${data.weekly.limit} (${data.weekly.percentUsed}%)`);
    console.log(`Remaining: ${data.weekly.remaining}`);
    console.log(`Burst: ${data.burst.used}/${data.burst.limit} this hour (resets in ${data.burst.resetsIn})`);
    console.log(`Weekly reset: ${new Date(data.weekly.resetsAt).toUTCString()}`);
    
    if (data.weekly.remaining <= 10) {
      console.log(`\n⚠️  Running low on credits. Upgrade at ${data.upgradeUrl}`);
    }

    console.log();
  } catch (error) {
    console.error(`Error fetching usage data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.error('The API may be temporarily unavailable. Try again later.');
    process.exit(1);
  }
}
