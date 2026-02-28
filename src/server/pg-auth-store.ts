/**
 * PostgreSQL-backed auth store for production deployments
 * Uses SHA-256 hashing for API keys and tracks WEEKLY usage with burst limits
 */

import pg from 'pg';
import crypto from 'crypto';
import { AuthStore, ApiKeyInfo } from './auth-store.js';

const { Pool } = pg;

export interface WeeklyUsageInfo {
  week: string;
  basicCount: number;
  stealthCount: number;
  captchaCount: number;
  searchCount: number;
  totalUsed: number;
  weeklyLimit: number;
  rolloverCredits: number;
  totalAvailable: number;
  remaining: number;
  percentUsed: number;
  resetsAt: string; // ISO timestamp of next Monday 00:00 UTC
}

export interface BurstInfo {
  hourBucket: string;
  count: number;
  limit: number;
  remaining: number;
  resetsIn: string; // human readable
}

export interface ExtraUsageInfo {
  enabled: boolean;
  balance: number;
  spent: number;
  spendingLimit: number;
  autoReload: boolean;
  percentUsed: number;
  resetsAt: string; // 1st of next month
}

// Extra usage cost constants
const EXTRA_USAGE_RATES = {
  basic: 0.002,    // $0.002 per basic fetch
  stealth: 0.01,   // $0.01 per stealth fetch
  captcha: 0.02,   // $0.02 per CAPTCHA solve
  search: 0.001,   // $0.001 per search
};

/**
 * PostgreSQL auth store for production
 */
export class PostgresAuthStore implements AuthStore {
  private pool: pg.Pool;

  constructor(connectionString?: string) {
    const dbUrl = connectionString || process.env.DATABASE_URL;
    
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is required for PostgresAuthStore');
    }

