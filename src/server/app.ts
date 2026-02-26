/**
 * WebPeel API Server
 * Express-based REST API for hosted deployments
 */

// Force IPv4-first DNS resolution to prevent IPv6 failures in containers
// (Render's Docker containers can't do IPv6 outbound, causing IANA/Cloudflare sites to fail)
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express, { Express, Request, Response, NextFunction } from 'express';
import './types.js'; // Augments Express.Request with requestId
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
import { createJobsRouter } from './routes/jobs.js';
import { createBatchRouter } from './routes/batch.js';
import { createAgentRouter } from './routes/agent.js';
import { createAnswerRouter } from './routes/answer.js';
import { createQuickAnswerRouter } from './routes/quick-answer.js';
import { createMcpRouter } from './routes/mcp.js';
import { createYouTubeRouter } from './routes/youtube.js';
import { createDeepFetchRouter } from './routes/deep-fetch.js';
import { createWatchRouter } from './routes/watch.js';
import pg from 'pg';
import { createScreenshotRouter } from './routes/screenshot.js';
import { createJobQueue } from './job-queue.js';
import { createCompatRouter } from './routes/compat.js';
import { createExtractRouter } from './routes/extract.js';
import { createSentryHooks } from './sentry.js';
import { warmup, cleanup as cleanupFetcher } from '../core/fetcher.js';
import { registerPremiumHooks } from './premium/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve path to the OpenAPI spec (works from both src/ and dist/)
const __dirname_app = dirname(fileURLToPath(import.meta.url));
let _openApiYaml: string | null = null;
function getOpenApiYaml(): string {
  if (_openApiYaml !== null) return _openApiYaml;
  try {
    // Try src/server/openapi.yaml relative to compiled dist/server/
    const candidates = [
      join(__dirname_app, 'openapi.yaml'),
      join(__dirname_app, '..', '..', 'src', 'server', 'openapi.yaml'),
    ];
    for (const candidate of candidates) {
      try {
        _openApiYaml = readFileSync(candidate, 'utf-8');
        return _openApiYaml;
      } catch {
        // try next
      }
    }
    throw new Error('openapi.yaml not found');
  } catch (e) {
    return '# openapi.yaml not found\n';
  }
}

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

  // ─── Request ID ─────────────────────────────────────────────────────────────
  // Generate a UUID v4 for every request so errors and logs are traceable.
  // Must run before all other middleware so req.requestId is always set.
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  // Hard server-side timeouts — no request runs longer than this
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    let timeoutMs = 30000; // 30s default
    if (path.includes('/crawl') || path.includes('/map')) timeoutMs = 300000; // 5min for crawls
    else if (path.includes('/batch')) timeoutMs = 120000; // 2min for batch
    else if (path.includes('/screenshot')) timeoutMs = 60000; // 1min for screenshots
    else if (req.query?.render === 'true') timeoutMs = 60000; // 1min for rendered fetches

    req.setTimeout(timeoutMs);
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          error: {
            type: 'timeout',
            message: `Request timed out after ${timeoutMs / 1000}s`,
            hint: 'Try reducing the scope of your request or upgrading your plan for higher limits.',
            docs: 'https://webpeel.dev/docs/errors#timeout',
          },
          metadata: { requestId: req.requestId },
        });
      }
    });
    next();
  });

  // Optional error tracking (enabled only when SENTRY_DSN is set)
  const sentry = createSentryHooks();
  if (sentry.requestHandler) {
    app.use(sentry.requestHandler);
  }

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
    // Only allow localhost in development (security: prevents credentialed cross-origin from local pages)
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:3001'] : []),
  ];
  const corsOrigins = config.corsOrigins || [...new Set([...defaultOrigins, ...envOrigins])];
  
  app.use(cors({
    origin: corsOrigins,
    credentials: true,
  }));

  // SECURITY: Security headers
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // API-safe CSP: JSON-only API does not need scripts/styles/fonts.
    // Keep this strict to reduce attack surface without affecting API clients.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    // Best-effort removal of Render's origin header (may be re-added by proxy)
    res.removeHeader('x-render-origin-server');
    next();
  });

  // SECURITY: JSON parse error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        success: false,
        error: {
          type: 'invalid_request',
          message: 'Malformed JSON in request body',
          hint: 'Ensure the request body is valid JSON',
          docs: 'https://webpeel.dev/docs/api-reference#errors',
        },
        requestId: req.requestId,
      });
      return;
    }
    next(err);
  });

  // Auth store - Use PostgreSQL if DATABASE_URL is set, otherwise in-memory
  const usePostgres = config.usePostgres ?? !!process.env.DATABASE_URL;
  const authStore = usePostgres 
    ? new PostgresAuthStore()
    : new InMemoryAuthStore();

  console.log(`Using ${usePostgres ? 'PostgreSQL' : 'in-memory'} auth store`);

  // PostgreSQL pool for features that need direct DB access (watch, etc.)
  const pool = process.env.DATABASE_URL
    ? new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
      })
    : null;

  // Job queue - Use PostgreSQL if DATABASE_URL is set, otherwise in-memory
  const jobQueue = createJobQueue();

  // Rate limiter
  const rateLimiter = new RateLimiter(config.rateLimitWindowMs || 3_600_000); // 1 hour

  // Clean up rate limiter every 5 minutes
  setInterval(() => {
    rateLimiter.cleanup();
  }, 5 * 60 * 1000);

  // Health check MUST be before auth/rate-limit middleware
  // Render hits /health every ~30s; rate-limiting it causes 429 → service marked as failed
  app.use(createHealthRouter());

  // OpenAPI spec — public, no auth required
  app.get('/openapi.yaml', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(getOpenApiYaml());
  });

  // Apply auth middleware globally
  app.use(createAuthMiddleware(authStore));

  // Apply rate limiting middleware globally
  app.use(createRateLimitMiddleware(rateLimiter));
  app.use(createCompatRouter(jobQueue));
  app.use(createExtractRouter());
  app.use(createDeepFetchRouter());
  if (pool) {
    app.use(createWatchRouter(pool));
  }
  app.use(createFetchRouter(authStore));
  app.use(createScreenshotRouter(authStore));
  app.use(createSearchRouter(authStore));
  app.use(createUserRouter());
  app.use(createOAuthRouter());
  app.use(createStatsRouter(authStore));
  app.use(createActivityRouter(authStore));
  app.use(createCLIUsageRouter());
  app.use(createJobsRouter(jobQueue, authStore));
  app.use(createBatchRouter(jobQueue));
  app.use(createAgentRouter());
  app.use(createAnswerRouter());
  app.use(createQuickAnswerRouter());
  app.use(createYouTubeRouter());
  app.use(createMcpRouter(authStore, pool));

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        type: 'not_found',
        message: `Route not found: ${req.method} ${req.path}`,
        docs: 'https://webpeel.dev/docs/api-reference',
      },
      requestId: req.requestId,
    });
  });

  // Sentry error middleware should run before the generic error handler.
  if (sentry.errorHandler) {
    app.use(sentry.errorHandler);
  }

  // Error handler - SECURITY: sanitize errors in production to prevent leaking
  // Playwright stack traces, internal paths, or other sensitive details.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err); // Log full error server-side
    if (res.headersSent) return; // Avoid double-send crash

    if (process.env.NODE_ENV === 'production') {
      // Strip Playwright/browser launch errors and stack traces from responses
      const sanitized = (err.message || 'An unexpected error occurred')
        .replace(/browserType\.launch:.*$/s, 'Browser rendering unavailable on this server. Use the CLI with --render for browser-rendered content.')
        .replace(/at\s+\S.*\n?/g, '') // strip "at <location>" stack lines
        .trim() || 'An unexpected error occurred';
      res.status(500).json({
        success: false,
        error: {
          type: 'internal_error',
          message: sanitized,
          docs: 'https://webpeel.dev/docs/api-reference#errors',
        },
        requestId: req.requestId,
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          type: 'internal_error',
          message: err.message || 'An unexpected error occurred',
          docs: 'https://webpeel.dev/docs/api-reference#errors',
        },
        requestId: req.requestId,
        stack: err.stack,
      });
    }
  });

  return app;
}

export function startServer(config: ServerConfig = {}): void {
  const app = createApp(config);
  const port = config.port || parseInt(process.env.PORT || '3000', 10);

  // Activate premium strategy hooks (SWR cache, domain intelligence, race).
  registerPremiumHooks();

  // Pre-warm browser resources in the background to reduce first-request latency.
  void warmup().catch((error) => {
    console.warn('Browser warmup failed:', error instanceof Error ? error.message : String(error));
  });

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
      void cleanupFetcher().finally(() => {
        process.exit(0);
      });
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
