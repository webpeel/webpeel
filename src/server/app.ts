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
import helmet from 'helmet';
import { createLogger } from './logger.js';

const log = createLogger('server');
import { InMemoryAuthStore } from './auth-store.js';
import { PostgresAuthStore } from './pg-auth-store.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimitMiddleware, RateLimiter } from './middleware/rate-limit.js';
import { createHealthRouter } from './routes/health.js';
import { createFetchRouter } from './routes/fetch.js';
import { createSearchRouter } from './routes/search.js';
import { createSmartSearchRouter } from './routes/smart-search.js';
import { createUserRouter } from './routes/users.js';
import { createStripeRouter, createBillingPortalRouter } from './routes/stripe.js';
import { createOAuthRouter } from './routes/oauth.js';
import { createStatsRouter } from './routes/stats.js';
import { createActivityRouter } from './routes/activity.js';
import { createCLIUsageRouter } from './routes/cli-usage.js';
import { createJobsRouter } from './routes/jobs.js';
import { createBatchRouter } from './routes/batch.js';
import { createAnswerRouter } from './routes/answer.js';
import { createDeepResearchRouter } from './routes/deep-research.js';
import { createResearchRouter } from './routes/research.js';
import { createAskRouter } from './routes/ask.js';
import { createMcpRouter } from './routes/mcp.js';
import { createDoRouter } from './routes/do.js';
import { createYouTubeRouter } from './routes/youtube.js';
import { createTranscriptExportRouter } from './routes/transcript-export.js';
import { createDeepFetchRouter } from './routes/deep-fetch.js';
import { createFeedRouter } from './routes/feed.js';
import { createGoRouter } from './routes/go.js';
import { createWatchRouter } from './routes/watch.js';
import pg from 'pg';
import { createScreenshotRouter } from './routes/screenshot.js';
import { createDemoRouter } from './routes/demo.js';
import { createPlaygroundRouter } from './routes/playground.js';
import { createReaderRouter } from './routes/reader.js';
import { createSharePublicRouter, createShareRouter } from './routes/share.js';
import { createJobQueue } from './job-queue.js';
import { createQueueFetchRouter } from './routes/fetch-queue.js';
import { createCompatRouter } from './routes/compat.js';
import { createCrawlRouter } from './routes/crawl.js';
import { createMapRouter } from './routes/map.js';
import { createExtractRouter } from './routes/extract.js';
import { createAgentRouter } from './routes/agent.js';
import { createSessionRouter } from './routes/session.js';
import { createSentryHooks } from './sentry.js';
import { requireScope } from './middleware/scope-guard.js';
import { createCacheWarmRouter, startCacheWarmer } from './routes/cache-warm.js';
import { warmup, cleanup as cleanupFetcher } from '../core/fetcher.js';
// Proprietary modules — loaded dynamically so the build works without TypeScript source.
let setExtractorRedis: ((redis: any) => void) | undefined;
let registerPremiumHooks: (() => void) | undefined;
try {
  const de = await import('../ee/domain-extractors.js');
  setExtractorRedis = de.setExtractorRedis;
} catch { /* ee module not available */ }
try {
  const ph = await import('../ee/premium-hooks.js');
  registerPremiumHooks = ph.registerPremiumHooks;
} catch { /* ee module not available */ }
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
    const urlParam = (req.query?.url as string) || '';
    if (path.includes('/crawl') || path.includes('/map')) timeoutMs = 300000; // 5min for crawls
    else if (path.includes('/batch')) timeoutMs = 120000; // 2min for batch
    else if (path.includes('/screenshot')) timeoutMs = 60000; // 1min for screenshots
    else if (path.includes('/search/smart')) timeoutMs = 45000; // 45s for smart search (Yelp+Reddit+Ollama chain)
    else if (req.query?.render === 'true' || req.query?.stealth === 'true') timeoutMs = 60000; // 1min for browser/stealth fetches
    else if (urlParam.includes('youtube.com') || urlParam.includes('youtu.be')) timeoutMs = 90000; // 90s for YouTube (yt-dlp needs time after simpleFetch fails)

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

  // Security headers via Helmet
  app.use(helmet({
    contentSecurityPolicy: false, // Disabled — API serves JSON, not HTML pages
    crossOriginEmbedderPolicy: false, // Allow embedding for widget/docs
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' }, // Prevent clickjacking
    noSniff: true, // X-Content-Type-Options: nosniff
    xssFilter: true, // X-XSS-Protection
  }));
  
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
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, server-to-server)
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, origin);
      // Unknown origins: allow (API key clients need cross-origin access) but no credentials.
      // SECURITY: Return '*' instead of reflecting the origin — wildcard is incompatible with
      // credentials (browsers reject Allow-Credentials + *), prevents origin-specific CORS caching,
      // and avoids security-scanner false positives from reflected origins.
      return callback(null, '*');
    },
    // credentials: set conditionally via post-cors middleware below
    credentials: false,
  }));
  // Set Access-Control-Allow-Credentials only for trusted origins
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
  });

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

  log.info(`Using ${usePostgres ? 'PostgreSQL' : 'in-memory'} auth store`);

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
  // Pass pool so /ready can check DB connectivity
  app.use(createHealthRouter(pool));

  // Affiliate redirect — /go/:store/*path — public, no auth required
  app.use(createGoRouter());

  // OpenAPI spec — public, no auth required
  app.get('/openapi.yaml', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(getOpenApiYaml());
  });

  // Redirect /openapi.json to YAML spec (no extra dependency needed)
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.redirect(301, '/openapi.yaml');
  });

  // Developer-friendly redirect
  app.get('/docs/api', (_req: Request, res: Response) => {
    res.redirect('/openapi.yaml');
  });

  // Internal cache-warming endpoints — unauthenticated (self-auth via bearer token)
  // Must be BEFORE auth middleware so the CF Worker can call without an API key
  app.use(createCacheWarmRouter(pool));

  // Demo endpoint — unauthenticated, must be before auth middleware
  app.use(createDemoRouter());

  // Playground endpoint — unauthenticated, CORS-locked to webpeel.dev/localhost
  app.use('/v1/playground', createPlaygroundRouter());

  // Public share endpoint — GET /s/:id (no auth required, must be before reader router)
  // Registered first so valid share IDs are served before falling through to reader's /s/* search
  app.use(createSharePublicRouter(pool));

  // Zero-auth reader API — Jina-style URL prefix (/r/URL) and search (/s/query)
  // Must be BEFORE auth middleware so no API key is required
  app.use(createReaderRouter());

  // Apply auth middleware globally
  app.use(createAuthMiddleware(authStore));

  // Apply rate limiting middleware globally
  app.use(createRateLimitMiddleware(rateLimiter));

  // Share links — POST /v1/share (auth required, after auth middleware)
  app.use(createShareRouter(pool));

  // First-class native routes (registered before compat so they take precedence)
  //
  // Scope guards enforce API key permission scopes; JWT sessions bypass them.
  // For routers with relative paths: app.use(path, guard, router)    ← prefix stripped, relative paths match
  // For routers with absolute paths: app.use(path, guard) then app.use(router) ← guard at path, router sees full path

  // /v1/crawl — full or read only (router uses relative paths)
  app.use('/v1/crawl', requireScope('full', 'read'), createCrawlRouter(jobQueue));
  // /v1/map — full or read only (router uses relative paths)
  app.use('/v1/map', requireScope('full', 'read'), createMapRouter());
  // Compat routes (/v1/scrape, /v1/search) — all scopes allowed, no guard needed
  app.use(createCompatRouter(jobQueue));
  app.use(createSessionRouter());
  // /v1/extract — full or read only (router uses absolute paths, guard before router)
  app.use('/v1/extract', requireScope('full', 'read'));
  app.use(createExtractRouter());
  // /v1/deep-fetch — full or read only (router uses absolute paths, guard before router)
  app.use('/v1/deep-fetch', requireScope('full', 'read'));
  app.use(createDeepFetchRouter());
  // /v1/watch — full or read only (router uses absolute paths, guard before router)
  if (pool) {
    app.use('/v1/watch', requireScope('full', 'read'));
    app.use(createWatchRouter(pool));
  }
  // /v1/fetch, /v1/search — all scopes allowed, no guard needed
  // In queue mode (API_MODE=queue), /v1/fetch and /v1/render are replaced by
  // queue-backed endpoints that enqueue Bull jobs and return { jobId, status }.
  // GET /v1/jobs/:id is also provided by the queue router for result polling.
  if (process.env.API_MODE === 'queue') {
    app.use(createQueueFetchRouter());
  } else {
    app.use(createFetchRouter(authStore));
  }
  // /v1/screenshot — full or read only (router uses absolute paths, guard before router)
  app.use('/v1/screenshot', requireScope('full', 'read'));
  app.use(createScreenshotRouter(authStore));
  // /v1/feed — feed discovery and parsing (all scopes allowed, no scope guard needed)
  app.use(createFeedRouter(authStore));
  app.use(createSearchRouter(authStore));
  // /v1/search/smart — intent detection + travel/commerce routing (POST)
  app.use(createSmartSearchRouter(authStore));
  // /v1/research — lightweight research (search → fetch → compile), BYOK LLM optional
  app.use('/v1/research', requireScope('full', 'read'));
  app.use(createResearchRouter());
  app.use(createBillingPortalRouter(pool));
  app.use(createUserRouter());
  app.use(createOAuthRouter());
  app.use(createStatsRouter(authStore));
  app.use(createActivityRouter(authStore));
  app.use(createCLIUsageRouter());
  app.use(createJobsRouter(jobQueue, authStore));
  // /v1/batch — full or read only (router uses absolute paths, guard before router)
  app.use('/v1/batch', requireScope('full', 'read'));
  app.use(createBatchRouter(jobQueue));
  // Deprecation headers for declining endpoints
  app.use('/v1/answer', (_req, res, next) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', '2026-06-01');
    res.set('Link', '</v1/ask>; rel="successor-version"');
    next();
  });
  // /v1/answer, /v1/ask — all scopes allowed, no guard needed
  app.use(createAnswerRouter());
  // /v1/deep-research — full or read only
  app.use('/v1/deep-research', requireScope('full', 'read'));
  app.use(createDeepResearchRouter());
  app.use(createAskRouter());
  // /v1/agent — full or read only (router uses relative paths)
  app.use('/v1/agent', requireScope('full', 'read'), createAgentRouter());
  // /v1/do — full only (router uses relative paths; admin-level operation)
  app.use('/v1/do', requireScope('full'), createDoRouter());
  app.use(createYouTubeRouter());
  app.use(createTranscriptExportRouter());
  app.use(createMcpRouter(authStore, pool));

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        type: 'not_found',
        message: 'Not found',
        docs: 'https://webpeel.dev/docs/api-reference',
      },
      requestId: req.requestId,
    });
  });

  // Sentry error middleware should run before the generic error handler.
  if (sentry.errorHandler) {
    app.use(sentry.errorHandler);
  }

  // Global error response normalizer — ensures ALL errors use the same structured shape.
  // Catches errors thrown via next(err) that may have a flat format {error: string, message: string}.
  // Must run before the generic error handler below.
  app.use((err: any, req: Request, res: Response, next: NextFunction): void => {
    // Skip if error is already in structured format (has error.type or error.message as object)
    if (err && typeof err.error === 'object' && err.error !== null) {
      return next(err);
    }
    // Skip standard Error objects (handled by the generic error handler with Playwright sanitization)
    if (err instanceof Error && !err.hasOwnProperty('statusCode') && !err.hasOwnProperty('status')) {
      return next(err);
    }
    const statusCode: number = (err && (err.statusCode || err.status)) || 500;
    if (res.headersSent) return next(err);
    const requestId: string = req.requestId || (req.headers['x-request-id'] as string) || crypto.randomUUID();
    res.status(statusCode).json({
      success: false,
      error: {
        type: (err && (err.type || err.error)) || 'server_error',
        message: (err && err.message) || 'An unexpected error occurred',
        ...((err && err.hint) ? { hint: err.hint } : {}),
        ...((err && err.docs) ? { docs: err.docs } : {}),
      },
      requestId,
    });
  });

  // Error handler - SECURITY: sanitize errors in production to prevent leaking
  // Playwright stack traces, internal paths, or other sensitive details.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    log.error('Unhandled error', { message: err.message, stack: err.stack }); // Log full error server-side
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
  registerPremiumHooks?.();

  // Inject Redis into the domain extractor cache for cross-pod cache sharing.
  // When REDIS_URL is set (multi-pod k8s deployments), all pods share one cache
  // so the first pod to fetch a URL populates it for all others.
  if (process.env.REDIS_URL) {
    // @ts-ignore — ioredis CJS/ESM interop
    import('ioredis').then((IoRedisModule: any) => {
      const IoRedis = IoRedisModule.default ?? IoRedisModule;
      const url = process.env.REDIS_URL!;
      const parsed = new URL(url);
      const redis = new IoRedis({
        host: parsed.hostname,
        port: parseInt(parsed.port || '6379', 10),
        db: parseInt(parsed.pathname?.slice(1) || '0', 10) || 0,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
      });
      setExtractorRedis?.(redis);
      log.info('Redis extractor cache initialized (shared cross-pod cache active)');
    }).catch((err: Error) => {
      log.warn('Failed to init Redis extractor cache (in-memory only)', { error: err.message });
    });
  }

  // Pre-warm browser resources in the background to reduce first-request latency.
  void warmup().catch((error) => {
    log.warn('Browser warmup failed', { error: error instanceof Error ? error.message : String(error) });
  });

  // Build a dedicated pool for the cache warmer (separate from the app pool inside createApp)
  const warmerPool = process.env.DATABASE_URL
    ? new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
        max: 2, // small pool — warmer only needs occasional queries
      })
    : null;

  const server = app.listen(port, () => {
    log.info(`WebPeel API server listening on port ${port}`);
    log.info(`Health: http://localhost:${port}/health  Fetch: /v1/fetch  Search: /v1/search`);

    // Start cache warmer only when opted-in
    if (process.env.ENABLE_CACHE_WARM === 'true') {
      log.info('Cache warming enabled (ENABLE_CACHE_WARM=true)');
      startCacheWarmer(warmerPool);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    log.info('Shutting down gracefully...');
    server.close(() => {
      log.info('Server closed');
      void cleanupFetcher().finally(() => {
        process.exit(0);
      });
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      log.error('Forced shutdown after timeout');
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
