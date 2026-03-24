/**
 * Authentication wall detection.
 *
 * Analyzes raw HTML (and optional HTTP status code) to determine whether the
 * response is a login/auth wall rather than real content.
 *
 * Design goals:
 *  - Fast: pure string/regex matching, no DOM parsing required
 *  - Low false-positive rate: uses confidence scoring, only flags at >= 0.5
 *  - Ignores ACTUAL login pages (user navigated there intentionally)
 *  - No external dependencies
 */

/* ---------- public types ------------------------------------------------- */

export type AuthWallType =
  | 'login-form'
  | 'oauth-redirect'
  | 'paywall'
  | 'signup-required'
  | 'generic';

export interface AuthDetectionResult {
  isAuthWall: boolean;
  /** Confidence score 0-1 */
  confidence: number;
  /** What kind of auth is needed */
  type?: AuthWallType;
  /** Human-readable detail */
  details?: string;
}

/* ---------- helpers ------------------------------------------------------ */

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

/**
 * Returns true when the URL path itself IS a login/auth page.
 * In that case the user navigated there intentionally — don't flag as auth wall.
 */
function urlIsAuthPage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const p = pathname.toLowerCase();
    // Match paths like /login, /signin, /sign-in, /auth, /authenticate,
    // /signup, /sign-up, /register, /registration, /account/login, etc.
    return /\/(login|log-in|signin|sign-in|auth|authenticate|signup|sign-up|register|registration)(\/|$|\?|#)/.test(p)
      || p === '/login'
      || p === '/signin'
      || p === '/sign-in'
      || p === '/auth'
      || p === '/authenticate'
      || p === '/signup'
      || p === '/sign-up'
      || p === '/register'
      || p === '/registration';
  } catch {
    return false;
  }
}

/* ---------- signal detectors --------------------------------------------- */

