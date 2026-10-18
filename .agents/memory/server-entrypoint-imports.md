---
name: Server entrypoint imports
description: Keep reusable service imports independent of application startup.
---

Reusable server services and unit tests must not import the application entrypoint merely for helpers.

**Why:** A service-to-entrypoint import cycle caused the full regression suite to start Express during module loading and access route imports before initialisation. Importing a large route module just for a small response helper also exceeded a unit test's cold-import timeout.

**How to apply:** Keep reusable helpers in side-effect-free modules. Test response helpers directly; use integration tests for route registration. Do not solve startup import cycles by masking unhandled rejections or increasing timeouts.
