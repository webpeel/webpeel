-- Migration 003: OAuth Accounts
-- Add OAuth authentication support for GitHub and Google login

-- OAuth accounts table
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_accounts(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

-- Make password_hash nullable (OAuth users don't have passwords)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Add name and avatar columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
