---
name: Date-specific clinician time off
description: Product rules for clinician time-off blocks and tenant activation.
---

Clinician time-off blocks are limited to specific calendar dates and must not remove or alter recurring availability. If a block overlaps an appointment or reservation, reject the block until the existing booking is resolved; never cancel, move, or edit that booking automatically. Keep the feature disabled by default and do not guess a practice identity when enabling it.

**Why:** The user chose date-specific hourly blocks, conflict rejection, and staged tenant activation to protect existing bookings and other practices.

**How to apply:** Match calendar cells against their occurrence date, but protect the whole upcoming schedule when checking booking eligibility. Enable the feature only after the intended tenant has been authenticated and confirmed.

Recurring allocations remain ongoing weekly or fortnightly appointments, not single-date bookings. A date supplied during assignment validates the requested occurrence against its schedule; it does not redefine the allocation. Confirmed recurring appointments must remain protected after their availability is retired, while respecting their original frequency and date bounds.

**Why:** The existing booking workflow treats recurring allocations as regular appointments and retains confirmation evidence after retiring availability. Treating an allocation as only its selected date would let later time-off blocks overlap those regular appointments.

**How to apply:** Preserve recurring booking semantics when adding date-specific checks. Never introduce a single assigned-occurrence date as a replacement for the recurring booking model.

The reverse protection is required too: an existing future time-off exception prevents a new ongoing recurring booking whose schedule intersects it, even when staff choose a different occurrence date. Past exceptions alone do not prevent a new ongoing booking. A separate one-off appointment on a different date remains bookable.

**Why:** Checking only the chosen date let reservations and option selection bypass future time off, despite ongoing bookings correctly preventing those same blocks when created in the opposite order.

**How to apply:** Use date-local checks for ordinary calendar display, and whole-upcoming-schedule checks for all booking eligibility, offers, reservations, direct assignments and reassignments.

Time-off edits must validate the replacement while the original block remains in place. Serialize changes with booking operations using the clinician lock, acquired before locking individual time-off rows.

**Why:** Deleting and recreating a block would temporarily expose the original hours and lose the block on rejection. Opposite clinician/block lock orders can deadlock concurrent edits and removals.

**How to apply:** Keep updates atomic and preserve block identity and creation evidence. Maintain a consistent clinician-first lock order for time-off mutations.