/** HIGH confidence: Login form with password field and sparse content. */
function scoreLoginForm(html: string, _htmlLower: string): number {
  const hasPasswordInput = /<input[^>]*type\s*=\s*["']password["'][^>]*>/i.test(html);
  if (!hasPasswordInput) return 0;

  const hasForm = /<form[^>]*>/i.test(html);
  if (!hasForm) return 0;

  // High confidence: form + password + sparse content
  const visibleLen = estimateVisibleTextLength(html);
  if (visibleLen < 300) {
    return 0.40; // Very sparse — strong signal
  } else if (visibleLen < 800) {
    return 0.25; // Somewhat sparse
  }

  // Password form on a content page with reasonable text — weak signal
  return 0.10;
}

/** HIGH confidence: HTTP 401/403 with auth-related HTML. */
function scoreStatusCode(_html: string, htmlLower: string, statusCode?: number): number {
  if (statusCode !== 401 && statusCode !== 403) return 0;

  const authKeywords = [
    'log in', 'login', 'sign in', 'signin', 'authenticate',
    'unauthorized', 'forbidden', 'access denied',
    'please log', 'please sign',
  ];
  const matches = countMatches(htmlLower, authKeywords);

  if (statusCode === 401) {
    // 401 Unauthorized almost always means auth required
    return matches > 0 ? 0.45 : 0.35;
  }
  // 403 with auth keywords
  return matches >= 2 ? 0.30 : matches === 1 ? 0.15 : 0;
}

/** MEDIUM confidence: Title contains auth-related terms. */
function scoreTitleSignals(html: string): number {
  const title = extractTitle(html);
  const authTitles = [
    'log in', 'login', 'sign in', 'signin', 'sign up', 'signup',
    'register', 'authenticate', 'authentication',
    'create account', 'create an account',
    'access denied', 'unauthorized',
  ];
  for (const t of authTitles) {
    if (title.includes(t)) return 0.20;
  }
  return 0;
}

/** MEDIUM confidence: Auth-related CSS classes in the page. */
function scoreCssClasses(html: string): number {
  const authClasses = [
    'login-wall', 'auth-wall', 'signin-gate', 'login-gate',
    'access-gate', 'content-gate', 'paywall', 'sign-in-gate',
    'registration-wall', 'auth-gate', 'login-modal', 'signin-modal',
    'auth-modal', 'auth-overlay', 'login-overlay',
  ];
  const matches = countMatches(html.toLowerCase(), authClasses);
  if (matches >= 2) return 0.25;
  if (matches === 1) return 0.20;
  return 0;
}

/** MEDIUM confidence: OAuth/social login buttons present. */
function scoreOAuthButtons(htmlLower: string): number {
  const oauthSignals = [
    'sign in with google',
    'login with google',
    'continue with google',
    'sign in with github',
    'login with github',
    'sign in with facebook',
    'login with facebook',
    'sign in with apple',
    'continue with apple',
    'sign in with twitter',
    'sign in with microsoft',
    '/auth/google',
    '/auth/github',
    '/auth/facebook',
    '/oauth/google',
    '/oauth/github',
  ];
  const matches = countMatches(htmlLower, oauthSignals);
  if (matches >= 3) return 0.25;
  if (matches >= 2) return 0.20;
  if (matches === 1) return 0.15;
  return 0;
}

/** MEDIUM confidence: Short page with password form. */
function scoreShortPageWithForm(html: string): number {
  if (html.length >= 5000) return 0;

  const hasPasswordInput = /<input[^>]*type\s*=\s*["']password["'][^>]*>/i.test(html);
  const hasForm = /<form[^>]*>/i.test(html);
  const hasSubmit = /<button[^>]*>|<input[^>]*type\s*=\s*["']submit["'][^>]*>/i.test(html);

  if (hasPasswordInput && hasForm && hasSubmit) return 0.20;
  return 0;
}

/** MEDIUM confidence: window.location redirect to auth URL in inline script. */
function scoreJsRedirect(html: string): number {
  if (!/<script/i.test(html)) return 0;

  const redirectPatterns = [
    /window\.location\s*[=.]\s*["'][^"']*\/(login|signin|auth|signup|register)/i,
    /location\.href\s*=\s*["'][^"']*\/(login|signin|auth|signup|register)/i,
    /location\.replace\s*\(\s*["'][^"']*\/(login|signin|auth|signup|register)/i,
  ];

  for (const pattern of redirectPatterns) {
    if (pattern.test(html)) return 0.20;
  }
  return 0;
}

/** MEDIUM confidence: Meta tags or OG contain auth-related text. */
function scoreMetaTags(html: string): number {
  const metaRegex = /<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    const content = match[1]!.toLowerCase();
    if (
      content.includes('log in') ||
      content.includes('sign in') ||
      content.includes('login') ||
      content.includes('signin') ||
      content.includes('authenticate')
    ) {
      return 0.15;
    }
  }
  return 0;
}

/** LOW confidence: Text phrases suggesting auth is required. */
function scoreAuthPhrases(htmlLower: string): number {
  const phrases = [
    'sign in to continue',
    'log in to continue',
    'login to continue',
    'sign in to view',
    'log in to view',
    'please sign in',
    'please log in',
    'please login',
    'create an account to',
    'create account to',
    'you must be logged in',
    'you need to log in',
    'you need to sign in',
    'members only',
    'subscribers only',
    'login required',
    'sign in required',
    'authentication required',
  ];

  const matches = countMatches(htmlLower, phrases);
  if (matches >= 3) return 0.15;
  if (matches >= 2) return 0.12;
  if (matches === 1) return 0.08;
  return 0;
}

/** LOW confidence: noscript tag mentions authentication. */
function scoreNoscriptAuth(html: string): number {
  const noscriptMatch = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi);
  if (!noscriptMatch) return 0;

  const noscriptText = noscriptMatch.join(' ').toLowerCase();
  if (
    noscriptText.includes('login') ||
    noscriptText.includes('sign in') ||
    noscriptText.includes('authenticate')
  ) {
    return 0.08;
  }
  return 0;
}

/** LOW confidence: Social login buttons but very little other content. */
function scoreSocialLoginSparse(htmlLower: string, html: string): number {
  const socialButtons = [
    'google', 'github', 'facebook', 'apple', 'microsoft', 'twitter',
  ];
  const socialCount = countMatches(htmlLower, socialButtons);
  if (socialCount < 2) return 0;

  const visibleLen = estimateVisibleTextLength(html);
  if (visibleLen < 200) return 0.10;
  return 0;
}

/** Detect the most likely auth wall type. */
function detectType(
  scores: { loginForm: number; oauth: number; cssClasses: number; authPhrases: number; status: number }
): AuthWallType {
  if (scores.status > 0.25) return 'generic';
  if (scores.loginForm >= 0.25) return 'login-form';
  if (scores.oauth >= 0.20) return 'oauth-redirect';
  if (scores.cssClasses > 0 && (scores.cssClasses >= 0.25 || (scores.cssClasses >= 0.20 && scores.authPhrases > 0))) {
    return 'generic';
  }
  if (scores.authPhrases >= 0.12) return 'signup-required';
  return 'generic';
}

/* ---------- main export -------------------------------------------------- */

/**
 * Detect whether an HTML response is an authentication/login wall.
 *
 * Returns `isAuthWall: true` only when confidence >= 0.5.
 *
 * **Important:** If the URL itself is a login/auth path (e.g. `/login`),
 * returns `{ isAuthWall: false }` — the user navigated there intentionally.
 *
 * @param html       - Raw HTML response body.
 * @param url        - Final URL (after redirects).
 * @param statusCode - HTTP status code (optional but improves accuracy).
 */
export function detectAuthWall(html: string, url: string, statusCode?: number): AuthDetectionResult {
  const THRESHOLD = 0.5;

  // Sanity — empty input
  if (!html || html.length === 0) {
    return { isAuthWall: false, confidence: 0 };
  }

  // If the URL itself IS a login/auth page, don't flag — user navigated there intentionally
  if (urlIsAuthPage(url)) {
    return { isAuthWall: false, confidence: 0, details: 'URL is a login/auth page — user navigated there intentionally' };
  }

  // Real content pages (lots of visible text) are almost never auth walls
  const visibleLen = estimateVisibleTextLength(html);
  if (visibleLen > 2000) {
    return { isAuthWall: false, confidence: 0, details: 'Page has substantial real content' };
  }

  const htmlLower = html.toLowerCase();

  // --- Score each signal ---
  const loginFormScore = scoreLoginForm(html, htmlLower);
  const statusScore = scoreStatusCode(html, htmlLower, statusCode);
  const titleScore = scoreTitleSignals(html);
  const cssClassScore = scoreCssClasses(html);
  const oauthScore = scoreOAuthButtons(htmlLower);
  const shortPageScore = scoreShortPageWithForm(html);
  const jsRedirectScore = scoreJsRedirect(html);
  const metaScore = scoreMetaTags(html);
  const phraseScore = scoreAuthPhrases(htmlLower);
  const noscriptScore = scoreNoscriptAuth(html);
  const socialSparseScore = scoreSocialLoginSparse(htmlLower, html);

  const totalScore =
    loginFormScore +
    statusScore +
    titleScore +
    cssClassScore +
    oauthScore +
    shortPageScore +
    jsRedirectScore +
    metaScore +
    phraseScore +
    noscriptScore +
    socialSparseScore;

  // Cap at 1.0
  const confidence = Math.min(1.0, totalScore);

  if (confidence < THRESHOLD) {
    return { isAuthWall: false, confidence };
  }

  const type = detectType({
    loginForm: loginFormScore,
    oauth: oauthScore,
    cssClasses: cssClassScore,
    authPhrases: phraseScore,
    status: statusScore,
  });

  // Build a human-readable detail string
  const signals: string[] = [];
  if (loginFormScore > 0) signals.push(`login form (${loginFormScore.toFixed(2)})`);
  if (statusScore > 0) signals.push(`HTTP ${statusCode} (${statusScore.toFixed(2)})`);
  if (titleScore > 0) signals.push(`auth title (${titleScore.toFixed(2)})`);
  if (cssClassScore > 0) signals.push(`auth CSS class (${cssClassScore.toFixed(2)})`);
  if (oauthScore > 0) signals.push(`OAuth buttons (${oauthScore.toFixed(2)})`);
  if (phraseScore > 0) signals.push(`auth phrases (${phraseScore.toFixed(2)})`);

  return {
    isAuthWall: true,
    confidence,
    type,
    details: `Auth wall detected (${type}): ${signals.join(', ')} → confidence ${confidence.toFixed(2)}`,
  };
}
