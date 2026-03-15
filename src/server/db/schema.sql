-- WebPeel PostgreSQL Schema Reference
-- ====================================
--
-- NOTE: This file is NOT used in production. The actual schema is managed
-- by the application code (pg-auth-store.ts, pg-job-queue.ts) which creates
-- tables on startup with proper migrations.
--
-- Production tables use:
--   - users (not accounts)
--   - api_keys with key_hash + key_prefix (never stores plaintext keys)
--   - oauth_accounts for GitHub/Google OAuth
--   - weekly_usage, burst_usage for rate limiting
--   - jobs for async job queue
--
-- See src/server/pg-auth-store.ts and src/server/pg-job-queue.ts for the
-- authoritative schema definitions.
--
-- This file is kept as a quick reference only. Do NOT run it against
-- production databases.

-- Users table (simplified reference)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  name VARCHAR(255),
  avatar_url TEXT,
  tier VARCHAR(50) NOT NULL DEFAULT 'free',
  weekly_limit INTEGER NOT NULL DEFAULT 500,
  burst_limit INTEGER NOT NULL DEFAULT 50,
  rate_limit INTEGER NOT NULL DEFAULT 10,
  stripe_customer_id VARCHAR(255) UNIQUE,
  stripe_subscription_id VARCHAR(255),
  extra_usage_enabled BOOLEAN DEFAULT FALSE,
  extra_usage_balance NUMERIC(10,2) DEFAULT 0,
  extra_usage_spent NUMERIC(10,2) DEFAULT 0,
  extra_usage_spending_limit NUMERIC(10,2) DEFAULT 50,
  auto_reload_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- API keys table (stores hashed keys only)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) UNIQUE NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  name VARCHAR(255) DEFAULT 'Default',
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth accounts
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);

-- Jobs table (async crawl/batch/extract)
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
  owner_id TEXT,
  webhook_url TEXT,
  webhook_events JSONB,
  webhook_metadata JSONB,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Refresh tokens table (for JWT refresh flow)
-- Access tokens: 1h expiry. Refresh tokens: 30d expiry, stored here for revocation.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,  -- the jti (JWT ID claim)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
