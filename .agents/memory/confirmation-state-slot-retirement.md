---
name: Confirmation state and slot retirement
description: Tenant feature rule and slot semantics when an appointment is confirmed.
---

Use `BookingConfirmed` only when the tenant has the Booking Confirmed Email feature enabled in Super Admin; otherwise use the legacy `Scheduled` state.

Confirmation must remove the selected slot from available inventory consistently for every tenant. The live availability row does not need to remain attached to the client, but the confirmed booking must retain a stable snapshot of clinician, date/day, time, and location for operations, email, Zoom, reporting, and audit history.

**Why:** Tenant 1 relies on confirmed slots being removed, and changing that behavior risks reopening previously resolved availability problems. Clearing all appointment information, however, loses the evidence needed after confirmation.

**How to apply:** Keep slot-retirement semantics identical across tenants and vary only the resulting workflow state and enabled follow-up automation. Perform snapshot creation, slot retirement, and client transition atomically.