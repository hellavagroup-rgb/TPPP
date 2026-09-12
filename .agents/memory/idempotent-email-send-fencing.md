---
name: Idempotent email send fencing
description: How to make retried provider sends recoverable without duplicate delivery or stale-owner cleanup races.
---

Retry-safe email delivery needs two distinct identifiers: a stable attempt key used as the provider idempotency key, and a rotating claim ID used to fence database ownership.

**Why:** A database lease alone cannot fence an irreversible provider call. Reusing only one key also lets an old claimant clear a newer recovery claim. Stable provider idempotency prevents duplicate delivery, while a new claim ID on each recovery prevents stale callers from cleaning up or finalizing the new owner.

**How to apply:** Persist both values. Crash recovery inherits the original provider attempt key but creates a fresh claim ID. Also persist any provider-visible payload identity (such as a bearer token inside an emailed URL) with the attempt and reuse it during recovery; otherwise provider deduplication may retain an email whose link no longer matches the database. Keep the prior active payload valid until provider acceptance. Every cleanup and finalization must match both values, and activity should be recorded only after an ownership-checked final update succeeds.