---
name: Tenant-scoped email evidence
description: Why intake invitation delivery diagnostics use tenant-owned message IDs
---

For shared email-provider accounts, retrieve event evidence only for a message ID already linked to a delivery owned by the authenticated tenant. Provider acceptance means the provider accepted the request, not that the recipient mailbox received it. A delivered event is provider evidence, not proof of inbox placement.

**Why:** Shared provider accounts can hold messages for multiple practices; global searches or unverified event metadata risk exposing another practice's messages. Historical sends without stored provider IDs cannot be verified retrospectively from the delivery row. Polling a stored message ID is intentionally preferred to trusting an unsolicited event's claimed tenant; an event-ingestion alternative must first establish authenticity and resolve ownership from persisted delivery records.

**How to apply:** When adding event ingestion, lookups, or reporting, establish tenant ownership from a trusted delivery first. Keep recipient and sender diagnostics staff-only, and never fetch or log clinical message bodies.