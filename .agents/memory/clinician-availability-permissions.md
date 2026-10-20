---
name: Clinician availability permissions
description: Clinicians may edit or delete their own free slots; occupied WriteUpp retirement remains administrator-only.
---

Clinicians must be able to remove their own unbooked availability without administrator access. Occupied WriteUpp retirement remains administrator-only, and booked slots stay protected.

Clinicians may also switch their own unbooked slots between online and in person. Administrators may edit any free slot within their own practice; booked and retired slots remain protected for both roles.

**Why:** The user explicitly approved ownership-scoped format editing, not administrator promotion or unrestricted changes to other clinicians' availability.

**Why:** The user confirmed this permission boundary after a production regression made ordinary clinician deletion depend on an administrator-only preview. That preview rejected clinician accounts and disabled deletion even for free slots.

**How to apply:** Check both clinician and administrator paths when changing shared availability dialogs. Never require an administrator-only preflight for ordinary own-slot deletion or reuse an administrator's cached approval for a clinician. Keep server ownership and active-booking checks authoritative.

Slot management actions must be discoverable without mouse hover, including on touch devices.

**Why:** The user reported that clinicians still could not delete slots after the dialog permission fix because they could not see the trash icon. Testing the dialog alone missed the calendar entry point.

**How to apply:** Exercise the actual calendar-to-dialog action with a clinician role, including ownership and booked-slot restrictions, rather than testing only an already-open dialog.
