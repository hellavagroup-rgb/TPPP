ALTER TABLE tenants ADD COLUMN IF NOT EXISTS flexible_booking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reservation_duration_hours integer NOT NULL DEFAULT 12;
CREATE TABLE IF NOT EXISTS clinician_invitations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id varchar NOT NULL REFERENCES tenants(id),
  client_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE, token text NOT NULL UNIQUE,
  clinician_ids json NOT NULL, previous_status text NOT NULL DEFAULT 'Forms Completed',
  status text NOT NULL, created_at timestamp NOT NULL DEFAULT now(), sent_at timestamp,
  email_attempt_key text NOT NULL DEFAULT gen_random_uuid(), email_attempt_started_at timestamp NOT NULL DEFAULT now(), email_attempt_accepted_at timestamp
);
CREATE INDEX IF NOT EXISTS clinician_invitations_client_idx ON clinician_invitations(client_id);
CREATE TABLE IF NOT EXISTS booking_reservations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id varchar NOT NULL REFERENCES tenants(id),
  client_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invitation_id varchar REFERENCES clinician_invitations(id),
  clinician_id varchar NOT NULL REFERENCES clinicians(id), slot_id varchar NOT NULL REFERENCES time_slots(id),
  route text NOT NULL, previous_status text NOT NULL DEFAULT 'Forms Completed',
  duration_hours integer NOT NULL, deadline timestamp NOT NULL, status text NOT NULL,
  reason text, clinician_name text NOT NULL, appointment_label text NOT NULL,
  payment_attempt_key text, payment_link_id text, created_at timestamp NOT NULL DEFAULT now(), ended_at timestamp,
  last_checked_at timestamp, late_payment_review_required boolean NOT NULL DEFAULT false,
  follow_up_pending boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS booking_reservations_due_idx ON booking_reservations(status, deadline);
CREATE UNIQUE INDEX IF NOT EXISTS booking_reservations_active_client_unique ON booking_reservations(client_id)
  WHERE status IN ('active', 'payment_check', 'payment_review');
