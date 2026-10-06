---
name: Designated intake and registration forms
description: Tenant-level rules for selecting forms used by the intake and registration workflows.
---

Every tenant must have exactly one designated intake form. A tenant with the registration-form feature enabled in Super Admin must also have exactly one designated registration form.

**Why:** Letting staff assemble workflow packets from arbitrary templates allowed registration and obsolete forms to block intake completion.

**How to apply:** Drive automated intake and registration delivery from the tenant designations. Do not infer form purpose from its title or allow unrelated templates into those automated stages. Legacy tenants with no verified intake choice stay explicitly unconfigured. Designated templates must be tenant-owned, distinct, and available; reconfigure them before deletion. Preserve historical deliveries and submissions. In the opted-in new intake workflow, completion requires a final submission for the current designated intake form. Email intake additionally requires its delivery to be completed; phone-assisted intake intentionally has no delivery record.

**Legacy manual workflow boundary:** Tenant 1 staff need to mark Forms Completed for forms handled outside the portal. Manual legacy status completion is not a claim that a designated portal form was submitted.

**Why:** Staff reported that the new shared designated-form check blocked their previously supported manual workflow even though the new-workflow opt-ins were off. Passing a disabled feature into a validator does not necessarily bypass validation; it may select another enforcement branch.

**How to apply:** Keep automated form designation separate from manual legacy status handling. Do not enable Tenant 1's new-workflow flags merely to work around a regression, and preserve the opted-in practice's registration, payment and delivery safeguards.