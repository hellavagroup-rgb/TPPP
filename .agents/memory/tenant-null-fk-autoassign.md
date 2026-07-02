---
name: Never auto-assign orphaned rows to "the first tenant"
description: Why a null-tenantId backfill/migration helper must warn, never guess, which tenant an orphaned row belongs to.
---

## The rule
Any helper that repairs rows with a null `tenantId` (seed scripts, startup checks, "fix data" admin
endpoints) must only **report** orphaned rows, never auto-assign them to "whichever tenant exists
first" or "the default tenant." Cross-tenant assignment is a data/business decision, not one code
can infer safely.

**Why:** In this app, a legacy one-time migration endpoint (`/api/admin/seed-tenant`, gated only by
`requireAdmin`, not super-admin) bulk-reassigned every null-tenantId row across every table to
whichever tenant was created first. A clinician's `users` row had a null `tenantId` at some point
(her `clinicians` row was already correctly tenant-scoped), and running this endpoint silently
flipped her user account to the wrong tenant — a split-brain where her clinician profile said one
practice and her login/user record said another. That mismatch is what caused her password-reset
email to carry the wrong practice's branding: the reset flow reads `user.tenantId`, not the
clinician profile's tenantId.

**How to apply:** When you see a startup/seed script or an admin-callable endpoint that does
`UPDATE ... SET tenant_id = $firstTenant WHERE tenant_id IS NULL` (or equivalent) in a multi-tenant
app, treat it as a live bug, not defensive code — replace it with a warn-only check. If a real fix
is needed, provide a narrow, audited, single-record action (reassign one user/entity by id/email to
an explicit target tenant) gated behind super-admin, and cascade to linked profile rows (e.g. a
clinician profile tied to a user) so the same record can't end up split across two tenants again.
