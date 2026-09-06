---
name: Delivery status after provider acceptance
description: Rule for workflows whose status tells staff that an email was sent.
---

Only advance to an email-driven status such as “Options Sent” after the email provider explicitly accepts the send. Missing configuration, missing recipient details, and rejected or unknown sends must return an error and preserve the recoverable prior state.

**Why:** A real allocation silently skipped its email because the public base URL was absent, while the endpoint returned success and moved the client to “Options Sent.” Staff had no indication that the client received nothing.

**How to apply:** For any workflow where a status asserts delivery, validate prerequisites before mutation, check the structured email result rather than relying on exceptions, and provide an explicit retry path for records already awaiting recipient action.