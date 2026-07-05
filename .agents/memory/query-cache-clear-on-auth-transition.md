---
name: Clear the client-side query cache on both login and logout, not just invalidate
description: In multi-tenant/multi-account apps, TanStack Query (or similar) caches must be fully cleared on auth transitions, or stale data from a previous session can leak into the next one on a shared device.
---

`queryClient.invalidateQueries()` is not sufficient on login/logout in an app where different users (or different tenants) can authenticate on the same browser session. Invalidation only marks currently-mounted queries as stale and triggers a refetch for them — it does not purge unmounted query cache entries. Any cached data under an un-namespaced query key (e.g. `["/api/clinicians"]`) can still be read from cache and briefly rendered before a refetch completes, or served indefinitely if nothing remounts that query.

**Why:** This was the root cause of a real incident where a Tenant 2 clinician saw Tenant 1 clinicians' availability data after logging in on a device previously used by a Tenant 1 session — the query cache simply wasn't cleared, so stale cross-tenant data persisted.

**How to apply:** Call `queryClient.clear()` (full cache wipe) in both the login success path and the logout path of the auth provider, not just invalidate. This matters even more when query keys are not tenant-namespaced (e.g. keyed only by resource type, not by `tenantId` or `userId`).
