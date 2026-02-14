/**
 * In-memory job queue for async operations
 * 
 * Tracks crawl, batch scrape, and extraction jobs with progress updates
 */

import { randomUUID } from 'crypto';

export interface WebhookConfig {
  url: string;
  events: ('started' | 'page' | 'completed' | 'failed')[];
  metadata?: Record<string, any>;
  secret?: string; // For HMAC-SHA256 signing
}

export interface Job {
  id: string;
  type: 'crawl' | 'batch' | 'extract';
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  total: number; // Total items
  completed: number; // Completed items
  creditsUsed: number;
  data: any[]; // Results array
  error?: string;
  webhook?: WebhookConfig;
  createdAt: string;
  updatedAt: string;
  expiresAt: string; // 24h after completion
}

export class JobQueue {
  private jobs: Map<string, Job> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean expired jobs every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanExpired();
    }, 60 * 60 * 1000);
  }

  /**
   * Create a new job
   */
  createJob(type: Job['type'], webhook?: WebhookConfig): Job {
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      type,
      status: 'queued',
      progress: 0,
      total: 0,
      completed: 0,
      creditsUsed: 0,
      data: [],
      webhook,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(), // 25h from now (updated on completion)
    };

    this.jobs.set(job.id, job);
    return job;
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): Job | null {
    return this.jobs.get(id) || null;
  }

  /**
   * Update a job
   */
  updateJob(id: string, update: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (!job) return;

    Object.assign(job, update, {
      updatedAt: new Date().toISOString(),
    });

    // When job completes/fails, set expiration to 24h from now
    if (update.status === 'completed' || update.status === 'failed') {
      job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }

    // Update progress percentage
    if (job.total > 0) {
      job.progress = Math.round((job.completed / job.total) * 100);
    }

    this.jobs.set(id, job);
  }

  /**
   * Cancel a job
   */
  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    
    // Can only cancel queued or processing jobs
    if (job.status !== 'queued' && job.status !== 'processing') {
      return false;
    }

    this.updateJob(id, {
      status: 'cancelled',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    return true;
  }

  /**
   * List jobs with optional filters
   */
  listJobs(options?: { 
    type?: string; 
    status?: string; 
    limit?: number;
  }): Job[] {
    let jobs = Array.from(this.jobs.values());

    if (options?.type) {
      jobs = jobs.filter(j => j.type === options.type);
    }

    if (options?.status) {
      jobs = jobs.filter(j => j.status === options.status);
    }

    // Sort by creation time (newest first)
    jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options?.limit) {
      jobs = jobs.slice(0, options.limit);
    }

    return jobs;
  }

  /**
   * Remove expired jobs
   */
  cleanExpired(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (new Date(job.expiresAt).getTime() < now) {
        this.jobs.delete(id);
      }
    }
  }

  /**
   * Clean up interval on shutdown
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

// Global job queue instance
export const jobQueue = new JobQueue();
