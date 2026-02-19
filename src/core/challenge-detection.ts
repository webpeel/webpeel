/**
 * Challenge / bot-protection page detection.
 *
 * Analyzes raw HTML (and optional HTTP status code) to determine whether the
 * response is a bot-challenge or block page rather than real content.
 *
 * Design goals:
 *  - Fast: pure string/regex matching, no DOM parsing required
 *  - Low false-positive rate: uses confidence scoring, only flags at >= 0.7
 *  - No external dependencies
 */

/* ---------- public types ------------------------------------------------- */

export type ChallengeType =
  | 'cloudflare'
  | 'captcha'
  | 'akamai'
  | 'perimeterx'
  | 'datadome'
  | 'incapsula'
  | 'generic-block'
  | 'empty-shell';

export interface ChallengeDetectionResult {
  isChallenge: boolean;
  type?: ChallengeType;
  /** Confidence score from 0 (not a challenge) to 1 (definitely a challenge). */
  confidence: number;
  details?: string;
}

/* ---------- helpers ------------------------------------------------------ */

/** Case-insensitive substring presence test. */
function has(html: string, needle: string): boolean {
  return html.includes(needle);
}

/** Test multiple needles — return how many match. */
function countMatches(html: string, needles: readonly string[]): number {
  let count = 0;
  for (const needle of needles) {
    if (html.includes(needle)) count++;
  }
  return count;
}

/** Extract <title> content (lowercased). */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1]!.toLowerCase().trim() : '';
}

/** Estimate visible text length after stripping scripts/styles/tags. */
function estimateVisibleTextLength(html: string): number {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length;
}

/* ---------- vendor-specific detectors ------------------------------------ */

function detectCloudflare(html: string, statusCode?: number): number {
  let score = 0;

  // Strong signals — each adds a lot of weight
  const strongSignals = [
    'cf-browser-verification',
    'cf-turnstile',
    'cf-challenge',
    'cf-chl-widget',
    'challenge-running',
    'challenge-form',
    'window._cf_chl_opt',
    '__cf_chl_f_tk',
    'cf_chl_prog',
    'cf-spinner',
    'cf-error-overview',
  ];
  const strongCount = countMatches(html, strongSignals);
  score += Math.min(strongCount * 0.25, 0.75);

  // Title check
  const title = extractTitle(html);
  if (
    title.includes('just a moment') ||
    title.includes('attention required') ||
    title.includes('checking your browser') ||
    title.includes('one more step')
  ) {
    score += 0.35;
  }

  // Ray ID is a Cloudflare-specific identifier
  if (/ray\s+id/i.test(html) || /ray id:/i.test(html)) {
    score += 0.2;
  }

  // Cloudflare's cdn-cgi path
  if (has(html, 'cdn-cgi/')) {
    score += 0.15;
  }

  // 403/503 + Cloudflare signals
  if ((statusCode === 403 || statusCode === 503) && score > 0) {
    score += 0.2;
  }

  return Math.min(score, 1);
}

