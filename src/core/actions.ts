/**
 * Page actions executor for browser automation
 *
 * This is WebPeel's "Actions API" — click/scroll/type/wait before extracting.
 *
 * Timeouts:
 * - Default per action: 5s
 * - Max total across all actions: 30s
 */

import type { Page } from 'playwright';
import type { PageAction } from '../types.js';
import { TimeoutError, WebPeelError } from '../types.js';

export const DEFAULT_ACTION_TIMEOUT_MS = 5_000;
export const MAX_TOTAL_ACTIONS_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new TimeoutError(message);
  }

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new TimeoutError(message)), ms)),
  ]);
}

/**
 * Normalize a raw actions array to WebPeel's internal PageAction shape.
 * Accepts Firecrawl-style fields (milliseconds, text, direction/amount).
 */
export function normalizeActions(input?: unknown): PageAction[] | undefined {
  if (!input) return undefined;
  if (!Array.isArray(input)) throw new WebPeelError('Invalid actions: must be an array');

  return input.map((raw: any) => {
    if (!raw || typeof raw !== 'object') throw new WebPeelError('Invalid action: must be an object');
    if (typeof raw.type !== 'string') throw new WebPeelError('Invalid action: missing type');

    const type = raw.type as PageAction['type'];

    // Common aliases
    const selector = typeof raw.selector === 'string' ? raw.selector : undefined;
    const timeout = typeof raw.timeout === 'number' ? raw.timeout : undefined;

    switch (type) {
      case 'wait': {
        const ms = typeof raw.milliseconds === 'number'
          ? raw.milliseconds
          : typeof raw.ms === 'number'
            ? raw.ms
            : typeof raw.value === 'number'
              ? raw.value
              : undefined;

        return {
          type: 'wait',
          ms: ms ?? 1000,
          timeout,
        };
      }

      case 'click':
        return { type: 'click', selector, timeout };

      case 'type':
      case 'fill': {
        const value = typeof raw.value === 'string' ? raw.value
          : typeof raw.text === 'string' ? raw.text
            : undefined;
        return { type, selector, value, timeout };
      }

      case 'select': {
        const value = typeof raw.value === 'string' ? raw.value : undefined;
        return { type: 'select', selector, value, timeout };
      }

      case 'press': {
        const key = typeof raw.key === 'string' ? raw.key : (typeof raw.value === 'string' ? raw.value : undefined);
        return { type: 'press', key, timeout };
      }

      case 'hover':
        return { type: 'hover', selector, timeout };

      case 'waitForSelector':
        return { type: 'waitForSelector', selector, timeout };

      case 'scroll': {
        const direction = typeof raw.direction === 'string' ? raw.direction : undefined;
        const amount = typeof raw.amount === 'number' ? raw.amount : undefined;

        // Legacy/internal: to can be top|bottom|number
        const to = raw.to === 'top' || raw.to === 'bottom' || typeof raw.to === 'number'
          ? raw.to
          : undefined;

        return {
          type: 'scroll',
          direction: (direction === 'up' || direction === 'down' || direction === 'left' || direction === 'right') ? direction : undefined,
          amount,
          to,
          timeout,
        };
      }

      case 'screenshot':
        return { type: 'screenshot', timeout };

      default:
        // Allow forward compatibility — but still pass through known fields.
        return { ...raw } as PageAction;
    }
  });
}

