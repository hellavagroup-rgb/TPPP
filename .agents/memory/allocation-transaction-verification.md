---
name: Allocation transaction verification
description: Confidence limits of mocked allocation transactions versus isolated PostgreSQL checks.
---

When changing allocation safety queries, use isolated PostgreSQL regression tests as the authority for ownership, locking, rollback and time-off conflicts. Lightweight transaction mocks remain useful but are not proof of those guarantees.

**Why:** Ordinal query mocks have lagged existing clinician/slot locks and additional configuration reads, producing misleading failures and empty results represented as undefined rows.

**How to apply:** Keep extra configuration and time-off reads table-aware in test doubles, return genuine empty arrays, and verify concurrency against PostgreSQL rather than weakening production safeguards to fit a mock.

Test doubles must evaluate the actual SQL predicates, not infer the operation solely from a field in its update patch.

**Why:** Confirmation can reset completion markers as part of a larger status transition. A mock that treats every completion reset as the standalone reopen action falsely rejects otherwise valid repeat confirmations.

**How to apply:** Model ownership, slot matching, inequality, and ordering for history queries. When cloning tables with PostgreSQL `LIKE INCLUDING ALL`, inspect copied index names: PostgreSQL can rename a copied unique index, so a migration dropping its original name may leave the cloned restriction in place.
