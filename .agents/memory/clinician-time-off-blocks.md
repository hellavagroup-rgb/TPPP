---
name: Date-specific clinician time off
description: Product rules for clinician time-off blocks and tenant activation.
---

Clinician time-off blocks are limited to specific calendar dates and must not remove or alter recurring availability. If a block overlaps an appointment or reservation, reject the block until the existing booking is resolved; never cancel, move, or edit that booking automatically. Keep the feature disabled by default and do not guess a practice identity when enabling it.

**Why:** The user chose date-specific hourly blocks, conflict rejection, and staged tenant activation to protect existing bookings and other practices.

**How to apply:** Any availability display or assignment check for a recurring slot must include its occurrence date. Enable the feature only after the intended tenant has been authenticated and confirmed.
