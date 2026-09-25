ALTER TABLE form_delivery_attempts
  ADD COLUMN IF NOT EXISTS alert_claimed_at timestamp,
  ADD COLUMN IF NOT EXISTS alerted_at timestamp;