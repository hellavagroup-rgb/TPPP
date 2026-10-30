ALTER TABLE booking_snapshots
  DROP CONSTRAINT IF EXISTS booking_snapshots_client_unique;

DROP INDEX IF EXISTS booking_snapshots_client_unique;
