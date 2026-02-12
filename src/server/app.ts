/**
 * WebPeel API Server
 * Express-based REST API for hosted deployments
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { InMemoryAuthStore } from './auth-store.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimitMiddleware, RateLimiter } from './middleware/rate-limit.js';
import { createHealthRouter } from './routes/health.js';
import { createFetchRouter } from './routes/fetch.js';
import { createSearchRouter } from './routes/search.js';

export interface ServerConfig {
  port?: number;
  corsOrigins?: string[];
  rateLimitWindowMs?: number;
}

export function createApp(config: ServerConfig = {}): Express {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(cors({
    origin: config.corsOrigins || '*',
    credentials: true,
  }));

  // Trust proxy (for rate limiting by IP in production)
  app.set('trust proxy', 1);

  // Auth store (in-memory for now, swap to PostgreSQL later)
  const authStore = new InMemoryAuthStore();

  // Rate limiter
  const rateLimiter = new RateLimiter(config.rateLimitWindowMs || 60000);

  // Clean up rate limiter every 5 minutes
  setInterval(() => {
    rateLimiter.cleanup();
  }, 5 * 60 * 1000);

  // Apply auth middleware globally
  app.use(createAuthMiddleware(authStore));

  // Apply rate limiting middleware globally
  app.use(createRateLimitMiddleware(rateLimiter));

  // Routes
  app.use(createHealthRouter());
  app.use(createFetchRouter(authStore));
  app.use(createSearchRouter(authStore));

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'not_found',
      message: `Route not found: ${req.method} ${req.path}`,
    });
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: err.message || 'An unexpected error occurred',
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
