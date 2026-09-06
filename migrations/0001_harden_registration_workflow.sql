ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS registration_terms_content text NOT NULL DEFAULT 'By proceeding you agree to the practice''s Terms & Conditions.',
  ADD COLUMN IF NOT EXISTS registration_terms_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS registration_terms_updated_at timestamp NOT NULL DEFAULT now();

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS registration_token_expires_at timestamp,
  ADD COLUMN IF NOT EXISTS registration_token_revoked_at timestamp,
  ADD COLUMN IF NOT EXISTS registration_email_sent_at timestamp,
  ADD COLUMN IF NOT EXISTS registration_email_sending_at timestamp,
  ADD COLUMN IF NOT EXISTS registration_email_attempt_key text,
  ADD COLUMN IF NOT EXISTS registration_email_claim_id text,
  ADD COLUMN IF NOT EXISTS registration_payment_attempt_key text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamp,
  ADD COLUMN IF NOT EXISTS terms_accepted_version integer,
  ADD COLUMN IF NOT EXISTS terms_accepted_content text,
  ADD COLUMN IF NOT EXISTS booking_confirmation_sent_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS payment_charges_stripe_payment_intent_unique
  ON payment_charges (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Older option offers reserved every proposed slot by marking it booked. Release
-- only pending option holds that are not also assigned to a real active booking.
UPDATE time_slots AS slot
SET is_booked = false
WHERE slot.is_booked = true
  AND EXISTS (
    SELECT 1
    FROM client_clinician_options pending_option
    JOIN clients option_client ON option_client.id = pending_option.client_id
    WHERE pending_option.slot_id = slot.id
      AND pending_option.status = 'pending'
      AND option_client.status = 'OptionsSent'
      AND pending_option.tenant_id = slot.tenant_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM clients booked_client
    WHERE booked_client.assigned_slot_id = slot.id
      AND booked_client.status IN (
        'Assigned', 'AwaitingConfirmation', 'Scheduled',
        'OptionSelected', 'RegistrationPending', 'BookingConfirmed'
      )
  );