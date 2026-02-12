/**
 * Auth store abstraction for API key validation and usage tracking
 * Designed to easily swap from in-memory to PostgreSQL
 */

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
 * In-memory auth store for development and self-hosted deployments
 */
export class InMemoryAuthStore implements AuthStore {
  private keys = new Map<string, ApiKeyInfo>();
  private usage = new Map<string, number>();

  constructor() {
    // Add a demo key for testing
    this.keys.set('demo_key_12345', {
      key: 'demo_key_12345',
      tier: 'pro',
      rateLimit: 300,
      createdAt: new Date(),
    });
  }

  async validateKey(key: string): Promise<ApiKeyInfo | null> {
    return this.keys.get(key) || null;
  }

  async trackUsage(key: string, credits: number): Promise<void> {
    const current = this.usage.get(key) || 0;
    this.usage.set(key, current + credits);
  }

  addKey(keyInfo: ApiKeyInfo): void {
    this.keys.set(keyInfo.key, keyInfo);
  }

  getUsage(key: string): number {
    return this.usage.get(key) || 0;
  }
}
