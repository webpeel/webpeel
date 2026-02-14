/**
 * Firecrawl API Compatibility Layer
 *
 * Drop-in replacement for Firecrawl's API - users can switch by ONLY changing the base URL.
 * This is our killer acquisition feature.
 *
 * Implements Firecrawl endpoints:
 * - POST /v1/scrape
 * - POST /v1/crawl
 * - GET /v1/crawl/:id
 * - POST /v1/search
 * - POST /v1/map
 */
import { Router } from 'express';
import type { IJobQueue } from '../job-queue.js';
export declare function createCompatRouter(jobQueue: IJobQueue): Router;
//# sourceMappingURL=compat.d.ts.map