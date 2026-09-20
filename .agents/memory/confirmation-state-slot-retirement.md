---
name: Confirmation state and slot retirement
description: Tenant feature rule and slot semantics when an appointment is confirmed.
---

Use `BookingConfirmed` only when the tenant has the Booking Confirmed Email feature enabled in Super Admin; otherwise use the legacy `Scheduled` state.

Confirmation must remove the selected slot from available inventory consistently for every tenant. Retire the slot row in place rather than deleting it: historical option rows stay auditable, while only pending options become unavailable. The confirmed booking must retain a stable snapshot of clinician, date/day, time, and location for operations, email, Zoom, reporting, and audit history.

**Why:** Tenant 1 relies on confirmed slots being removed, and changing that behavior risks reopening previously resolved availability problems. Clearing all appointment information, however, loses the evidence needed after confirmation.

**How to apply:** Keep slot-retirement semantics identical across tenants and vary only the resulting workflow state and enabled follow-up automation. Perform snapshot creation, slot retirement, pending-option invalidation, and client transition atomically. Active client ownership is stronger evidence than a stale booking flag and must block administrative retirement.