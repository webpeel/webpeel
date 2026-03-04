/**
 * Auto-interact: automatically dismiss cookie banners, consent popups,
 * overlay modals, and optionally click "load more" / "show all" buttons.
 *
 * Runs after page.goto() and before content extraction.
 * Never blocks extraction — each interaction has a tight timeout.
 * Total budget: 3s max.
 */

import type { Page } from 'playwright';

export interface AutoInteractResult {
  cookieBannerDismissed: boolean;
  consentHandled: boolean;
  loadMoreClicked: number;
  overlaysDismissed: number;
}

// ── Selector lists ─────────────────────────────────────────────────────────

const COOKIE_DISMISS_SELECTORS: string[] = [
  // OneTrust (very common consent management platform)
  '#onetrust-accept-btn-handler',
  // Cookiebot
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  // Cookie Consent library
  '.cc-btn.cc-dismiss',
  '.cc-btn.cc-allow',
  // Osano
  '.osano-cm-accept',
  '.osano-cm-accept-all',
  // TrustArc
  '#truste-consent-button',
  // Quantcast
  '#qc-cmp2-ui button[mode="primary"]',
  // Didomi
  '#didomi-notice-agree-button',
  // Testing library markers
  '[data-testid="cookie-policy-dialog-accept-button"]',
  '[data-testid="accept-cookies"]',
  '[data-testid="cookie-accept"]',
  // ARIA labels
  'button[aria-label*="cookie" i]',
  'button[aria-label*="accept cookie" i]',
  'button[aria-label*="agree" i]',
  'button[aria-label*="consent" i]',
  // Class-based matchers (broad)
  '[class*="cookie"] button[class*="accept"]',
  '[class*="cookie"] button[class*="dismiss"]',
  '[class*="cookie"] button[class*="close"]',
  '[class*="cookie"] button[class*="agree"]',
  '[class*="cookie"] button[class*="allow"]',
  '[class*="consent"] button[class*="accept"]',
  '[class*="consent"] button[class*="agree"]',
  '[class*="consent"] button[class*="allow"]',
  '[id*="cookie"] button[class*="accept"]',
  '[id*="cookie"] button[class*="agree"]',
  '.cookie-banner button:first-of-type',
  '.cookie-notice button:first-of-type',
  '#cookie-notice button:first-of-type',
];

const CONSENT_SELECTORS: string[] = [
  // GDPR / privacy
  '[class*="gdpr"] button[class*="accept"]',
  '[class*="gdpr"] button[class*="agree"]',
  '[class*="privacy"] button[class*="accept"]',
  '[class*="privacy"] button[class*="agree"]',
  // Modal/overlay consent
  '.modal-overlay [class*="accept"]',
  '[role="dialog"] button[class*="accept"]',
  '[role="dialog"] button[class*="agree"]',
  '[role="alertdialog"] button[class*="accept"]',
  // Age gates and terms
  '[class*="age-gate"] button[class*="confirm"]',
  '[class*="terms"] button[class*="accept"]',
];

const OVERLAY_DISMISS_SELECTORS: string[] = [
  // Generic close buttons
  '.modal-close',
  '.overlay-close',
  '[class*="modal"] [class*="close"]',
  '[class*="modal"] button[aria-label="Close"]',
  '[role="dialog"] [aria-label="Close"]',
  '[role="dialog"] [aria-label="close"]',
  '[role="dialog"] button[class*="close"]',
  '[class*="popup"] [class*="close"]',
  '[class*="popup"] button[aria-label="Close"]',
  'button[class*="dismiss"]',
  // Newsletter/email capture popups
  '[class*="newsletter"] [class*="close"]',
  '[class*="subscribe"] [class*="close"]',
  '[class*="signup"] [class*="close"]',
  // Survey/feedback popups
  '[class*="survey"] [class*="close"]',
  '[class*="feedback"] [class*="close"]',
  // Notification/alert banners
  '[class*="notification"] button[class*="close"]',
  '[class*="alert"] button[class*="close"]',
  '[class*="banner"] button[class*="close"]',
];

