---
name: Drizzle query builder error handling
description: How to catch failures from awaitable Drizzle query builders in this project.
---

Treat Drizzle query builders as awaitable objects, not full Promises. Wrap `await` in an explicit `try/catch` when cleanup must absorb a database error; do not call `.catch()` directly on the builder.

**Why:** A registration-delivery cleanup path used `.catch()` on the result of `.where()`. The builder was awaitable but had no `.catch()` method, so the cleanup itself threw and left the request unresolved in tests.

**How to apply:** Use explicit `try/catch` around best-effort database cleanup and other places where a query failure must be logged without replacing the original error response.