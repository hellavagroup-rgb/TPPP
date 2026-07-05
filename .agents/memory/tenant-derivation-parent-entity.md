---
name: Tenant ID derivation rules for multi-tenant routes
description: Where to source tenantId when creating/updating rows — covers public routes (req.tenant is never set) and body-supplied tenantId on create endpoints.
---

Two related pitfalls found repeatedly while auditing tenant isolation in an Express + session-auth multi-tenant app:

1. **On public/unauthenticated routes, `req.tenant` is deliberately never resolved** (no session to derive it from). Any route handler that passes `req.tenant?.id` into a create/update call on such a route is silently passing `undefined` forever — not a bug that only appears sometimes, but on every single request. This is easy to miss because the code looks identical to the authenticated-route pattern and compiles/runs fine.
   - **Why:** found in a public form-submission flow where this left effectively all real production rows with a null tenantId, silently breaking a tenant-scoped export for every tenant.
   - **How to apply:** on public routes, derive tenantId from an already-verified parent entity fetched earlier in the same handler (e.g. the client record looked up by ID), never from `req.tenant`. Grep for `req.tenant` inside any route registered without an auth-requiring middleware to catch this class of bug.

2. **Create endpoints must never let the request body set `tenantId`.** If an insert schema (e.g. drizzle-zod `createInsertSchema`) isn't given an explicit `.omit({ tenantId: true })`, `tenantId` is a normal accepted field — a caller can set it to any value, or omit it and get null.
   - **Why:** found a `POST /api/users`-style endpoint where any authenticated tenant admin could set an arbitrary `tenantId` in the body, letting them create a working login account (password of their choosing) inside a different tenant.
   - **How to apply:** on any authenticated create-resource route, always overwrite `tenantId` with the server-derived value (`req.tenant?.id`) after body validation, never trust/merge whatever the client sent — even if the schema currently doesn't expose the field in the UI.

General principle from this codebase's audits: prefer deriving tenant ownership from a reliably-tagged **parent** entity over trusting either (a) the resource's own tenantId column (can be null on legacy/buggy rows) or (b) attacker/caller-controlled input (request body or an unresolved `req.tenant`).
