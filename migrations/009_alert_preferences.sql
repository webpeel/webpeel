-- Migration 009: Add usage alert preferences to users table
-- Enables real email alerts when usage crosses threshold

ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_threshold INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_email TEXT DEFAULT NULL;

-- Index for efficient alert checks
CREATE INDEX IF NOT EXISTS idx_users_alert_threshold ON users(alert_threshold) WHERE alert_threshold IS NOT NULL;