const LOAD_MORE_SELECTORS: string[] = [
  'button[class*="load-more"]',
  'button[class*="loadmore"]',
  'button[class*="load_more"]',
  '[class*="load-more"] button',
  'a[class*="load-more"]',
  'button[class*="show-more"]',
  'button[class*="show_more"]',
  'button[class*="showmore"]',
  '[class*="show-more"] button',
  'button[aria-label*="load more" i]',
  'button[aria-label*="show more" i]',
  '[data-testid*="load-more"]',
  '[data-testid*="show-more"]',
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if an element is visible (has dimensions + not hidden).
 * Returns false if the element doesn't exist or is invisible.
 */
async function isVisible(page: Page, selector: string): Promise<boolean> {
  try {
    const visible = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(el as HTMLElement);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    }, selector);
    return !!visible;
  } catch {
    return false;
  }
}

/**
 * Try to click a selector with a 1s timeout. Returns true if clicked.
 */
async function tryClick(page: Page, selector: string): Promise<boolean> {
  const CLICK_TIMEOUT_MS = 1000;
  try {
    const visible = await isVisible(page, selector);
    if (!visible) return false;

    await Promise.race([
      page.click(selector, { timeout: CLICK_TIMEOUT_MS }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('click timeout')), CLICK_TIMEOUT_MS)
      ),
    ]);

    // Brief pause to let DOM settle after click
    await page.waitForTimeout(300).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Try each selector in the list; click the first visible one.
 * Returns the selector that was clicked, or null.
 */
async function tryClickFirst(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const clicked = await tryClick(page, selector);
    if (clicked) {
      if (process.env.DEBUG) {
        console.debug('[webpeel:auto-interact]', 'clicked:', selector);
      }
      return selector;
    }
  }
  return null;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Automatically interact with the page to dismiss common UI overlays before
 * content extraction.  Never throws — all errors are swallowed.
 *
 * @param page - Playwright page (already navigated)
 * @returns Summary of what was dismissed
 */
export async function autoInteract(page: Page): Promise<AutoInteractResult> {
  const TOTAL_BUDGET_MS = 3000;
  const startTime = Date.now();

  const result: AutoInteractResult = {
    cookieBannerDismissed: false,
    consentHandled: false,
    loadMoreClicked: 0,
    overlaysDismissed: 0,
  };

  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startTime);

  try {
    // ── 1. Cookie banners ─────────────────────────────────────────────────
    if (remaining() > 0) {
      const clicked = await tryClickFirst(page, COOKIE_DISMISS_SELECTORS);
      if (clicked) {
        result.cookieBannerDismissed = true;
        if (process.env.DEBUG) console.debug('[webpeel:auto-interact]', 'cookie banner dismissed');
      }
    }

    // ── 2. Consent popups ────────────────────────────────────────────────
    if (remaining() > 500) {
      const clicked = await tryClickFirst(page, CONSENT_SELECTORS);
      if (clicked) {
        result.consentHandled = true;
        if (process.env.DEBUG) console.debug('[webpeel:auto-interact]', 'consent handled');
      }
    }

    // ── 3. Overlay/modal dismiss ──────────────────────────────────────────
    if (remaining() > 500) {
      let dismissed = 0;
      // Try up to 2 overlays to avoid infinite loops on persistent UI
      for (let i = 0; i < 2 && remaining() > 300; i++) {
        const clicked = await tryClickFirst(page, OVERLAY_DISMISS_SELECTORS);
        if (!clicked) break;
        dismissed++;
      }
      result.overlaysDismissed = dismissed;
      if (dismissed > 0 && process.env.DEBUG) {
        console.debug('[webpeel:auto-interact]', `overlays dismissed: ${dismissed}`);
      }
    }

    // ── 4. Load more (optional, only if budget remains) ───────────────────
    if (remaining() > 500) {
      let clicked = 0;
      // Click at most 1 "load more" button to get more content without infinite looping
      const loadMoreClicked = await tryClickFirst(page, LOAD_MORE_SELECTORS);
      if (loadMoreClicked) {
        clicked++;
        // Wait briefly for new content to render
        await page.waitForTimeout(500).catch(() => {});
      }
      result.loadMoreClicked = clicked;
      if (clicked > 0 && process.env.DEBUG) {
        console.debug('[webpeel:auto-interact]', `load-more clicked: ${clicked}`);
      }
    }
  } catch (err) {
    // Never block extraction due to auto-interact errors
    if (process.env.DEBUG) {
      console.debug('[webpeel:auto-interact]', 'error (ignored):', err instanceof Error ? err.message : err);
    }
  }

  const elapsed = Date.now() - startTime;
  if (process.env.DEBUG) {
    console.debug('[webpeel:auto-interact]', 'complete in', elapsed, 'ms', JSON.stringify(result));
  }

  return result;
}
