---
name: HTML emails do not auto-linkify plain-text URLs
description: Why a shared "wrap plain text into an HTML email" helper must explicitly turn URLs into <a> tags.
---

## The rule
When building HTML emails from user/admin-authored plain text (e.g. an editable template body with
`{{link}}` placeholders), do not assume the URL will be clickable just because it renders inside the
HTML `<body>`. Plain-text email clients auto-linkify bare URLs; HTML-rendering clients generally do
not — a URL sitting inside a `<p>` tag with no `<a href>` wrapper shows as inert text.

**Why:** In this app, a shared `wrapInHtmlTemplate()` helper converted each line of an admin-edited
template into a `<p>` tag verbatim. It worked fine for templates with hardcoded HTML (which already
had real `<a href>` buttons), but any admin-editable template (password reset, invite, form link,
reminders) rendered its `{{link}}` placeholder as plain unclickable text once substituted.

**How to apply:** any function that converts free-form template text to HTML for email must run the
text through a URL-linkify step (regex-detect `https?://...` and wrap in `<a href="...">`) before
wrapping lines in `<p>`. Test by actually rendering the HTML output of the *stored/editable* template
path, not just the hardcoded fallback path — they can diverge silently since only one of them is
exercised by casual manual testing.
