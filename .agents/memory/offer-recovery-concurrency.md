---
name: Offer recovery concurrency
description: Concurrency and delivery-evidence tradeoffs for recovering declined appointment offers.
---

Serialize offer lifecycle operations on the owning client, including resend through provider acceptance. Recovery sends must reject repeated clicks once valid fresh choices exist, rather than silently replacing the newly delivered generation. Recheck a decline's entry token under that same lock.

**Why:** Checking pending status before a transaction is insufficient: a concurrent decline or replacement can close the token before resend sends it, and a delayed decline can affect a newer generation. Holding the lock during provider delivery deliberately trades longer transactions for preventing already-closed links from being emailed.

**How to apply:** Maintain the same client-lock ordering across offer recovery, decline, selection and resend. Keep best-effort send timestamps outside the critical transaction: a caught PostgreSQL write error still aborts its transaction, potentially undoing an offer that the provider already accepted. Preserve Needs Call independently of new offer delivery and selection; staff resolve it explicitly.