/**
 * Auth store abstraction for API key validation and usage tracking
 * Designed to easily swap from in-memory to PostgreSQL
 */

import { timingSafeEqual } from 'crypto';

export interface ApiKeyInfo {
  key: string;
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
  rateLimit: number;
  accountId?: string;
  createdAt: Date;
}

export interface AuthStore {
  validateKey(key: string): Promise<ApiKeyInfo | null>;
  trackUsage(key: string, credits: number): Promise<void>;
}

/**
 * Validate API key format and strength
 * SECURITY: Enforce minimum complexity
 */
function validateKeyFormat(key: string): boolean {
  // Minimum 32 characters
  if (key.length < 32) {
    return false;
  }

  // Must contain alphanumeric characters
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return false;
  }

  return true;
}

/**
 * Timing-safe key comparison
 * SECURITY: Prevent timing attacks on key validation
 */
function timingSafeKeyCompare(a: string, b: string): boolean {
  // Ensure equal length for comparison
  if (a.length !== b.length) {
    // Compare against dummy to prevent timing leak
    const dummy = 'x'.repeat(Math.max(a.length, b.length));
    timingSafeEqual(Buffer.from(dummy), Buffer.from(dummy));
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * In-memory auth store for development and self-hosted deployments
 */
export class InMemoryAuthStore implements AuthStore {
  private keys = new Map<string, ApiKeyInfo>();
  private usage = new Map<string, number>();

  constructor() {
    // SECURITY: Demo key only in development mode
    // Removed hardcoded demo key - use addKey() or environment variables
    if (process.env.NODE_ENV === 'development' && process.env.DEMO_KEY) {
      this.addKey({
        key: process.env.DEMO_KEY,
        tier: 'pro',
        rateLimit: 300,
        createdAt: new Date(),
      });
    }
  }

  async validateKey(key: string): Promise<ApiKeyInfo | null> {
    // Basic validation
    if (!key || typeof key !== 'string') {
      return null;
    }

    // SECURITY: Timing-safe comparison to prevent timing attacks
    for (const [storedKey, keyInfo] of this.keys.entries()) {
      if (timingSafeKeyCompare(key, storedKey)) {
        return keyInfo;
      }
    }

    // Constant-time operation for invalid key
    return null;
  }

  async trackUsage(key: string, credits: number): Promise<void> {
    const current = this.usage.get(key) || 0;
    this.usage.set(key, current + credits);
  }

  addKey(keyInfo: ApiKeyInfo): void {
    // SECURITY: Validate key format before adding
    if (!validateKeyFormat(keyInfo.key)) {
      throw new Error('Invalid API key format: must be at least 32 characters, alphanumeric with - or _');
    }
    this.keys.set(keyInfo.key, keyInfo);
  }

  getUsage(key: string): number {
    return this.usage.get(key) || 0;
  }
}
