---
name: External bookings are not portal confirmations
description: How to keep historic external diary evidence separate from internal booking state.
---

Clients explicitly marked as arranged in WriteUpp belong in the staff Confirmed view, not a separate active Kanban column. Portal-confirmed clients also stay off the active Kanban. A mere diary review is not an arrangement acknowledgement.

**Why:** The user said that cases with no further booking action clog the dashboard and should move to Confirmed rather than remain on the Kanban.

**How to apply:** Keep the external-booking label and evidence; do not fabricate portal status, payment, consent or appointment snapshots. No extra manager PIN action is needed just to classify an already-recorded arrangement. Preserve payment review and completion controls in the Confirmed view. An explicit reopen into intake or matching is active work again.

For historically booked clients, record a staff acknowledgement that the appointment is arranged in WriteUpp as separate audited evidence, not a portal booking confirmation. Both an external review and a WriteUpp arrangement acknowledgement must block later automatic or manual portal confirmation. The portal status can remain pending while the staff view classifies the case as arranged.

**Why:** The external diary, original family-facing message and payment provider can disagree with the portal. Converting a note or badge into a booking snapshot, consent answer, Stripe charge or email timestamp would invent evidence and could create a second appointment.

**How to apply:** Keep detailed external diary reviews separate from the simple arrangement acknowledgement. Where a detailed review records appointment identity, retain its duplicate-claim checks. Never infer provider payment or delivery from either staff notes or the acknowledgement.

Selecting "Appointment arranged in WriteUpp" should immediately confirm that staff recorded the arrangement, with no further form or action needed.

**Why:** The user explicitly rejected the mandatory external diary reference, clinician, date/time and verification form; the button itself is their acknowledgement that WriteUpp is arranged.

**How to apply:** Record the staff actor and server time, show a saved arrangement state, and remove pending booking prompts. Do not invent appointment details, payment, consent, delivery evidence or a portal booking snapshot. Preserve existing evidence and reservations.

Recording independently verified WriteUpp arrangements must not require repairing a historic portal allocation. Keep portal repair as an optional, separate workflow, not the primary instruction for an appointment already arranged outside the portal.

**Why:** Staff need to record the real external appointment, not rebuild obsolete portal selections. Requiring portal repair here adds unnecessary work and risks confusing external verification with payment recovery or a second booking confirmation.

**How to apply:** Move cases out of the active booking queue only after an explicit staff assertion that WriteUpp is arranged; an ordinary historic review is not that assertion. Preserve unresolved portal evidence and reservations without silently repairing or releasing them.

Staff may explicitly retire occupied portal availability for an appointment already recorded as arranged in WriteUpp, while preserving the client's appointment links and history. Do not require completing therapy, deallocation, portal confirmation or payment reconciliation to remove that occupied availability.

**Why:** The user approved a safe removal action for externally arranged appointments whose therapy is already underway. The portal's pending confirmation state must not force staff to misrepresent therapy as completed or release occupied time for another client.

**How to apply:** Keep this an explicit, audited administrative action rather than a side effect of recording a WriteUpp arrangement. Recheck ownership and the recorded arrangement at confirmation, retain the slot as retired history, and leave client, payment and delivery evidence unchanged.