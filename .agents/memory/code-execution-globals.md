---
name: Code execution sandbox globals
description: Buffer availability and partial file writes when a durable notebook block fails.
---

Do not assume Node's `Buffer` is available in the durable top-level sandbox. Pass the text into a small `"use impure"` function for `Buffer.byteLength`, or measure the written asset with the shell.

**Why:** A report block wrote its CSV successfully, then failed when measuring HTML with a top-level Buffer call. The tool surfaced a replay-termination error rather than the underlying missing-global error. Buffer was unavailable at the durable top level but worked inside an impure function.

**How to apply:** Keep callbacks outside impure functions. If a file-producing block fails, inspect its output paths before retrying: completed file writes can survive even when variables from the failed block are unavailable in later notebook calls. Recover from the existing file rather than assuming nothing was written.

Do not assume the `URL` constructor is available at the durable top level either.

**Why:** Constructing a webhook URL there raised `URL is not defined` after read-only callbacks had already completed.

**How to apply:** For a verified canonical deployment origin and a fixed route, append the route after stripping trailing slashes. For general URL parsing, use a small impure helper. Inspect completed work before retrying a partially failed block, especially when it could include an external mutation.
