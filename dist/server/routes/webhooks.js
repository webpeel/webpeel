/**
 * Webhook delivery with HMAC-SHA256 signing
 *
 * Sends webhook notifications for job events with retry logic
 */
import { createHmac } from 'crypto';
/**
 * Send a webhook notification
 *
 * @param webhook - Webhook configuration
 * @param event - Event type
 * @param payload - Event payload
 */
export async function sendWebhook(webhook, event, payload) {
    // Check if this event should be sent
    if (!webhook.events.includes(event)) {
        return;
    }
    const webhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data: {
            ...payload,
            ...webhook.metadata,
        },
    };
    const body = JSON.stringify(webhookPayload);
    // Generate HMAC signature if secret is provided
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'WebPeel-Webhook/1.0',
    };
    if (webhook.secret) {
        const signature = createHmac('sha256', webhook.secret)
            .update(body)
            .digest('hex');
        headers['X-WebPeel-Signature'] = signature;
    }
    // Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
    const maxRetries = 3;
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(webhook.url, {
                method: 'POST',
                headers,
                body,
                signal: AbortSignal.timeout(10000), // 10s timeout
            });
            if (response.ok) {
                // Success!
                return;
            }
            // Non-2xx response
            lastError = new Error(`Webhook returned ${response.status}`);
        }
        catch (error) {
            lastError = error;
        }
        // Exponential backoff: 1s, 2s, 4s
        if (attempt < maxRetries - 1) {
            const delayMs = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    // All retries failed - log error but don't throw (fire and forget)
    console.error(`Webhook delivery failed after ${maxRetries} attempts:`, {
        url: webhook.url,
        event,
        error: lastError?.message,
    });
}
//# sourceMappingURL=webhooks.js.map