export async function executeActions(
  page: Page,
  actions: PageAction[],
  screenshotOptions?: { fullPage?: boolean; type?: 'png' | 'jpeg'; quality?: number }
): Promise<Buffer | undefined> {
  let lastScreenshot: Buffer | undefined;

  const screenshotType = screenshotOptions?.type || 'png';
  const screenshotFullPage = screenshotOptions?.fullPage ?? true;
  const screenshotQuality = screenshotOptions?.quality;

  const start = Date.now();
  const deadline = start + MAX_TOTAL_ACTIONS_MS;

  // Normalize once to handle Firecrawl-style aliases even if caller didn't.
  const normalized = normalizeActions(actions) ?? [];

  for (let i = 0; i < normalized.length; i++) {
    const action = normalized[i]!;

    const remainingTotal = deadline - Date.now();
    if (remainingTotal <= 0) {
      throw new TimeoutError(`Actions timed out after ${MAX_TOTAL_ACTIONS_MS}ms`);
    }

    const perActionTimeout = Math.min(
      typeof action.timeout === 'number' && action.timeout > 0 ? action.timeout : DEFAULT_ACTION_TIMEOUT_MS,
      remainingTotal
    );

    const label = `Action ${i + 1}/${normalized.length} (${action.type})`;

    switch (action.type) {
      case 'wait': {
        const ms = (typeof action.ms === 'number' ? action.ms : undefined)
          ?? (typeof (action as any).milliseconds === 'number' ? (action as any).milliseconds : undefined)
          ?? 1000;

        const waitMs = Math.min(Math.max(ms, 0), remainingTotal);
        await withTimeout(page.waitForTimeout(waitMs), waitMs + 50, `${label} timed out`);
        break;
      }

      case 'click': {
        if (!action.selector) throw new WebPeelError('click action requires selector');
        await withTimeout(
          page.click(action.selector, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'scroll': {
        const dir = action.direction;
        const amount = typeof action.amount === 'number' ? action.amount : undefined;

        const scrollPromise = (async () => {
          // Relative scroll (Firecrawl-style)
          if (dir && amount !== undefined) {
            const a = Math.max(0, amount);
            let dx = 0;
            let dy = 0;
            if (dir === 'down') dy = a;
            if (dir === 'up') dy = -a;
            if (dir === 'right') dx = a;
            if (dir === 'left') dx = -a;
            await page.evaluate(`window.scrollBy(${dx}, ${dy})`);
            return;
          }

          // Legacy absolute scroll target
          if (action.to === 'bottom') {
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            return;
          }
          if (action.to === 'top') {
            await page.evaluate('window.scrollTo(0, 0)');
            return;
          }
          if (typeof action.to === 'number') {
            await page.evaluate(`window.scrollTo(0, ${action.to})`);
            return;
          }

          // Default: scroll to bottom
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        })();

        await withTimeout(scrollPromise, perActionTimeout + 50, `${label} timed out`);
        break;
      }

      case 'type': {
        if (!action.selector) throw new WebPeelError('type action requires selector');
        const value = action.value ?? (action as any).text;
        if (!value) throw new WebPeelError('type action requires text');
        await withTimeout(
          page.type(action.selector, value, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'fill': {
        if (!action.selector) throw new WebPeelError('fill action requires selector');
        const value = action.value ?? (action as any).text;
        if (!value) throw new WebPeelError('fill action requires value');
        await withTimeout(
          page.fill(action.selector, value, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'select': {
        if (!action.selector) throw new WebPeelError('select action requires selector');
        if (!action.value) throw new WebPeelError('select action requires value');
        await withTimeout(
          page.selectOption(action.selector, action.value, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'press': {
        const key = action.key;
        if (!key) throw new WebPeelError('press action requires key');
        await withTimeout(
          page.keyboard.press(key),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'hover': {
        if (!action.selector) throw new WebPeelError('hover action requires selector');
        await withTimeout(
          page.hover(action.selector, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'waitForSelector': {
        if (!action.selector) throw new WebPeelError('waitForSelector action requires selector');
        await withTimeout(
          page.waitForSelector(action.selector, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'screenshot': {
        lastScreenshot = await withTimeout(
          page.screenshot({
            fullPage: screenshotFullPage,
            type: screenshotType,
            ...(screenshotType === 'jpeg' && typeof screenshotQuality === 'number'
              ? { quality: screenshotQuality }
              : {}),
          }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      default: {
        // This should not happen due to our type union, but keep a safe fallback.
        throw new WebPeelError(`Unknown action type: ${(action as any).type}`);
      }
    }

    // Small yield to avoid starving the event loop in tight action sequences
    await sleep(0);
  }

  return lastScreenshot;
}
