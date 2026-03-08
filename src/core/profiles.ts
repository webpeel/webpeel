/**
 * WebPeel Profile Management
 *
 * Manages named browser profiles stored in ~/.webpeel/profiles/<name>/
 * Each profile contains:
 *   - storage-state.json  (Playwright storage state: cookies, localStorage, origins)
 *   - metadata.json       (name, created, lastUsed, domains, description)
 */

import { chromium } from 'playwright';
import { homedir } from 'os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProfileMetadata {
  name: string;
  created: string;   // ISO date
  lastUsed: string;  // ISO date
  domains: string[]; // domains the user logged into during setup
  description?: string;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const PROFILES_DIR = path.join(homedir(), '.webpeel', 'profiles');

function ensureProfilesDir(): void {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

// ─── Name validation ─────────────────────────────────────────────────────────

/**
 * Valid profile names: letters, digits, hyphens, and dots. No spaces or special chars.
 * Dots are allowed so domain names like "instagram.com" work as profile names.
 */
export function isValidProfileName(name: string): boolean {
  return /^[a-zA-Z0-9\-.]+$/.test(name) && name.length > 0 && name.length <= 64;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Get the directory path for a named profile, or null if it doesn't exist.
 */
export function getProfilePath(name: string): string | null {
  const dir = path.join(PROFILES_DIR, name);
  if (existsSync(dir) && existsSync(path.join(dir, 'metadata.json'))) {
    return dir;
  }
  return null;
}

/**
 * Load the Playwright storage state (cookies + localStorage) for a named profile.
 * Returns null if the profile or storage-state.json doesn't exist.
 */
export function loadStorageState(name: string): any | null {
  const statePath = path.join(PROFILES_DIR, name, 'storage-state.json');
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update the lastUsed timestamp for a profile.
 */
export function touchProfile(name: string): void {
  const metaPath = path.join(PROFILES_DIR, name, 'metadata.json');
  if (!existsSync(metaPath)) return;
  try {
    const meta: ProfileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.lastUsed = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'profile touch failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * List all profiles, sorted by lastUsed descending.
 */
export function listProfiles(): ProfileMetadata[] {
  ensureProfilesDir();
  const profiles: ProfileMetadata[] = [];
  try {
    const entries = readdirSync(PROFILES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(PROFILES_DIR, entry.name, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      try {
        const meta: ProfileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
        profiles.push(meta);
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'profile metadata parse failed:', e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'profiles dir read failed:', e instanceof Error ? e.message : e);
  }
  // Sort: most recently used first
  profiles.sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
  return profiles;
}

/**
 * Delete a named profile. Returns true if deleted, false if not found.
 */
export function deleteProfile(name: string): boolean {
  const dir = path.join(PROFILES_DIR, name);
  if (!existsSync(dir)) return false;
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ─── Interactive profile creation ─────────────────────────────────────────────

/**
 * Interactively create a new profile:
 * 1. Launches a VISIBLE (headed) Chromium browser
 * 2. User navigates and logs into sites
 * 3. On browser close or Ctrl+C, captures storage state and saves the profile
 */
export async function createProfile(name: string, description?: string): Promise<void> {
  if (!isValidProfileName(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use only letters, numbers, and hyphens (no spaces or special characters).`,
    );
  }

  ensureProfilesDir();

  const profileDir = path.join(PROFILES_DIR, name);
  if (existsSync(profileDir)) {
    throw new Error(
      `Profile "${name}" already exists. Delete it first with:\n  webpeel profile delete ${name}`,
    );
  }

  mkdirSync(profileDir, { recursive: true });

  // Launch headed (visible) Chromium — no user-data-dir so we start fresh
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('about:blank').catch(() => {});

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║  WebPeel Profile Setup: "${name}"`);
  console.log('║                                                      ║');
  console.log('║  Navigate to websites and log in.                   ║');
  console.log('║  When done, press Ctrl+C or close this window.      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  let saved = false;

  const saveAndClose = async (): Promise<void> => {
    if (saved) return;
    saved = true;

    console.log('\nCapturing browser session...');

    try {
      const storageState = await context.storageState();

      writeFileSync(
        path.join(profileDir, 'storage-state.json'),
        JSON.stringify(storageState, null, 2),
      );

      // Extract unique domains from cookies (strip leading dot)
      const domains: string[] = [
        ...new Set(
          (storageState.cookies ?? [])
            .map((c: any) => (c.domain ?? '').replace(/^\./, ''))
            .filter(Boolean),
        ),
      ];

      const now = new Date().toISOString();
      const meta: ProfileMetadata = {
        name,
        created: now,
        lastUsed: now,
        domains,
        ...(description ? { description } : {}),
      };

      writeFileSync(
        path.join(profileDir, 'metadata.json'),
        JSON.stringify(meta, null, 2),
      );

      console.log(`✓ Profile "${name}" saved to ${profileDir}`);
      if (domains.length > 0) {
        console.log(`  Domains: ${domains.join(', ')}`);
      } else {
        console.log('  No login sessions detected (no cookies).');
      }
    } catch (e) {
      console.error(
        'Warning: Failed to save storage state:',
        e instanceof Error ? e.message : String(e),
      );
      // Clean up partial directory
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'cleanup dir failed:', e instanceof Error ? e.message : e);
      }
    }

    try {
      await browser.close();
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'browser close failed:', e instanceof Error ? e.message : e);
    }
  };

  // Wait for the browser to disconnect (user closed the window) OR SIGINT (Ctrl+C)
  await new Promise<void>((resolve) => {
    browser.on('disconnected', async () => {
      await saveAndClose();
      resolve();
    });

    // Handle Ctrl+C gracefully
    const sigintHandler = async () => {
      await saveAndClose();
      resolve();
    };
    process.once('SIGINT', sigintHandler);

    // Clean up the SIGINT handler if browser closes first
    browser.on('disconnected', () => {
      process.removeListener('SIGINT', sigintHandler);
    });
  });
}

// ─── Browser-based login helper ───────────────────────────────────────────────

/**
 * Open a headed browser, navigate to `url`, and wait for the user to log in.
 * Pressing Enter (or closing the browser) saves the session as a named profile.
 *
 * Unlike `createProfile()` (which opens to about:blank and waits for browser close),
 * this function:
 *   1. Navigates directly to the given URL on launch
 *   2. Waits for the user to press Enter (or close the browser) to save
 *   3. Saves storage state AND creates metadata under ~/.webpeel/profiles/<name>/
 *
 * Profile names may contain letters, digits, hyphens, and dots (e.g. "instagram.com").
 */
export async function loginToProfile(url: string, profileName: string, description?: string): Promise<void> {
  if (!isValidProfileName(profileName)) {
    throw new Error(
      `Invalid profile name "${profileName}". Use only letters, numbers, hyphens, and dots (no spaces).`,
    );
  }

  ensureProfilesDir();

  const profileDir = path.join(PROFILES_DIR, profileName);
  const isUpdate = existsSync(profileDir) && existsSync(path.join(profileDir, 'metadata.json'));

  mkdirSync(profileDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(url);
  } catch (e) {
    // Non-fatal — browser is open, user can navigate manually
    if (process.env.DEBUG) console.debug('[webpeel]', 'initial navigation error:', e instanceof Error ? e.message : e);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║  WebPeel Browser Login`);
  console.log(`║  URL:     ${url}`);
  console.log(`║  Profile: ${profileName}`);
  console.log('║                                                      ║');
  console.log('║  Log in, then press Enter here to save your session. ║');
  console.log('║  (Or close the browser window — same effect.)        ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  let saved = false;

  const saveAndClose = async (): Promise<void> => {
    if (saved) return;
    saved = true;

    console.log('\nCapturing browser session...');

    try {
      const storageState = await context.storageState();

      writeFileSync(
        path.join(profileDir, 'storage-state.json'),
        JSON.stringify(storageState, null, 2),
      );

      // Extract unique domains from cookies (strip leading dot)
      const domains: string[] = [
        ...new Set(
          (storageState.cookies ?? [])
            .map((c: any) => (c.domain ?? '').replace(/^\./, ''))
            .filter(Boolean),
        ),
      ];

      const now = new Date().toISOString();
      const meta: ProfileMetadata = isUpdate
        ? {
            // Preserve original creation date on update
            ...((() => {
              try { return JSON.parse(readFileSync(path.join(profileDir, 'metadata.json'), 'utf-8')); } catch { return {}; }
            })()),
            name: profileName,
            lastUsed: now,
            domains,
            ...(description ? { description } : {}),
          }
        : {
            name: profileName,
            created: now,
            lastUsed: now,
            domains,
            ...(description ? { description } : {}),
          };

      writeFileSync(
        path.join(profileDir, 'metadata.json'),
        JSON.stringify(meta, null, 2),
      );

      console.log(`✅ Profile "${profileName}" ${isUpdate ? 'updated' : 'saved'}!`);
      if (domains.length > 0) {
        console.log(`   Domains: ${domains.join(', ')}`);
      } else {
        console.log('   No login sessions detected (no cookies captured).');
        console.log('   Make sure you completed the login before pressing Enter.');
      }
      console.log('');
      console.log(`   Use with: webpeel "${url}" --profile ${profileName}`);
    } catch (e) {
      console.error(
        'Warning: Failed to save storage state:',
        e instanceof Error ? e.message : String(e),
      );
      // Clean up partial directory if this was a new profile
      if (!isUpdate) {
        try {
          rmSync(profileDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
    }

    try {
      await browser.close();
    } catch {
      // ignore close errors
    }
  };

  // Three ways to save: Enter key, browser close, or Ctrl+C
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = async () => {
      if (resolved) return;
      resolved = true;
      await saveAndClose();
      resolve();
    };

    // Wait for Enter key on stdin
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();
    process.stdin.once('data', () => done());

    // Browser closed by user
    browser.on('disconnected', () => done());

    // Ctrl+C
    process.once('SIGINT', () => done());
  });
}
