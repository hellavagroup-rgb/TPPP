CREATE TABLE IF NOT EXISTS stripe_webhook_failures (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  event_id text NOT NULL,
  event_type text NOT NULL,
  client_id varchar REFERENCES clients(id),
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  generation integer NOT NULL DEFAULT 1,
  first_failed_at timestamp NOT NULL DEFAULT now(),
  last_failed_at timestamp NOT NULL DEFAULT now(),
  alert_claimed_at timestamp,
  alerted_at timestamp,
  resolved_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS stripe_webhook_failures_tenant_event_unique ON stripe_webhook_failures(tenant_id, event_id);
CREATE INDEX IF NOT EXISTS stripe_webhook_failures_tenant_open_idx ON stripe_webhook_failures(tenant_id, resolved_at);