---
name: Per-tenant feature flags must be checked on every page that renders the feature
description: Why gating a field/section in one view (e.g. admin) is not enough — every other view showing the same data needs the same check.
---

## The rule
This app has per-tenant JSON feature flags (e.g. `tenants.clinicianProfileConfig.showTier`,
`showTherapyMode`) that let individual tenants hide fields that don't apply to their practice.
When a flag like this is added, it must be checked independently on **every** page/component that
can render that field — not just the primary admin view.

**Why:** `showTier` was correctly wired into the admin-facing clinicians list (`clinicians.tsx`), but
the clinician's own self-service "My Information" page (`clinician-profile.tsx`) never fetched
`/api/tenant` or checked the flag at all, so it always showed the Practice Tier field/badge even for
tenants that had explicitly turned it off. The two pages render overlapping data but are separate
components with no shared gating logic.

**How to apply:** when adding or auditing a per-tenant `*ProfileConfig`/feature-flag field, grep for
every page that reads the underlying data field (e.g. `tier`, `therapyMode`) and confirm each one also
fetches tenant config and gates on the same flag — don't assume gating one view covers the rest.
