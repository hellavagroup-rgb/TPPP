-- Retire availability without deleting historical option references.
ALTER TABLE time_slots
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS retirement_reason TEXT;

-- Existing option history is append-only; unavailable means a pending choice
-- can no longer be selected because its slot was retired or removed.
ALTER TABLE client_clinician_options
  DROP CONSTRAINT IF EXISTS client_clinician_options_status_check;
ALTER TABLE client_clinician_options
  ADD CONSTRAINT client_clinician_options_status_check
  CHECK (status IN ('pending', 'selected', 'declined', 'unavailable'));

CREATE INDEX IF NOT EXISTS time_slots_active_clinician_idx
  ON time_slots (tenant_id, clinician_id)
  WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS client_options_pending_slot_idx
  ON client_clinician_options (tenant_id, slot_id)
  WHERE status = 'pending';