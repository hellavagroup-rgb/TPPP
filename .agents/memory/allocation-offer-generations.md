---
name: Allocation offer generations
description: Rules for replacing appointment-option offers without exposing stale choices.
---

A newly sent allocation offer must replace all prior options for that tenant-owned client. Email, portal, resend, and selection behavior must operate on the same current generation rather than an append-only history.

**Why:** Old pending options can survive a workflow rollback. Appending a new selection and querying every historical row caused clients to receive duplicate options and left obsolete selection links active.

**How to apply:** Invalidate or remove the previous tenant-scoped option set before creating a replacement, and build outbound email from the rows created by that attempt rather than a broad client-history query.