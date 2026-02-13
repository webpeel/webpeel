/**
 * WebPeel API Server
 * Express-based REST API for hosted deployments
 */

// Force IPv4-first DNS resolution to prevent IPv6 failures in containers
// (Render's Docker containers can't do IPv6 outbound, causing IANA/Cloudflare sites to fail)
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { InMemoryAuthStore } from './auth-store.js';
import { PostgresAuthStore } from './pg-auth-store.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimitMiddleware, RateLimiter } from './middleware/rate-limit.js';
import { createHealthRouter } from './routes/health.js';
import { createFetchRouter } from './routes/fetch.js';
import { createSearchRouter } from './routes/search.js';
import { createUserRouter } from './routes/users.js';
import { createStripeRouter } from './routes/stripe.js';
import { createOAuthRouter } from './routes/oauth.js';
import { createStatsRouter } from './routes/stats.js';
import { createActivityRouter } from './routes/activity.js';
import { createCLIUsageRouter } from './routes/cli-usage.js';

export interface ServerConfig {
  port?: number;
  corsOrigins?: string[];
  rateLimitWindowMs?: number;
  usePostgres?: boolean;
}

export function createApp(config: ServerConfig = {}): Express {
  const app = express();

  // SECURITY: Trust proxy for Render/production (HTTPS only)
  app.set('trust proxy', 1);

  // Stripe webhook route MUST come before express.json() to get raw body
  const stripeRouter = createStripeRouter();
  app.use('/v1/webhooks/stripe', express.raw({ type: 'application/json' }), stripeRouter);

  // Middleware
  // SECURITY: Limit request body size to prevent DoS
  app.use(express.json({ limit: '1mb' }));
  
  // CORS configuration
  // Always allow our own domains + any env-configured origins
  const envOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : [];
  const defaultOrigins = [
    'https://app.webpeel.dev',
    'https://webpeel.dev',
    'http://localhost:3000',
    'http://localhost:3001',
  ];
  const corsOrigins = config.corsOrigins || [...new Set([...defaultOrigins, ...envOrigins])];
  
  app.use(cors({
    origin: corsOrigins,
    credentials: true,
  }));

  // Auth store - Use PostgreSQL if DATABASE_URL is set, otherwise in-memory
  const usePostgres = config.usePostgres ?? !!process.env.DATABASE_URL;
  const authStore = usePostgres 
    ? new PostgresAuthStore()
    : new InMemoryAuthStore();

  console.log(`Using ${usePostgres ? 'PostgreSQL' : 'in-memory'} auth store`);

  // Rate limiter
  const rateLimiter = new RateLimiter(config.rateLimitWindowMs || 60000);

  // Clean up rate limiter every 5 minutes
  setInterval(() => {
    rateLimiter.cleanup();
  }, 5 * 60 * 1000);

  // Health check MUST be before auth/rate-limit middleware
  // Render hits /health every ~30s; rate-limiting it causes 429 → service marked as failed
  app.use(createHealthRouter());

  // Apply auth middleware globally
  app.use(createAuthMiddleware(authStore));

  // Apply rate limiting middleware globally
  app.use(createRateLimitMiddleware(rateLimiter));
  app.use(createFetchRouter(authStore));
  app.use(createSearchRouter(authStore));
  app.use(createUserRouter());
  app.use(createOAuthRouter());
  app.use(createStatsRouter(authStore));
  app.use(createActivityRouter(authStore));
  app.use(createCLIUsageRouter());

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'not_found',
      message: `Route not found: ${req.method} ${req.path}`,
    });
  });

  // Error handler - SECURITY: Do not expose internal error details
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err); // Log full error server-side
    if (res.headersSent) return; // Avoid double-send crash
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred', // Generic message only
    });
  });

  return app;
}

export function startServer(config: ServerConfig = {}): void {
  const app = createApp(config);
  const port = config.port || parseInt(process.env.PORT || '3000', 10);

  const server = app.listen(port, () => {
    console.log(`WebPeel API server listening on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`Fetch: http://localhost:${port}/v1/fetch?url=<url>`);
    console.log(`Search: http://localhost:${port}/v1/search?q=<query>`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
