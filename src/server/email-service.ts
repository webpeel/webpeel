/**
 * Email service for WebPeel usage alerts
 * Uses Resend for transactional email delivery
 */

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface UsageAlertEmailParams {
  toEmail: string;
  userName?: string;
  usagePercent: number;
  used: number;
  total: number;
  tier: string;
}

/**
 * Send a usage alert email via Resend.
 * Returns true on success, false if not configured or on error.
 * Never throws — graceful degradation when RESEND_API_KEY is not set.
 */
export async function sendUsageAlertEmail(params: UsageAlertEmailParams): Promise<boolean> {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set, skipping email alert');
    return false;
  }

  const html = buildUsageAlertHtml(params);

  try {
    await resend.emails.send({
      from: 'WebPeel <alerts@webpeel.dev>',
      to: [params.toEmail],
      subject: `WebPeel: You've used ${params.usagePercent}% of your monthly API limit`,
      html,
    });
    console.log(`[email] Usage alert sent to ${params.toEmail} (${params.usagePercent}%)`);
    return true;
  } catch (err) {
    console.error('[email] Failed to send usage alert:', err);
    return false;
  }
}

function buildUsageAlertHtml(params: UsageAlertEmailParams): string {
  const { userName, usagePercent, used, total, tier } = params;
  const displayName = userName || 'there';
  const tierLabel = tier === 'pro' ? 'Pro' : tier === 'max' ? 'Max' : 'Free';
  const billingUrl = 'https://app.webpeel.dev/billing';
  const settingsUrl = 'https://app.webpeel.dev/settings';

  // Determine urgency color
  const urgencyColor = usagePercent >= 90 ? '#EF4444' : usagePercent >= 80 ? '#F59E0B' : '#5865F2';
  const urgencyLabel = usagePercent >= 90 ? '🚨 Critical' : usagePercent >= 80 ? '⚠️ Warning' : '📊 Notice';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WebPeel Usage Alert</title>
</head>
<body style="margin:0;padding:0;background-color:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0A0F;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:32px;text-align:center;">
              <div style="display:inline-block;background:#5865F2;border-radius:12px;padding:10px 20px;">
                <span style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:-0.3px;">WebPeel</span>
              </div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#111116;border:1px solid #1F1F2E;border-radius:16px;padding:40px;">

              <!-- Badge -->
              <p style="margin:0 0 20px 0;font-size:13px;font-weight:600;color:${urgencyColor};letter-spacing:0.5px;">${urgencyLabel}</p>

              <!-- Headline -->
              <h1 style="margin:0 0 12px 0;font-size:24px;font-weight:700;color:#FFFFFF;line-height:1.3;">
                Hi ${displayName}, you've used ${usagePercent}% of your limit
              </h1>

              <!-- Sub-headline -->
              <p style="margin:0 0 32px 0;font-size:15px;color:#9CA3AF;line-height:1.6;">
                Your ${tierLabel} plan has reached the usage threshold you set. Here's where you stand:
              </p>

              <!-- Usage bar card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0F;border:1px solid #1F1F2E;border-radius:12px;padding:24px;margin-bottom:32px;">
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                      <tr>
                        <td style="font-size:13px;color:#9CA3AF;">API Requests Used</td>
                        <td align="right" style="font-size:13px;color:#9CA3AF;">${used.toLocaleString()} / ${total.toLocaleString()}</td>
                      </tr>
                    </table>
                    <!-- Progress bar -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                      <tr>
                        <td style="background:#1F1F2E;border-radius:999px;height:8px;overflow:hidden;">
                          <div style="background:${urgencyColor};width:${Math.min(usagePercent, 100)}%;height:8px;border-radius:999px;"></div>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0;font-size:28px;font-weight:700;color:${urgencyColor};">${usagePercent}%</p>
                    <p style="margin:4px 0 0 0;font-size:13px;color:#6B7280;">of your monthly allocation consumed</p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${billingUrl}"
                       style="display:inline-block;background:#5865F2;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:-0.1px;">
                      Upgrade Your Plan →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Secondary info -->
              <p style="margin:0;font-size:13px;color:#6B7280;text-align:center;line-height:1.6;">
                Upgrading gives you more API calls, higher rate limits, and priority support.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0 0;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:12px;color:#4B5563;line-height:1.6;">
                You're receiving this because you enabled usage alerts in WebPeel Settings.
              </p>
              <p style="margin:0;font-size:12px;color:#4B5563;">
                To disable, <a href="${settingsUrl}" style="color:#5865F2;text-decoration:none;">visit Settings</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
