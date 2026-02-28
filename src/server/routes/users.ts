/**
 * User authentication and API key management routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { PostgresAuthStore } from '../pg-auth-store.js';

const { Pool } = pg;

const BCRYPT_ROUNDS = 12;

/**
 * Per-email rate limiter for login attempts (brute-force protection)
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of loginAttempts.entries()) {
    if (now >= attempt.resetAt) {
      loginAttempts.delete(key);
    }
  }
}, 15 * 60 * 1000);

function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const email = req.body?.email?.toLowerCase();
  if (!email) {
    next();
    return;
  }

  const now = Date.now();
  const attempt = loginAttempts.get(email);

  if (attempt && now < attempt.resetAt) {
    if (attempt.count >= 5) {
      res.status(429).json({
        error: 'too_many_attempts',
        message: 'Too many login attempts. Please try again in 15 minutes.',
        retryAfter: Math.ceil((attempt.resetAt - now) / 1000),
      });
      return;
    }
    attempt.count++;
  } else {
    loginAttempts.set(email, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }
  next();
}

/**
 * Per-IP rate limiter for refresh endpoint (brute-force protection)
 */
const refreshAttempts = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of refreshAttempts.entries()) {
    if (now >= attempt.resetAt) {
      refreshAttempts.delete(key);
    }
  }
}, 15 * 60 * 1000);

function refreshRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip =
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    'unknown';

  const now = Date.now();
  const attempt = refreshAttempts.get(ip);

  if (attempt && now < attempt.resetAt) {
    if (attempt.count >= 10) {
      res.status(429).json({
        error: 'too_many_attempts',
        message: 'Too many refresh attempts. Please try again in 15 minutes.',
        retryAfter: Math.ceil((attempt.resetAt - now) / 1000),
      });
      return;
    }
    attempt.count++;
  } else {
    refreshAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }
  next();
}

/**
 * JWT payload interface
 */
interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
}

/**
 * Refresh token JWT payload
 */
