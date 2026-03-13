-- Add scope column to api_keys table
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'full';
-- Valid scopes: 'full', 'read', 'restricted'
-- 'full' = all endpoints
-- 'read' = only GET endpoints + POST /v1/scrape + POST /v1/search (read operations)
-- 'restricted' = only /v1/scrape with rate limits (for sharing)

COMMENT ON COLUMN api_keys.scope IS 'Key permission scope: full, read, or restricted';
