---
name: Confirmation state and slot retirement
description: Tenant feature rule and slot semantics when an appointment is confirmed.
---

Use `BookingConfirmed` only when the tenant has the Booking Confirmed Email feature enabled in Super Admin; otherwise use the legacy `Scheduled` state.

Confirmation must remove the selected slot from available inventory consistently for every tenant. Retire the slot row in place rather than deleting it: historical option rows stay auditable, while only pending options become unavailable. The confirmed booking must retain a stable snapshot of clinician, date/day, time, and location for operations, email, Zoom, reporting, and audit history.

**Why:** Tenant 1 relies on confirmed slots being removed, and changing that behavior risks reopening previously resolved availability problems. Clearing all appointment information, however, loses the evidence needed after confirmation.

**How to apply:** Keep slot-retirement semantics identical across tenants and vary only the resulting workflow state and enabled follow-up automation. Perform snapshot creation, slot retirement, pending-option invalidation, and client transition atomically. After confirmation, history and follow-up delivery must read the immutable snapshot, not the cleared live assignment. Active client ownership is stronger evidence than a stale booking flag and must block administrative retirement.

The platform does not track ongoing recurring bookings after client confirmation. This applies across tenants: once a client is confirmed, the original slot disappears from availability. Newly added availability at the same time is independent and must not conflict with that historical confirmation.

**Why:** The user reiterated that this has been discussed many times and has caused repeated problems. The portal is not the ongoing therapy diary; treating old confirmations as indefinite occupancy contradicts its purpose.

**How to apply:** Preserve original confirmation, payment, manager-override and appointment history without using that history to block new availability or time off. Do not require a booking end date, therapy completion, archive action, acknowledgement or override to manage newly added availability. Keep protections for genuinely current live allocations and pending reservations; never restore the old booking-linked slot automatically.

A reopened client may be allocated a different slot and confirmed again. Keep a separate immutable snapshot for each appointment; an earlier snapshot must not permanently prevent that client's next confirmation.

**Why:** The user explicitly approved allowing new booking snapshots after a prior confirmation was deallocated. The previous appointment must remain history, not be overwritten or treated as confirmation of the replacement allocation.

**How to apply:** Scope confirmation idempotency to the appointment/attempt rather than the client's lifetime. Singular operational views use the latest relevant snapshot without duplicating clients; reservation recovery matches its own slot. Preserve previous delivery/completion/checklist evidence in history before resetting the client's current-booking markers. Retain prior snapshots and never reopen their retired slots.