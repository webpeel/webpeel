-- WebPeel Watch - Persistent URL monitoring with change detection
-- Migration 007: watches table

CREATE TABLE IF NOT EXISTS watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  url TEXT NOT NULL,
  webhook_url TEXT,
  check_interval_minutes INTEGER DEFAULT 60,
  selector TEXT,  -- optional CSS selector to watch specific element
  last_fingerprint TEXT,
  last_checked_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  change_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',  -- active, paused, error
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watches_account ON watches(account_id);
CREATE INDEX IF NOT EXISTS idx_watches_status ON watches(status);
CREATE INDEX IF NOT EXISTS idx_watches_next_check ON watches(status, last_checked_at);
