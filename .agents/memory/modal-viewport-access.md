---
name: Modal viewport access
description: Keep long staff forms usable when small screens, zoom or warnings increase their height.
---

Long staff dialogs must have a viewport-height limit, an internally scrollable field area and reachable action buttons. Do not rely on scrolling the page behind an open modal.

**Why:** A user could not reach the new-referral Create button when the form exceeded the screen height. Radix's modal scroll lock means background-page scrolling cannot recover an off-screen footer. Extra practice fields and duplicate-email warnings can make the problem appear intermittently.

**How to apply:** Check long-form layouts on short viewports as well as narrow screens, including expanded warnings. Keep fixes local unless auditing shared dialog behaviour explicitly; do not change client creation or duplicate rules to resolve a layout failure.
