---
name: External bookings are not portal confirmations
description: How to keep historic external diary evidence separate from internal booking state.
---

For historically booked clients, record a staff-verified external diary appointment as separate audited evidence, not a portal booking confirmation. A reviewed external appointment must block later automatic or manual portal confirmation until the discrepancy is resolved. The portal status can remain pending while the staff view classifies the case as externally booked.

**Why:** The external diary, original family-facing message and payment provider can disagree with the portal. Converting a note or badge into a booking snapshot, consent answer, Stripe charge or email timestamp would invent evidence and could create a second appointment.

**How to apply:** In future reconciliation flows, require the actual external diary reference and appointment identity, prevent duplicate claims across active clients, and never infer provider payment or delivery from staff notes. Investigate external facts separately before changing live booking status.

Recording independently verified WriteUpp arrangements must not require repairing a historic portal allocation. Keep portal repair as an optional, separate workflow, not the primary instruction for an appointment already arranged outside the portal.

**Why:** Staff need to record the real external appointment, not rebuild obsolete portal selections. Requiring portal repair here adds unnecessary work and risks confusing external verification with payment recovery or a second booking confirmation.

**How to apply:** Move cases out of the active booking queue only after an explicit staff assertion that WriteUpp is arranged; an ordinary historic review is not that assertion. Preserve unresolved portal evidence and reservations without silently repairing or releasing them.