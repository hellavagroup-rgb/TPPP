---
name: Multi-tenant email isolation
description: How to send emails correctly per-tenant — template lookup, FROM address, and body copy must all be scoped to the tenant.
---

## The rule
Every email send must pass a `TenantContext` (`{ id, name, fromEmail? }`) so that:
1. Template lookup (`getEmailTemplateByKey`) tries tenant-specific row first, then global fallback (NULL tenantId)
2. FROM address is built as `"<Tenant Name> <shared-email-address>"` via `buildFromAddress(tenant)`
3. All body copy / subject / footer use `tenant.name` not a hardcoded practice name

## Pattern for authenticated routes
```ts
const tc = req.tenant ? { id: req.tenant.id, name: req.tenant.name, fromEmail: req.tenant.fromEmail } : undefined;
const emailOptions = await generateXxxEmail(...args, tc);
await sendEmail({ ...emailOptions, to: recipient });
```

## Pattern for public routes (no req.tenant)
Look up tenant from the object that owns a tenantId:
```ts
const tenant = client.tenantId ? await storage.getTenantById(client.tenantId) : null;
const tc = tenant ? { id: tenant.id, name: tenant.name, fromEmail: tenant.fromEmail } : undefined;
```

## Key files
- `server/email.ts` — `TenantContext` type, `buildFromAddress()` (exported), all `generate*Email(tenant?)` functions
- `server/storage.ts` — `getEmailTemplateByKey(key, tenantId?)` and `getTenantById(id)` 
- `shared/schema.ts` — `fromEmail` column on tenants table (per-tenant custom FROM address override)

**Why:** Two tenants share the same app. Before this fix, all emails were sent from "The Perinatal Psychology Practice" regardless of which tenant triggered the action, because the template lookup had no tenant filter and the FROM address was hardcoded.
