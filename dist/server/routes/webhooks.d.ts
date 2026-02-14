/**
 * Webhook delivery with HMAC-SHA256 signing
 *
 * Sends webhook notifications for job events with retry logic
 */
import type { WebhookConfig } from '../job-queue.js';
/**
 * Send a webhook notification
 *
 * @param webhook - Webhook configuration
 * @param event - Event type
 * @param payload - Event payload
 */
export declare function sendWebhook(webhook: WebhookConfig, event: string, payload: any): Promise<void>;
//# sourceMappingURL=webhooks.d.ts.map