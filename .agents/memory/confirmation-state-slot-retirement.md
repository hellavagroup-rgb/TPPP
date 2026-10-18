---
name: Confirmation state and slot retirement
description: Tenant feature rule and slot semantics when an appointment is confirmed.
---

Use `BookingConfirmed` only when the tenant has the Booking Confirmed Email feature enabled in Super Admin; otherwise use the legacy `Scheduled` state.

Confirmation must remove the selected slot from available inventory consistently for every tenant. Retire the slot row in place rather than deleting it: historical option rows stay auditable, while only pending options become unavailable. The confirmed booking must retain a stable snapshot of clinician, date/day, time, and location for operations, email, Zoom, reporting, and audit history.

**Why:** Tenant 1 relies on confirmed slots being removed, and changing that behavior risks reopening previously resolved availability problems. Clearing all appointment information, however, loses the evidence needed after confirmation.

**How to apply:** Keep slot-retirement semantics identical across tenants and vary only the resulting workflow state and enabled follow-up automation. Perform snapshot creation, slot retirement, pending-option invalidation, and client transition atomically. After confirmation, history and follow-up delivery must read the immutable snapshot, not the cleared live assignment. Active client ownership is stronger evidence than a stale booking flag and must block administrative retirement.

Tenant 2 expects staff to be able to publish fresh availability at a previously booked time once the clinician says it is free again, without reopening the original intake or declaring therapy complete.

**Why:** Tenant 2 explained that clinicians may move clients after work starts, while the intake portal does not track the duration or subsequent scheduling of therapy. An old confirmed booking is history, not a permanent ban on offering that clock time again. The user approved clearer warnings and regression coverage as the safeguard, without changing booking/payment transitions or automatically re-listing time.

**How to apply:** Distinguish a new availability entry from restoring or deleting the old booking-linked slot. Preserve original confirmation, payment, manager-override and appointment history. Require staff's current availability decision rather than inferring that a time is free from therapy completion or an old message. Keep protections for genuinely pending reservations.