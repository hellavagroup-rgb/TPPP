---
name: Stripe webhook subscriptions
description: Initial checkout processing requires an explicit event subscription, not just valid credentials.
---

Verify that the practice's enabled production Stripe endpoint subscribes to `checkout.session.completed`. Stored keys, a signing secret, and successful responses to other payment events do not prove that initial payment processing works.

**Why:** A real practice endpoint subscribed to payment-intent and charge events but omitted checkout completion. Stripe collected payment while the portal retained setup-pending state. The other events were acknowledged successfully, and no checkout-processing failure existed to alert staff.

**How to apply:** Inspect the tenant-owned Stripe account's endpoint URL, live mode, enabled status and event subscriptions. Preserve other subscriptions when adding the required event. Distinguish configuration presence from verified integration health. Do not reconnect or replace keys merely because an event subscription is missing.
