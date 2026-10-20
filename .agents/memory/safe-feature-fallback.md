---
name: Safe booking feature fallback
description: Recovery must keep clinician fixes and preserve live booking data and additive schema.
---

The user wants a recovery version of the workflow before online booking that retains both later clinician permission fixes, while leaving the current application active.

**Why:** They requested a tested fallback before publishing and explicitly do not want to lose the deletion or Online/In-person editing fixes.

**How to apply:** Consult `recovery/README.md` for the pinned recovery version and portable source patch. Preparation does not authorise activation or publication. Treat it as code-only recovery, not an old-database restore; retain additive schema and review outstanding reservations, invitations and payments before cutover. Later schema changes also need preserving.

Do not assume an ignored recovery worktree is still attached to its own Git repository after a managed workspace update.

**Why:** Its source files and saved branch survived, but its worktree Git link disappeared; a Git command in that directory resolved to the parent main repository instead.

**How to apply:** Verify the reported repository root before operating on the recovery worktree. The pinned tag and tracked portable patch, not the temporary checkout, are the durable recovery sources.