function detectPerimeterX(html: string, statusCode?: number): number {
  let score = 0;

  const signals = [
    'perimeterx',
    '_pxhd',
    'px-captcha',
    '_pxCaptcha',
    'window._pxAppId',
    'window._pxUuid',
    'pxCaptcha',
    '_px3',
    '_pxvid',
    'human.security',
    'px-block',
  ];
  const count = countMatches(html, signals);
  score += Math.min(count * 0.3, 0.8);

  const title = extractTitle(html);
  if (
    title.includes('access denied') ||
    title.includes('has been denied') ||
    title.includes('access to this page') ||
    title.includes('please verify') ||
    title.includes('bot detection') ||
    title.includes('pardon our interruption')
  ) {
    score += 0.15;
  }

  // PerimeterX "Press & Hold" challenge page (used by Zillow, etc.)
  const hasPresssHold = has(html, 'Press & Hold') || has(html, 'Press &amp; Hold') || has(html, 'press and hold');
  const hasHumanCheck = has(html, 'confirm you are human') || has(html, 'confirm you area human') || has(html, 'not a bot');
  if (hasPresssHold && hasHumanCheck) {
    score += 0.5;
  } else if (hasPresssHold || hasHumanCheck) {
    score += 0.2;
  }

  // Reference ID pattern is common in PerimeterX block pages
  if (/reference\s+id\s+[0-9a-f-]{20,}/i.test(html)) {
    score += 0.2;
  }

  if (statusCode === 403 && score > 0) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

function detectAkamai(html: string, statusCode?: number): number {
  let score = 0;

  const signals = [
    'ak_bmsc',
    '_abck',
    'bm_sz',
    'akamaized.net',
    'akamai',
    'bmak.',
    '__utmz',
    'akam/',
    'BotManagerSettings',
  ];
  const count = countMatches(html, signals);
  score += Math.min(count * 0.2, 0.6);

  // Akamai often shows a short "Access Denied" page
  const title = extractTitle(html);
  if (title.includes('access denied') || title.includes('forbidden')) {
    score += 0.2;
  }

  // Akamai block pages tend to be small
  if (html.length < 2000 && score > 0) {
    score += 0.15;
  }

  if ((statusCode === 403 || statusCode === 503) && score > 0) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

function detectDataDome(html: string, _statusCode?: number): number {
  let score = 0;

  const signals = [
    'datadome',
    'dd.js',
    'datadome.co',
    'window.ddjskey',
    'ddjskey',
    'dd_referrer',
    'dd_cookie_test',
    'datadome/captcha',
    // DataDome's CAPTCHA delivery infrastructure (used by Etsy, FootLocker, etc.)
    'captcha-delivery.com',
    'geo.captcha-delivery.com',
  ];
  const count = countMatches(html, signals);
  score += Math.min(count * 0.3, 0.9);

  // DataDome uses a short `var dd={...}` config variable with captcha-delivery host
  if (/\bvar\s+dd\s*=\s*\{/.test(html) && html.includes('captcha-delivery')) {
    score += 0.4;
  }

  return Math.min(score, 1);
}

function detectIncapsula(html: string, _statusCode?: number): number {
  let score = 0;

  const signals = [
    'incap_ses_',
    'visid_incap_',
    '_incap_',
    'imperva',
    'incapsula',
    'incapsula.com',
    'incapcookies',
    'reese84',
  ];
  const count = countMatches(html, signals);
  score += Math.min(count * 0.3, 0.8);

  // Incapsula "requires JavaScript" pages
  if (
    has(html, 'This site requires JavaScript') ||
    has(html, 'requires javascript')
  ) {
    score += 0.15;
  }

  return Math.min(score, 1);
}

/**
 * Detect generic block/challenge pages that don't belong to a specific vendor.
 *
 * We use multiple weak signals and require several of them to fire before
 * flagging — this avoids false positives from pages that merely mention
 * these terms in article content.
 */
function detectGenericBlock(html: string, statusCode?: number): number {
  let score = 0;

  // Title signals (strong)
  const title = extractTitle(html);
  const blockTitles = [
    'access denied',
    'has been denied',
    'has been blocked',
    'access to this page',
    '403 forbidden',
    'bot detected',
    'verify you are human',
    'security check',
    'ddos protection',
    'rate limit exceeded',
    'too many requests',
    'captcha required',
    'robot check',
    'unusual traffic',
    'automated access',
    'browser check',
    'human verification',
    'blocked by',
    'pardon our interruption',
  ];
  for (const t of blockTitles) {
    if (title.includes(t)) {
      score += 0.35;
      break; // Only count once from title
    }
  }

  // Body signals — but require multiple (to avoid false positives from blog posts)
  const bodySignals = [
    'automated access',
    'suspicious activity',
    'rate limit',
    'bot detected',
    'verify you are human',
    'verify that you are human',
    'confirm you are human',
    'confirm you area human',   // known PerimeterX typo in the wild
    'are you a robot',
    'are you human',
    'not a bot',
    'and not a bot',
    'press & hold',
    'press and hold',
    'ddos protection by',
    'please complete the security check',
    'this page checks to see if it',
    'prove you are human',
    'security challenge',
    'enable javascript and cookies',
    'javascript and cookies to continue',
    'enable cookies',
    'reference id',             // PerimeterX block pages include a Reference ID
    'why have i been blocked',
    'your access has been blocked',
    'detected unusual activity',
  ];
  const bodyCount = countMatches(html, bodySignals);
  // Require at least 2 body signals to avoid flagging a blog post mentioning one
  if (bodyCount >= 2) {
    score += Math.min((bodyCount - 1) * 0.15, 0.4);
  } else if (bodyCount === 1 && title.length === 0) {
    // Single body signal + no title = weak signal only
    score += 0.05;
  }

  // Very short response with an error status
  if (html.length < 1000 && (statusCode === 403 || statusCode === 503 || statusCode === 429)) {
    score += 0.25;
    // Tiny pages (< 500 chars) with a block status are almost certainly block pages
    if (html.length < 500) {
      score += 0.15;
    }
  }

  // Meta refresh to a captcha/challenge URL — this ONLY happens on challenge interstitials;
  // real content pages never redirect to a captcha URL via meta-refresh.
  if (/meta[^>]*refresh/i.test(html) && /captcha|challenge/i.test(html)) {
    score += 0.75;
  }

  // Page is almost entirely a form with nothing else (login-wall-adjacent)
  // We want to avoid flagging actual login pages here, so only trigger if
  // combined with other signals.
  if (score > 0.2) {
    const formOnly =
      html.length < 3000 &&
      (html.match(/<form/gi) || []).length > 0 &&
      estimateVisibleTextLength(html) < 150;
    if (formOnly) {
      score += 0.15;
    }
  }

  // HTTP 429 on its own is a strong rate-limit signal
  if (statusCode === 429) {
    score += 0.25;
  }

  // A page that is mostly/entirely an iframe to a captcha service
  // (short HTML + iframe with captcha in src/title)
  if (
    html.length < 2000 &&
    /iframe[^>]*captcha/i.test(html) &&
    (statusCode === 403 || statusCode === 503 || statusCode === 429)
  ) {
    score += 0.5;
  }

  return Math.min(score, 1);
}

/**
 * Detect SPA shells — large HTML but almost no visible text.
 * These happen when a JS-rendered site returns an app shell without executing JS.
 */
function detectEmptyShell(html: string, _statusCode?: number): number {
  // Must be a substantial HTML payload (otherwise it's just a small page)
  if (html.length < 2000) return 0;

  const visibleLen = estimateVisibleTextLength(html);

  // Less than 200 chars of visible text in a large HTML doc = shell
  if (visibleLen >= 200) return 0;

  let score = 0.65; // base confidence for a shell

  // Known SPA root elements that are empty
  const shellPatterns = [
    '<div id="root"></div>',
    '<div id="root"> </div>',
    '<div id="app"></div>',
    '<div id="app"> </div>',
    '<div id="__next"></div>',
    '<div id="__next"> </div>',
    '<div id="gatsby-focus-wrapper"></div>',
    '<div id="___gatsby"></div>',
    'id="root"',    // weaker — just presence of root
    'id="__next"',  // Next.js
  ];
  const shellCount = countMatches(html, shellPatterns);
  if (shellCount > 0) {
    score += Math.min(shellCount * 0.1, 0.2);
  }

  // Many script tags in a tiny-text page = SPA shell
  const scriptTagCount = (html.match(/<script/gi) || []).length;
  if (scriptTagCount >= 3) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

/* ---------- false-positive guards --------------------------------------- */

/**
 * Returns true if the HTML looks like legitimate content that just happens
 * to mention security/captcha terms (e.g. a blog post ABOUT CAPTCHAs).
 */
function looksLikeRealContent(html: string): boolean {
  const visible = estimateVisibleTextLength(html);

  // If there's a lot of visible text, it's almost certainly real content
  if (visible > 1500) return true;

  // If visible text is 600+ chars and it's not a tiny page, likely real
  if (visible > 600 && html.length > 5000) return true;

  return false;
}

/**
 * Returns true if this looks like a normal 404 page (not a block page).
 * 404s are sometimes mistaken for blocks when they have short content.
 */
function looksLike404(html: string, statusCode?: number): boolean {
  if (statusCode !== 404) return false;
  const title = extractTitle(html);
  return (
    title.includes('not found') ||
    title.includes('404') ||
    title.includes('page not found') ||
    title.includes('error 404')
  );
}

/* ---------- main export -------------------------------------------------- */

/**
 * Detect whether an HTML response is a bot-challenge or block page.
 *
 * @param html       - Raw HTML response body.
 * @param statusCode - HTTP status code (optional but improves accuracy).
 */
export function detectChallenge(
  html: string,
  statusCode?: number,
): ChallengeDetectionResult {
  const THRESHOLD = 0.7;

  // Sanity — empty input
  if (!html || html.length === 0) {
    return { isChallenge: false, confidence: 0 };
  }

  // Quick exit: if there's clearly lots of real content, don't bother scoring
  // (still allow empty-shell detection to run since that has LOTS of html but no text)
  const realContent = looksLikeRealContent(html);
  const is404 = looksLike404(html, statusCode);
  if (is404) {
    return { isChallenge: false, confidence: 0, details: '404 page' };
  }

  // Normalize to lowercase for case-insensitive matching
  // We keep a lowercase copy for patterns that don't need case sensitivity
  const htmlLower = html.toLowerCase();

  // Run each vendor detector
  const scores: Array<{ type: ChallengeType; score: number }> = [
    { type: 'cloudflare', score: detectCloudflare(html, statusCode) },
    { type: 'perimeterx', score: detectPerimeterX(html, statusCode) },
    { type: 'akamai', score: detectAkamai(html, statusCode) },
    { type: 'datadome', score: detectDataDome(htmlLower, statusCode) },
    { type: 'incapsula', score: detectIncapsula(htmlLower, statusCode) },
    { type: 'generic-block', score: detectGenericBlock(htmlLower, statusCode) },
    { type: 'empty-shell', score: detectEmptyShell(html, statusCode) },
  ];

  // Find highest scoring detector
  let best = scores[0]!;
  for (const entry of scores) {
    if (entry.score > best.score) best = entry;
  }

  // If real content guard fired, suppress non-empty-shell challenges
  // (a blog post about Cloudflare can mention cf patterns in quoted code blocks)
  if (realContent && best.type !== 'empty-shell') {
    return {
      isChallenge: false,
      confidence: best.score * 0.4,
      details: 'Suppressed: page has substantial real content',
    };
  }

  if (best.score < THRESHOLD) {
    return { isChallenge: false, confidence: best.score };
  }

  return {
    isChallenge: true,
    type: best.type,
    confidence: best.score,
    details: `Detected as ${best.type} (confidence ${best.score.toFixed(2)})`,
  };
}
