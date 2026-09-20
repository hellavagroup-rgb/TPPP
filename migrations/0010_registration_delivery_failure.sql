ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS registration_email_failed_at timestamp,
  ADD COLUMN IF NOT EXISTS registration_email_failure_reason text,
  ADD COLUMN IF NOT EXISTS registration_payment_failed_at timestamp,
  ADD COLUMN IF NOT EXISTS registration_payment_failure_reason text;
