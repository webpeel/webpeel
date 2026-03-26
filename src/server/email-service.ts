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
import { Resend } from 'resend';
import type { Pool as PgPool } from 'pg';

// ── Resend (primary — sends from noreply@webpeel.dev) ─────────────────────
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

// ── Nodemailer (fallback — Gmail SMTP) ────────────────────────────────────
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

/**
 * Send an email via Resend (primary) or Nodemailer (fallback).
 * Returns true if sent successfully.
 */
async function sendEmail(options: { to: string; subject: string; html: string }): Promise<boolean> {
  const fromAddress = process.env.EMAIL_FROM || 'noreply@webpeel.dev';
  const fromName = 'WebPeel';

  // Try Resend first (proper From address, no Gmail override)
  const resend = getResend();
  if (resend) {
    try {
      await resend.emails.send({
        from: `${fromName} <${fromAddress}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      console.log(`[email] Sent via Resend to: ${options.to}`);
      return true;
    } catch (err) {
      console.warn('[email] Resend failed, trying Nodemailer fallback:', (err as Error).message);
    }
  }

  // Fallback to Nodemailer/SMTP
  const transport = createTransport();
  if (transport) {
    try {
      const smtpFrom = process.env.EMAIL_SMTP_USER || fromAddress;
      await transport.sendMail({
        from: `${fromName} <${smtpFrom}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      console.log(`[email] Sent via SMTP to: ${options.to}`);
      return true;
    } catch (err) {
      console.error('[email] SMTP send failed:', (err as Error).message);
    }
  }

  console.warn('[email] No email provider configured (set RESEND_API_KEY or EMAIL_SMTP_*)');
  return false;
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
  const html = buildUsageAlertHtml(params);
  return sendEmail({
    to: params.toEmail,
    subject: `WebPeel: You've used ${params.usagePercent}% of your weekly API limit`,
    html,
  });
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

// ---------------------------------------------------------------------------
// Dual-threshold automatic alert system (80% and 90%)
// ---------------------------------------------------------------------------

/** Week string in "YYYY-Www" format, consistent with pg-auth-store */
function getCurrentWeek(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekNum = Math.ceil(
    ((now.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7
  );
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/** Returns true if the timestamp is within the current ISO week */
function isSentThisWeek(ts: Date | null): boolean {
  if (!ts) return false;
  const now = new Date();
  // Start of current week (Monday 00:00 UTC)
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday));
  return ts >= weekStart;
}

export interface UsageAlertCheckResult {
  /**
   * Which threshold was crossed (80 | 90), or null if no alert to send.
   * Priority: 90 > 80 (only one alert per call).
   */
  threshold: 80 | 90 | null;
  usagePercent: number;
  used: number;
  total: number;
  userEmail: string;
  userName?: string;
  userTier: string;
  /** Custom alert email if set, otherwise falls back to userEmail */
  alertEmail: string;
}

/**
 * Check whether a usage alert should be sent for a given user and,
 * if so, return the alert details plus automatically update the
 * `alert_sent_80_at` / `alert_sent_90_at` column.
 *
 * Thresholds are **automatic** (80% and 90%) and work independently of
 * the user-configured `alert_threshold` system.
 *
 * Call this fire-and-forget style after each successful API request:
 *   ```ts
 *   checkAndSendDualAlert(pool, userId).catch(() => {});
 *   ```
 */
export async function checkAndSendDualAlert(
  pool: PgPool,
  userId: string
): Promise<void> {
  try {
    const currentWeek = getCurrentWeek();

    const result = await pool.query(
      `SELECT u.email, u.name, u.tier, u.alert_email,
              u.alert_sent_80_at, u.alert_sent_90_at,
              u.weekly_limit,
              COALESCE(SUM(wu.total_count), 0) AS total_used,
              u.weekly_limit + COALESCE(MAX(wu.rollover_credits), 0) AS total_available
       FROM users u
       LEFT JOIN api_keys ak ON ak.user_id = u.id
       LEFT JOIN weekly_usage wu ON wu.api_key_id = ak.id AND wu.week = $2
       WHERE u.id = $1
       GROUP BY u.id, u.email, u.name, u.tier, u.alert_email,
                u.alert_sent_80_at, u.alert_sent_90_at, u.weekly_limit`,
      [userId, currentWeek]
    );

    const row = result.rows[0];
    if (!row) return;

    const used = parseInt(row.total_used, 10) || 0;
    const total = parseInt(row.total_available, 10) || row.weekly_limit || 999;
    const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;
    const alertEmail: string = row.alert_email || row.email;

    const sharedParams = {
      toEmail: alertEmail,
      userName: row.name || undefined,
      used,
      total,
      tier: row.tier as string,
    };

    // Check 90% threshold first (higher priority)
    if (usagePercent >= 90 && !isSentThisWeek(row.alert_sent_90_at ? new Date(row.alert_sent_90_at) : null)) {
      const sent = await sendUsageAlertEmail({ ...sharedParams, usagePercent: 90 });
      if (sent) {
        await pool.query(
          'UPDATE users SET alert_sent_90_at = NOW() WHERE id = $1',
          [userId]
        );
        console.log(`[alert] Sent 90% usage alert to ${alertEmail} (user ${userId})`);
      }
      return; // Only one alert per call
    }

    // Check 80% threshold (lower priority — don't send if already sent 90%)
    if (usagePercent >= 80 && !isSentThisWeek(row.alert_sent_80_at ? new Date(row.alert_sent_80_at) : null)) {
      const sent = await sendUsageAlertEmail({ ...sharedParams, usagePercent: 80 });
      if (sent) {
        await pool.query(
          'UPDATE users SET alert_sent_80_at = NOW() WHERE id = $1',
          [userId]
        );
        console.log(`[alert] Sent 80% usage alert to ${alertEmail} (user ${userId})`);
      }
    }
  } catch (err) {
    // Never let alert errors surface to callers
    console.warn('[alert] checkAndSendDualAlert failed:', err);
  }
}

/**
 * Send password reset email with a secure reset link.
 */
export async function sendPasswordResetEmail(toEmail: string, resetUrl: string): Promise<boolean> {
  const result = await sendEmail({
    to: toEmail,
    subject: 'Reset your WebPeel password',
      html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f6f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6f9;padding:40px 0;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">

  <!-- Logo -->
  <tr><td align="center" style="padding:0 0 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#5865F2;border-radius:10px;width:40px;height:40px;text-align:center;vertical-align:middle;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;line-height:40px;">W</span>
      </td>
      <td style="padding-left:12px;">
        <span style="font-size:22px;font-weight:700;color:#1a1a2e;letter-spacing:-0.5px;">WebPeel</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- Card -->
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;border:1px solid #e5e5ea;overflow:hidden;">
      
      <!-- Purple accent bar -->
      <tr><td style="background-color:#5865F2;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
      
      <!-- Content -->
      <tr><td style="padding:40px 36px;">
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1a1a2e;">Reset your password</h1>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#4a4a5a;">Hi there,</p>
        <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#4a4a5a;">
          We received a request to reset your WebPeel account password. Click the button below to choose a new one. This link expires in <strong>1 hour</strong>.
        </p>
        
        <!-- Button -->
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
        <tr><td align="center" style="background-color:#5865F2;border-radius:10px;">
          <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
            Reset Password
          </a>
        </td></tr>
        </table>
        
        <!-- Fallback URL -->
        <p style="margin:0 0 24px;font-size:12px;line-height:1.5;color:#9a9aaa;word-break:break-all;">
          Or copy this link: <a href="${resetUrl}" style="color:#5865F2;">${resetUrl}</a>
        </p>
        
        <hr style="border:none;border-top:1px solid #eeeef2;margin:0 0 20px;">
        <p style="margin:0;font-size:13px;line-height:1.5;color:#9a9aaa;">
          If you didn't request this, no action is needed — your password won't change.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td align="center" style="padding:28px 0 0;">
    <p style="margin:0 0 6px;font-size:12px;color:#9a9aaa;">
      © ${new Date().getFullYear()} WebPeel — The web data platform for AI
    </p>
    <p style="margin:0;font-size:12px;">
      <a href="https://webpeel.dev" style="color:#5865F2;text-decoration:none;">webpeel.dev</a>
      &nbsp;·&nbsp;
      <a href="https://app.webpeel.dev" style="color:#5865F2;text-decoration:none;">Dashboard</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`,
  });
  if (!result) {
    console.warn('[email] Password reset email not sent to:', toEmail);
    console.warn('[email] Reset URL:', resetUrl);
  }
  return result;
}
