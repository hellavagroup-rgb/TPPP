-- No backfill: historic offers and bookings retain their original slot mode.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_location_type text;
ALTER TABLE client_clinician_options ADD COLUMN IF NOT EXISTS location_type text;
ALTER TABLE booking_reservations ADD COLUMN IF NOT EXISTS location_type text;
