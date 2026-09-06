---
name: Recoverable Stripe resource setup
description: Making multi-resource Stripe setup recoverable after crashes and ambiguous provider responses.
---

Persist a stable workflow attempt key before the first Stripe call, and derive a distinct provider idempotency key from it for every external resource created during that attempt.

**Why:** A crash can occur after Stripe creates a Price or Payment Link but before the application saves the URL. Resetting local state or retrying with new keys either strands the client or creates duplicate external resources.

**How to apply:** Keep the workflow in a recoverable pending state when the provider outcome is unknown. On retry, reuse the persisted attempt key for each Stripe call, then save the resulting identifiers with a conditional once-only update. Only that update's winner should emit activity.