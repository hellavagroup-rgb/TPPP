ALTER TABLE booking_snapshots
  DROP CONSTRAINT IF EXISTS booking_snapshots_client_unique;

DROP INDEX IF EXISTS booking_snapshots_client_unique;

CREATE INDEX IF NOT EXISTS booking_snapshots_client_history_idx
  ON booking_snapshots (tenant_id, client_id, confirmed_at);
