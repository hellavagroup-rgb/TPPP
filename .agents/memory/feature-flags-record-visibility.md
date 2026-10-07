---
name: Feature flags must not hide workflow records
description: Keep existing client records visible when workflow capabilities are disabled.
---

Feature flags may enable controls, automation, labels, and alternate workflow paths, but they must not determine whether an existing client status belongs to a visible column.

**Why:** Clients already in OptionSelected, RegistrationPending, or BookingConfirmed disappeared from the board when Multi-Clinician Allocation was disabled because those statuses were conditionally removed from every column.

**How to apply:** Derive record visibility from persisted status and explicit booking evidence, not feature flags. Confirmed records belong in the Confirmed view rather than active Kanban; explicit WriteUpp arrangements are staff-confirmed without inventing portal verification. Apply feature flags to actions or presentation. Test visibility with flags enabled and disabled, and keep unconfirmed or reopened work accessible.