---
name: Clinician availability permissions
description: Keep ordinary own-slot management separate from administrator-only occupied WriteUpp retirement.
---

Clinicians must be able to remove their own unbooked availability without administrator access. Occupied WriteUpp retirement remains administrator-only, and booked slots stay protected.

**Why:** The user confirmed this permission boundary after a production regression made ordinary clinician deletion depend on an administrator-only preview. That preview rejected clinician accounts and disabled deletion even for free slots.

**How to apply:** Check both clinician and administrator paths when changing shared availability dialogs. Never require an administrator-only preflight for ordinary own-slot deletion or reuse an administrator's cached approval for a clinician. Keep server ownership and active-booking checks authoritative.
