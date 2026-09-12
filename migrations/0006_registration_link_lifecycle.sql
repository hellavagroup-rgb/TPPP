ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS registration_email_pending_token text;