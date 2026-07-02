---
name: Production demo tenant
description: A dedicated "Wellness Demo Practice" tenant exists in production, seeded with fictional data for video/demo recording. Read this before assuming production only has the two real practice tenants.
---

Production has a third tenant, "Wellness Demo Practice" (slug `demo`), created specifically so the user can record product demo videos against the stable published app instead of the dev environment (which can visibly white-screen/reload when the dev server restarts or its live-reload connection drops).

It is seeded with entirely fictional clinicians and clients (all `@example.com` emails) spanning every client workflow status, a couple of tasks, and a sample form template — created through the app's own APIs (via the super-admin tenant-creation endpoint + admin login), not direct DB writes.

**Why this matters:** don't assume it's a misconfigured/duplicate real tenant, don't seed it with real client or staff PII, and don't delete it without checking with the user first — it's an intentional, ongoing fixture for recording.

**How to apply:** if asked to audit tenants, count real customers, or investigate "why is there a tenant with fake data," this is the explanation. If the user wants it refreshed/reset, reseed via the app's normal admin APIs the same way, not raw SQL.
