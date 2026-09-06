CREATE TABLE IF NOT EXISTS client_creation_requests (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  idempotency_key text NOT NULL,
  client_id varchar NOT NULL REFERENCES clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_creation_requests_tenant_key_unique
  ON client_creation_requests (tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS form_deliveries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  client_id varchar NOT NULL REFERENCES clients(id),
  form_template_id varchar NOT NULL REFERENCES form_templates(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'completed')),
  idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_token text,
  lease_expires_at timestamp,
  sent_at timestamp,
  completed_at timestamp,
  failed_at timestamp,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS form_deliveries_tenant_client_form_unique
  ON form_deliveries (tenant_id, client_id, form_template_id);
CREATE UNIQUE INDEX IF NOT EXISTS form_deliveries_idempotency_key_unique
  ON form_deliveries (idempotency_key);