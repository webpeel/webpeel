/**
 * API key authentication middleware
 */
import { Request, Response, NextFunction } from 'express';
import { AuthStore, ApiKeyInfo } from '../auth-store.js';
declare global {
    namespace Express {
        interface Request {
            auth?: {
                keyInfo: ApiKeyInfo | null;
                tier: 'free' | 'starter' | 'pro' | 'enterprise';
                rateLimit: number;
            };
        }
    }
}
export declare function createAuthMiddleware(authStore: AuthStore): (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=auth.d.ts.map