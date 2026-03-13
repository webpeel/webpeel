-- Migration 011: Create shared_reads table for short shareable links
-- Enables clean public URLs for fetched content (e.g. /s/abc123xyz)

CREATE TABLE IF NOT EXISTS shared_reads (
  id VARCHAR(12) PRIMARY KEY,           -- short ID like 'abc123xyz' (base64url, 9 chars)
  url TEXT NOT NULL,                    -- original URL that was fetched
  title TEXT,                           -- page title
  content TEXT NOT NULL,               -- markdown content
  tokens INTEGER,                       -- token count
  created_by TEXT REFERENCES users(id), -- user who created the share (UUID string)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  view_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shared_reads_url ON shared_reads(url);
CREATE INDEX IF NOT EXISTS idx_shared_reads_created_by ON shared_reads(created_by);
