---
name: Allocation slot ownership
description: Which client workflow stages already own a clinician appointment slot.
---

OptionSelected and RegistrationPending are allocated states because the selected slot is already reserved before registration and payment complete. Moving backward from either state to an unallocated stage must release the slot and clear the client assignment, just as rollback from BookingConfirmed does.

**Why:** Treating only BookingConfirmed as the end-state with slot ownership left a client at Forms Completed while their previously selected slot remained booked and greyed out.

**How to apply:** Any rollback or repair logic must classify slot ownership by whether the stage can carry a reserved slot, not by whether booking and payment have finished. Keep OptionSelected and RegistrationPending in the allocated-state set.

Returning an allocated client to Forms Completed is a workflow rollback, not first-time intake completion. Do not require a new designated intake delivery for that return.

**Why:** Historical clients can already have a completed intake submission but no modern delivery record. Reapplying the initial completion check prevents staff from replacing an unsuitable appointment.

**How to apply:** Preserve existing intake evidence and its completion date. Invalidate discarded appointment choices, registration tokens and in-flight registration delivery claims together with releasing the assignment. Preserve any slot retirement; releasing a reservation must not make a retired slot offerable again. Keep first-time intake completion checks for the intake stages.