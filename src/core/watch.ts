/**
 * WebPeel Watch - Lightweight URL monitoring with assertions
 *
 * Polls a URL on a configurable interval, evaluates assertions against the
 * response, detects content changes, and optionally fires a webhook on failure.
 */

import { createHash, createHmac } from 'crypto';
import { fetch as undiciFetch } from 'undici';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface WatchOptions {
  url: string;
  /** Polling interval in milliseconds */
  intervalMs: number;
  /** Assertions to evaluate on every check */
  assertions?: Assertion[];
  /** POST this URL when an assertion fails or content changes */
  webhookUrl?: string;
  /** HMAC-SHA256 secret for signing webhook deliveries (header: X-WebPeel-Signature). */
  webhookSecret?: string;
  /** Per-request timeout in milliseconds (default: 10 000) */
  timeout?: number;
  /** Stop after this many checks (default: unlimited) */
  maxChecks?: number;
  /** Use browser rendering instead of simple HTTP fetch */
  render?: boolean;
  /** Output each result as NDJSON to stdout */
  json?: boolean;
  /** Suppress output unless a failure or change is detected */
  silent?: boolean;
  /** Optional callback invoked after every check */
  onCheck?: (result: WatchCheckResult) => void;
}

export interface Assertion {
  /** Field to evaluate: "status" (HTTP status), "body", "header.<name>",
   *  or a dot-notation path into the JSON response body (e.g. "data.health") */
  field: string;
  operator: '=' | '!=' | '<' | '>' | 'contains';
  value: string;
}

export interface WatchCheckResult {
  timestamp: string;
  url: string;
  /** HTTP status code (0 on network error, 408 on timeout) */
  status: number;
  /** Request round-trip time in milliseconds */
  elapsed: number;
  /** Per-assertion evaluation results */
  assertions: AssertionResult[];
  /** true when every assertion passed (or there are no assertions) */
  allPassed: boolean;
  /** true when the response body changed since the previous check */
  changed: boolean;
  /** Present only on network/fetch errors */
  error?: string;
}

export interface AssertionResult {
  field: string;
  expected: string;
  actual: string;
  passed: boolean;
}

// ─── Duration parsing ──────────────────────────────────────────────────────────

/**
 * Parse a human-readable duration string into milliseconds.
 *
 * @example
 * parseDuration("30s")  // → 30 000
 * parseDuration("5m")   // → 300 000
 * parseDuration("1h")   // → 3 600 000
 * parseDuration("500ms")// → 500
 */
export function parseDuration(duration: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(duration.trim());
  if (!match) {
    throw new Error(
      `Invalid duration: "${duration}". Use formats like 30s, 5m, 1h, 500ms.`,
    );
  }
  const value = parseFloat(match[1]);
  const unit = match[2] ?? 'ms';
  switch (unit) {
    case 'ms': return Math.round(value);
    case 's':  return Math.round(value * 1_000);
    case 'm':  return Math.round(value * 60_000);
    case 'h':  return Math.round(value * 3_600_000);
    default:   return Math.round(value);
  }
}

// ─── Assertion parsing ─────────────────────────────────────────────────────────

/**
 * Parse an assertion expression into an {@link Assertion} object.
 *
 * Supported formats:
 *   field=value        — equality
 *   field!=value       — inequality
 *   field>value        — greater-than (numeric)
 *   field<value        — less-than (numeric)
 *   field contains str — substring match
 *
 * @example
 * parseAssertion("status=200")            // HTTP status
 * parseAssertion("body.status=healthy")   // JSON field
 * parseAssertion("version!=0.0.0")
 */
