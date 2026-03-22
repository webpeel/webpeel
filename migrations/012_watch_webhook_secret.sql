-- WebPeel Watch — Add webhook_secret column for HMAC-SHA256 signing
-- Migration 012: adds optional webhook_secret to the watches table
--
-- When set, WebPeel will sign webhook deliveries with HMAC-SHA256 and include:
--   X-WebPeel-Signature: sha256=<hex>
--   X-WebPeel-Timestamp: <unix-ms>
--
-- Recipients verify:
--   const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
--   if (receivedSignature !== `sha256=${expected}`) reject();

ALTER TABLE watches
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
