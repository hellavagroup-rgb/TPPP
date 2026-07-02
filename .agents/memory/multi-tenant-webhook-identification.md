---
name: Multi-tenant webhook tenant identification
description: How to identify which tenant a signed webhook (e.g. Stripe) belongs to when each tenant has its own signing secret.
---

Do not identify the owning tenant of an incoming signed webhook by reading a field (like `tenantId`) out of the request body before the signature is verified. That field is only present on the subset of event/object types your own code happens to stamp with it — most third-party event types won't carry it, so metadata-based lookup silently fails for everything except the narrow case you tested.

Instead, treat signature verification itself as the tenant-identification mechanism: loop over every tenant that has a configured secret, attempt to verify the payload against each one, and treat whichever secret succeeds as authoritative. Only after a secret verifies should you trust any tenant/owner id derived from it (and that derived id should now be used unconditionally in downstream ownership checks, not just "if present").

**Why:** A production integration (Stripe webhooks) silently failed ~100% of the time for one tenant because the handler read `metadata.tenantId` from the unverified body to pick which stored secret to check against — but that metadata is only set on the checkout/payment objects our own code creates. Every other event type (customer.*, invoice.*, payment_method.*, etc.) has no such metadata, so tenant lookup came back empty and the handler always rejected with a generic "secret not configured" error, even though the tenant's secret was correctly stored.

**How to apply:** Any time you add or debug a multi-tenant (or multi-account) webhook/callback endpoint where each tenant has its own signing secret, resolve the tenant by trying each candidate secret against the signature rather than parsing untrusted identifying fields out of the payload first. Keep a dev-only global-secret fallback separate from this loop for local CLI testing.
