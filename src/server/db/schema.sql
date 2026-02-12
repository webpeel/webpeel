-- WebPeel PostgreSQL Schema for Neon
-- Designed for production hosting with VoltBee integration

-- Accounts table (users/organizations)
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  
  -- Billing
  stripe_customer_id VARCHAR(255) UNIQUE,
  stripe_subscription_id VARCHAR(255),
  tier VARCHAR(50) NOT NULL DEFAULT 'free',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_stripe_customer ON accounts(stripe_customer_id);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  
  -- Key details
  key VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  tier VARCHAR(50) NOT NULL DEFAULT 'free',
  
  -- Rate limiting
  rate_limit INTEGER NOT NULL DEFAULT 10,
  
  -- Status
  active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);

-- Usage logs table (for analytics and billing)
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  
  -- Request details
  endpoint VARCHAR(50) NOT NULL,
  url TEXT,
  method VARCHAR(10) NOT NULL DEFAULT 'simple',
  
  -- Usage metrics
  credits INTEGER NOT NULL DEFAULT 1,
  processing_time_ms INTEGER,
  tokens INTEGER,
  
  -- Response
  status_code INTEGER,
  error TEXT,
  
  -- Request metadata
  ip_address INET,
  user_agent TEXT,
  
  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_account_created ON usage_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_api_key_created ON usage_logs(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for accounts table
CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Sample data for development
INSERT INTO accounts (email, name, tier)
VALUES 
  ('demo@webpeel.dev', 'Demo Account', 'pro')
ON CONFLICT (email) DO NOTHING;

INSERT INTO api_keys (account_id, key, name, tier, rate_limit)
SELECT 
  id,
  'demo_key_12345',
  'Demo API Key',
  'pro',
  300
FROM accounts
WHERE email = 'demo@webpeel.dev'
ON CONFLICT (key) DO NOTHING;

-- Views for analytics
CREATE OR REPLACE VIEW daily_usage AS
SELECT 
  account_id,
  DATE(created_at) as date,
  endpoint,
  COUNT(*) as requests,
  SUM(credits) as total_credits,
  AVG(processing_time_ms) as avg_processing_time,
  SUM(tokens) as total_tokens
FROM usage_logs
GROUP BY account_id, DATE(created_at), endpoint
ORDER BY date DESC;

CREATE OR REPLACE VIEW account_stats AS
SELECT 
  a.id,
  a.email,
  a.tier,
  COUNT(DISTINCT k.id) as api_keys_count,
  COUNT(DISTINCT u.id) as total_requests,
  SUM(u.credits) as total_credits,
  MAX(u.created_at) as last_request_at
FROM accounts a
LEFT JOIN api_keys k ON k.account_id = a.id
LEFT JOIN usage_logs u ON u.account_id = a.id
GROUP BY a.id, a.email, a.tier;
