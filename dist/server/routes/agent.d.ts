/**
 * Agent API - autonomous web research endpoint
 *
 * Supports:
 * - POST /v1/agent           — synchronous (default) or SSE streaming (stream: true)
 * - POST /v1/agent/async     — async with job queue
 * - GET  /v1/agent/:id       — job status
 * - DELETE /v1/agent/:id     — cancel job
 */
import { Router } from 'express';
export declare function createAgentRouter(): Router;
//# sourceMappingURL=agent.d.ts.map