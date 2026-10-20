# Tested recovery version: before online booking, with clinician fixes

## What is saved

This is a separate, tested recovery version, not an activated rollback and not a
Replit timeline checkpoint. The current application still contains the online
booking feature and both clinician permission fixes.

- Recovery branch: `fallback/pre-online-booking-with-permission-fixes`
- Pinned recovery tag: `recovery/pre-online-booking-with-permission-fixes`
- Recovery commit: `b3a6629ae7bb80986736719fd1c77d8ef3d5c13d`
- Baseline before the booking feature: `137a403`
- Current application source preserved during preparation: `52a8dff`
- Portable source patch: `recovery/pre-online-booking.patch`
- Preparation date: 2026-10-20

The recovery version removes the new clinician invitation/online booking,
flexible reservation, and reservation-sweeper runtime code. It restores the
previous booking workflow while preserving:

1. Clinicians deleting their own free slots without an administrator-only
   WriteUpp preview; booked slots and occupied WriteUpp retirement remain protected.
2. Clinicians changing their own unbooked slots between online and in person.
   Administrators may edit free slots within their own practice. Other clinicians'
   slots, booked/retired slots, active client ownership and booking history are
   protected.
3. The CURRENT additive database schema and the new table-creation migration.
   Existing new-feature rows are retained, not erased.
4. Small independent login/logging helper extractions from the current version,
   preventing the older server-entrypoint import cycle. These do not enable the
   removed booking workflow.

The patch is the full source difference from the baseline to the recovery
version, including new files. It is checked into the main project so an ordinary
project checkpoint also retains a portable copy if the local branch is lost.
Do not apply it to current application files; it is intended for reconstructing
the saved recovery version from its baseline.

## Verification

- All 924 tests in the recovery version passed across 66 files.
- Production client and server build succeeded.
- Database-backed permission/ownership tests used temporary isolated schemas,
  not practice records.
- No runtime references to the removed booking entrypoints, sweeper, guards or
  clinician-invitation controls remained.
- Recovery and current `shared/schema.ts` were byte-for-byte identical:
  SHA-256 `5ec6879550efc88583fb385aa81e7b36bb6a0e87c80396b81c071c551ad21429`.
- Current application source was not changed or switched during preparation.
- Existing project typecheck errors remain; neither version has a clean
  project-wide typecheck. Build and test success are not a claim otherwise.
- No live deployment or production data was changed. The signed-in recovery
  screens were covered by automated tests, not a live signed-in visual check.

## How to request activation

Tell Replit Agent:

> Restore the saved pre-online-booking fallback, keeping both clinician fixes.
> Keep live records and database structures intact.

An agent must obtain explicit approval to activate the recovery version. Merely
creating this backup is not permission to switch the project or publish.

Before restoring application code:

1. Save any subsequent work. Verify the pinned tag still points to the recovery
   commit above. If it is unavailable, reconstruct in a separate working copy
   from the baseline plus the portable patch, then test.
2. Inspect live new-feature invitations, reservations, payment attempts and
   incoming webhooks using read-only production queries. This older workflow
   does not serve new booking links or run the reservation sweeper. Existing
   outstanding bookings/payments need a deliberate cutover plan; do not silently
   release slots, cancel reservations, resend emails or invent payment evidence.
3. Compare the CURRENT published schema to the recovery schema again. It was
   identical at preparation time, but later changes must also be preserved.
   Never restore an old production database, drop new tables/columns, delete
   records, or run a destructive old-schema push as part of code recovery.
4. Restore the approved application code from the recovery tag, preserving
   current recovery documents, ignore rules, later additive schema changes and
   unrelated later work. Do not blindly reset the whole workspace.
5. Build, run relevant tests, restart and check the preview. Only then ask the
   user to republish. Restoring workspace code does not change the live site.
6. After publishing, verify clinician slot management, administrator access,
   existing booking/payment processing and any clients affected by the cutover.

This is a quick-to-identify code recovery option, not an instant production
switch or a substitute for checking bookings created since publication.

## Payment safety in the current version

The earlier booking-feature review identified a payment reconciliation risk
when flexible booking is enabled without payment reconciliation: a legacy path
can replace a payment link, while reservation settlement checks the client's
current link rather than reliably accounting for the earlier attempt. Preparing
this recovery version did not repair that risk in the current application.

The current workflow now requires payment reconciliation before new flexible
bookings are available, fences payment-link replacement for reservations even if
that setting is later disabled, and pins the payment attempt and link to the hold.
Settlement, registration recovery and webhook confirmation cannot adopt a
different current-client link in place of that evidence. Changed or missing
historical identity retains the slot for staff payment review; it does not prove
that an earlier link was unpaid. Expiry and cancellation preserve the original
payment references.

This is a conservative safeguard, not a historical data repair. No existing rows
have been backfilled or released. Before enabling the workflow, staff must resolve
any existing payment-review holds by checking all relevant attempts in the
practice's own Stripe account. Do not clear payment references or swap links to
bypass review. The saved recovery version remains unchanged and inactive.
