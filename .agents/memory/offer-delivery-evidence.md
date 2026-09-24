---
name: Offer delivery evidence
description: Distinguish historical option creation from confirmed email delivery in staff displays.
---

Treat an option's creation timestamp as creation evidence, not as proof of email delivery. Older options may have been created without a durable send timestamp; show the recorded option and its state, but label the send time unavailable rather than implying an email was sent at creation.

**Why:** Some older allocation attempts created option rows before email delivery, and failed delivery could leave unavailable option rows. Equating row creation with delivery would mislead staff.

**How to apply:** In allocation history, reports, or exports, only use a recorded successful-send timestamp as a send timestamp. Do not reconstruct delivery times from option creation.