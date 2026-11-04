---
name: Availability edit promises
description: Preserve offered appointment details and distinguish whole-series edits from single-date changes.
---

A pending fixed-slot offer is a promise about its schedule, not merely a slot ID. Do not edit that slot's schedule in place while the offer is pending.

**Why:** An existing offer link retains its slot identity; changing its schedule would silently change what the client was offered.

**How to apply:** Resolve or replace the fixed offer first. For live-availability booking, bind the submitted choice to the schedule the visitor saw and reject changed times or formats rather than booking a different appointment under the same ID.

Editing recurring availability changes the whole series. Editing one-off availability changes that one date; neither action creates an exception to a recurring series.

**Why:** The user explicitly requested a clear distinction between recurring-series and single-date changes.

**How to apply:** State the edit scope before saving. A future single-occurrence exception must preserve the rest of the series rather than silently changing it.
