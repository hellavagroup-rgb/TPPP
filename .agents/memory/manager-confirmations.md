---
name: Manager confirmation authority
description: The distinction between administrative manager confirmations and verified portal bookings.
---

Manager overrides use a separate practice PIN and are restricted to selected admin accounts, not every administrator.

**Why:** The user chose these controls so practice managers can move historical clients to Confirmed despite incomplete portal evidence.

**How to apply:** Check both current practice-scoped manager authority and the PIN on the server. Require a reason and retain who acted and when. Keep the PIN private, hashed, rate-limited and configured inside the app, never through chat.

A manager confirmation is an administrative declaration, not proof of payment, registration, consent or a verified portal booking. Label it as a manual override and do not create booking snapshots or send booking confirmation emails.

**Why:** Clearing historical queues must not fabricate missing evidence or create a second booking. Ordinary confirmation and provider-reconciliation safeguards remain authoritative outside this explicitly authorised override.

**How to apply:** Preserve existing evidence and appointment ownership. If staff explicitly reopen the workflow, the previous override remains historical audit evidence rather than the current booking authority.

First-time configuration requires an authenticated admin's own password and includes that account among the selected managers. After setup, only selected managers may change the PIN or approvals.

**Why:** The project has no separate practice-owner role; this permits initial setup without enabling unselected admins to reset the PIN or grant themselves override permission afterwards.

The normal Edit Status → Confirmed action must expose the manager PIN flow to approved managers, not leave it available only through a separate toolbar button.

**Why:** The user tried that existing action and encountered the normal payment blocker without a PIN prompt.

**How to apply:** Carry the current client into the protected confirmation dialog. Explain setup or approval requirements when unavailable; never bypass checks for other admins or silently discard a proposed reassignment.
