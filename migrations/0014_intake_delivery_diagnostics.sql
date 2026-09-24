ALTER TABLE tenants ADD COLUMN IF NOT EXISTS intake_delivery_diagnostics_enabled boolean DEFAULT false;
ALTER TABLE form_deliveries ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE form_deliveries ADD COLUMN IF NOT EXISTS provider_event text;
CREATE TABLE IF NOT EXISTS form_delivery_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  delivery_id varchar NOT NULL REFERENCES form_deliveries(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  provider_message_id text,
  provider_event text,
  outcome text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS form_delivery_attempt_key_unique ON form_delivery_attempts(tenant_id, idempotency_key);
-- Opt in the established CY&A workflow configuration only; other practices remain off.
UPDATE tenants SET intake_delivery_diagnostics_enabled = true
WHERE registration_form_enabled = true AND multi_clinician_allocation_enabled = true
  AND booking_confirmed_email_enabled = true;