ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS assigned_occurrence_date text;
