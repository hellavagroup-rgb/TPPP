ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS registration_consent_evidence json,
  ADD COLUMN IF NOT EXISTS registration_terms_accepted_at timestamp,
  ADD COLUMN IF NOT EXISTS registration_terms_accepted_version integer,
  ADD COLUMN IF NOT EXISTS registration_terms_accepted_content text;