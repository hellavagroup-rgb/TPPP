---
name: External bookings are not portal confirmations
description: How to keep historic external diary evidence separate from internal booking state.
---

For historically booked clients, record a staff-verified external diary appointment as separate audited evidence, not a portal booking confirmation. A reviewed external appointment must block later automatic or manual portal confirmation until the discrepancy is resolved. The portal status can remain pending while the staff view classifies the case as externally booked.

**Why:** The external diary, original family-facing message and payment provider can disagree with the portal. Converting a note or badge into a booking snapshot, consent answer, Stripe charge or email timestamp would invent evidence and could create a second appointment.

**How to apply:** In future reconciliation flows, require the actual external diary reference and appointment identity, prevent duplicate claims across active clients, and never infer provider payment or delivery from staff notes. Investigate external facts separately before changing live booking status.