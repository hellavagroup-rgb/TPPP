CREATE TABLE IF NOT EXISTS booking_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  client_id varchar NOT NULL REFERENCES clients(id),
  slot_id varchar REFERENCES time_slots(id) ON DELETE SET NULL,
  clinician_id varchar REFERENCES clinicians(id) ON DELETE SET NULL,
  clinician_name text NOT NULL,
  slot_type text NOT NULL,
  date text,
  day text,
  start_time text NOT NULL,
  end_time text NOT NULL,
  location_type text NOT NULL,
  confirmed_at timestamp NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  CONSTRAINT booking_snapshots_client_unique UNIQUE (client_id),
  CONSTRAINT booking_snapshots_idempotency_unique UNIQUE (tenant_id, idempotency_key)
);