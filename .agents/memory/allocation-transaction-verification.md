---
name: Allocation transaction verification
description: Confidence limits of mocked allocation transactions versus isolated PostgreSQL checks.
---

When changing allocation safety queries, use isolated PostgreSQL regression tests as the authority for ownership, locking, rollback and time-off conflicts. Lightweight transaction mocks remain useful but are not proof of those guarantees.

**Why:** Ordinal query mocks have lagged existing clinician/slot locks and additional configuration reads, producing misleading failures and empty results represented as undefined rows.

**How to apply:** Keep extra configuration and time-off reads table-aware in test doubles, return genuine empty arrays, and verify concurrency against PostgreSQL rather than weakening production safeguards to fit a mock.
