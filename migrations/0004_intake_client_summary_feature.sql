ALTER TABLE "tenants"
ADD COLUMN IF NOT EXISTS "intake_client_summary_enabled" boolean DEFAULT false;