/**
 * Email service using Nodemailer (free, no API key required).
 * Configure via environment variables:
 *   EMAIL_SMTP_HOST - SMTP server (e.g. smtp.gmail.com)
 *   EMAIL_SMTP_PORT - SMTP port (default: 587)
 *   EMAIL_SMTP_USER - SMTP username / email address
 *   EMAIL_SMTP_PASS - SMTP password (Gmail: use App Password)
 *   EMAIL_FROM      - From address (default: EMAIL_SMTP_USER)
 *
 * Gmail setup: https://myaccount.google.com/apppasswords
 * Use "App Password" (not your regular password).
 */

import nodemailer from 'nodemailer';

function createTransport() {
  const host = process.env.EMAIL_SMTP_HOST;
  const user = process.env.EMAIL_SMTP_USER;
  const pass = process.env.EMAIL_SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
    secure: process.env.EMAIL_SMTP_PORT === '465',
    auth: { user, pass },
  });
}

export interface UsageAlertEmailParams {
  toEmail: string;
  userName?: string;
  usagePercent: number;
  used: number;
  total: number;
  tier: string;
}

export async function sendUsageAlertEmail(params: UsageAlertEmailParams): Promise<boolean> {
  const transport = createTransport();
  if (!transport) {
    console.warn('[email] SMTP not configured. Set EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASS to enable email alerts.');
    return false;
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;
  const html = buildUsageAlertHtml(params);

  try {
    await transport.sendMail({
      from: `WebPeel <${from}>`,
      to: params.toEmail,
      subject: `WebPeel: You've used ${params.usagePercent}% of your weekly API limit`,
      html,
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send usage alert:', err);
    return false;
  }
}

function buildUsageAlertHtml(params: UsageAlertEmailParams): string {
  const { usagePercent, used, total, tier, userName } = params;
  const color = usagePercent >= 90 ? '#ef4444' : usagePercent >= 75 ? '#f59e0b' : '#5865F2';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WebPeel Usage Alert</title></head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#111116;border:1px solid #27272a;border-radius:12px;overflow:hidden;">
    <div style="background:${color};padding:4px 24px;"></div>
    <div style="padding:32px 24px;">
      <div style="font-size:24px;font-weight:700;color:#ffffff;margin-bottom:8px;">Usage Alert</div>
      <div style="font-size:15px;color:#a1a1aa;margin-bottom:24px;">
        ${userName ? `Hi ${userName}, you've` : "You've"} used <strong style="color:#ffffff;">${usagePercent}%</strong> of your weekly API limit.
      </div>
      <div style="background:#18181b;border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="font-size:13px;color:#a1a1aa;margin-bottom:8px;">Usage this week</div>
        <div style="height:8px;background:#27272a;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(usagePercent,100)}%;background:${color};border-radius:4px;"></div>
        </div>
        <div style="font-size:13px;color:#a1a1aa;margin-top:8px;">${used} / ${total} requests · ${tier} plan</div>
      </div>
      <a href="https://app.webpeel.dev/billing" style="display:inline-block;background:#5865F2;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Upgrade Plan →</a>
      <div style="font-size:12px;color:#71717a;margin-top:24px;">
        To disable these alerts, visit <a href="https://app.webpeel.dev/settings" style="color:#5865F2;">Settings</a>.
      </div>
    </div>
  </div>
</body>
</html>`;
}
