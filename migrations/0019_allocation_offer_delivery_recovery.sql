CREATE TABLE IF NOT EXISTS allocation_offer_deliveries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  client_id varchar NOT NULL REFERENCES clients(id),
  generation_key text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'sending', 'accepted', 'finalized', 'failed', 'uncertain')),
  option_tokens json NOT NULL,
  email_payload json NOT NULL,
  send_started_at timestamp,
  dedup_expires_at timestamp,
  accepted_at timestamp,
  provider_message_id text,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS allocation_offer_deliveries_generation_unique
  ON allocation_offer_deliveries (generation_key);
CREATE UNIQUE INDEX IF NOT EXISTS allocation_offer_deliveries_idempotency_unique
  ON allocation_offer_deliveries (idempotency_key);
CREATE INDEX IF NOT EXISTS allocation_offer_deliveries_client_status_idx
  ON allocation_offer_deliveries (tenant_id, client_id, status);