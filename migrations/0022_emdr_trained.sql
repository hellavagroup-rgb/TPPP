ALTER TABLE clinicians
  ADD COLUMN IF NOT EXISTS emdr_trained boolean NOT NULL DEFAULT false;
