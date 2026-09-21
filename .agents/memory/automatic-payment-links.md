---
name: Automatic payment link workflow
description: Product decision for payment-link creation in the registration and booking workflow.
---

In the new workflow, payment-link creation and delivery are automatic as the client completes the process. Administrators do not need early manual payment-link creation. Once a link exists, administrators must be able to copy or resend that same persistent link.

**Why:** A manual creation action duplicates the automated progression and creates uncertainty about which path staff should use. Routine replacement can also leave multiple payable links or invalidate the link the client already has.

**How to apply:** Show payment progress and failures to administrators. For an awaiting-client state, expose the existing link with copy and resend actions. Reserve recovery for failures; do not present routine replacement or early creation as the normal workflow.