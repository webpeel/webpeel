/**
 * OAuth authentication routes
 * Handles OAuth login from Auth.js (GitHub, Google)
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { PostgresAuthStore } from '../pg-auth-store.js';

const { Pool } = pg;

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
 * Simple in-memory rate limiter for OAuth endpoint
 */
class OAuthRateLimiter {
  private attempts: Map<string, number[]> = new Map();
  private readonly maxAttempts = 10;
  private readonly windowMs = 60000; // 1 minute

  check(identifier: string): boolean {
    const now = Date.now();
    const attempts = this.attempts.get(identifier) || [];
    
    // Remove old attempts outside the window
    const recentAttempts = attempts.filter(time => now - time < this.windowMs);
    
    if (recentAttempts.length >= this.maxAttempts) {
      return false;
    }
    
    recentAttempts.push(now);
    this.attempts.set(identifier, recentAttempts);
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, attempts] of this.attempts.entries()) {
      const recentAttempts = attempts.filter(time => now - time < this.windowMs);
      if (recentAttempts.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, recentAttempts);
      }
    }
  }
}

const rateLimiter = new OAuthRateLimiter();

// Clean up rate limiter every 2 minutes
setInterval(() => {
  rateLimiter.cleanup();
}, 2 * 60 * 1000);

/**
 * Create OAuth routes
 */
