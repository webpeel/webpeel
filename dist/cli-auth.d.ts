/**
 * CLI Authentication & Usage Tracking
 *
 * Handles:
 * - Anonymous usage (25 free fetches)
 * - API key authentication
 * - Usage checking against API
 * - Config file management (~/.webpeel/config.json)
 */
interface CLIConfig {
    apiKey?: string;
    anonymousUsage: number;
    lastReset: string;
    planTier?: string;
    planCachedAt?: string;
}
interface UsageCheckResult {
    allowed: boolean;
    message?: string;
    isAnonymous?: boolean;
    usageInfo?: {
        used: number;
        limit: number;
        remaining: number;
    };
}
/**
 * Load config from ~/.webpeel/config.json
 */
export declare function loadConfig(): CLIConfig;
/**
 * Save config to ~/.webpeel/config.json
 */
export declare function saveConfig(config: CLIConfig): void;
/**
 * Delete config file
 */
export declare function deleteConfig(): void;
/**
 * Check usage quota before making a request
 */
export declare function checkUsage(): Promise<UsageCheckResult>;
export type PremiumFeature = 'stealth' | 'crawl' | 'batch';
/**
 * Check if user has access to a premium feature.
 * Returns { allowed: true } for paid users, or a helpful upgrade message.
 *
 * Priority:
 * 1. No API key → blocked (must sign up)
 * 2. Has API key + cached plan → check plan tier
 * 3. Has API key + no cache → check API, then cache
 * 4. API unreachable + cached plan within 7 days → use cache
 * 5. API unreachable + stale cache → allow gracefully (trust the user)
 */
export declare function checkFeatureAccess(feature: PremiumFeature): Promise<{
    allowed: boolean;
    message?: string;
}>;
/**
 * Show usage footer after successful fetch (for free/anonymous users only)
 */
export declare function showUsageFooter(usageInfo: {
    used: number;
    limit: number;
    remaining: number;
} | undefined, isAnonymous: boolean, stealth?: boolean): void;
/**
 * Prompt user for API key via stdin
 */
export declare function promptForApiKey(): Promise<string>;
/**
 * Login command - save API key to config
 */
export declare function handleLogin(): Promise<void>;
/**
 * Logout command - remove API key from config
 */
export declare function handleLogout(): void;
/**
 * Usage command - show current quota
 */
export declare function handleUsage(): Promise<void>;
export {};
//# sourceMappingURL=cli-auth.d.ts.map