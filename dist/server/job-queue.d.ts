/**
 * In-memory job queue for async operations
 *
 * Tracks crawl, batch scrape, and extraction jobs with progress updates
 */
export interface WebhookConfig {
    url: string;
    events: ('started' | 'page' | 'completed' | 'failed')[];
    metadata?: Record<string, any>;
    secret?: string;
}
export interface Job {
    id: string;
    type: 'crawl' | 'batch' | 'extract';
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    total: number;
    completed: number;
    creditsUsed: number;
    data: any[];
    error?: string;
    webhook?: WebhookConfig;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
}
export declare class JobQueue {
    private jobs;
    private cleanupInterval;
    constructor();
    /**
     * Create a new job
     */
    createJob(type: Job['type'], webhook?: WebhookConfig): Job;
    /**
     * Get a job by ID
     */
    getJob(id: string): Job | null;
    /**
     * Update a job
     */
    updateJob(id: string, update: Partial<Job>): void;
    /**
     * Cancel a job
     */
    cancelJob(id: string): boolean;
    /**
     * List jobs with optional filters
     */
    listJobs(options?: {
        type?: string;
        status?: string;
        limit?: number;
    }): Job[];
    /**
     * Remove expired jobs
     */
    cleanExpired(): void;
    /**
     * Clean up interval on shutdown
     */
    destroy(): void;
}
export declare const jobQueue: JobQueue;
//# sourceMappingURL=job-queue.d.ts.map