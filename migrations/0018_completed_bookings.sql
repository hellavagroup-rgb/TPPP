ALTER TABLE tenants ADD COLUMN IF NOT EXISTS completed_bookings_enabled boolean DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS completed_at timestamp;
-- Opt in only the established booking-confirmation + WriteUpp practice.
UPDATE tenants SET completed_bookings_enabled = true
WHERE multi_clinician_allocation_enabled = true
  AND booking_confirmed_email_enabled = true
  AND writeup_checklist_enabled = true;