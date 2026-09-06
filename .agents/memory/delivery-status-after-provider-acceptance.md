---
name: Delivery status after provider acceptance
description: Rule for workflows whose status tells staff that an email was sent.
---

Only advance to an email-driven status such as “Options Sent” after the email provider explicitly accepts the send. Missing configuration, missing recipient details, and rejected or unknown sends must return an error and preserve the recoverable prior state.

**Why:** Status labels are operational promises to staff; advancing before confirmed acceptance can make an unsent message look delivered.

**How to apply:** For any workflow where a status asserts delivery, validate prerequisites before mutation, check the structured email result rather than relying on exceptions, and provide an explicit retry path for records already awaiting recipient action.