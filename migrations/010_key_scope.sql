-- Migration 010: Add API key scope/permission support
-- Adds scope column to api_keys to support read-only vs full-access keys

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'full';
-- Valid scopes: 'full', 'read', 'restricted'
-- 'full'       = all endpoints (default, backward compatible)
-- 'read'       = read/fetch operations only
-- 'restricted' = /v1/scrape only (for limited sharing)

COMMENT ON COLUMN api_keys.scope IS 'Key permission scope: full, read, or restricted';

-- Index for scope filtering (useful for admin queries)
CREATE INDEX IF NOT EXISTS idx_api_keys_scope ON api_keys(scope);
