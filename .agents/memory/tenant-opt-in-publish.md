---
name: Tenant opt-ins at publish
description: Why a schema-only publish does not carry migration data updates that turn on tenant features.
---

Do not assume that SQL data updates in a migration file will activate a tenant feature when publishing. Replit's managed-database Publish flow computes a development-to-production **schema** diff; separately verify the approved opt-in values in production after publication.

**Why:** A migration can add a flag with a false default and then set it true for selected practices in development. The schema diff adds the column but does not replay that migration's data update for the production practices. Development may not even contain the same set of practices.

**How to apply:** Before publishing tenant-specific changes, review the actual Publish UI diff for destructive operations, agree on the intended practice opt-ins, and after authorized publication verify each practice's flags via read-only inspection before claiming its feature is active.