interface RefreshTokenPayload {
  userId: string;
  jti: string;
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
function isValidPassword(password: string): boolean {
  // bcrypt silently truncates at 72 bytes — enforce a max to prevent confusion
  return password.length >= 8 && password.length <= 128;
}

/**
 * JWT authentication middleware
 */
function jwtAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'missing_token',
        message: 'JWT token required. Provide via Authorization: Bearer <token>',
      });
      return;
    }

    const token = authHeader.slice(7);
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable not configured');
    }

    const payload = jwt.verify(token, jwtSecret) as JwtPayload;
    
    // Attach user info to request
    (req as any).user = payload;
    
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid or expired JWT token',
      });
      return;
    }
    
    res.status(500).json({
      error: 'auth_error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Create user routes
 */
export function createUserRouter(): Router {
  const router = Router();
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({
    connectionString: dbUrl,
    // TLS: enabled when DATABASE_URL contains sslmode=require.
    // Secure by default (rejectUnauthorized: true); set PG_REJECT_UNAUTHORIZED=false
    // only for managed DBs (Render/Neon/Supabase) that use self-signed certs.
    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
  });

  // Initialize refresh_tokens table on startup
  pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => pool.query(
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`
  )).catch((err: Error) => {
    console.error('Failed to initialize refresh_tokens table:', err);
  });

  /**
   * Helper: generate a refresh token and store its jti in the database
   */
  async function createRefreshToken(userId: string, jwtSecret: string): Promise<string> {
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, expires_at) VALUES ($1, $2, $3)`,
      [jti, userId, expiresAt]
    );

    return jwt.sign(
      { userId, jti } as RefreshTokenPayload,
      jwtSecret,
      { expiresIn: '30d' }
    );
  }

  /**
   * POST /v1/auth/register
   * Register a new user and create their first API key
   */
  router.post('/v1/auth/register', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      // Input validation
      if (!email || !password) {
        res.status(400).json({
          error: 'missing_fields',
          message: 'Email and password are required',
        });
        return;
      }

      if (!isValidEmail(email)) {
        res.status(400).json({
          error: 'invalid_email',
          message: 'Invalid email format',
        });
        return;
      }

      if (!isValidPassword(password)) {
        res.status(400).json({
          error: 'weak_password',
          message: 'Password must be at least 8 characters',
        });
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // Create user
      const userResult = await pool.query(
        `INSERT INTO users (email, password_hash, tier, weekly_limit, burst_limit, rate_limit)
        VALUES ($1, $2, 'free', 500, 50, 10)
        RETURNING id, email, tier, weekly_limit, burst_limit, rate_limit, created_at`,
        [email, passwordHash]
      );

      const user = userResult.rows[0];

      // Generate API key
      const apiKey = PostgresAuthStore.generateApiKey();
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const keyPrefix = PostgresAuthStore.getKeyPrefix(apiKey);

      // Store API key
      await pool.query(
        `INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
        VALUES ($1, $2, $3, 'Default')`,
        [user.id, keyHash, keyPrefix]
      );

      const signupTimestamp = new Date().toISOString();

      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          tier: user.tier,
          weeklyLimit: user.weekly_limit,
          burstLimit: user.burst_limit,
          rateLimit: user.rate_limit,
          createdAt: user.created_at,
        },
        apiKey, // SECURITY: Only returned once, never stored or shown again
      });

      // Fire-and-forget Discord webhook for successful signups; never block registration on webhook errors.
      try {
        const webhookUrl = process.env.DISCORD_SIGNUP_WEBHOOK;
        if (webhookUrl) {
          void fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '🎉 New Signup',
                color: 9133302,
                fields: [
                  { name: 'Email', value: email, inline: true },
                  { name: 'Tier', value: 'Free', inline: true },
                  { name: 'Timestamp', value: signupTimestamp, inline: false },
                ],
                timestamp: signupTimestamp,
                footer: { text: 'WebPeel Signups' },
              }],
            }),
          }).catch(() => {});
        }
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'discord webhook failed:', e instanceof Error ? e.message : e);
      }
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        res.status(409).json({
          error: 'email_exists',
          message: 'Email already registered',
        });
        return;
      }

      console.error('Registration error:', error);
      res.status(500).json({
        error: 'registration_failed',
        message: 'Failed to register user',
      });
    }
  });

  /**
   * POST /v1/auth/login
   * Login with email/password and get JWT token
   */
  router.post('/v1/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({
          error: 'missing_fields',
          message: 'Email and password are required',
        });
        return;
      }

      // Get user
      const result = await pool.query(
        'SELECT id, email, password_hash, tier FROM users WHERE email = $1',
        [email]
      );

      // Constant-time auth: always run bcrypt.compare to prevent timing oracle
      // (prevents user enumeration via response time differences)
      const DUMMY_HASH = '$2b$12$LJ7F3mGTqKmEqFv5GsNXxeIkYwJwgJkOqSvKqGqKqGqKqGqKqGqKq';
      const user = result.rows[0];
      const hashToCompare = user?.password_hash ?? DUMMY_HASH;
      const passwordValid = await bcrypt.compare(password, hashToCompare);

      if (!user || !passwordValid) {
        res.status(401).json({
          error: 'invalid_credentials',
          message: 'Invalid email or password',
        });
        return;
      }

      // Generate JWT
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new Error('JWT_SECRET not configured');
      }

      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          tier: user.tier,
        } as JwtPayload,
        jwtSecret,
        { expiresIn: '7d' }
      );

      let refreshToken: string | null = null;
      try {
        refreshToken = await createRefreshToken(user.id, jwtSecret);
      } catch (refreshErr) {
        console.error('Refresh token creation failed (login will continue without it):', refreshErr);
      }

      res.json({
        token,
        ...(refreshToken ? { refreshToken } : {}),
        expiresIn: 604800,
        user: {
          id: user.id,
          email: user.email,
          tier: user.tier,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        error: 'login_failed',
        message: 'Failed to login',
      });
    }
  });

  /**
   * POST /v1/auth/refresh
   * Exchange a valid refresh token for a new access token + refresh token
   */
  router.post('/v1/auth/refresh', refreshRateLimiter, async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          error: 'missing_token',
          message: 'refreshToken is required',
        });
        return;
      }

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new Error('JWT_SECRET not configured');
      }

      // Verify JWT signature + expiry
      let payload: RefreshTokenPayload;
      try {
        payload = jwt.verify(refreshToken, jwtSecret) as RefreshTokenPayload;
      } catch {
        res.status(401).json({
          error: 'invalid_token',
          message: 'Invalid or expired refresh token',
        });
        return;
      }

      // Check token is not revoked and still exists
      const tokenResult = await pool.query(
        `SELECT id, user_id, revoked_at FROM refresh_tokens WHERE id = $1`,
        [payload.jti]
      );

      if (tokenResult.rows.length === 0 || tokenResult.rows[0].revoked_at !== null) {
        res.status(401).json({
          error: 'token_revoked',
          message: 'Refresh token has been revoked',
        });
        return;
      }

      // Get current user info (tier may have changed)
      const userResult = await pool.query(
        'SELECT id, email, tier FROM users WHERE id = $1',
        [payload.userId]
      );

      if (userResult.rows.length === 0) {
        res.status(401).json({
          error: 'user_not_found',
          message: 'User no longer exists',
        });
        return;
      }

      const user = userResult.rows[0];

      // Revoke old refresh token (rotate tokens)
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
        [payload.jti]
      );

      // Issue new access token (7d) + new refresh token (30d)
      const newToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          tier: user.tier,
        } as JwtPayload,
        jwtSecret,
        { expiresIn: '7d' }
      );

      const newRefreshToken = await createRefreshToken(user.id, jwtSecret);

      res.json({
        token: newToken,
        refreshToken: newRefreshToken,
        expiresIn: 604800,
      });
    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(500).json({
        error: 'refresh_failed',
        message: 'Failed to refresh token',
      });
    }
  });

  /**
   * POST /v1/auth/revoke
   * Revoke all refresh tokens for the current user (logout all devices)
   */
  router.post('/v1/auth/revoke', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;

      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
      );

      res.json({ success: true, message: 'All refresh tokens revoked' });
    } catch (error) {
      console.error('Revoke tokens error:', error);
      res.status(500).json({
        error: 'revoke_failed',
        message: 'Failed to revoke tokens',
      });
    }
  });

  /**
   * GET /v1/me
   * Get current user profile and usage
   */
  router.get('/v1/me', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;

      const result = await pool.query(
        `SELECT 
          u.id, u.email, u.tier, u.weekly_limit, u.burst_limit, u.rate_limit, u.created_at,
          u.stripe_customer_id, u.stripe_subscription_id
        FROM users u
        WHERE u.id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'user_not_found',
          message: 'User not found',
        });
        return;
      }

      const user = result.rows[0];

      res.json({
        id: user.id,
        email: user.email,
        tier: user.tier,
        weeklyLimit: user.weekly_limit,
        burstLimit: user.burst_limit,
        rateLimit: user.rate_limit,
        createdAt: user.created_at,
        hasStripe: !!user.stripe_customer_id,
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        error: 'profile_failed',
        message: 'Failed to get profile',
      });
    }
  });

  /**
   * PATCH /v1/me
   * Update current user's profile (name)
   */
  router.patch('/v1/me', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { name } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name_required', message: 'Name is required' });
        return;
      }
      if (name.length > 100) {
        res.status(400).json({ error: 'invalid_name', message: 'Name must be 100 characters or less' });
        return;
      }
      const result = await pool.query(
        'UPDATE users SET name = $1, updated_at = now() WHERE id = $2 RETURNING id, email, name, tier',
        [name.trim(), userId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: 'user_not_found', message: 'User not found' });
        return;
      }
      res.json({ user: result.rows[0] });
    } catch (error) {
      console.error('Update me error:', error);
      res.status(500).json({ error: 'update_failed', message: 'Failed to update profile' });
    }
  });

  /**
   * Parse expiresIn parameter to a Date or null (null = never expires)
   */
  function parseExpiresIn(expiresIn: string | undefined): Date | null {
    if (!expiresIn || expiresIn === 'never') return null;
    const now = new Date();
    switch (expiresIn) {
      case '7d':  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case '30d': return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      case '90d': return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      case '1y':  return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      default: {
        // Try ISO date string
        const parsed = new Date(expiresIn);
        if (!isNaN(parsed.getTime()) && parsed > now) return parsed;
        return null;
      }
    }
  }

  /**
   * POST /v1/keys
   * Create a new API key
   */
  router.post('/v1/keys', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { name, expiresIn } = req.body;

      // Parse optional expiration
      const expiresAt = parseExpiresIn(expiresIn as string | undefined);

      // Generate API key
      const apiKey = PostgresAuthStore.generateApiKey();
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const keyPrefix = PostgresAuthStore.getKeyPrefix(apiKey);

      // Store API key
      const result = await pool.query(
        `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, key_prefix, name, created_at, expires_at`,
        [userId, keyHash, keyPrefix, name || 'Unnamed Key', expiresAt]
      );

      const key = result.rows[0];

      res.status(201).json({
        id: key.id,
        key: apiKey, // SECURITY: Only returned once
        prefix: key.key_prefix,
        name: key.name,
        createdAt: key.created_at,
        expiresAt: key.expires_at,
      });
    } catch (error) {
      console.error('Create key error:', error);
      res.status(500).json({
        error: 'key_creation_failed',
        message: 'Failed to create API key',
      });
    }
  });

  /**
   * Format expiry as human-readable string
   */
  function formatExpiresIn(expiresAt: Date | null): string | null {
    if (!expiresAt) return null;
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 0) {
      const absDays = Math.abs(diffDays);
      return absDays === 1 ? 'expired 1 day ago' : `expired ${absDays} days ago`;
    }
    if (diffDays === 0) return 'expires today';
    if (diffDays === 1) return 'in 1 day';
    return `in ${diffDays} days`;
  }

  /**
   * GET /v1/keys
   * List user's API keys (prefix only, never full key)
   */
  router.get('/v1/keys', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;

      const result = await pool.query(
        `SELECT id, key_prefix, name, is_active, created_at, last_used_at, expires_at
        FROM api_keys
        WHERE user_id = $1
        ORDER BY created_at DESC`,
        [userId]
      );

      const now = new Date();
      res.json({
        keys: result.rows.map(key => {
          const expiresAt: Date | null = key.expires_at ? new Date(key.expires_at) : null;
          const isExpired = expiresAt !== null && expiresAt <= now;
          return {
            id: key.id,
            prefix: key.key_prefix,
            name: key.name,
            isActive: key.is_active,
            createdAt: key.created_at,
            lastUsedAt: key.last_used_at,
            expiresAt: key.expires_at,
            isExpired,
            expiresIn: formatExpiresIn(expiresAt),
          };
        }),
      });
    } catch (error) {
      console.error('List keys error:', error);
      res.status(500).json({
        error: 'list_keys_failed',
        message: 'Failed to list API keys',
      });
    }
  });

  /**
   * PATCH /v1/keys/:id
   * Update an API key (currently: name only)
   */
  router.patch('/v1/keys/:id', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { id } = req.params;
      const { name } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'invalid_name', message: 'Key name is required' });
        return;
      }

      if (name.length > 64) {
        res.status(400).json({ error: 'invalid_name', message: 'Key name must be 64 characters or less' });
        return;
      }

      const result = await pool.query(
        `UPDATE api_keys SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, key_prefix, created_at, last_used_at, is_active, expires_at`,
        [name.trim(), id, userId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'not_found', message: 'API key not found' });
        return;
      }

      const key = result.rows[0];
      res.json({
        id: key.id,
        name: key.name,
        prefix: key.key_prefix,
        createdAt: key.created_at,
        lastUsedAt: key.last_used_at,
        isActive: key.is_active,
        expiresAt: key.expires_at,
      });
    } catch (error) {
      console.error('Update key error:', error);
      res.status(500).json({ error: 'update_failed', message: 'Failed to update API key' });
    }
  });

  /**
   * DELETE /v1/keys/:id
   * Deactivate an API key
   */
  router.delete('/v1/keys/:id', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { id } = req.params;

      // Verify ownership and deactivate
      const result = await pool.query(
        `UPDATE api_keys 
        SET is_active = false
        WHERE id = $1 AND user_id = $2
        RETURNING id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'key_not_found',
          message: 'API key not found or access denied',
        });
        return;
      }

      res.json({
        success: true,
        message: 'API key deactivated',
      });
    } catch (error) {
      console.error('Delete key error:', error);
      res.status(500).json({
        error: 'delete_key_failed',
        message: 'Failed to delete API key',
      });
    }
  });

  /**
   * GET /v1/usage
   * Get current week usage + limits + burst + extra usage
   */
  router.get('/v1/usage', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;

      // Helper: Get current ISO week
      const getCurrentWeek = () => {
        const now = new Date();
        const year = now.getUTCFullYear();
        const jan4 = new Date(Date.UTC(year, 0, 4));
        const weekNum = Math.ceil(((now.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
        return `${year}-W${String(weekNum).padStart(2, '0')}`;
      };

      // Helper: Get current hour bucket
      const getCurrentHour = () => {
        return new Date().toISOString().substring(0, 13);
      };

      // Helper: Get week reset time
      const getWeekResetTime = () => {
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
        const nextMonday = new Date(now);
        nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
        nextMonday.setUTCHours(0, 0, 0, 0);
        return nextMonday.toISOString();
      };

      // Helper: Get time until next hour
      const getTimeUntilNextHour = () => {
        const now = new Date();
        const minutesRemaining = 59 - now.getUTCMinutes();
        if (minutesRemaining === 0) return '< 1 min';
        return `${minutesRemaining} min`;
      };

      // Helper: Get next month reset
      const getMonthResetTime = () => {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
      };

      const currentWeek = getCurrentWeek();
      const currentHour = getCurrentHour();

      // Get user plan info
      const planResult = await pool.query(
        `SELECT tier, weekly_limit, burst_limit FROM users WHERE id = $1`,
        [userId]
      );

      if (planResult.rows.length === 0) {
        res.status(404).json({
          error: 'user_not_found',
          message: 'User not found',
        });
        return;
      }

      const plan = planResult.rows[0];

      // Get weekly usage
      const weeklyResult = await pool.query(
        `SELECT 
          COALESCE(SUM(wu.basic_count), 0) as basic_used,
          COALESCE(SUM(wu.stealth_count), 0) as stealth_used,
          COALESCE(SUM(wu.captcha_count), 0) as captcha_used,
          COALESCE(SUM(wu.search_count), 0) as search_used,
          COALESCE(SUM(wu.total_count), 0) as total_used,
          COALESCE(MAX(wu.rollover_credits), 0) as rollover_credits
        FROM users u
        LEFT JOIN api_keys ak ON ak.user_id = u.id
        LEFT JOIN weekly_usage wu ON wu.api_key_id = ak.id AND wu.week = $2
        WHERE u.id = $1
        GROUP BY u.id`,
        [userId, currentWeek]
      );

      const weeklyUsage = weeklyResult.rows[0] || {
        basic_used: 0,
        stealth_used: 0,
        captcha_used: 0,
        search_used: 0,
        total_used: 0,
        rollover_credits: 0,
      };

      const totalAvailable = plan.weekly_limit + weeklyUsage.rollover_credits;
      const remaining = Math.max(0, totalAvailable - weeklyUsage.total_used);
      const percentUsed = totalAvailable > 0 ? Math.round((weeklyUsage.total_used / totalAvailable) * 100) : 0;

      // Get burst usage (current hour)
      const burstResult = await pool.query(
        `SELECT COALESCE(SUM(bu.count), 0) as burst_used
        FROM users u
        LEFT JOIN api_keys ak ON ak.user_id = u.id
        LEFT JOIN burst_usage bu ON bu.api_key_id = ak.id AND bu.hour_bucket = $2
        WHERE u.id = $1`,
        [userId, currentHour]
      );

      const burstUsed = burstResult.rows[0]?.burst_used || 0;
      const burstPercent = plan.burst_limit > 0 ? Math.round((burstUsed / plan.burst_limit) * 100) : 0;

      // Get extra usage info
      const extraResult = await pool.query(
        `SELECT 
          extra_usage_enabled,
          extra_usage_balance,
          extra_usage_spent,
          extra_usage_spending_limit,
          auto_reload_enabled
        FROM users
        WHERE id = $1`,
        [userId]
      );

      const extra = extraResult.rows[0];
      const extraPercent = extra.extra_usage_spending_limit > 0
        ? Math.round((parseFloat(extra.extra_usage_spent) / parseFloat(extra.extra_usage_spending_limit)) * 100)
        : 0;

      res.json({
        plan: {
          tier: plan.tier,
          weeklyLimit: plan.weekly_limit,
          burstLimit: plan.burst_limit,
        },
        session: {
          burstUsed,
          burstLimit: plan.burst_limit,
          resetsIn: getTimeUntilNextHour(),
          percentUsed: burstPercent,
        },
        weekly: {
          week: currentWeek,
          basicUsed: weeklyUsage.basic_used,
          stealthUsed: weeklyUsage.stealth_used,
          captchaUsed: weeklyUsage.captcha_used,
          searchUsed: weeklyUsage.search_used,
          totalUsed: weeklyUsage.total_used,
          totalAvailable,
          rolloverCredits: weeklyUsage.rollover_credits,
          remaining,
          percentUsed,
          resetsAt: getWeekResetTime(),
        },
        extraUsage: {
          enabled: extra.extra_usage_enabled,
          spent: parseFloat(extra.extra_usage_spent),
          spendingLimit: parseFloat(extra.extra_usage_spending_limit),
          balance: parseFloat(extra.extra_usage_balance),
          autoReload: extra.auto_reload_enabled,
          percentUsed: extraPercent,
          resetsAt: getMonthResetTime(),
        },
      });
    } catch (error) {
      console.error('Get usage error:', error);
      res.status(500).json({
        error: 'usage_failed',
        message: 'Failed to get usage',
      });
    }
  });

  /**
   * GET /v1/usage/history
   * Get daily usage history for the past N days (default 7)
   */
  router.get('/v1/usage/history', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);

      // Get daily usage from usage_logs table
      const result = await pool.query(
        `SELECT
          DATE(created_at) as date,
          COUNT(*) FILTER (WHERE method = 'basic' OR method IS NULL) as fetches,
          COUNT(*) FILTER (WHERE method = 'stealth') as stealth,
          COUNT(*) FILTER (WHERE method = 'search') as search
        FROM usage_logs
        WHERE user_id = $1
          AND created_at >= NOW() - INTERVAL '1 day' * $2
        GROUP BY DATE(created_at)
        ORDER BY date ASC`,
        [userId, days]
      );

      // Fill in missing days with zeros
      const history: Array<{ date: string; fetches: number; stealth: number; search: number }> = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = d.toISOString().substring(0, 10);
        const row = result.rows.find((r: any) => r.date?.toISOString?.().substring(0, 10) === dateStr || r.date === dateStr);
        history.push({
          date: dateStr,
          fetches: parseInt(row?.fetches || '0', 10),
          stealth: parseInt(row?.stealth || '0', 10),
          search: parseInt(row?.search || '0', 10),
        });
      }

      res.json({ history });
    } catch (error) {
      console.error('Get usage history error:', error);
      res.status(500).json({
        error: 'history_failed',
        message: 'Failed to get usage history',
      });
    }
  });

  /**
   * POST /v1/extra-usage/toggle
   * Enable/disable extra usage
   */
  router.post('/v1/extra-usage/toggle', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'enabled must be a boolean',
        });
        return;
      }

      await pool.query(
        'UPDATE users SET extra_usage_enabled = $1, updated_at = now() WHERE id = $2',
        [enabled, userId]
      );

      res.json({
        success: true,
        enabled,
      });
    } catch (error) {
      console.error('Toggle extra usage error:', error);
      res.status(500).json({
        error: 'toggle_failed',
        message: 'Failed to toggle extra usage',
      });
    }
  });

  /**
   * POST /v1/extra-usage/limit
   * Adjust spending limit
   */
  router.post('/v1/extra-usage/limit', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { limit } = req.body;

      if (typeof limit !== 'number' || limit < 10 || limit > 500) {
        res.status(400).json({
          error: 'invalid_limit',
          message: 'Limit must be a number between 10 and 500',
        });
        return;
      }

      await pool.query(
        'UPDATE users SET extra_usage_spending_limit = $1, updated_at = now() WHERE id = $2',
        [limit, userId]
      );

      res.json({
        success: true,
        limit,
      });
    } catch (error) {
      console.error('Set limit error:', error);
      res.status(500).json({
        error: 'limit_failed',
        message: 'Failed to set spending limit',
      });
    }
  });

  /**
   * POST /v1/extra-usage/buy
   * Add to extra usage balance (future: Stripe checkout)
   */
  router.post('/v1/extra-usage/buy', jwtAuth, async (_req: Request, res: Response) => {
    // DISABLED: Stripe integration in progress
    res.status(501).json({
      error: 'not_implemented',
      message: 'Extra usage purchases are available through our billing portal. Visit https://app.webpeel.dev/billing',
    });
  });

  /**
   * PATCH /v1/user/profile
   * Update user profile (name, avatar)
   */
  router.patch('/v1/user/profile', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { name, avatarUrl } = req.body;

      // Validate inputs
      if (name && typeof name !== 'string') {
        res.status(400).json({ error: 'invalid_name', message: 'Name must be a string' });
        return;
      }
      if (name && name.length > 100) {
        res.status(400).json({ error: 'invalid_name', message: 'Name too long (max 100 characters)' });
        return;
      }
      if (avatarUrl && typeof avatarUrl !== 'string') {
        res.status(400).json({ error: 'invalid_avatar', message: 'Avatar URL must be a string' });
        return;
      }
      if (avatarUrl && avatarUrl.length > 500) {
        res.status(400).json({ error: 'invalid_avatar', message: 'Avatar URL too long (max 500 characters)' });
        return;
      }
      if (avatarUrl) {
        try {
          const parsed = new URL(avatarUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            res.status(400).json({ error: 'invalid_avatar', message: 'Avatar URL must use http or https protocol' });
            return;
          }
        } catch {
          res.status(400).json({ error: 'invalid_avatar', message: 'Avatar URL must be a valid URL' });
          return;
        }
      }

      // Build update query dynamically
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }
      if (avatarUrl !== undefined) {
        updates.push(`avatar_url = $${paramIndex++}`);
        values.push(avatarUrl);
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'no_updates', message: 'No fields to update' });
        return;
      }

      updates.push(`updated_at = now()`);
      values.push(userId);

      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, name, avatar_url`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'user_not_found', message: 'User not found' });
        return;
      }

      res.json({
        success: true,
        user: {
          id: result.rows[0].id,
          email: result.rows[0].email,
          name: result.rows[0].name,
          avatar: result.rows[0].avatar_url,
        },
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'update_failed', message: 'Failed to update profile' });
    }
  });

  /**
   * PATCH /v1/user/password
   * Change password (verify current, hash new)
   */
  router.patch('/v1/user/password', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'missing_fields', message: 'Current and new passwords are required' });
        return;
      }

      if (!isValidPassword(newPassword)) {
        res.status(400).json({ error: 'weak_password', message: 'Password must be at least 8 characters' });
        return;
      }

      // Get current password hash
      const userResult = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        res.status(404).json({ error: 'user_not_found', message: 'User not found' });
        return;
      }

      // OAuth users don't have passwords
      if (!userResult.rows[0].password_hash) {
        res.status(400).json({ 
          error: 'oauth_user', 
          message: 'OAuth users cannot set passwords. Please use your OAuth provider to manage your account.' 
        });
        return;
      }

      // Verify current password
      const passwordValid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
      if (!passwordValid) {
        res.status(401).json({ error: 'invalid_password', message: 'Current password is incorrect' });
        return;
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

      // Update password
      await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
        [newPasswordHash, userId]
      );

      res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'update_failed', message: 'Failed to change password' });
    }
  });

  /**
   * DELETE /v1/user/account
   * Delete account + cascade to api_keys, oauth_accounts
   */
  router.delete('/v1/user/account', jwtAuth, async (req: Request, res: Response) => {
    try {
      const { userId } = (req as any).user as JwtPayload;
      const { password, confirmEmail } = req.body;

      // Get user info
      const userResult = await pool.query(
        'SELECT email, password_hash FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        res.status(404).json({ error: 'user_not_found', message: 'User not found' });
        return;
      }

      const user = userResult.rows[0];

      // Verify email confirmation
      if (confirmEmail !== user.email) {
        res.status(400).json({ 
          error: 'email_mismatch', 
          message: 'Email confirmation does not match account email' 
        });
        return;
      }

      // Verify password (if user has one - OAuth users might not)
      if (user.password_hash) {
        if (!password) {
          res.status(400).json({ error: 'missing_password', message: 'Password is required' });
          return;
        }

        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
          res.status(401).json({ error: 'invalid_password', message: 'Password is incorrect' });
          return;
        }
      }

      // Delete user and all related data in a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM api_keys WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM oauth_accounts WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      res.json({ 
        success: true, 
        message: 'Account deleted successfully. We\'re sorry to see you go!' 
      });
    } catch (error) {
      console.error('Delete account error:', error);
      res.status(500).json({ error: 'delete_failed', message: 'Failed to delete account' });
    }
  });

  return router;
}
