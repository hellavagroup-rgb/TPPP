---
name: tsx dev mode does not type-check
description: Why missing imports (e.g. an unimported Drizzle table) can run fine in dev but crash only on rarely-exercised code paths, including in production.
---

The dev workflow runs the server with `tsx server/index.ts`, which transpiles TypeScript by stripping types — it does NOT run the TypeScript type-checker. This means a reference to an unimported symbol (e.g. a Drizzle table like `tenants` used in a query but never imported into that file) will NOT be caught at build/start time. It only throws a `ReferenceError` at runtime, and only when that specific code path actually executes.

**Why:** A production incident occurred where `getTenantById` in `server/storage.ts` used the `tenants` table without importing it. The server started fine and most routes worked, but any request that called `getTenantById` (e.g. building a tenant-scoped email during password reset) threw `ReferenceError: tenants is not defined` and returned 500. This went unnoticed because that specific code path had never been exercised/tested.

**How to apply:** When a route/function has never been manually tested (especially less-common flows like password reset, invites, edge-case admin actions), don't assume "the app starts and other routes work" means it's bug-free — grep for whether every table/type it references is actually imported in that file, or actually exercise the code path once (curl/click through it) before considering it done. Consider running `tsc --noEmit` periodically to catch this class of bug across the whole codebase.