export function parseAssertion(expr: string): Assertion {
  // Order matters: try longer operators before shorter ones.
  const match = /^(.+?)(!=|contains|=|>|<)(.*)$/s.exec(expr.trim());
  if (!match) {
    throw new Error(
      `Invalid assertion: "${expr}". ` +
      `Examples: status=200, body.status=healthy, version!=0.0.0`,
    );
  }
  const [, field, operator, value] = match;
  return {
    field: field.trim(),
    operator: operator as Assertion['operator'],
    value: value.trim(),
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Retrieve a nested value from an object using dot-notation path.
 *
 * @example
 * getNestedValue({ data: { status: "ok" } }, "data.status") // → "ok"
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce((curr: unknown, key: string) => {
    if (curr === null || curr === undefined) return undefined;
    if (typeof curr !== 'object') return undefined;
    return (curr as Record<string, unknown>)[key];
  }, obj);
}

/**
 * Evaluate a single assertion against the fetched response data.
 */
function evaluateAssertion(
  assertion: Assertion,
  httpStatus: number,
  jsonBody: unknown | null,
  rawBody: string,
  headers: Record<string, string>,
): AssertionResult {
  const { field, operator, value: expected } = assertion;

  let actual: unknown;

  if (field === 'httpStatus' || field === 'http_status') {
    // Explicit HTTP status check — always returns the HTTP code.
    actual = httpStatus;
  } else if (field === 'status') {
    // Smart: prefer JSON body's "status" field when present, fall back to HTTP.
    if (jsonBody !== null && typeof jsonBody === 'object' && !Array.isArray(jsonBody) &&
        'status' in (jsonBody as Record<string, unknown>)) {
      actual = (jsonBody as Record<string, unknown>).status;
    } else {
      actual = httpStatus;
    }
  } else if (field === 'body') {
    actual = rawBody;
  } else if (/^headers?\./.test(field)) {
    const headerName = field.replace(/^headers?\./, '').toLowerCase();
    actual = headers[headerName] ?? '';
  } else if (jsonBody !== null) {
    // Dot-notation lookup in JSON body.
    actual = getNestedValue(jsonBody, field);
  } else {
    // Fallback: treat raw body as the value.
    actual = rawBody;
  }

  const actualStr = actual === undefined ? '' : String(actual);

  let passed: boolean;
  switch (operator) {
    case '=':        passed = actualStr === expected;                        break;
    case '!=':       passed = actualStr !== expected;                        break;
    case '>':        passed = parseFloat(actualStr) > parseFloat(expected);  break;
    case '<':        passed = parseFloat(actualStr) < parseFloat(expected);  break;
    case 'contains': passed = actualStr.includes(expected);                  break;
    default:         passed = false;
  }

  return { field, expected, actual: actualStr, passed };
}

/** Fingerprint a string for change detection. */
function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ─── Single check ──────────────────────────────────────────────────────────────

interface InternalCheckResult {
  result: WatchCheckResult;
  /** Fingerprint of the raw response body (used by the loop to detect changes). */
  contentFingerprint: string;
}

async function performCheck(
  url: string,
  options: {
    assertions: Assertion[];
    timeout: number;
    render: boolean;
  },
  previousFingerprint: string | null,
): Promise<InternalCheckResult> {
  const timestamp = new Date().toISOString();
  const startTime = Date.now();

  try {
    let httpStatus = 200;
    let rawBody = '';
    let jsonBody: unknown = null;
    let headers: Record<string, string> = {};

    if (options.render) {
      // Use peel() for browser-rendered pages.
      const { peel } = await import('../index.js');
      const peelResult = await peel(url, {
        render: true,
        timeout: options.timeout,
        format: 'markdown',
      });
      rawBody = peelResult.content;
      // peel() throws on non-2xx, so success → 200.
      httpStatus = 200;
      // Try to parse the content as JSON.
      try { jsonBody = JSON.parse(rawBody); } catch { /* not JSON */ }
    } else {
      // Direct HTTP fetch for accurate status codes and minimal overhead.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout);

      try {
        const response = await undiciFetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'WebPeel-Watch/1.0 (+https://github.com/webpeel/webpeel)',
            'Accept': 'application/json, text/html, */*',
          },
        });

        httpStatus = response.status;
        rawBody = await response.text();

        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });

        // Try JSON parsing based on Content-Type, then fall back to heuristic.
        const ct = response.headers.get('content-type') ?? '';
        if (ct.includes('json') || rawBody.trimStart().startsWith('{') || rawBody.trimStart().startsWith('[')) {
          try { jsonBody = JSON.parse(rawBody); } catch { /* malformed JSON */ }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const elapsed = Date.now() - startTime;
    const fp = fingerprint(rawBody);
    const changed = previousFingerprint !== null && fp !== previousFingerprint;

    const assertionResults = options.assertions.map(a =>
      evaluateAssertion(a, httpStatus, jsonBody, rawBody, headers),
    );
    const allPassed = assertionResults.every(ar => ar.passed);

    return {
      result: {
        timestamp, url, status: httpStatus, elapsed,
        assertions: assertionResults, allPassed, changed,
      },
      contentFingerprint: fp,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    const isTimeout = errMsg.toLowerCase().includes('abort') ||
                      errMsg.toLowerCase().includes('timeout');

    const assertionResults = options.assertions.map(a => ({
      field: a.field, expected: a.value, actual: '', passed: false,
    }));

    return {
      result: {
        timestamp, url,
        status: isTimeout ? 408 : 0,
        elapsed,
        assertions: assertionResults,
        allPassed: false,
        changed: false,
        error: errMsg,
      },
      contentFingerprint: '',
    };
  }
}

// ─── Webhook ───────────────────────────────────────────────────────────────────

/**
 * Sign a webhook payload body with HMAC-SHA256.
 *
 * @param body    - The raw JSON string that will be sent as the request body.
 * @param secret  - The signing secret shared between WebPeel and the recipient.
 * @returns       - Hex digest of the HMAC-SHA256 signature.
 *
 * Recipients verify delivery authenticity like this:
 *   const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
 *   if (receivedSignature !== `sha256=${expected}`) reject(); // tampered or wrong secret
 */
function signWebhookBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

async function sendWebhook(
  webhookUrl: string,
  payload: unknown,
  webhookSecret?: string,
): Promise<void> {
  try {
    const bodyStr = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'WebPeel-Watch/1.0',
    };

    // Sign the payload when a secret is available (per-watch secret or global fallback).
    const secret = webhookSecret || process.env.WEBHOOK_SIGNING_SECRET;
    if (secret) {
      headers['X-WebPeel-Signature'] = `sha256=${signWebhookBody(bodyStr, secret)}`;
      headers['X-WebPeel-Timestamp'] = String(Date.now());
    }

    await undiciFetch(webhookUrl, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // Webhook failures are non-fatal; log to stderr.
    process.stderr.write(
      `[watch] Webhook delivery failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// ─── Human-readable formatting ────────────────────────────────────────────────

function formatResult(result: WatchCheckResult): string {
  const time = result.timestamp.slice(11, 19); // HH:MM:SS
  const icon = result.allPassed && !result.error ? '✓' : '✗';

  let statusPart: string;
  if (result.error) {
    statusPart = `ERROR (${result.elapsed}ms): ${result.error.slice(0, 100)}`;
  } else {
    statusPart = `${result.status} (${result.elapsed}ms)`;
  }

  const parts: string[] = [`[${time}] ${icon} ${result.url} — ${statusPart}`];

  if (result.changed) parts.push('content changed');

  if (result.assertions.length > 0) {
    const failures = result.assertions.filter(a => !a.passed);
    if (failures.length === 0) {
      parts.push('all assertions passed');
    } else {
      parts.push(
        failures.map(f => `FAILED: ${f.field}=${f.expected} → actual: "${f.actual}"`).join(', '),
      );
    }
  }

  return parts.join(' — ');
}

// ─── Main watch loop ───────────────────────────────────────────────────────────

/**
 * Monitor a URL on a recurring interval.
 *
 * Resolves when {@link WatchOptions.maxChecks} is reached (or never, until the
 * process receives SIGINT/SIGTERM).
 *
 * @example
 * ```typescript
 * await watch({
 *   url: 'https://api.example.com/health',
 *   intervalMs: 60_000,
 *   assertions: [{ field: 'status', operator: '=', value: 'healthy' }],
 *   webhookUrl: 'https://hooks.example.com/alert',
 * });
 * ```
 */
export async function watch(options: WatchOptions): Promise<void> {
  const {
    url,
    intervalMs,
    assertions = [],
    webhookUrl,
    webhookSecret,
    timeout = 10_000,
    maxChecks,
    render = false,
    json = false,
    silent = false,
    onCheck,
  } = options;

  let checksCompleted = 0;
  let previousFp: string | null = null;
  let running = true;

  // Graceful shutdown on Ctrl+C / SIGTERM.
  const handleSignal = () => {
    running = false;
    if (!json && !silent) {
      process.stderr.write('\n[watch] Stopped.\n');
    }
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    while (running) {
      if (maxChecks !== undefined && checksCompleted >= maxChecks) break;

      const { result, contentFingerprint } = await performCheck(
        url,
        { assertions, timeout, render },
        previousFp,
      );

      // Update fingerprint for next iteration (empty string on error → keep previous).
      if (contentFingerprint) previousFp = contentFingerprint;

      checksCompleted++;

      // Invoke caller callback.
      if (onCheck) onCheck(result);

      // Emit output.
      const isBad = !result.allPassed || result.changed || !!result.error;
      if (json) {
        process.stdout.write(JSON.stringify(result) + '\n');
      } else if (!silent || isBad) {
        process.stderr.write(formatResult(result) + '\n');
      }

      // Fire webhook on failure or change.
      if (webhookUrl && isBad) {
        const failures = result.assertions.filter(a => !a.passed);
        const payload = {
          event: failures.length > 0 ? 'assertion_failed' : 'content_changed',
          url,
          timestamp: result.timestamp,
          ...(failures.length > 0 && {
            failures: failures.map(f => ({
              field: f.field,
              expected: f.expected,
              actual: f.actual,
            })),
          }),
          check: result,
        };
        await sendWebhook(webhookUrl, payload, webhookSecret);
      }

      // Check stop condition again after callback/webhook (they may take time).
      if (maxChecks !== undefined && checksCompleted >= maxChecks) break;
      if (!running) break;

      // Sleep until next interval, checking for shutdown every 100 ms.
      await new Promise<void>(resolve => {
        let elapsed = 0;
        const tick = setInterval(() => {
          elapsed += 100;
          if (!running || elapsed >= intervalMs) {
            clearInterval(tick);
            resolve();
          }
        }, 100);
      });
    }
  } finally {
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
  }
}
