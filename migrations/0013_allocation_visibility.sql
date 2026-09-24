ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allocation_visibility_enabled boolean DEFAULT false;
ALTER TABLE client_clinician_options ADD COLUMN IF NOT EXISTS sent_at timestamp;
-- Opt in the existing registration/option-booking practice without enabling
-- the original manual-allocation practice.
UPDATE tenants SET allocation_visibility_enabled = true
WHERE multi_clinician_allocation_enabled = true
  AND registration_form_enabled = true
  AND booking_confirmed_email_enabled = true;