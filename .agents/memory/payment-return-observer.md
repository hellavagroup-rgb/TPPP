---
name: Payment return pages are read-only observers
description: Authority and privacy rules for browser returns from hosted payment checkout.
---

The browser return from Stripe must only report provider-verified payment state and the correlated durable workflow state. It must never create payments, confirm bookings, send messages, or record workflow activity.

**Why:** The browser can reach the return URL before the webhook, revisit it later, or supply an unrelated session identifier. Treating the redirect as authority can claim an unconfirmed appointment or expose cross-tenant information.

**How to apply:** Require exact provider, tenant, client, and current-link correlation before returning branding or any workflow result. Registration payments also require current-attempt correlation and may claim booking confirmation only at the tenant's feature-correct terminal state. Ordinary hosted payments may report verified payment without claiming the appointment is confirmed. Leave all mutations to the webhook.