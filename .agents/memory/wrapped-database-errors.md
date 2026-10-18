---
name: Wrapped database errors
description: Database conflict handling must account for Drizzle's nested PostgreSQL errors.
---

Classify database failures using structured PostgreSQL codes and constraints across the error cause chain, not substring checks on the outer message. Apply this consistently to user-facing conflicts and retry/idempotency recovery.

**Why:** Drizzle can wrap a unique-constraint failure in an outer error containing only the failed query and parameters. Looking only at that outer message hid a valid duplicate-client rejection behind a generic server error. Raw query messages can also contain client information and must not become user-facing copy.

**How to apply:** Test both direct driver errors and wrapped errors. Keep duplicate protection in place, preserve existing clinical records, and return a safe explanation without exposing another practice's client details.
