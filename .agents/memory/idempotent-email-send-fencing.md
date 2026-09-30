---
name: Idempotent email send fencing
description: How to make retried provider sends recoverable without duplicate delivery or stale-owner cleanup races.
---

Retry-safe email delivery needs two distinct identifiers: a stable attempt key used as the provider idempotency key, and a rotating claim ID used to fence database ownership.

**Why:** A database lease alone cannot fence an irreversible provider call. Reusing only one key also lets an old claimant clear a newer recovery claim. Stable provider idempotency prevents duplicate delivery, while a new claim ID on each recovery prevents stale callers from cleaning up or finalizing the new owner.

**How to apply:** Persist both values. Crash recovery inherits the original provider attempt key but creates a fresh claim ID. Also persist any provider-visible payload identity (such as a bearer token inside an emailed URL) with the attempt and reuse it during recovery; otherwise provider deduplication may retain an email whose link no longer matches the database. Keep the prior active payload valid until provider acceptance. Every cleanup and finalization must match both values, and activity should be recorded only after an ownership-checked final update succeeds.

Provider idempotency is time-bounded, not permanent. An unresolved send must stop automatic retry before the provider's deduplication retention expires; changing the key or rebuilding the email is not safe recovery. Recorded acceptance can still be finalized after that window without contacting the provider again.

**Why:** A provider can accept an email while its acceptance write fails. After deduplication expires, the same key may send another copy, so durable payload storage alone does not guarantee duplicate-free recovery.

**How to apply:** Persist the first send time and a conservative expiry before delivery. Reuse the exact saved payload, including branding, during unresolved retry; once expired, require reconciliation or an explicit replacement offer that retires the old tokens.

Do not equate a provider SDK's returned error with definitive rejection. Some SDKs turn a lost network response into a normal error result with no HTTP status, instead of throwing.

**Why:** The provider may already have accepted the email before the response was lost. Treating that as rejected retires valid links and creates a new key on retry, defeating deduplication.

**How to apply:** Preserve unresolved attempt identity for transport failures, missing status codes, timeouts, and server errors; classify only definitive nonacceptance as terminal rejection.