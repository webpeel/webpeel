/**
 * Realistic User Agent Rotation for WebPeel
 *
 * Provides a curated list of real-world Chrome user agents (132-136 range)
 * across Windows, macOS, and Linux platforms. Used when stealth mode is active
 * and no custom UA is set — prevents the default "Chrome for Testing" UA which
 * is an instant bot-detection signal.
 *
 * Also provides `getSecCHUA()` for generating correct Sec-CH-UA header values
 * that match the selected user agent (version-accurate brand hints).
 */

// ── Curated UA lists ──────────────────────────────────────────────────────────

const WINDOWS_UAS: readonly string[] = [
  // Chrome 132
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  // Chrome 133
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  // Chrome 134
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  // Chrome 135
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  // Chrome 136
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
];

const MAC_UAS: readonly string[] = [
  // Chrome 132 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  // Chrome 133 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  // Chrome 134 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  // Chrome 135 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  // Chrome 136 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
];

const LINUX_UAS: readonly string[] = [
  // Chrome 133 Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  // Chrome 135 Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  // Chrome 136 Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
];

/** All Chrome UAs combined (fallback when no platform is specified) */
const ALL_UAS: readonly string[] = [...WINDOWS_UAS, ...MAC_UAS, ...LINUX_UAS];

// ── Extended pools for non-Chrome browsers (HTTP-only use) ───────────────────

/** Firefox UAs — Windows, Mac, Linux */
const FIREFOX_UAS: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
];

/** Safari UAs — macOS */
const SAFARI_UAS: readonly string[] = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
];

/** Microsoft Edge UAs */
const EDGE_UAS: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0',
];

/** Mobile Chrome UAs */
const MOBILE_CHROME_UAS: readonly string[] = [
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.103 Mobile/15E148 Safari/604.1',
];

/**
 * Full UA pool for HTTP-only requests (Chrome + Firefox + Safari + Edge + Mobile).
 * NOT for browser contexts — use getRealisticUserAgent() there (Chrome-only).
 */
export const HTTP_UAS: readonly string[] = [
  ...ALL_UAS,
  ...FIREFOX_UAS,
  ...SAFARI_UAS,
  ...EDGE_UAS,
  ...MOBILE_CHROME_UAS,
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a realistic, recent Chrome user agent string.
 * Randomly picks from a curated list of real-world UAs (Chrome 132-136 range).
 *
 * @param platform - Optionally restrict to a specific OS platform.
 *                   When omitted, picks from all platforms (weighted: ~55% Windows, ~35% Mac, ~10% Linux).
 *
 * @example
 * ```ts
 * // Random platform
 * const ua = getRealisticUserAgent();
 *
 * // Force Windows UA (e.g. for LinkedIn, which is more common on Windows)
 * const ua = getRealisticUserAgent('windows');
 * ```
 */
export function getRealisticUserAgent(platform?: 'windows' | 'mac' | 'linux'): string {
  let pool: readonly string[];

  if (platform === 'windows') {
    pool = WINDOWS_UAS;
  } else if (platform === 'mac') {
    pool = MAC_UAS;
  } else if (platform === 'linux') {
    pool = LINUX_UAS;
  } else {
    // Weighted random: Windows ~55%, Mac ~35%, Linux ~10%
    const roll = Math.random();
    if (roll < 0.55) {
      pool = WINDOWS_UAS;
    } else if (roll < 0.90) {
      pool = MAC_UAS;
    } else {
      pool = LINUX_UAS;
    }
  }

  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx]!;
}

/**
 * Returns a random UA from the full list (all platforms).
 * Equivalent to `getRealisticUserAgent()` with no arguments.
 */
export function getRandomUA(): string {
  const idx = Math.floor(Math.random() * ALL_UAS.length);
  return ALL_UAS[idx]!;
}

/**
 * Returns a realistic user agent for HTTP-only (non-browser) requests.
 * Unlike `getRealisticUserAgent()` which is Chrome-only for browser contexts,
 * this function returns from a wider pool: Chrome, Firefox, Safari, Edge, and Mobile.
 *
 * Weight distribution (approximate):
 * - Chrome Windows:  ~30%
 * - Chrome macOS:    ~25%
 * - Chrome Linux:    ~10%
 * - Firefox:         ~15%
 * - Safari:          ~10%
 * - Edge:             ~5%
 * - Mobile Chrome:    ~5%
 *
 * @example
 * ```ts
 * const ua = getHttpUA(); // e.g. "Mozilla/5.0 ... Firefox/133.0"
 * ```
 */
export function getHttpUA(): string {
  const roll = Math.random();
  let pool: readonly string[];

  if (roll < 0.30) {
    pool = WINDOWS_UAS;
  } else if (roll < 0.55) {
    pool = MAC_UAS;
  } else if (roll < 0.65) {
    pool = LINUX_UAS;
  } else if (roll < 0.80) {
    pool = FIREFOX_UAS;
  } else if (roll < 0.90) {
    pool = SAFARI_UAS;
  } else if (roll < 0.95) {
    pool = EDGE_UAS;
  } else {
    pool = MOBILE_CHROME_UAS;
  }

  return pool[Math.floor(Math.random() * pool.length)]!;
}

/**
 * The full curated list of realistic user agents (Chrome-only, all platforms).
 * Exported for inspection / testing.
 */
export const REALISTIC_USER_AGENTS: readonly string[] = ALL_UAS;

// ── Sec-CH-UA header generation ───────────────────────────────────────────────

/**
 * The "Not A Brand" token format varies by Chrome version.
 *
 * Chrome 132-133: `"Not_A Brand";v="8"`
 * Chrome 134-135: `"Not)A;Brand";v="99"`
 * Chrome 136+:    `"Not.A/Brand";v="24"`
 *
 * This matches real Chrome behavior to avoid client-hint fingerprinting.
 */
function getNotABrandToken(chromeVersion: number): string {
  if (chromeVersion >= 136) {
    return '"Not.A/Brand";v="24"';
  } else if (chromeVersion >= 134) {
    return '"Not)A;Brand";v="99"';
  } else {
    return '"Not_A Brand";v="8"';
  }
}

/**
 * Get a Sec-CH-UA header value that matches the given user agent string.
 *
 * Extracts the Chrome major version from the UA string and returns a properly
 * formatted `Sec-CH-UA` header value, e.g.:
 *   `"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="24"`
 *
 * Falls back to a sane Chrome 136 value when the UA doesn't contain a
 * recognizable Chrome version.
 *
 * @param userAgent - Full user agent string (e.g. from getRealisticUserAgent())
 */
export function getSecCHUA(userAgent: string): string {
  // Extract Chrome major version from UA string
  // Matches patterns like: Chrome/136.0.0.0 or Chrome/132
  const match = userAgent.match(/Chrome\/(\d+)/i);
  const version = match ? parseInt(match[1]!, 10) : 136;

  const notABrand = getNotABrandToken(version);
  return `"Chromium";v="${version}", "Google Chrome";v="${version}", ${notABrand}`;
}

/**
 * Determine the Sec-CH-UA-Platform header value based on the user agent string.
 *
 * @param userAgent - Full user agent string
 */
export function getSecCHUAPlatform(userAgent: string): string {
  if (userAgent.includes('Windows')) return '"Windows"';
  if (userAgent.includes('Macintosh')) return '"macOS"';
  if (userAgent.includes('Linux')) return '"Linux"';
  return '"Unknown"';
}
