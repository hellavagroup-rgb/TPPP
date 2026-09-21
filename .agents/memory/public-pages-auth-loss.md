---
name: Public pages and staff-session loss
description: Prevent staff authentication recovery from hijacking unauthenticated client journeys.
---

Public client journeys must not invoke the global staff-session-loss redirect when one of their API requests returns 401. Every API used by a public page must also be explicitly permitted by tenant middleware.

**Why:** A missing public middleware exemption caused the intake form’s completion-copy request to return 401. The global auth-loss handler interpreted that as an expired staff session and redirected the client’s valid form link to the staff login page.

**How to apply:** When adding or changing a public form, option, registration, or payment page, verify every mounted API is public and ensure auth-loss handling distinguishes public locations from protected staff routes.