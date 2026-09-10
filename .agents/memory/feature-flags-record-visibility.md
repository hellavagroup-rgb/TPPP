---
name: Feature flags must not hide workflow records
description: Keep existing client records visible when workflow capabilities are disabled.
---

Feature flags may enable controls, automation, labels, and alternate workflow paths, but they must not determine whether an existing client status belongs to a visible column.

**Why:** Clients already in OptionSelected, RegistrationPending, or BookingConfirmed disappeared from the board when Multi-Clinician Allocation was disabled because those statuses were conditionally removed from every column.

**How to apply:** Derive record visibility and column membership from persisted status alone. Apply feature flags inside the visible record to actions or presentation. Test every feature-specific persisted status with the flag both enabled and disabled.