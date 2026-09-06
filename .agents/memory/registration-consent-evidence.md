---
name: Registration consent evidence
description: How registration terms acceptance remains singular and auditable.
---

The registration form's designated agreement question is the only consent control. A separate generic checkbox must not duplicate it.

**Why:** A consent flag alone does not prove which wording the client saw, while two controls create contradictory answers and unnecessary friction.

**How to apply:** Derive acceptance server-side from the designated form response, reject stale form revisions, and atomically retain the response, immutable template snapshot, exact terms text, terms version, and server acceptance timestamp.