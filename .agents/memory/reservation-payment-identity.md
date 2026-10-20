---
name: Reservation payment identity
description: Why booking holds must retain their original payment identity even when client pointers or feature flags change.
---

A held appointment must not be released or confirmed using only the client's current payment link when earlier reservation evidence is missing or differs. Keep the hold for staff review rather than adopting a replacement as proof of nonpayment.

**Why:** Legacy link replacement can conceal an earlier paid or processing checkout. A missing historical reference is uncertainty, not proof that no earlier payment exists. Feature flags can be disabled while holds and webhooks remain outstanding.

**How to apply:** Bind identity before provider setup and keep it stable through retries, expiry and cancellation. Require reconciliation for new flexible bookings, but keep existing financial safeguards independent of that opt-in. Never backfill old holds from mutable client pointers without separately verified tenant-owned evidence.

Both sets of payment references being empty does not prove that payment setup never started. Registration progress, checkout data or a pending/active payment badge makes that a review case. Only a pristine unsubmitted hold may use the no-payment shortcut.

**Why:** A legacy payment journey can lose both the reservation and client references after checkout starts. Equality between two missing values can otherwise release an already-paid appointment without any provider check.

**How to apply:** Check workflow progress as well as reference equality; include expiry and cancellation regressions where both records' references and checkout URL are empty.
