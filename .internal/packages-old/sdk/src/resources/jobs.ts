// ============================================================
// @webpeel/sdk — Jobs Resource
// ============================================================

import type { JobResult, JobListParams, JobListResult } from '../types.js';
import type { RequestCallOptions } from './base.js';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 300_000; // 5 minutes

export class JobsResource {
  constructor(private readonly _request: <T>(path: string, opts?: RequestCallOptions) => Promise<T>) {}

  /**
   * Get the current status and result of an async job by its ID.
   *
   * @example
   * const job = await client.jobs.get('job_abc123');
   * console.log(job.status); // "pending" | "running" | "completed" | "failed"
   */
  async get(jobId: string): Promise<JobResult> {
    return this._request<JobResult>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * Cancel a running async job.
   *
   * Returns the final job state after cancellation is acknowledged.
   *
   * @example
   * const cancelled = await client.jobs.cancel('job_abc123');
   * console.log(cancelled.status); // "cancelled"
   */
  async cancel(jobId: string): Promise<JobResult> {
    return this._request<JobResult>(`/v1/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * List async jobs, optionally filtered by status.
   *
   * @example
   * const { jobs } = await client.jobs.list({ status: 'completed', limit: 20 });
   * jobs.forEach(j => console.log(j.jobId, j.status));
   */
  async list(params: JobListParams = {}): Promise<JobListResult> {
    const { signal, timeout, ...rest } = params;
    const query = buildJobListQuery(rest);
    const path = query ? `/v1/jobs?${query}` : '/v1/jobs';
    return this._request<JobListResult>(path, { signal, timeout });
  }

  /**
   * Poll a job until it reaches a terminal state (`completed` or `failed`),
   * then return the final `JobResult`.
   *
   * Throws an error if the job fails or if `maxWaitMs` elapses before completion.
   *
   * @param jobId - The job ID to wait for.
   * @param pollIntervalMs - How often to poll in milliseconds. Default: 2000.
   * @param maxWaitMs - Maximum total wait time in milliseconds. Default: 300000 (5 min).
   *
   * @example
   * const result = await client.jobs.waitForCompletion('job_abc123');
   * console.log(result.output);
   */
  async waitForCompletion(
    jobId: string,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
    maxWaitMs: number = DEFAULT_MAX_WAIT_MS,
  ): Promise<JobResult> {
    const deadline = Date.now() + maxWaitMs;

    while (true) {
      const job = await this.get(jobId);

      if (job.status === 'completed') {
        return job;
      }

      if (job.status === 'failed') {
        const msg = job.error ?? `Job ${jobId} failed`;
        throw new Error(msg);
      }

      if (job.status === 'cancelled') {
        throw new Error(`Job ${jobId} was cancelled`);
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for job ${jobId} after ${maxWaitMs}ms. Last status: ${job.status}`,
        );
      }

      await sleep(pollIntervalMs);
    }
  }
}

function buildJobListQuery(params: Omit<JobListParams, 'signal' | 'timeout'>): string {
  const p = new URLSearchParams();
  if (params.status) p.set('status', params.status);
  if (params.limit !== undefined) p.set('limit', String(params.limit));
  if (params.offset !== undefined) p.set('offset', String(params.offset));
  return p.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
