---
name: Booking harness reservation states
description: Testing stricter manual confirmation without changing automated allocation behavior.
---

Do not infer from an assigned clinician and slot in an HTTP test fixture that availability is already reserved. Automated option selection and registration paths can begin with an unreserved slot and claim it at a later step. Test manual reservation preconditions with explicitly reserved fixtures, rather than weakening the manual rule or implicitly changing automated paths.

**Why:** Stronger slot-reservation checks initially broke unrelated registration and payment reconciliation tests because their fixtures represented a different point in the workflow.

**How to apply:** When testing booking preconditions, distinguish the source and timing of assignment from the slot's reservation state; preserve separate tests for manual and automated confirmation.