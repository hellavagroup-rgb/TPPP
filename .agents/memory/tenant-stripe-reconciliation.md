---
name: Tenant-owned Stripe reconciliation
description: Provider authority and tenant boundary for recovering missed registration payments.
---

Payment recovery is not an administrative assertion of payment. Require independent provider confirmation against the practice's own Stripe account and current client payment attempt, amount and currency before persisting payment evidence or confirming a booking. A missing provider response is uncertainty, not an unpaid result.

**Why:** A shared global Stripe key can silently override a tenant key in legacy helpers, and a signed webhook may be delivered while app persistence or schema access fails. Neither the local pending state nor a checkout redirect proves payment.

**How to apply:** Keep recovery behind explicit tenant opt-in. Fail closed on missing tenant credentials, mismatched ownership or amount, and provider errors. Keep repeated staff and webhook recovery idempotent; never create a new payment request as a side effect of reconciliation. Legacy registration links may belong to a globally configured account even when the practice also has its own key. Do not change the account used to create links independently of the webhook and later off-session charging paths; if a historic link is not in the practice account, stop rather than treating a global-account payment as tenant-owned recovery evidence.

An intent marked succeeded and a checkout marked paid establish the original collection, not an unrefunded balance. Check the underlying charge's refunds and disputes before treating historical payment as current payment authority.

**Why:** A live audit found a fully refunded checkout whose payment intent still showed succeeded. A cancelled/waitlisted client must not be restored or charged again just because historical payment exists.

**How to apply:** Separate current-attempt, unrefunded payments from old attempts, refunds and cancelled bookings. Preserve staff-reviewed external appointments: payment evidence may need repair independently of booking confirmation, rather than clearing diary acknowledgements or creating a second portal booking.