---
name: Shared sender address causes stale display-name caching in recipients' inboxes
description: Why a tenant-correct "From" header can still show an old practice name to recipients, and how to verify it.
---

All tenants/environments in this app send from one shared address (`FROM_EMAIL`, e.g. `noreply@notifications.unboundly.io`), with only the display name swapped per tenant (`buildFromAddress()` in `server/email.ts` strips any name baked into `FROM_EMAIL` and substitutes `tenant.name`).

Because the address itself never changes across tenants/dev/prod, an email client (e.g. Gmail) that has previously seen mail from that address under one tenant's name can cache that name and keep showing it for later messages from the same address — even when the actual `From:` header is correct for a different tenant.

**Why:** Confirmed via direct test: `buildFromAddress()` produced the correct current tenant name, but a real received email still displayed an old cached name for the shared address. Root cause was client-side caching, not a server bug.

**How to apply:** When a user reports an email "showing the wrong practice name," don't assume a code/tenant-resolution bug — first verify what the code actually generates (call `buildFromAddress`/the relevant `generate*Email` function directly for that tenant), then ask the user to check the raw/original headers in their mail client (e.g. Gmail "Show original") before looking further. Also keep the `FROM_EMAIL` env var itself free of a hardcoded display name (bare address only) to avoid confusion when inspecting config, even though the app code already overrides it.