    this.pool = new Pool({
      connectionString: dbUrl,
      // TLS: enabled when DATABASE_URL contains sslmode=require.
      // Secure by default (rejectUnauthorized: true); set PG_REJECT_UNAUTHORIZED=false
      // only for managed DBs (Render/Neon/Supabase) that use self-signed certs.
      ssl: process.env.DATABASE_URL?.includes('sslmode=require')
        ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
        : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Hash API key with SHA-256
   * SECURITY: Never store raw API keys
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Get current ISO week in YYYY-WXX format (e.g., "2026-W07")
   */
  private getCurrentWeek(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const weekNum = Math.ceil(((now.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
  }

  /**
   * Get previous ISO week in YYYY-WXX format
   */
  private getPreviousWeek(): string {
    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const year = lastWeek.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const weekNum = Math.ceil(((lastWeek.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
  }

  /**
   * Get next Monday 00:00 UTC (week reset time)
   */
  private getWeekResetTime(): Date {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const nextMonday = new Date(now);
    nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
    nextMonday.setUTCHours(0, 0, 0, 0);
    return nextMonday;
  }

  /**
   * Get current hour bucket in YYYY-MM-DDTHH format (UTC)
   */
  private getCurrentHour(): string {
    const now = new Date();
    return now.toISOString().substring(0, 13); // "2026-02-12T20"
  }

  /**
   * Get human-readable time until next hour
   */
  private getTimeUntilNextHour(): string {
    const now = new Date();
    const minutesRemaining = 59 - now.getUTCMinutes();
    if (minutesRemaining === 0) {
      return '< 1 min';
    }
    return `${minutesRemaining} min`;
  }

  /**
   * Validate API key and return user info
   * SECURITY: Uses SHA-256 hash comparison, updates last_used_at
   */
  async validateKey(key: string): Promise<ApiKeyInfo | null> {
    if (!key || typeof key !== 'string') {
      return null;
    }

    const keyHash = this.hashKey(key);
    
    try {
      const result = await this.pool.query(
        `SELECT 
          ak.id,
          ak.user_id,
          ak.key_prefix,
          ak.name,
          u.tier,
          u.rate_limit,
          u.weekly_limit,
          u.burst_limit,
          u.email
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = $1 AND ak.is_active = true
          AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
        [keyHash]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Update last_used_at (fire and forget, don't wait)
      this.pool.query(
        'UPDATE api_keys SET last_used_at = now() WHERE id = $1',
        [row.id]
      ).catch(err => console.error('Failed to update last_used_at:', err));

      return {
        key,
        tier: row.tier,
        rateLimit: row.rate_limit,
        accountId: row.user_id,
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('Failed to validate API key:', error);
      return null;
    }
  }

  /**
   * Check if a key exists but is expired (used to return specific 401 error)
   */
  async isKeyExpired(key: string): Promise<boolean> {
    if (!key || typeof key !== 'string') return false;
    const keyHash = this.hashKey(key);
    try {
      const result = await this.pool.query(
        `SELECT 1 FROM api_keys WHERE key_hash = $1 AND is_active = true AND expires_at IS NOT NULL AND expires_at <= NOW()`,
        [keyHash]
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Track weekly usage for an API key
   * SECURITY: Uses UPSERT to prevent race conditions
   */
  async trackUsage(
    key: string,
    fetchType: 'basic' | 'stealth' | 'captcha' | 'search'
  ): Promise<void> {
    const keyHash = this.hashKey(key);
    const week = this.getCurrentWeek();

    try {
      // Get API key ID and user ID
      const keyResult = await this.pool.query(
        'SELECT id, user_id FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );

      if (keyResult.rows.length === 0) {
        return;
      }

      const { id: apiKeyId, user_id: userId } = keyResult.rows[0];

      // Determine which counter to increment
      const columnMap = {
        basic: 'basic_count',
        stealth: 'stealth_count',
        captcha: 'captcha_count',
        search: 'search_count',
      };

      const column = columnMap[fetchType];

      // UPSERT usage record (total_count is GENERATED, don't touch it)
      await this.pool.query(
        `INSERT INTO weekly_usage (user_id, api_key_id, week, ${column})
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (api_key_id, week)
        DO UPDATE SET 
          ${column} = weekly_usage.${column} + 1,
          updated_at = now()`,
        [userId, apiKeyId, week]
      );
    } catch (error) {
      console.error('Failed to track usage:', error);
      throw error;
    }
  }

  /**
   * Track burst usage (hourly limit)
   */
  async trackBurstUsage(key: string): Promise<void> {
    const keyHash = this.hashKey(key);
    const hourBucket = this.getCurrentHour();

    try {
      const keyResult = await this.pool.query(
        'SELECT id FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );

      if (keyResult.rows.length === 0) {
        return;
      }

      const apiKeyId = keyResult.rows[0].id;

      // UPSERT burst usage
      await this.pool.query(
        `INSERT INTO burst_usage (api_key_id, hour_bucket, count)
        VALUES ($1, $2, 1)
        ON CONFLICT (api_key_id, hour_bucket)
        DO UPDATE SET 
          count = burst_usage.count + 1,
          updated_at = now()`,
        [apiKeyId, hourBucket]
      );
    } catch (error) {
      console.error('Failed to track burst usage:', error);
      throw error;
    }
  }

  /**
   * Check burst limit (hourly)
   */
  async checkBurstLimit(key: string): Promise<{ allowed: boolean; burst: BurstInfo }> {
    const keyHash = this.hashKey(key);
    const hourBucket = this.getCurrentHour();

    try {
      const result = await this.pool.query(
        `SELECT 
          u.burst_limit,
          COALESCE(bu.count, 0) as count
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        LEFT JOIN burst_usage bu ON bu.api_key_id = ak.id AND bu.hour_bucket = $2
        WHERE ak.key_hash = $1`,
        [keyHash, hourBucket]
      );

      if (result.rows.length === 0) {
        return {
          allowed: false,
          burst: {
            hourBucket,
            count: 0,
            limit: 0,
            remaining: 0,
            resetsIn: this.getTimeUntilNextHour(),
          },
        };
      }

      const row = result.rows[0];
      const allowed = row.count < row.burst_limit;

      return {
        allowed,
        burst: {
          hourBucket,
          count: row.count,
          limit: row.burst_limit,
          remaining: Math.max(0, row.burst_limit - row.count),
          resetsIn: this.getTimeUntilNextHour(),
        },
      };
    } catch (error) {
      console.error('Failed to check burst limit:', error);
      return {
        allowed: false,
        burst: {
          hourBucket,
          count: 0,
          limit: 0,
          remaining: 0,
          resetsIn: this.getTimeUntilNextHour(),
        },
      };
    }
  }

  /**
   * Get weekly usage info for an API key with rollover calculation
   */
  async getUsage(key: string): Promise<WeeklyUsageInfo | null> {
    const keyHash = this.hashKey(key);
    const currentWeek = this.getCurrentWeek();
    const previousWeek = this.getPreviousWeek();

    try {
      const result = await this.pool.query(
        `SELECT 
          u.weekly_limit,
          COALESCE(curr.basic_count, 0) as basic_count,
          COALESCE(curr.stealth_count, 0) as stealth_count,
          COALESCE(curr.captcha_count, 0) as captcha_count,
          COALESCE(curr.search_count, 0) as search_count,
          COALESCE(curr.total_count, 0) as current_used,
          COALESCE(prev.total_count, 0) as prev_used,
          COALESCE(curr.rollover_credits, 0) as rollover_credits
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        LEFT JOIN weekly_usage curr ON curr.api_key_id = ak.id AND curr.week = $2
        LEFT JOIN weekly_usage prev ON prev.api_key_id = ak.id AND prev.week = $3
        WHERE ak.key_hash = $1`,
        [keyHash, currentWeek, previousWeek]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const weeklyLimit = row.weekly_limit;
      const currentUsed = row.current_used;
      const prevUsed = row.prev_used;
      const rolloverCredits = row.rollover_credits;

      // Calculate rollover: MIN(unused_last_week, weekly_limit)
      const prevUnused = Math.max(0, weeklyLimit - prevUsed);
      const calculatedRollover = Math.min(prevUnused, weeklyLimit);

      // Update rollover if it's the first access this week
      if (rolloverCredits === 0 && calculatedRollover > 0) {
        await this.pool.query(
          `INSERT INTO weekly_usage (user_id, api_key_id, week, rollover_credits, updated_at)
          SELECT user_id, id, $2, $3, now()
          FROM api_keys WHERE key_hash = $1
          ON CONFLICT (api_key_id, week)
          DO UPDATE SET rollover_credits = $3`,
          [keyHash, currentWeek, calculatedRollover]
        );
      }

      const effectiveRollover = rolloverCredits > 0 ? rolloverCredits : calculatedRollover;
      const totalAvailable = weeklyLimit + effectiveRollover;
      const remaining = Math.max(0, totalAvailable - currentUsed);
      const percentUsed = totalAvailable > 0 ? Math.round((currentUsed / totalAvailable) * 100) : 0;

      return {
        week: currentWeek,
        basicCount: row.basic_count,
        stealthCount: row.stealth_count,
        captchaCount: row.captcha_count,
        searchCount: row.search_count,
        totalUsed: currentUsed,
        weeklyLimit,
        rolloverCredits: effectiveRollover,
        totalAvailable,
        remaining,
        percentUsed,
        resetsAt: this.getWeekResetTime().toISOString(),
      };
    } catch (error) {
      console.error('Failed to get usage:', error);
      return null;
    }
  }

  /**
   * Check if API key has exceeded weekly limit
   */
  async checkLimit(key: string): Promise<{ allowed: boolean; usage?: WeeklyUsageInfo }> {
    const usage = await this.getUsage(key);
    
    if (!usage) {
      return { allowed: false };
    }

    const allowed = usage.remaining > 0;
    
    return { allowed, usage };
  }

  /**
   * Get extra usage info for a user
   */
  async getExtraUsageInfo(key: string): Promise<ExtraUsageInfo | null> {
    const keyHash = this.hashKey(key);

    try {
      const result = await this.pool.query(
        `SELECT 
          u.extra_usage_enabled,
          u.extra_usage_balance,
          u.extra_usage_spent,
          u.extra_usage_spending_limit,
          u.auto_reload_enabled,
          u.extra_usage_period_start
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = $1`,
        [keyHash]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      
      // Calculate next month reset (1st of next month, 00:00 UTC)
      const now = new Date();
      const nextMonth = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
        1,
        0, 0, 0, 0
      ));

      const percentUsed = row.extra_usage_spending_limit > 0
        ? Math.round((parseFloat(row.extra_usage_spent) / parseFloat(row.extra_usage_spending_limit)) * 100)
        : 0;

      return {
        enabled: row.extra_usage_enabled,
        balance: parseFloat(row.extra_usage_balance),
        spent: parseFloat(row.extra_usage_spent),
        spendingLimit: parseFloat(row.extra_usage_spending_limit),
        autoReload: row.auto_reload_enabled,
        percentUsed,
        resetsAt: nextMonth.toISOString(),
      };
    } catch (error) {
      console.error('Failed to get extra usage info:', error);
      return null;
    }
  }

  /**
   * Check if extra usage can be used
   */
  async canUseExtraUsage(key: string): Promise<boolean> {
    const info = await this.getExtraUsageInfo(key);
    
    if (!info || !info.enabled) {
      return false;
    }

    // Check if under spending limit and has balance
    return info.balance > 0 && info.spent < info.spendingLimit;
  }

  /**
   * Track extra usage and deduct from balance
   */
  async trackExtraUsage(
    key: string,
    fetchType: 'basic' | 'stealth' | 'captcha' | 'search',
    url?: string,
    processingTimeMs?: number,
    statusCode?: number
  ): Promise<{ success: boolean; cost: number; newBalance: number }> {
    const keyHash = this.hashKey(key);
    const cost = EXTRA_USAGE_RATES[fetchType];

    try {
      // Get API key and user info
      const keyResult = await this.pool.query(
        `SELECT 
          ak.id as api_key_id,
          ak.user_id,
          u.extra_usage_balance,
          u.extra_usage_spent
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = $1`,
        [keyHash]
      );

      if (keyResult.rows.length === 0) {
        return { success: false, cost: 0, newBalance: 0 };
      }

      const { api_key_id, user_id, extra_usage_balance } = keyResult.rows[0];
      const currentBalance = parseFloat(extra_usage_balance);

      if (currentBalance < cost) {
        return { success: false, cost, newBalance: currentBalance };
      }

      // Start transaction
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Deduct from balance and add to spent
        const updateResult = await client.query(
          `UPDATE users 
          SET 
            extra_usage_balance = extra_usage_balance - $1,
            extra_usage_spent = extra_usage_spent + $1,
            updated_at = now()
          WHERE id = $2
          RETURNING extra_usage_balance`,
          [cost, user_id]
        );

        const newBalance = parseFloat(updateResult.rows[0].extra_usage_balance);

        // Log to extra_usage_logs
        await client.query(
          `INSERT INTO extra_usage_logs 
            (user_id, api_key_id, fetch_type, url, cost, processing_time_ms, status_code)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user_id, api_key_id, fetchType, url, cost, processingTimeMs, statusCode]
        );

        await client.query('COMMIT');

        return { success: true, cost, newBalance };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Failed to track extra usage:', error);
      return { success: false, cost, newBalance: 0 };
    }
  }

  /**
   * Generate a cryptographically secure API key
   * Format: wp_live_ + 32 random hex chars (total 40 chars)
   */
  static generateApiKey(): string {
    const randomBytes = crypto.randomBytes(16).toString('hex');
    return `wp_live_${randomBytes}`;
  }

  /**
   * Get key prefix (first 12 characters for display)
   */
  static getKeyPrefix(key: string): string {
    return key.substring(0, 12);
  }

  /**
   * Close the database pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
