---
name: Recoverable Stripe resource setup
description: Making multi-resource Stripe setup recoverable after crashes and ambiguous provider responses.
---

Persist a stable workflow attempt key before the first Stripe call, and derive a distinct provider idempotency key from it for every external resource created during that attempt.

**Why:** A crash can occur after Stripe creates a Price or Payment Link but before the application saves the URL. Resetting local state or retrying with new keys either strands the client or creates duplicate external resources.

**How to apply:** Keep the workflow in a recoverable pending state when the provider outcome is unknown. On retry, reuse the persisted attempt key for each Stripe call, then save the resulting identifiers with a conditional once-only update. Only that update's winner should emit activity. Create/retrieve the idempotent replacement before deactivating any prior resource, and never deactivate it when Stripe returns the same ID. If a stored link is already inactive, rotate the workflow attempt and replace it rather than returning the dead URL. When the provider creation contract changes, version the resource-level idempotency key so Stripe cannot replay an artifact created under the invalid old contract; reject inactive resources before persisting their URLs.

Stripe Payment Links are active by default. The create endpoint rejects an `active` parameter; use `active` only with the update endpoint, and validate the returned link's state after creation.