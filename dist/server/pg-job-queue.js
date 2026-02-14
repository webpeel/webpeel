/**
 * PostgreSQL-backed job queue for production deployments
 * Uses same Pool pattern as pg-auth-store.ts
 */
import pg from 'pg';
import { randomUUID } from 'crypto';
const { Pool } = pg;
export class PostgresJobQueue {
    pool;
    cleanupInterval;
    constructor(connectionString) {
        const dbUrl = connectionString || process.env.DATABASE_URL;
        if (!dbUrl) {
            throw new Error('DATABASE_URL environment variable is required for PostgresJobQueue');
        }
        this.pool = new Pool({
            connectionString: dbUrl,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });
        // Initialize table
        this.initTable().catch(err => {
            console.error('Failed to initialize jobs table:', err);
        });
        // Clean up old completed/failed jobs every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldJobs().catch(err => {
                console.error('Failed to cleanup old jobs:', err);
            });
        }, 60 * 60 * 1000);
    }
    /**
     * Create jobs table if it doesn't exist
     */
    async initTable() {
        try {
            await this.pool.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          progress INTEGER DEFAULT 0,
          data JSONB,
          error TEXT,
          total INTEGER DEFAULT 0,
          completed INTEGER DEFAULT 0,
          credits_used INTEGER DEFAULT 0,
          webhook_url TEXT,
          webhook_events JSONB,
          webhook_metadata JSONB,
          webhook_secret TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ
        )
      `);
            // Add index on status and created_at for faster queries
            await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_jobs_status_created 
        ON jobs(status, created_at DESC)
      `);
            // Add index on type for filtering
            await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_jobs_type 
        ON jobs(type)
      `);
            // Add index on expires_at for cleanup
            await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_jobs_expires 
        ON jobs(expires_at)
      `);
        }
        catch (error) {
            console.error('Failed to create jobs table:', error);
            throw error;
        }
    }
    /**
     * Create a new job
     */
    async createJob(type, webhook) {
        const id = randomUUID();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25h from now
        try {
            await this.pool.query(`INSERT INTO jobs (
          id, type, status, progress, data, total, completed, credits_used,
          webhook_url, webhook_events, webhook_metadata, webhook_secret,
          created_at, updated_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, [
                id,
                type,
                'queued',
                0,
                JSON.stringify([]),
                0,
                0,
                0,
                webhook?.url || null,
                webhook?.events ? JSON.stringify(webhook.events) : null,
                webhook?.metadata ? JSON.stringify(webhook.metadata) : null,
                webhook?.secret || null,
                now,
                now,
                expiresAt,
            ]);
            return {
                id,
                type,
                status: 'queued',
                progress: 0,
                total: 0,
                completed: 0,
                creditsUsed: 0,
                data: [],
                webhook,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                expiresAt: expiresAt.toISOString(),
            };
        }
        catch (error) {
            console.error('Failed to create job:', error);
            throw error;
        }
    }
    /**
     * Get a job by ID
     */
    async getJob(id) {
        try {
            const result = await this.pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
            if (result.rows.length === 0) {
                return null;
            }
            return this.mapRowToJob(result.rows[0]);
        }
        catch (error) {
            console.error('Failed to get job:', error);
            return null;
        }
    }
    /**
     * Update a job
     */
    async updateJob(id, update) {
        try {
            const job = await this.getJob(id);
            if (!job)
                return;
            const updates = [];
            const values = [];
            let paramIndex = 1;
            // Map Job fields to database columns
            if (update.status !== undefined) {
                updates.push(`status = $${paramIndex++}`);
                values.push(update.status);
            }
            if (update.progress !== undefined) {
                updates.push(`progress = $${paramIndex++}`);
                values.push(update.progress);
            }
            if (update.total !== undefined) {
                updates.push(`total = $${paramIndex++}`);
                values.push(update.total);
            }
            if (update.completed !== undefined) {
                updates.push(`completed = $${paramIndex++}`);
                values.push(update.completed);
            }
            if (update.creditsUsed !== undefined) {
                updates.push(`credits_used = $${paramIndex++}`);
                values.push(update.creditsUsed);
            }
            if (update.data !== undefined) {
                updates.push(`data = $${paramIndex++}`);
                values.push(JSON.stringify(update.data));
            }
            if (update.error !== undefined) {
                updates.push(`error = $${paramIndex++}`);
                values.push(update.error);
            }
            // Always update updated_at
            updates.push(`updated_at = $${paramIndex++}`);
            values.push(new Date());
            // When job completes/fails, set expiration to 24h from now
            if (update.status === 'completed' || update.status === 'failed' || update.status === 'cancelled') {
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                updates.push(`expires_at = $${paramIndex++}`);
                values.push(expiresAt);
            }
            // Calculate progress percentage if total and completed are provided
            const newTotal = update.total ?? job.total;
            const newCompleted = update.completed ?? job.completed;
            if (newTotal > 0) {
                const progress = Math.round((newCompleted / newTotal) * 100);
                if (!updates.some(u => u.startsWith('progress'))) {
                    updates.push(`progress = $${paramIndex++}`);
                    values.push(progress);
                }
            }
            if (updates.length === 0)
                return;
            // Add job ID as the last parameter
            values.push(id);
            const sql = `UPDATE jobs SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
            await this.pool.query(sql, values);
        }
        catch (error) {
            console.error('Failed to update job:', error);
            throw error;
        }
    }
    /**
     * Cancel a job
     */
    async cancelJob(id) {
        try {
            const job = await this.getJob(id);
            if (!job)
                return false;
            // Can only cancel queued or processing jobs
            if (job.status !== 'queued' && job.status !== 'processing') {
                return false;
            }
            await this.updateJob(id, {
                status: 'cancelled',
            });
            return true;
        }
        catch (error) {
            console.error('Failed to cancel job:', error);
            return false;
        }
    }
    /**
     * List jobs with optional filters
     */
    async listJobs(options) {
        try {
            const conditions = [];
            const values = [];
            let paramIndex = 1;
            if (options?.type) {
                conditions.push(`type = $${paramIndex++}`);
                values.push(options.type);
            }
            if (options?.status) {
                conditions.push(`status = $${paramIndex++}`);
                values.push(options.status);
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const limit = options?.limit || 50;
            const sql = `
        SELECT * FROM jobs 
        ${whereClause}
        ORDER BY created_at DESC 
        LIMIT $${paramIndex}
      `;
            values.push(limit);
            const result = await this.pool.query(sql, values);
            return result.rows.map(row => this.mapRowToJob(row));
        }
        catch (error) {
            console.error('Failed to list jobs:', error);
            return [];
        }
    }
    /**
     * Remove expired jobs (called periodically)
     */
    async cleanExpired() {
        try {
            await this.pool.query(`DELETE FROM jobs WHERE expires_at < NOW()`);
        }
        catch (error) {
            console.error('Failed to clean expired jobs:', error);
        }
    }
    /**
     * Remove old completed/failed jobs (>7 days)
     */
    async cleanupOldJobs() {
        try {
            // Remove expired jobs
            await this.cleanExpired();
            // Remove completed/failed jobs older than 7 days
            await this.pool.query(`DELETE FROM jobs 
        WHERE (status = 'completed' OR status = 'failed' OR status = 'cancelled')
        AND updated_at < NOW() - INTERVAL '7 days'`);
        }
        catch (error) {
            console.error('Failed to cleanup old jobs:', error);
        }
    }
    /**
     * Map database row to Job object
     */
    mapRowToJob(row) {
        const webhook = row.webhook_url
            ? {
                url: row.webhook_url,
                events: row.webhook_events || [],
                metadata: row.webhook_metadata || undefined,
                secret: row.webhook_secret || undefined,
            }
            : undefined;
        return {
            id: row.id,
            type: row.type,
            status: row.status,
            progress: row.progress || 0,
            total: row.total || 0,
            completed: row.completed || 0,
            creditsUsed: row.credits_used || 0,
            data: row.data || [],
            error: row.error || undefined,
            webhook,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
            expiresAt: row.expires_at.toISOString(),
        };
    }
    /**
     * Clean up interval on shutdown
     */
    destroy() {
        clearInterval(this.cleanupInterval);
    }
    /**
     * Close the database pool
     */
    async close() {
        this.destroy();
        await this.pool.end();
    }
}
//# sourceMappingURL=pg-job-queue.js.map