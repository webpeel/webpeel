/**
 * Tests for src/core/challenge-detection.ts
 *
 * Each test uses realistic HTML that mimics what the protection systems
 * actually return, based on known patterns.
 */

import { describe, it, expect } from 'vitest';
import { detectChallenge } from '../core/challenge-detection.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

// ── Cloudflare ───────────────────────────────────────────────────────────────

describe('challenge-detection — Cloudflare', () => {
  it('detects Cloudflare "Just a moment" page', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Just a moment...</title>
  <meta charset="UTF-8" />
</head>
<body>
  <div id="challenge-running"></div>
  <div id="challenge-form" action="/cdn-cgi/challenge-platform/h/b/flow/ov1/...">
    <input type="hidden" id="cf-spinner" value="..." />
  </div>
  <script>window._cf_chl_opt = { cType: 'interactive', cNounce: '12345' };</script>
</body>
</html>`;
    const result = detectChallenge(html, 503);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('cloudflare');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects Cloudflare Turnstile challenge', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Checking your browser...</title></head>
<body>
  <div class="cf-turnstile" data-sitekey="0x4AAAAAAA..." data-callback="onSuccess"></div>
  <script src="/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/src/..."></script>
  <div class="cf-chl-widget">Please complete the CAPTCHA below.</div>
</body>
</html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('cloudflare');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects Cloudflare Ray ID block page', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Attention Required! | Cloudflare</title></head>
<body>
  <h1>Error</h1>
  <p>Sorry, you have been blocked.</p>
  <p>You are unable to access example.com</p>
  <div class="cf-error-overview">
    <p>Ray ID: <code>8f3a2b1c4d5e6f7a</code></p>
    <p>Cloudflare Ray ID: 8f3a2b1c • 2024-01-01</p>
  </div>
  <script>window.__cf_chl_f_tk = 'abcdef123456';</script>
</body>
</html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('cloudflare');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── PerimeterX ───────────────────────────────────────────────────────────────

describe('challenge-detection — PerimeterX', () => {
  it('detects PerimeterX block page', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Access Denied</title></head>
<body>
  <div id="px-block-page">
    <h1>Access Denied</h1>
    <p>You don't have permission to access this page.</p>
  </div>
  <script>
    window._pxAppId = 'PXabcdef12';
    window._pxUuid = 'abc123-def456';
    (function(w, d, s, l, i) {
      // perimeterx integration
      w[l] = w[l] || [];
    })(window, document, 'script', '_pxhd', 'PXabcdef12');
  </script>
</body>
</html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('perimeterx');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects PerimeterX "Press & Hold" challenge (Zillow-style)', () => {
    const html = makeHtml(
      'Access to this page has been denied',
      `<div>
        <p>Press & Hold to confirm you area human (and not a bot).</p>
        <p>Reference ID c74752d2-0d38-11f1-83bf-f3d585362b78</p>
      </div>`,
    );
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects px-captcha challenge', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Please verify you are human</title></head>
<body>
  <div id="px-captcha">
    <div class="g-recaptcha" data-sitekey="..."></div>
  </div>
  <script>
    window._pxCaptcha = true;
    window._px3 = 'token_here';
    window._pxvid = 'visitor-id-here';
  </script>
</body>
</html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('perimeterx');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── Akamai ───────────────────────────────────────────────────────────────────

describe('challenge-detection — Akamai', () => {
  it('detects Akamai Bot Manager block', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Access Denied</title></head>
<body>
  <h1>Access Denied</h1>
  <p>You don't have permission to access this resource.</p>
  <script src="https://example.akamaized.net/akam/13/bmak.js"></script>
  <script>
    var _bm_sz = "abcdef1234567890";
    var ak_bmsc = "some_akamai_token_here";
  </script>
</body>
</html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('akamai');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── DataDome ─────────────────────────────────────────────────────────────────

describe('challenge-detection — DataDome', () => {
  it('detects DataDome interstitial', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Security Check</title>
  <script src="https://ct.datadome.co/captcha/"></script>
</head>
<body>
  <div id="datadome-captcha">
    <p>Please verify you are human to continue.</p>
  </div>
  <script>
    window.ddjskey = 'DD_KEY_12345abcde';
    var dd_referrer = document.referrer;
    var dd_cookie_test = 'test';
    // datadome integration
  </script>
</body>
</html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('datadome');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects DataDome captcha-delivery.com variant (Etsy-style)', () => {
    const html = `<html lang="en"><head><title>etsy.com</title><style>#cmsg{animation: A 1.5s;}@keyframes A{0%{opacity:0;}99%{opacity:0;}100%{opacity:1;}}</style></head><body style="margin:0"><script data-cfasync="false">var dd={'rt':'c','cid':'AHrlqA','hsh':'D013AA','t':'bv','s':45977,'host':'geo.captcha-delivery.com','cookie':'hGW_WGUTY'}</script><script data-cfasync="false" src="https://ct.captcha-delivery.com/c.js"></script><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=AHrlqA" title="DataDome CAPTCHA" width="100%" height="100%" style="height:100vh;" frameborder="0"></iframe></body></html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    // Could be detected as datadome or generic-block (either is correct)
    expect(['datadome', 'generic-block']).toContain(result.type);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── Incapsula ────────────────────────────────────────────────────────────────

describe('challenge-detection — Incapsula', () => {
  it('detects Incapsula challenge', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Incapsula incident ID</title></head>
<body>
  <p>This site requires JavaScript and Cookies to be enabled.</p>
  <p>Please change your browser settings or upgrade your browser.</p>
  <script src="https://www.imperva.com/protect/incapsula.js?appId=..."></script>
  <script>
    var incapsula_resource = 'blocked';
    // incap_ses_xyz = cookie value
    // visid_incap_123 = visitor id
  </script>
  <noscript>
    <iframe src="https://www.incapsula.com/acl/ident.html?..."></iframe>
  </noscript>
</body>
</html>`;
    const result = detectChallenge(html);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('incapsula');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── Generic blocks ───────────────────────────────────────────────────────────

describe('challenge-detection — Generic blocks', () => {
  it('detects generic "Access Denied" page', () => {
    const html = makeHtml(
      'Access Denied',
      `<h1>403 Forbidden</h1>
       <p>You do not have permission to access this resource.</p>
       <p>Please verify you are human to continue browsing this site.</p>
       <p>Your access has been blocked due to suspicious activity detected.</p>`,
    );
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects generic bot detection page', () => {
    const html = makeHtml(
      'Bot Detected',
      `<h1>Automated access detected</h1>
       <p>We have detected unusual traffic from your computer network.</p>
       <p>Please prove you are human by completing the CAPTCHA below.</p>
       <p>This check prevents automated access to our servers.</p>
       <div class="g-recaptcha" data-sitekey="..."></div>`,
    );
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects short empty block page with 403', () => {
    const html = `<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>Forbidden</h1><p>Access denied.</p></body></html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects meta-refresh to captcha', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="refresh" content="0; url=/challenge/verify?type=captcha" />
  <title>Redirecting...</title>
</head>
<body>
  <p>Please wait while we verify your browser...</p>
  <p>You will be redirected to the challenge page.</p>
</body>
</html>`;
    const result = detectChallenge(html, 302);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects HTTP 429 rate limit response', () => {
    const html = makeHtml(
      'Too Many Requests',
      '<p>Rate limit exceeded. Please slow down your requests.</p>',
    );
    const result = detectChallenge(html, 429);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── Empty shell ───────────────────────────────────────────────────────────────

describe('challenge-detection — Empty shell (SPA)', () => {
  it('detects Next.js empty shell', () => {
    // Realistic Next.js SSG shell: big HTML, tiny visible text
    const scripts = Array(5).fill('<script src="/static/chunks/main.js"></script>').join('\n');
    const styles = Array(3).fill('<link rel="stylesheet" href="/_next/static/css/app.css" />').join('\n');
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${styles}
  <title>My App</title>
</head>
<body>
  <div id="__next"></div>
  ${scripts}
  <script>self.__next_f=self.__next_f||[]</script>
  <script src="/_next/static/chunks/webpack.js" defer></script>
  <script src="/_next/static/chunks/framework.js" defer></script>
  <noscript>You need to enable JavaScript to run this app.</noscript>
</body>
</html>`;
    // Pad to make it large enough
    const padded = html + ' '.repeat(Math.max(0, 2500 - html.length));
    const result = detectChallenge(padded);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('empty-shell');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects React SPA empty shell', () => {
    const scripts = Array(6).fill('<script src="/static/js/main.chunk.js"></script>').join('\n');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/static/css/main.css" />
  <title>React App</title>
</head>
<body>
  <noscript>You need to enable JavaScript to run this app.</noscript>
  <div id="root"></div>
  ${scripts}
  <script>window.__REDUX_STATE__ = {};</script>
</body>
</html>`;
    const padded = html + ' '.repeat(Math.max(0, 2500 - html.length));
    const result = detectChallenge(padded);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('empty-shell');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── False positive prevention ─────────────────────────────────────────────────

describe('challenge-detection — False positive prevention', () => {
  it('does NOT flag real content mentioning captcha', () => {
    const html = makeHtml(
      'How CAPTCHA Works: A Deep Dive',
      `<article>
        <h1>Understanding CAPTCHA: History and How It Works</h1>
        <p>CAPTCHA (Completely Automated Public Turing test to tell Computers and Humans Apart)
           was invented by Luis von Ahn at Carnegie Mellon University in 2000.</p>
        <p>The most common implementation today is Google's reCAPTCHA, which uses image
           recognition challenges to verify users. Cloudflare has its own CAPTCHA called
           Turnstile that is more privacy-preserving.</p>
        <p>Bot detection systems like PerimeterX, DataDome, and Akamai Bot Manager use
           CAPTCHAs as a last resort after other signals have already flagged suspicious
           traffic patterns from automated access tools.</p>
        <p>Modern CAPTCHA systems use JavaScript challenges, mouse movement tracking,
           and behavioral analysis to distinguish human users from bots.</p>
        <p>When you see "Verify you are human", the system is running challenge-response
           tests behind the scenes before showing you the actual content.</p>
        <p>For developers building scrapers or automated testing tools, understanding these
           bot detection techniques helps in building more respectful and compliant tools.</p>
      </article>`,
    );
    const result = detectChallenge(html);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag normal short pages', () => {
    const html = makeHtml(
      'Contact Us',
      `<h1>Contact Us</h1>
       <p>Email us at hello@example.com</p>
       <p>We typically respond within 24 hours.</p>`,
    );
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag login pages', () => {
    const html = makeHtml(
      'Sign In — MyApp',
      `<main>
        <h1>Welcome back</h1>
        <form action="/login" method="post">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" placeholder="you@example.com" />
          <label for="password">Password</label>
          <input type="password" id="password" name="password" />
          <button type="submit">Sign in</button>
        </form>
        <p><a href="/forgot-password">Forgot password?</a></p>
        <p>Don't have an account? <a href="/register">Create one</a></p>
      </main>`,
    );
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag 404 pages', () => {
    const html = makeHtml(
      'Page Not Found — Example',
      `<main>
        <h1>404 — Page Not Found</h1>
        <p>The page you were looking for doesn't exist.</p>
        <a href="/">Go back home</a>
      </main>`,
    );
    const result = detectChallenge(html, 404);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag normal blog content', () => {
    const html = makeHtml(
      '10 Tips for Better Web Security',
      `<article>
        <h1>10 Tips for Better Web Security</h1>
        <p>Web security is a critical concern for all developers. Here are ten practices
           that can help you keep your application safe.</p>
        <h2>1. Use HTTPS everywhere</h2>
        <p>Always serve your content over HTTPS. Modern browsers flag HTTP sites as
           insecure, and search engines penalize them in rankings.</p>
        <h2>2. Implement rate limiting</h2>
        <p>Rate limiting helps prevent brute force attacks and abuse. You can implement
           it at the application level or using a CDN like Cloudflare.</p>
        <h2>3. Validate all inputs</h2>
        <p>Never trust user input. Validate, sanitize, and escape everything that comes
           from the outside world.</p>
        <h2>4. Keep dependencies updated</h2>
        <p>Outdated dependencies are a major source of vulnerabilities. Use tools like
           Dependabot or Snyk to stay on top of updates.</p>
        <p>Following these best practices will dramatically improve your application
           security posture. Remember: security is not a one-time task but an ongoing
           process that requires constant attention and improvement.</p>
      </article>`,
    );
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag API JSON responses', () => {
    // JSON is not HTML — the detector should not fire
    const json = JSON.stringify({
      status: 'ok',
      data: { users: [], total: 0 },
      message: 'Access granted',
    });
    const result = detectChallenge(json, 200);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag normal e-commerce product pages', () => {
    const html = makeHtml(
      'Blue Widget — MyStore',
      `<div class="product-page">
        <h1>Blue Widget</h1>
        <p class="price">$29.99</p>
        <p class="description">
          This high-quality blue widget is perfect for all your widget needs.
          Made from premium materials, it is durable and long-lasting.
          Available in multiple colors and sizes to fit every use case.
        </p>
        <button>Add to Cart</button>
        <div class="reviews">
          <h2>Customer Reviews</h2>
          <div class="review">
            <p>Great product! Works exactly as described.</p>
            <p>— Jane D., Verified Buyer</p>
          </div>
          <div class="review">
            <p>Very happy with my purchase. Fast shipping too!</p>
            <p>— Bob S., Verified Buyer</p>
          </div>
        </div>
      </div>`,
    );
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag a normal error page with short content and 200 status', () => {
    // A short page is not a challenge if there's no other signal
    const html = makeHtml(
      'Oops',
      '<p>Something went wrong. Please try again later.</p>',
    );
    // 200 status, short HTML, no bot signals
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
  });
});
