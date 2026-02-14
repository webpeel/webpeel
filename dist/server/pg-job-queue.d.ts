/**
 * PostgreSQL-backed job queue for production deployments
 * Uses same Pool pattern as pg-auth-store.ts
 */
import type { Job, WebhookConfig } from './job-queue.js';
export declare class PostgresJobQueue {
    private pool;
    private cleanupInterval;
    constructor(connectionString?: string);
    /**
     * Create jobs table if it doesn't exist
     */
    private initTable;
    /**
     * Create a new job
     */
    createJob(type: Job['type'], webhook?: WebhookConfig): Promise<Job>;
    /**
     * Get a job by ID
     */
    getJob(id: string): Promise<Job | null>;
    /**
     * Update a job
     */
    updateJob(id: string, update: Partial<Job>): Promise<void>;
    /**
     * Cancel a job
     */
    cancelJob(id: string): Promise<boolean>;
    /**
     * List jobs with optional filters
     */
    listJobs(options?: {
        type?: string;
        status?: string;
        limit?: number;
    }): Promise<Job[]>;
    /**
     * Remove expired jobs (called periodically)
     */
    private cleanExpired;
    /**
     * Remove old completed/failed jobs (>7 days)
     */
    private cleanupOldJobs;
    /**
     * Map database row to Job object
     */
    private mapRowToJob;
    /**
     * Clean up interval on shutdown
     */
    destroy(): void;
    /**
     * Close the database pool
     */
    close(): Promise<void>;
}
//# sourceMappingURL=pg-job-queue.d.ts.map