export function createOAuthRouter(): Router {
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
   * POST /v1/auth/oauth
   * OAuth callback handler - called by Auth.js after successful OAuth flow
   * Auto-creates users if they don't exist
   */
  router.post('/v1/auth/oauth', async (req: Request, res: Response) => {
    try {
      const { provider, accessToken, name, avatar } = req.body;

      // Rate limiting — scoped per-IP per-provider (not global) to prevent DoS.
      // IP extracted from cf-connecting-ip (Cloudflare) > x-forwarded-for (reverse proxy) > req.ip.
      // Limit: 10 attempts per minute per IP+provider combination.
      const clientIp = (req.headers['cf-connecting-ip'] as string) || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      if (!rateLimiter.check(`${clientIp}:${provider || 'unknown'}`)) {
        res.status(429).json({
          success: false,
          error: {
            type: 'rate_limit_exceeded',
            message: 'Too many OAuth attempts. Please try again in a minute.',
            hint: 'Wait 1 minute before retrying.',
            docs: 'https://webpeel.dev/docs/errors#rate-limit-exceeded',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      // Input validation
      if (!provider || !accessToken) {
        res.status(400).json({
          success: false,
          error: {
            type: 'missing_fields',
            message: 'provider and accessToken are required',
            hint: 'Include both "provider" and "accessToken" in the request body.',
            docs: 'https://webpeel.dev/docs/errors#missing-fields',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      // Validate provider
      if (provider !== 'github' && provider !== 'google') {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_provider',
            message: 'provider must be "github" or "google"',
            hint: 'Use "github" or "google" as the provider value.',
            docs: 'https://webpeel.dev/docs/errors#invalid-provider',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      // SECURITY: Verify the OAuth token server-side and extract trusted identity
      let providerId: string;
      let email: string;

      if (provider === 'github') {
        // Verify GitHub access token
        const ghRes = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
          },
        });
        if (!ghRes.ok) {
          res.status(401).json({
            success: false,
            error: { type: 'invalid_token', message: 'Invalid GitHub access token.' },
            requestId: req.requestId,
          });
          return;
        }
        const ghUser = await ghRes.json() as { id: number; email?: string | null };
        providerId = String(ghUser.id);

        // GitHub may not return email on /user; fetch from /user/emails
        if (ghUser.email) {
          email = ghUser.email;
        } else {
          const emailRes = await fetch('https://api.github.com/user/emails', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github+json',
            },
          });
          if (emailRes.ok) {
            const emails = await emailRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
            const primary = emails.find(e => e.primary && e.verified);
            email = primary?.email || emails[0]?.email || '';
          } else {
            email = '';
          }
        }
      } else {
        // Verify Google ID token
        const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(accessToken)}`);
        if (!gRes.ok) {
          res.status(401).json({
            success: false,
            error: { type: 'invalid_token', message: 'Invalid Google token.' },
            requestId: req.requestId,
          });
          return;
        }
        const gUser = await gRes.json() as { sub: string; email?: string };
        providerId = gUser.sub;
        email = gUser.email || '';
      }

      // Validate email from verified token
      if (!email || !isValidEmail(email)) {
        res.status(400).json({
          success: false,
          error: {
            type: 'invalid_email',
            message: 'Could not retrieve a valid email from OAuth provider',
            hint: 'Ensure your OAuth account has a verified email address.',
            docs: 'https://webpeel.dev/docs/errors#invalid-email',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');

        // Check if OAuth account already exists
        const oauthResult = await client.query(
          `SELECT user_id FROM oauth_accounts 
           WHERE provider = $1 AND provider_id = $2`,
          [provider, providerId]
        );

        let userId: string;
        let isNew = false;
        let apiKey: string | undefined;

        if (oauthResult.rows.length > 0) {
          // Existing OAuth account - get user
          userId = oauthResult.rows[0].user_id;

          // Update OAuth account info
          await client.query(
            `UPDATE oauth_accounts 
             SET email = $1, name = $2, avatar_url = $3, updated_at = now()
             WHERE provider = $4 AND provider_id = $5`,
            [email, name || null, avatar || null, provider, providerId]
          );
        } else {
          // New OAuth account - check if user with this email exists
          const userResult = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
          );

          if (userResult.rows.length > 0) {
            // User exists - link OAuth account to existing user
            userId = userResult.rows[0].id;

            // Update user info
            await client.query(
              `UPDATE users 
               SET name = COALESCE($1, name), 
                   avatar_url = COALESCE($2, avatar_url), 
                   updated_at = now()
               WHERE id = $3`,
              [name || null, avatar || null, userId]
            );

            // Create OAuth account link
            await client.query(
              `INSERT INTO oauth_accounts 
               (user_id, provider, provider_id, email, name, avatar_url)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [userId, provider, providerId, email, name || null, avatar || null]
            );
          } else {
            // New user - create account
            const newUserResult = await client.query(
              `INSERT INTO users 
               (email, password_hash, tier, weekly_limit, burst_limit, rate_limit, name, avatar_url)
               VALUES ($1, NULL, 'free', 500, 50, 10, $2, $3)
               RETURNING id`,
              [email, name || null, avatar || null]
            );

            userId = newUserResult.rows[0].id;
            isNew = true;

            // Create OAuth account link
            await client.query(
              `INSERT INTO oauth_accounts 
               (user_id, provider, provider_id, email, name, avatar_url)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [userId, provider, providerId, email, name || null, avatar || null]
            );

            // Generate first API key for new user
            apiKey = PostgresAuthStore.generateApiKey();
            const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            const keyPrefix = PostgresAuthStore.getKeyPrefix(apiKey);

            await client.query(
              `INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
               VALUES ($1, $2, $3, 'Default')`,
              [userId, keyHash, keyPrefix]
            );
          }
        }

        // Get user info for response
        const userInfoResult = await client.query(
          'SELECT id, email, tier, name, avatar_url FROM users WHERE id = $1',
          [userId]
        );

        const user = userInfoResult.rows[0];

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

        await client.query('COMMIT');

        // Generate refresh token (after commit, uses pool not client)
        const refreshToken = await createRefreshToken(user.id, jwtSecret);

        // Response
        const response: any = {
          user: {
            id: user.id,
            email: user.email,
            tier: user.tier,
            name: user.name,
            avatar: user.avatar_url,
          },
          token,
          refreshToken,
          expiresIn: 604800,
          isNew,
        };

        // Include API key only for new users
        if (isNew && apiKey) {
          response.apiKey = apiKey;
        }

        res.json(response);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error('OAuth error:', error);
      
      // Handle specific errors
      if (error.code === '23505') { // Unique violation
        res.status(409).json({
          success: false,
          error: {
            type: 'oauth_conflict',
            message: 'OAuth account already exists',
            hint: 'This OAuth account is already linked to another user.',
            docs: 'https://webpeel.dev/docs/errors#oauth-conflict',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: {
          type: 'oauth_failed',
          message: 'Failed to process OAuth login',
          docs: 'https://webpeel.dev/docs/errors#oauth-failed',
        },
        requestId: req.requestId || crypto.randomUUID(),
      });
    }
  });

  /**
   * POST /v1/auth/recover
   * Email-based session recovery — used by the dashboard when the OAuth token
   * has expired but the user is still authenticated via NextAuth.
   * Trusts the email from the NextAuth JWT and verifies via shared secret.
   */
  router.post('/v1/auth/recover', async (req: Request, res: Response) => {
    try {
      const { email, secret } = req.body;

      if (!email || !secret) {
        return res.status(400).json({
          success: false,
          error: {
            type: 'missing_fields',
            message: 'email and secret required',
            hint: 'Include both "email" and "secret" in the request body.',
            docs: 'https://webpeel.dev/docs/errors#missing-fields',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
      }

      // Verify the shared secret — proves the request comes from our own dashboard
      const expectedSecret = process.env.DASHBOARD_RECOVER_SECRET || process.env.NEXTAUTH_SECRET;
      if (!expectedSecret || secret !== expectedSecret) {
        return res.status(401).json({ success: false, error: { type: 'unauthorized', message: 'Invalid recovery secret.' }, requestId: req.requestId });
      }

      // Look up user by email
      const result = await pool.query(
        'SELECT id, email, tier, weekly_limit FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            type: 'user_not_found',
            message: 'No account found for this email',
            hint: 'Sign up at https://app.webpeel.dev to create an account.',
            docs: 'https://webpeel.dev/docs/errors#user-not-found',
          },
          requestId: req.requestId || crypto.randomUUID(),
        });
      }

      const user = result.rows[0];
      const jwtSecret = process.env.JWT_SECRET || '';

      const token = jwt.sign(
        { userId: user.id, email: user.email, tier: user.tier } as JwtPayload,
        jwtSecret,
        { expiresIn: '30d' }
      );

      // Get an active API key prefix for the user (if any)
      const keyResult = await pool.query(
        'SELECT key_prefix FROM api_keys WHERE user_id = $1 AND is_active = true LIMIT 1',
        [user.id]
      );

      return res.json({
        token,
        user: { id: user.id, email: user.email, tier: user.tier },
        apiKey: keyResult.rows[0]?.key_prefix ? `${keyResult.rows[0].key_prefix}...` : null,
      });
    } catch (err) {
      console.error('Recovery endpoint error:', err);
      return res.status(500).json({
        success: false,
        error: {
          type: 'server_error',
          message: 'An unexpected server error occurred.',
          docs: 'https://webpeel.dev/docs/errors#server-error',
        },
        requestId: req.requestId || crypto.randomUUID(),
      });
    }
  });

  return router;
}
