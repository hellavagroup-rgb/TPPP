---
name: Safe booking feature fallback
description: Recovery must keep clinician fixes and preserve live booking data and additive schema.
---

The user wants a recovery version of the workflow before online booking that retains both later clinician permission fixes, while leaving the current application active.

**Why:** They requested a tested fallback before publishing and explicitly do not want to lose the deletion or Online/In-person editing fixes.

**How to apply:** Consult `recovery/README.md` for the pinned recovery version and portable source patch. Preparation does not authorise activation or publication. Treat it as code-only recovery, not an old-database restore; retain additive schema and review outstanding reservations, invitations and payments before cutover. Later schema changes also need preserving.
