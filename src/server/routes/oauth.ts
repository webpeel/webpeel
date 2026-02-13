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
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });

  /**
   * POST /v1/auth/oauth
   * OAuth callback handler - called by Auth.js after successful OAuth flow
   * Auto-creates users if they don't exist
   */
  router.post('/v1/auth/oauth', async (req: Request, res: Response) => {
    try {
      const { provider, providerId, email, name, avatar } = req.body;

      // Rate limiting - use email as identifier
      if (!rateLimiter.check(email || 'unknown')) {
        res.status(429).json({
          error: 'rate_limit_exceeded',
          message: 'Too many OAuth attempts. Please try again in a minute.',
        });
        return;
      }

      // Input validation
      if (!provider || !providerId || !email) {
        res.status(400).json({
          error: 'missing_fields',
          message: 'provider, providerId, and email are required',
        });
        return;
      }

      // Validate provider
      if (provider !== 'github' && provider !== 'google') {
        res.status(400).json({
          error: 'invalid_provider',
          message: 'provider must be "github" or "google"',
        });
        return;
      }

      // Validate email
      if (!isValidEmail(email)) {
        res.status(400).json({
          error: 'invalid_email',
          message: 'Invalid email format',
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
               VALUES ($1, NULL, 'free', 125, 25, 10, $2, $3)
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
          { expiresIn: '30d' }
        );

        await client.query('COMMIT');

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
          error: 'oauth_conflict',
          message: 'OAuth account already exists',
        });
        return;
      }

      res.status(500).json({
        error: 'oauth_failed',
        message: 'Failed to process OAuth login',
      });
    }
  });

  return router;
}
