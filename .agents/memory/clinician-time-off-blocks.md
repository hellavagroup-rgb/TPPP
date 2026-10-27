---
name: Date-specific clinician time off
description: Product rules for clinician time-off blocks and tenant activation.
---

Clinician time-off blocks are limited to specific calendar dates and must not remove or alter recurring availability. If a block overlaps an appointment or reservation, reject the block until the existing booking is resolved; never cancel, move, or edit that booking automatically. Keep the feature disabled by default and do not guess a practice identity when enabling it.

**Why:** The user chose date-specific hourly blocks, conflict rejection, and staged tenant activation to protect existing bookings and other practices.

**How to apply:** Match calendar cells against their occurrence date, but protect the whole upcoming schedule when checking booking eligibility. Enable the feature only after the intended tenant has been authenticated and confirmed.

Before confirmation, recurring availability and live allocations/reservations retain their weekly or fortnightly schedule checks. A date supplied during assignment validates the requested occurrence; it does not redefine the availability. After confirmation, however, the portal does not track continuing recurring bookings: the retired slot and confirmation snapshot are history, not current occupancy.

**Why:** The user explicitly corrected the assumption that old confirmed appointments must remain protected indefinitely. That assumption repeatedly made new independent availability conflict with historical bookings.

**How to apply:** Protect current live allocations and pending reservations, but never reject time off over new availability solely because an old confirmed snapshot overlaps. Do not require an acknowledgement, override, end date, completion or archive action. See [Confirmation state and slot retirement](confirmation-state-slot-retirement.md) for the product-wide boundary.

The reverse protection is required too: an existing future time-off exception prevents a new ongoing recurring booking whose schedule intersects it, even when staff choose a different occurrence date. Past exceptions alone do not prevent a new ongoing booking. A separate one-off appointment on a different date remains bookable.

**Why:** Checking only the chosen date let reservations and option selection bypass future time off, despite ongoing bookings correctly preventing those same blocks when created in the opposite order.

**How to apply:** Use date-local checks for ordinary calendar display, and whole-upcoming-schedule checks for all booking eligibility, offers, reservations, direct assignments and reassignments.

Time-off edits must validate the replacement while the original block remains in place. Serialize changes with booking operations using the clinician lock, acquired before locking individual time-off rows.

**Why:** Deleting and recreating a block would temporarily expose the original hours and lose the block on rejection. Opposite clinician/block lock orders can deadlock concurrent edits and removals.

**How to apply:** Keep updates atomic and preserve block identity and creation evidence. Maintain a consistent clinician-first lock order for time-off mutations.

Present hourly blocks inside **Time Off / Vacation**, not as a separate type. Default **All day** on for the existing date-range holiday workflow; switch it off for a single date and whole-hour range. Keep the optional one-off availability feature separate.

**Why:** The user approved keeping the two familiar availability/time-off choices and combining both lengths of absence within time off.

**How to apply:** Preserve this unified entry point when changing scheduling controls; do not reintroduce a separate hourly-block option.
