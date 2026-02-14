/**
 * Async jobs API - crawl endpoints with SSE support
 */
import { Router } from 'express';
import { crawl } from '../../index.js';
import { sendWebhook } from './webhooks.js';
export function createJobsRouter(jobQueue) {
    const router = Router();
    /**
     * POST /v1/crawl - Start async crawl job
     */
    router.post('/v1/crawl', async (req, res) => {
        try {
            const { url, limit, maxDepth, scrapeOptions, webhook, location, languages } = req.body;
            // Validate required parameters
            if (!url || typeof url !== 'string') {
                res.status(400).json({
                    error: 'invalid_request',
                    message: 'Missing or invalid "url" parameter',
                });
                return;
            }
            // Validate URL
            try {
                new URL(url);
            }
            catch {
                res.status(400).json({
                    error: 'invalid_url',
                    message: 'Invalid URL format',
                });
                return;
            }
            // Create job
            const job = await jobQueue.createJob('crawl', webhook);
            // Start crawl in background
            setImmediate(async () => {
                try {
                    // Update job to processing
                    jobQueue.updateJob(job.id, { status: 'processing' });
                    // Send started webhook
                    if (webhook) {
                        await sendWebhook(webhook, 'started', {
                            jobId: job.id,
                            url,
                        });
                    }
                    // Build crawl options
                    const crawlOptions = {
                        maxPages: limit || 100,
                        maxDepth: maxDepth || 3,
                        onProgress: (progress) => {
                            // Update job progress
                            const total = progress.crawled + progress.queued;
                            jobQueue.updateJob(job.id, {
                                total,
                                completed: progress.crawled,
                                creditsUsed: progress.crawled,
                            });
                            // Send page webhook
                            if (webhook && progress.currentUrl) {
                                sendWebhook(webhook, 'page', {
                                    jobId: job.id,
                                    url: progress.currentUrl,
                                    completed: progress.crawled,
                                    total,
                                }).catch(() => { }); // Fire and forget
                            }
                        },
                        // Spread existing scrapeOptions
                        ...scrapeOptions,
                        // Add location support if provided (CrawlOptions extends PeelOptions)
                        location: location || languages ? {
                            country: location,
                            languages: Array.isArray(languages) ? languages : (languages ? [languages] : undefined),
                        } : undefined,
                    };
                    // Run crawl
                    const results = await crawl(url, crawlOptions);
                    // Update job with results
                    jobQueue.updateJob(job.id, {
                        status: 'completed',
                        data: results,
                        total: results.length,
                        completed: results.length,
                        creditsUsed: results.length,
                    });
                    // Send completed webhook
                    if (webhook) {
                        await sendWebhook(webhook, 'completed', {
                            jobId: job.id,
                            total: results.length,
                        });
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
                url: `/v1/crawl/${job.id}`,
            });
        }
        catch (error) {
            console.error('Crawl job creation error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to create crawl job',
            });
        }
    });
    /**
     * GET /v1/crawl/:id - Get crawl job status + results (with SSE support)
     */
    router.get('/v1/crawl/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const job = await jobQueue.getJob(id);
            if (!job) {
                res.status(404).json({
                    error: 'not_found',
                    message: 'Job not found',
                });
                return;
            }
            // Check for SSE request
            const acceptHeader = req.get('Accept');
            const isSSE = acceptHeader?.includes('text/event-stream');
            if (isSSE) {
                // Set SSE headers
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                // Send initial event
                const sendEvent = (data) => {
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                };
                sendEvent({
                    event: 'status',
                    ...job,
                });
                // Poll for updates every second
                const interval = setInterval(async () => {
                    const updatedJob = await jobQueue.getJob(id);
                    if (!updatedJob) {
                        clearInterval(interval);
                        res.end();
                        return;
                    }
                    sendEvent({
                        event: 'status',
                        ...updatedJob,
                    });
                    // End stream if job is complete
                    if (updatedJob.status === 'completed' || updatedJob.status === 'failed' || updatedJob.status === 'cancelled') {
                        clearInterval(interval);
                        res.end();
                    }
                }, 1000);
                // Clean up on client disconnect
                req.on('close', () => {
                    clearInterval(interval);
                });
            }
            else {
                // Return JSON response
                res.json({
                    success: true,
                    status: job.status,
                    progress: job.progress,
                    total: job.total,
                    completed: job.completed,
                    creditsUsed: job.creditsUsed,
                    data: job.data,
                    error: job.error,
                    expiresAt: job.expiresAt,
                });
            }
        }
        catch (error) {
            console.error('Get crawl job error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to retrieve job',
            });
        }
    });
    /**
     * DELETE /v1/crawl/:id - Cancel crawl job
     */
    router.delete('/v1/crawl/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const cancelled = await jobQueue.cancelJob(id);
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
            console.error('Cancel crawl job error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to cancel job',
            });
        }
    });
    /**
     * GET /v1/jobs - List all jobs
     */
    router.get('/v1/jobs', async (req, res) => {
        try {
            const { type, status, limit } = req.query;
            const jobs = await jobQueue.listJobs({
                type: type,
                status: status,
                limit: limit ? parseInt(limit, 10) : 50,
            });
            res.json({
                success: true,
                count: jobs.length,
                jobs,
            });
        }
        catch (error) {
            console.error('List jobs error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to list jobs',
            });
        }
    });
    return router;
}
//# sourceMappingURL=jobs.js.map