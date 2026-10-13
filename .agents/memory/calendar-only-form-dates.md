---
name: Calendar-only form dates
description: Prevent DOB day shifts and avoid guessing corrections for historical form answers.
---

DOBs and other date-only form answers must remain calendar-day strings, not UTC timestamps. Apply this to selection, draft saving/restoration, submission, staff display and exports; leave actual event timestamps unchanged.

**Why:** A public form calendar returned local-midnight Date objects. JSON serialization converted UK summer-time selections to 23:00 UTC on the previous day. Staff could therefore see a DOB one day earlier than the family selected.

**How to apply:** Preserve the selected local year/month/day before JSON serialization, and reconstruct a local calendar date only for the picker. Verify summer/winter, DST transitions, leap days and multiple browser timezones. Do not bulk-add a day to historical DOBs or infer their original browser timezone from the current staff browser; correct existing clinical answers only against verified original information.
