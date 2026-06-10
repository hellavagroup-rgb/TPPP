---
name: Express middleware mount path stripping
description: When middleware is mounted at a prefix with app.use('/api', fn), req.path inside the middleware is the path AFTER the prefix.
---

When you register middleware with `app.use('/api', fn)`, Express strips the mount prefix from `req.path` inside `fn`.

So for a request to `POST /api/auth/login`:
- `req.path` inside the middleware = `/auth/login` (NOT `/api/auth/login`)
- `req.originalUrl` = `/api/auth/login` (full path, unchanged)

**Why:** This is standard Express behaviour to allow sub-routers to be path-agnostic.

**How to apply:** Any open-path bypass list inside a prefixed middleware must use paths WITHOUT the mount prefix. Use `req.originalUrl` if you need the full path, or strip the `/api` prefix from all path strings.

Burned by this in `server/middleware/tenant.ts`: open-paths listed `/api/auth/login` but needed `/auth/login`, causing login to return 401 even after it was added to the bypass list.
