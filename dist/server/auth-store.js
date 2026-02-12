/**
 * Auth store abstraction for API key validation and usage tracking
 * Designed to easily swap from in-memory to PostgreSQL
 */
/**
 * In-memory auth store for development and self-hosted deployments
 */
export class InMemoryAuthStore {
    keys = new Map();
    usage = new Map();
    constructor() {
        // Add a demo key for testing
        this.keys.set('demo_key_12345', {
            key: 'demo_key_12345',
            tier: 'pro',
            rateLimit: 300,
            createdAt: new Date(),
        });
    }
    async validateKey(key) {
        return this.keys.get(key) || null;
    }
    async trackUsage(key, credits) {
        const current = this.usage.get(key) || 0;
        this.usage.set(key, current + credits);
    }
    addKey(keyInfo) {
        this.keys.set(keyInfo.key, keyInfo);
    }
    getUsage(key) {
        return this.usage.get(key) || 0;
    }
}
//# sourceMappingURL=auth-store.js.map