ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "intake_form_template_id" varchar;

-- Deliberately do not backfill from titles or row order. Existing tenants remain
-- in an explicit setup-required state until a super-admin makes a verified choice.
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_intake_form_template_id_form_templates_id_fk"
  FOREIGN KEY ("intake_form_template_id") REFERENCES "form_templates"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_workflow_forms_distinct'
  ) THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT "tenants_workflow_forms_distinct"
      CHECK (
        "intake_form_template_id" IS NULL
        OR "registration_form_template_id" IS NULL
        OR "intake_form_template_id" <> "registration_form_template_id"
      );
  END IF;
END $$;