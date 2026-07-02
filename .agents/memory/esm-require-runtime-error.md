---
name: require() throws in ESM projects at runtime, not compile time
description: Why a stray require('module') call in an ESM ("type": "module") codebase can sit unnoticed until the exact code path runs.
---

## The rule
In a project with `"type": "module"` in `package.json`, `require(...)` is not defined at runtime
(no CJS interop shim). A call like `require('crypto').randomBytes(...)` compiles fine under `tsx`
(no type-checking in dev, see the tsx-dev-no-typecheck lesson) but throws
`ReferenceError: require is not defined` the moment that line actually executes.

**Why this is dangerous:** it silently breaks any code path that isn't exercised by day-to-day
manual testing — e.g. a "forgot password" flow that nobody triggers often. The route still returns
a generic 500/error response, so the bug can look unrelated to its real cause (in this app it made
the token-generation step fail, while a *second*, independent bug — a missing frontend route for
the reset-link landing page — was the more visible symptom).

**How to apply:** grep for `require(` in any ESM project before trusting that a code path works;
use the already-imported ESM module or `await import(...)` instead. When debugging a broken flow
that "sends an email/link" but the destination 404s or errors, check both ends independently: (1)
does the link-generating endpoint actually run without error, and (2) does a route exist to consume
the link — don't assume fixing one half fixes the other.
