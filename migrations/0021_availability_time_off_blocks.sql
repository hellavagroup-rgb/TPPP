ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS time_off_blocks_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS availability_time_off_blocks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clinician_id varchar NOT NULL REFERENCES clinicians(id) ON DELETE CASCADE,
  date text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS availability_time_off_blocks_tenant_clinician_date_idx
  ON availability_time_off_blocks (tenant_id, clinician_id, date);
