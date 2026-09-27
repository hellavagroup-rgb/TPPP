# Tenant booking release check

Assessment date: 27 September 2026. This is a pre-publish check, **not** a certification of the live release.

## Current evidence

- The local confirmation path now looks up an existing booking snapshot by both client and tenant. An inconsistent foreign snapshot cannot be returned as the current tenant's confirmed booking. The globally unique client index also prevents insertion of a second snapshot for that client, so inconsistent data stops booking finalization rather than silently replacing evidence. If Stripe has already verified payment, payment evidence remains recorded while booking finalization reports a blocker; staff must not send another payment request.
- Request-level tests cover opted-in confirmation, the legacy unopted practice path, administrator-only confirmation/completion, foreign clients, foreign snapshots, concurrent confirmation/completion, and repeat/reopen behavior. Payment reconciliation already has request-level concurrent, tenant, provider-evidence and unopted-practice cases in the same suite.
- Read-only development/production schema comparison found 327 development columns versus 295 production columns: 32 development-only columns (including five tenant opt-ins and `clients.completed_at`) and zero production-only columns. Development has five additional indexes on two new tables; production has no additional index names. The latest queried production schema does **not** contain the recent opt-ins, so their live behavior is not yet verified.
- The development database currently has only one practice and the four queried booking/reconciliation opt-ins are all off. Automated two-practice request tests use isolated fixtures; the development data cannot itself establish the intended live opt-ins for both practices.
- `npm test` passed (client build and all 427 tests as checked on this date). `npm run check` remains red with 42 errors outside the changed booking confirmation/test files; do not treat this as a passing type-check gate. The separate client type-check issue is already tracked.
- This comparison does not inspect every constraint, migration data update, or the SQL statements that the Publish UI will generate. It must not be mistaken for approval of a destructive schema change.

## Before a separately authorized publish

1. Confirm the automated tests and build pass on the exact source revision being published. Establish the intended opt-ins for each production practice from an approved rollout plan; the single-practice development database cannot validate this. Do not assume a migration file's data update runs during a schema-only publish diff.
2. Inspect the Publish UI's actual schema diff. Expect additive columns and the new delivery/failure tables and indexes. **Stop** if it proposes a drop, rename without an explicit reviewed mapping, replacement of production data, unexpectedly destructive change, or an unreviewed type/default change. Do not choose “overwrite data.”
3. Keep the tenant flags off unless the practice has explicitly opted in. Schema default `false` does not automatically establish the intended existing-tenant flag values after a publish.

## After an authorized publish (not yet performed)

Use staff accounts in each practice to **read** the tenant features and client list and confirm that only the intended practice has each opt-in. Check a representative existing confirmed booking snapshot and the ordinary Tenant 1 workflow without changing any real client's state. For Tenant 2, check that staff can see the expected booking/completion state and relevant blockers, and that existing records remain assigned to the correct practice. Review application errors and confirm there are no unexpected tenant mismatches. Do not click a button that confirms/completes/reopens a real booking, sends an email, creates a payment link, or invokes a provider check solely for a smoke test. Any such end-to-end test needs a separate approved synthetic record and safe delivery/payment setup.

Record the build identifier, schema diff approval, opt-in values, observations for both practices, and any exceptions before describing the release as verified. Passing these checks reduces risk; it cannot guarantee no future regression or third-party outage.