/**
 * Job queue for async operations
 *
 * Factory creates PostgreSQL-backed queue in production or in-memory queue for local dev.
 * Tracks crawl, batch scrape, and extraction jobs with progress updates.
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
/**
 * Job queue interface - implemented by both in-memory and PostgreSQL queues
 */
export interface IJobQueue {
    createJob(type: Job['type'], webhook?: WebhookConfig): Job | Promise<Job>;
    getJob(id: string): Job | null | Promise<Job | null>;
    updateJob(id: string, update: Partial<Job>): void | Promise<void>;
    cancelJob(id: string): boolean | Promise<boolean>;
    listJobs(options?: {
        type?: string;
        status?: string;
        limit?: number;
    }): Job[] | Promise<Job[]>;
    destroy(): void;
}
/**
 * In-memory job queue for local development
 */
export declare class InMemoryJobQueue implements IJobQueue {
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
/**
 * Create job queue based on environment
 * - Uses PostgreSQL if DATABASE_URL is set
 * - Falls back to in-memory for local development
 */
export declare function createJobQueue(): IJobQueue;
export declare const jobQueue: InMemoryJobQueue;
//# sourceMappingURL=job-queue.d.ts.map