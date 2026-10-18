---
name: Reservation duration policy
description: Admin-configurable reservation duration and preservation of existing client deadlines.
---

Tenant 2 admins must be able to change reservation duration through settings without a code change.

**Why:** The user explicitly requested an admin-editable duration rather than a hard-coded 12-hour limit.

**How to apply:** Keep duration configurable when implementing online and phone reservations; do not reintroduce a hard-coded-only duration.

Apply setting changes to new reservations only; preserve the exact deadline already shown for an existing hold.

**Why:** A setting edit must not silently change an existing client's promised booking deadline.

**How to apply:** Capture the effective duration and deadline at slot reservation, not invitation send time. Completed, verified bookings must not remain subject to unpaid-hold expiry.
