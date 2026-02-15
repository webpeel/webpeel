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
import { runAgent } from '../../core/agent.js';
import { jobQueue } from '../job-queue.js';
import { sendWebhook } from './webhooks.js';
const VALID_DEPTHS = ['basic', 'thorough'];
const VALID_TOPICS = ['general', 'news', 'technical', 'academic'];
export function createAgentRouter() {
    const router = Router();
    /**
     * POST /v1/agent - Run autonomous web research (synchronous or SSE streaming)
     */
    router.post('/v1/agent', async (req, res) => {
        try {
            const { prompt, urls, schema, outputSchema, llmApiKey, llmApiBase, llmModel, maxPages, maxSources, maxCredits, depth, topic, stream, } = req.body;
            // Validate required parameters
            if (!prompt || typeof prompt !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "prompt" parameter',
                });
                return;
            }
            if (!llmApiKey || typeof llmApiKey !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "llmApiKey" parameter (BYOK required)',
                });
                return;
            }
            // Validate optional parameters
            if (urls && !Array.isArray(urls)) {
                res.status(400).json({ error: 'invalid_request', message: '"urls" must be an array' });
                return;
            }
            if (depth && !VALID_DEPTHS.includes(depth)) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: `"depth" must be one of: ${VALID_DEPTHS.join(', ')}`,
                });
                return;
            }
            if (topic && !VALID_TOPICS.includes(topic)) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: `"topic" must be one of: ${VALID_TOPICS.join(', ')}`,
                });
                return;
            }
            if (maxSources !== undefined) {
                if (typeof maxSources !== 'number' || maxSources < 1 || maxSources > 20) {
                    res.status(400).json({
                        error: 'invalid_request',
                        message: '"maxSources" must be a number between 1 and 20',
                    });
                    return;
                }
            }
            if (outputSchema !== undefined && (typeof outputSchema !== 'object' || outputSchema === null)) {
                res.status(400).json({
                    error: 'invalid_request',
                    message: '"outputSchema" must be a JSON Schema object',
                });
                return;
            }
            // Build agent options
            const agentOptions = {
                prompt,
                urls,
                schema,
                outputSchema,
                llmApiKey,
                llmApiBase,
                llmModel,
                maxPages,
                maxSources,
                maxCredits,
                depth,
                topic,
            };
            // -----------------------------------------------------------------------
            // SSE Streaming mode
            // -----------------------------------------------------------------------
            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
                res.flushHeaders();
                const sendSSE = (data) => {
                    if (!res.writableEnded) {
                        res.write(`data: ${JSON.stringify(data)}\n\n`);
                    }
                };
                let closed = false;
                req.on('close', () => { closed = true; });
                agentOptions.onEvent = (event) => {
                    if (closed)
                        return;
                    sendSSE(event);
                };
                try {
                    await runAgent(agentOptions);
                    // The 'done' event is already emitted by runAgent via onEvent
                    // End the stream
                    if (!res.writableEnded) {
                        res.end();
                    }
                }
                catch (error) {
                    sendSSE({ type: 'error', message: error.message || 'Agent failed' });
                    if (!res.writableEnded) {
                        res.end();
                    }
                }
                return;
            }
            // -----------------------------------------------------------------------
            // Normal synchronous mode (backward compatible)
            // -----------------------------------------------------------------------
            const result = await runAgent(agentOptions);
            res.json(result);
        }
        catch (error) {
            console.error('Agent error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: error.message || 'Failed to run agent',
            });
        }
    });
    /**
     * POST /v1/agent/async - Run autonomous web research (async with job queue)
     */
    router.post('/v1/agent/async', async (req, res) => {
        try {
            const { prompt, urls, schema, outputSchema, llmApiKey, llmApiBase, llmModel, maxPages, maxSources, maxCredits, depth, topic, webhook, } = req.body;
            // Validate required parameters
            if (!prompt || typeof prompt !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "prompt" parameter',
                });
                return;
            }
            if (!llmApiKey || typeof llmApiKey !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "llmApiKey" parameter (BYOK required)',
                });
                return;
            }
            // Create job (use 'extract' type since agent extracts data)
            const job = jobQueue.createJob('extract', webhook);
            // Start agent in background
            setImmediate(async () => {
                try {
                    // Update job to processing
                    jobQueue.updateJob(job.id, { status: 'processing' });
                    // Send started webhook
                    if (webhook) {
                        await sendWebhook(webhook, 'started', {
                            jobId: job.id,
                            prompt,
                        });
                    }
                    // Build agent options with progress callback
                    const agentOptions = {
                        prompt,
                        urls,
                        schema,
                        outputSchema,
                        llmApiKey,
                        llmApiBase,
                        llmModel,
                        maxPages,
                        maxSources,
                        maxCredits,
                        depth,
                        topic,
                        onProgress: (progress) => {
                            // Update job progress
                            jobQueue.updateJob(job.id, {
                                completed: progress.pagesVisited,
                                creditsUsed: progress.pagesVisited,
                            });
                            // Send progress webhook
                            if (webhook && progress.currentUrl) {
                                sendWebhook(webhook, 'progress', {
                                    jobId: job.id,
                                    status: progress.status,
                                    currentUrl: progress.currentUrl,
                                    pagesVisited: progress.pagesVisited,
                                    message: progress.message,
                                }).catch(() => { }); // Fire and forget
                            }
                        },
                    };
                    // Run agent
                    const result = await runAgent(agentOptions);
                    // Update job with results
                    if (result.success) {
                        jobQueue.updateJob(job.id, {
                            status: 'completed',
                            data: [result], // Wrap in array to match Job type
                            completed: result.pagesVisited,
                            creditsUsed: result.creditsUsed,
                        });
                        // Send completed webhook
                        if (webhook) {
                            await sendWebhook(webhook, 'completed', {
                                jobId: job.id,
                                pagesVisited: result.pagesVisited,
                                creditsUsed: result.creditsUsed,
                            });
                        }
                    }
                    else {
                        // Agent returned failure
                        jobQueue.updateJob(job.id, {
                            status: 'failed',
                            error: result.data?.error || 'Agent failed',
                            data: [result], // Wrap in array to match Job type
                            completed: result.pagesVisited,
                            creditsUsed: result.creditsUsed,
                        });
                        // Send failed webhook
                        if (webhook) {
                            await sendWebhook(webhook, 'failed', {
                                jobId: job.id,
                                error: result.data?.error || 'Agent failed',
                            });
                        }
                    }
                }
                catch (error) {
                    // Update job with error
                    jobQueue.updateJob(job.id, {
                        status: 'failed',
                        error: error.message || 'Unknown error',
                    });
                    // Send failed webhook
                    if (webhook) {
                        await sendWebhook(webhook, 'failed', {
                            jobId: job.id,
                            error: error.message || 'Unknown error',
                        });
                    }
                }
            });
            // Return job ID immediately
            res.status(202).json({
                success: true,
                id: job.id,
                url: `/v1/agent/${job.id}`,
            });
        }
        catch (error) {
            console.error('Agent job creation error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to create agent job',
            });
        }
    });
    /**
     * GET /v1/agent/:id - Get agent job status + results
     */
    router.get('/v1/agent/:id', (req, res) => {
        try {
            const id = req.params.id;
            const job = jobQueue.getJob(id);
            if (!job) {
                res.status(404).json({
                    error: 'not_found',
                    message: 'Job not found',
                });
                return;
            }
            // Return JSON response
            res.json({
                success: true,
                status: job.status,
                completed: job.completed,
                creditsUsed: job.creditsUsed,
                data: job.data,
                error: job.error,
                expiresAt: job.expiresAt,
            });
        }
        catch (error) {
            console.error('Get agent job error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to retrieve job',
            });
        }
    });
    /**
     * DELETE /v1/agent/:id - Cancel agent job
     */
    router.delete('/v1/agent/:id', (req, res) => {
        try {
            const id = req.params.id;
            const cancelled = jobQueue.cancelJob(id);
            if (!cancelled) {
                res.status(404).json({
                    error: 'not_found',
                    message: 'Job not found or cannot be cancelled',
                });
                return;
            }
            res.json({
                success: true,
                message: 'Job cancelled',
            });
        }
        catch (error) {
            console.error('Cancel agent job error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to cancel job',
            });
        }
    });
    return router;
}
//# sourceMappingURL=agent.js.map