ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS registration_form_template_id varchar REFERENCES form_templates(id);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS registration_form_submission_id varchar REFERENCES form_submissions(id);

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS registration_attempt_key text,
  ADD COLUMN IF NOT EXISTS registration_template_title text,
  ADD COLUMN IF NOT EXISTS registration_template_description text,
  ADD COLUMN IF NOT EXISTS registration_template_fields json;

-- A registration snapshot remains exportable after an administrator deletes
-- its editable source template.
ALTER TABLE form_submissions
  ALTER COLUMN form_template_id DROP NOT NULL;
ALTER TABLE form_submissions
  DROP CONSTRAINT IF EXISTS form_submissions_form_template_id_form_templates_id_fk;
ALTER TABLE form_submissions
  ADD CONSTRAINT form_submissions_form_template_id_form_templates_id_fk
  FOREIGN KEY (form_template_id) REFERENCES form_templates(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_registration_attempt_key_unique
  ON form_submissions (registration_attempt_key)
  WHERE registration_attempt_key IS NOT NULL;