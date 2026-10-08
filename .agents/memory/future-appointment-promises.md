---
name: Future appointment promises
description: Distinguish an exact future appointment from a recurring availability window.
---

Both tenants must be able to book pending slots. Future-start recurring availability can be offered and reserved before its start date; the start date must remain unchanged. Use a staff-created one-off slot when promising an exact future appointment date. A recurring weekday and availability window are not verification of its first appointment occurrence.

**Why:** The user stated that Tenant 1 previously booked pending slots, reported a regression, and explicitly required pending booking for both tenants. Current source code is not proof of previous behaviour. Advance reservation must still not invent the exact first appointment date.

**How to apply:** Apply the same pending-slot eligibility to staff allocation, reassignment, offers and public selection, without a tenant opt-in. Show the availability start date. Keep booked, retired, expired, invalid-window and tenant-ownership protections, and recheck locked state before reserving. Keep recurring first-date wording explicitly unconfirmed unless there is separate verified evidence; preserve one-off feature opt-ins and UK calendar dates.