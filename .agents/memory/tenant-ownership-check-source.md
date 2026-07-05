---
name: Tenant ownership checks should key off a reliably-scoped parent, not a per-row column
description: When enforcing tenant ownership on an API route, prefer deriving tenant from a parent entity (e.g. the clinician) rather than trusting a tenantId column on the row being acted on.
---

A route that mutates/reads a child resource by ID (e.g. `/api/timeslots/:clinicianId/:slotId`) needs a tenant-ownership check, but the check should be built by looking up the parent entity referenced in the URL (e.g. the clinician) and comparing its `tenantId`, not by trusting a `tenantId` column stored directly on the child row.

**Why:** In a multi-tenant retrofit, columns like a per-slot `tenantId` are often added later and backfilled inconsistently — legacy rows can have `tenantId = NULL` (seen in production: 32 of 145 `time_slots` rows). A check like `row.tenantId !== req.tenant.id` then fails closed for legitimate legacy data (blocks the rightful owner) or, worse, could fail open if the comparison is written carelessly. The parent entity (clinician, client, etc.) is usually the one column that was tenant-scoped from the start and has no legacy nulls.

**How to apply:** For any `<parentId>/<childId>` route, do `const parent = await storage.getParentById(parentId); if (!parent || parent.tenantId !== req.tenant?.id) return 403`. Don't add a redundant/competing check based on the child's own tenant column unless you've confirmed that column is fully and reliably backfilled.
