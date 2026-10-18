---
name: Feature flags must not hide workflow records
description: Keep existing client records visible when workflow capabilities are disabled.
---

Feature flags may enable controls, automation, labels, and alternate workflow paths, but they must not determine whether an existing client status belongs to a visible column.

**Why:** Clients already in OptionSelected, RegistrationPending, or BookingConfirmed disappeared from the board when Multi-Clinician Allocation was disabled because those statuses were conditionally removed from every column.

**How to apply:** Derive record visibility from persisted status and explicit booking evidence, not feature flags. Confirmed records belong in the Confirmed view rather than active Kanban; explicit WriteUpp arrangements are staff-confirmed without inventing portal verification. Apply feature flags to actions or presentation. Test visibility with flags enabled and disabled, and keep unconfirmed or reopened work accessible.

Tenant 2 also needs confirmed clients to remain visible as outstanding admin work until both WriteUpp checkboxes are ticked. Keep this additional working list separate from the unconfirmed booking columns; clients remain in Show Confirmed throughout. Tenant 1 must retain its existing board behaviour.

**Why:** The user approved this after staff missed WriteUpp appointment-entry and data-transfer tasks when registration/payment automatically moved clients out of their working queue.

**How to apply:** Treat manual WriteUpp work as independent of booking/payment confirmation. Do not reverse confirmation, re-request payment, release calendar time or mark a booking completed when clearing the working list. Only saved checks clear the task; failed saves must leave it visible. Archived and completed records stay in their dedicated views.