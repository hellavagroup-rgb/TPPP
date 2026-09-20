ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS registration_payment_failure_code text;