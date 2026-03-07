/**
 * Webhook delivery with HMAC-SHA256 signing
 * // AUTH: Not a route handler — this is an outbound utility function (HMAC-signed payloads)
 *
 * Sends webhook notifications for job events with retry logic
 */

import { createHmac } from 'crypto';
import type { WebhookConfig, WebhookDeliveryResult } from '../job-queue.js';
import { createLogger } from '../logger.js';

const log = createLogger('webhook');

/** Maximum payload size before truncation (1MB) */
const MAX_PAYLOAD_BYTES = 1_000_000;

interface WebhookPayload {
  event: string;
  timestamp: string;
  data: any;
}

/**
 * Validate webhook URL — must be HTTPS, not localhost, not private IPs.
 * Throws an error if the URL is invalid.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Webhook URL must use HTTPS (got ${parsed.protocol})`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and loopback
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    throw new Error(`Webhook URL must not target localhost or loopback addresses`);
  }

  // Block private IP ranges
  const privateRanges = [
    /^10\./,                            // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./,       // 172.16.0.0/12
    /^192\.168\./,                      // 192.168.0.0/16
    /^169\.254\./,                      // 169.254.0.0/16 (link-local)
    /^fc[0-9a-f]{2}:/i,                 // IPv6 unique local
    /^fe[89ab][0-9a-f]:/i,              // IPv6 link-local
  ];

  if (privateRanges.some(re => re.test(hostname))) {
    throw new Error(`Webhook URL must not target private IP ranges`);
  }
}

/**
 * Normalize webhook input — accept either a URL string or a WebhookConfig object.
 * When a string URL is passed, defaults to subscribing to all events.
 */
export function normalizeWebhook(
  webhook: string | WebhookConfig,
  defaultEvents: WebhookConfig['events'] = ['started', 'page', 'completed', 'failed']
): WebhookConfig {
  if (typeof webhook === 'string') {
    return {
      url: webhook,
      events: defaultEvents,
    };
  }
  // Ensure events array exists (guard against malformed objects)
  if (!Array.isArray((webhook as any).events)) {
    return { ...webhook, events: defaultEvents };
  }
  return webhook;
}

/**
 * Send a webhook notification
 *
 * @param webhook - Webhook configuration or URL string
 * @param event - Event type (started | page | completed | failed)
 * @param payload - Event payload
 * @returns Delivery result with status, or null if the event was skipped
 */
export async function sendWebhook(
  webhook: string | WebhookConfig,
  event: string,
  payload: any
): Promise<WebhookDeliveryResult | null> {
  const config = normalizeWebhook(webhook);

  // Check if this event should be sent
  if (!config.events.includes(event as any)) {
    return null;
  }

  // Validate URL (HTTPS only, no localhost, no private IPs)
  try {
    validateWebhookUrl(config.url);
  } catch (err: any) {
    log.error(`Webhook URL rejected — ${err.message}`);
    return {
      url: config.url,
      delivered: false,
      error: err.message,
    };
  }

  const webhookPayload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: {
      ...payload,
      ...config.metadata,
    },
  };

  let body = JSON.stringify(webhookPayload);

  // Size limit: if payload > 1MB, truncate data and include a note
  if (Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) {
    const summary: WebhookPayload = {
      event,
      timestamp: webhookPayload.timestamp,
      data: {
        ...config.metadata,
        _truncated: true,
        _reason: 'Payload exceeded 1MB limit. Use the job ID to fetch full results via the API.',
        jobId: payload.jobId,
        total: payload.total,
        completed: payload.completed,
        failed: payload.failed,
      },
    };
    body = JSON.stringify(summary);
    log.warn(`Webhook payload truncated (>1MB) for event "${event}" to ${config.url}`);
  }

  // Generate HMAC-SHA256 signature if secret is provided
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'WebPeel-Webhook/1.0',
  };

  if (config.secret) {
    const signature = createHmac('sha256', config.secret)
      .update(body)
      .digest('hex');
    headers['X-WebPeel-Signature'] = signature;
  }

  // Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
  const maxRetries = 3;
  let lastError: Error | null = null;
  const startTime = Date.now();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (response.ok) {
        const elapsed = Date.now() - startTime;
        log.info(`Webhook delivered to ${config.url} — status ${response.status} — ${elapsed}ms`);
        return {
          url: config.url,
          delivered: true,
          deliveredAt: new Date().toISOString(),
          statusCode: response.status,
        };
      }

      // Non-2xx response — record for retry
      lastError = new Error(`Webhook returned ${response.status}`);
    } catch (error) {
      lastError = error as Error;
    }

    // Exponential backoff before next retry: 1s, 2s, 4s
    if (attempt < maxRetries - 1) {
      const delayMs = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries exhausted
  log.error(`Webhook delivery failed to ${config.url} after ${maxRetries} attempts — ${lastError?.message}`);
  return {
    url: config.url,
    delivered: false,
    error: lastError?.message,
  };
}
