ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS zoom_link_email_enabled boolean DEFAULT false;

-- Preserve the existing CY&A Zoom workflow without enabling it for tenants
-- that do not use the registration and booking-confirmation email journey.
UPDATE tenants
SET zoom_link_email_enabled = true
WHERE registration_form_enabled = true
  AND booking_confirmed_email_enabled = true;