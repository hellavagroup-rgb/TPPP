# The Perinatal Psychology Practice - Client Management System

## Recent Changes (July 2026)
- **Found and fixed the TRUE root cause of the cross-tenant clinician leak (the fix below turned out to be incomplete)**: After the fix directly below shipped, a CY&A (Tenant 2) clinician still reported seeing Tenant 1 availability, while the user's own freshly-created Tenant 2 test account worked correctly — proving the leak wasn't in the query-cache/IDOR fix itself, but in stale data. Root cause: `requireTenant` resolves a logged-in user's tenant from `users.tenantId`, NOT from their `clinicians.tenantId`. The "Add Clinician" flow (`POST /api/clinicians/with-user`) created the login (`users`) row without ever setting `tenantId`, while the linked `clinicians` row was correctly tenant-tagged — so every clinician added this way silently got a blank tenant on their login account. Combined with the historical `/api/admin/seed-tenant` incident (see below) that auto-assigned blank-tenant rows to "whichever tenant was created first," this left **12 real CY&A Psychology clinician accounts permanently pointed at "The Perinatal Psychology Practice"** in production (confirmed via read-only query) — exactly matching the reported symptom — plus 4 Wellness Demo Practice clinicians with a fully blank tenant (broken login, not a leak). Fixed `POST /api/clinicians/with-user` to set `tenantId: req.tenant?.id` on user creation so this can't happen for newly-added clinicians going forward. Since production data writes can't be made directly (read-only DB access) and shouldn't bypass the app's own admin auth boundary, added a **bulk variant** of the existing single-user "Reassign Tenant" super-admin tool (`POST /api/super-admin/users/reassign-tenant-bulk` + a "Bulk Reassign Users to a Different Tenant" card in Super Admin > Users) so the already-corrupted accounts can be repaired in one action instead of 12+ individual ones, once this is deployed. **Lesson for future incidents**: removing a data-corrupting endpoint stops new damage but does not repair existing victims — always check for and remediate rows already corrupted by a since-fixed bug.
- **Fixed cross-tenant clinician availability leak (critical)**: A Tenant 2 clinician reported seeing Tenant 1 clinicians' availability data after logging in. Root cause was two-fold: (1) `client/src/lib/auth.tsx` never cleared the TanStack Query cache on login/logout, so on a shared device, stale data fetched under a previous tenant's session (e.g. `/api/clinicians`) could persist and flash before it was refetched. Fixed by calling `queryClient.clear()` on both login and logout. (2) `GET/POST /api/timeslots/:clinicianId` had no tenant/ownership check at all (IDOR) — any authenticated user could read or write another tenant's clinician's slots by guessing/enumerating a clinician ID. Fixed by looking up the target clinician and verifying its `tenantId` matches the requester's tenant before proceeding; the existing `DELETE` route's check was also hardened to compare against the clinician's `tenantId` (reliable) instead of the slot's own `tenantId` column (which has null values on 32 legacy production rows predating per-slot tenant tagging). While auditing for related issues, also found and fixed: `storage.addTimeSlots` never wrote `tenantId` onto newly inserted slot rows (fixed — now takes an optional `tenantId` param); `GET /api/export/form-responses` had zero tenant filtering, meaning any admin could export **all tenants'** clinical/mental-health form responses (fixed — now scoped to the requester's tenant); `GET /api/email-templates/:key` ignored tenant context and could return the wrong tenant's customized template (fixed). Audited all other admin list/export endpoints (tasks, insurers, non-engagement categories, intake messages, Stripe charges, Gmail connections, clients, form submissions) and confirmed they were already properly tenant-scoped. `/api/forms/:id` is intentionally unauthenticated — it only serves form question definitions (no client data) to the public form-fill flow, matching the threat model's documented public surface. Verified locally (clean restart, no type/runtime errors, login flow unaffected). Requires a production redeploy to take effect.
- **Fixed CY&A Psychology's live Stripe webhook failing on almost every delivery**: Stripe reported 542+ failed deliveries to `/api/stripe/webhook` since June 29, 2026. Root cause: the handler identified which tenant's webhook secret to use by reading `tenantId` out of the *unverified* event body's `metadata` field before checking the signature — but we only ever set that metadata on checkout sessions and payment intents created by our own code. Any other event type Stripe sends (e.g. `customer.*`, `invoice.*`, `payment_method.*`, and most subscription events) has no such metadata, so tenant lookup came back empty and the handler always returned 400 "webhook secret not configured for this tenant," even though CY&A's secret was correctly stored. Fixed by identifying the tenant cryptographically instead: the handler now loops over every tenant with a configured webhook secret and tries `stripe.webhooks.constructEvent` with each one — the tenant whose secret successfully verifies the signature is authoritative, regardless of event type or metadata. A dev-only fallback to a global `STRIPE_WEBHOOK_SECRET` env var remains for local Stripe CLI testing. Also removed a stale conditional so downstream tenant-ownership checks are now always enforced (previously skipped when metadata was absent). Verified locally with simulated signed requests for both a metadata-less event (now succeeds) and a signature that matches no tenant (still correctly rejected with 400). Requires a production redeploy to take effect for CY&A.
- **Added a "Wellness Demo Practice" tenant in production for demo/video recording**: Created via the Super Admin > New Tenant flow so the user can record product demos on the stable published app (no dev-server HMR reload issues) without using real client or clinician data. Seeded with 4 fictional clinicians, 8 fictional clients spanning every workflow status (New/Forms Sent/Forms Completed/Assigned/AwaitingConfirmation/Scheduled/Waitlist/Archived), 2 tasks, and a sample form template — all using `@example.com` addresses. This is a real, permanent tenant alongside "The Perinatal Psychology Practice" and "CY&A Psychology"; do not treat it as a real customer or seed it with genuine PII. Admin login: `demoadmin@example.com` (password known to the user, not stored here).
- **Fixed non-clickable links in admin-editable email templates**: Emails generated from admin-editable templates (Settings > Email Templates) rendered links as plain text instead of clickable buttons/anchors, because the shared HTML wrapper (`wrapInHtmlTemplate` in `server/email.ts`) converted each line to a `<p>` tag without turning URLs into `<a href>` tags. Most email clients (e.g. Gmail rendering HTML mail) do not auto-linkify plain URLs inside HTML, so reset/invite/form links were unclickable. Added a `linkifyUrls()` helper used by `wrapInHtmlTemplate` so any `http(s)://` URL in a stored template's body is now wrapped in a proper link. This affects every admin-editable template (password reset, form invite, task reminder, availability reminder, referrals, waitlist) — the hardcoded fallback templates already used real `<a>` tags and were unaffected.
- **Fixed broken password reset flow**: The "forgot password" email link pointed to `/reset-password?token=...`, but no such page existed in the frontend router, so clicking the link always produced a 404. Separately, the token-generation code called `require('crypto')`, which throws `ReferenceError: require is not defined` in this ESM project — meaning `/api/auth/forgot-password` was failing server-side too. Added the missing `/reset-password` page and matching `GET/POST /api/auth/reset-password` endpoints (validate token, set new password, mark token single-use), fixed the `require` bug to use the already-imported `crypto` module, and added the route to the public-path allowlist and rate limiter.
- **Cross-tenant branding leak fix**: Audited and fixed all email templates and UI fallbacks that could leak one tenant's name/logo into another tenant's emails or public pages. Replaced hardcoded "The Perinatal Psychology Practice" fallbacks with a generic "PsychPortal" default across `server/email.ts`, `server/routes.ts`, `server/stripe.ts`, and client-side pages (form-fill, accept-invite, index.html meta tags). Admin-editable email template defaults now use a `{{practice_name}}` placeholder instead of a hardcoded name.
- **Root cause found and removed**: A legacy one-time migration endpoint (`/api/admin/seed-tenant`), reachable by any regular tenant admin, silently reassigned any row with a null `tenantId` to whichever tenant was created first. This caused a real incident where a clinician's user account got flipped to the wrong tenant while her clinician profile stayed correctly tenant-scoped, so her password-reset email carried the wrong practice's branding. The endpoint has been deleted; `server/seed.ts`'s startup check now only warns about orphaned rows instead of auto-assigning them.
- **New safe tenant-reassignment tool**: Super Admin panel > Users tab now has a "Reassign User to a Different Tenant" action that moves a single user (and their linked clinician profile, if any) to a chosen tenant. This is the only supported way to correct a mis-tenanted account going forward.

## Recent Changes (January 2026)
- **Security hardening**: Added rate limiting (5 login attempts/15min, 100 API requests/15min), helmet security headers, SESSION_SECRET production enforcement
- **Secure token storage**: Password reset tokens now stored in database with 7-day expiry (never logged)
- Added secure admin user invitation flow: new admins receive email invite to set their own password (7-day token expiry)
- Added admin-editable email templates in Settings > Email Templates (form invite, password reset, task reminder, availability reminder)
- UI labels updated: "Assigned" displays as "Allocated", "Scheduled" displays as "Confirmed" (database values unchanged)
- Renamed "Edit Allocation" to "Edit Status" in client dropdown menu
- Added "View Responses" feature to view submitted form responses with PDF download
- Added comprehensive Therapy Enquiry Form matching WriteUpp form with 35+ fields including safety/risk assessment, therapy history, and neurodiversity accommodations
- Added "Add Clinician" feature with automatic user account creation
- Added "Add Task" feature with priority levels and due dates
- Updated form-fill page to use real API endpoints with proper conditional field logic (showWhen support)
- Added public form submission endpoint that updates client status automatically
- Added notification preferences in Settings allowing users to toggle email notifications for new referrals, waitlist updates, and task assignments
- All three notification types now send automatic emails based on user preferences:
  - **New Referrals**: Emails sent to admins when new clients are created
  - **Waitlist Updates**: Emails sent to admins when client status changes
  - **Task Assignments**: Emails sent to assignee when tasks are created
- Added "Promote to Admin" feature for clinicians to become admins while keeping their clinician profile linked
- Availability calendar now shows Monday-Saturday only (Sunday removed)
- Added workflow stage timestamps: formsSentAt, formsCompletedAt, allocatedAt, confirmedAt track when clients move through each stage
- Kanban board now displays relevant timestamps for each column (Created, Sent, Completed, Allocated, Confirmed dates)
- Added allocation reason field: admins can optionally explain why a clinician was selected when allocating a client; displayed on Kanban cards in Allocated column
- Added new workflow step "Awaiting Confirmation": workflow is now New → Forms Sent → Forms Completed → Allocated → Awaiting Confirmation → Confirmed; admins move clients to Awaiting Confirmation after emailing them
- Added task comments feature: tasks have a comments field for progress notes; comments displayed on task cards and editable in task edit dialog
- Added show/hide completed tasks toggle: users can filter task view to hide completed tasks; grid layout adjusts dynamically (2 columns when hidden, 3 when shown)
- Expired slot filtering: slots with past endDate are now filtered out of all allocation dialogs and slot displays
- **Simplified availability system (Feb 2026)**: Completely reworked slot management. Each 1-hour slot is an independent database record. No batch operations or edit mode - add new or delete existing only. Deleting a slot permanently removes it from all future weeks (even booked slots). Booked slot deletion clears client assignment reference automatically. Default to ongoing (no end date), with "Add an end date" checkbox. End time auto-defaults to 1 hour after selected start time. SpecificDate slot type removed from UI (schema retained for backward compatibility). Fortnightly alternation fixed with proper week start alignment.
- **Permanent client deletion (Mar 2026)**: Archived clients can be permanently deleted via "Permanently Delete" option in the dropdown menu. Requires admin password confirmation and shows an irreversibility warning. Deletes client record, form submissions, and releases any booked slots. Only available for archived clients.
- **Non-engagement tracking (Mar 2026)**: When archiving a client as "Didn't Engage", admins can select a category and add a reason/notes. Categories are admin-managed via Settings > Non-Engagement tab. Archive reason and category are displayed on archived client cards. Schema fields: `archiveReason`, `archiveCategory` on clients table; `non_engagement_categories` table for category management.

## Overview

This is a practice management and client onboarding system for The Perinatal Psychology Practice. It enables staff to manage client intake workflows, clinician scheduling, form creation/distribution, task assignment, and waitlist management. The system supports two user roles: administrators (full access) and clinicians (limited to their own profile and availability).

Key features include:
- Client intake and status tracking (New → Forms Sent → Forms Completed → Allocated → Confirmed) [stored as Assigned/Scheduled]
- Clinician availability management with recurring and one-off time slots
- Dynamic form builder for creating intake questionnaires
- Public form filling interface for clients (no authentication required)
- Task management for administrative staff
- Analytics dashboard for practice metrics
- Waitlist management with automated tracking

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack Query for server state, React Context for auth state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS v4 with custom CSS variables for theming
- **Build Tool**: Vite with custom plugins for Replit integration

The frontend follows a page-based architecture where each route maps to a component in `client/src/pages/`. Shared UI components live in `client/src/components/ui/` (shadcn components) and custom components in `client/src/components/`.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Pattern**: RESTful JSON API with `/api` prefix
- **Authentication**: Passport.js with local strategy, session-based auth using express-session
- **Password Security**: Scrypt hashing with salt (via Node.js crypto module)
- **Session Storage**: MemoryStore (development) - should use connect-pg-simple for production

Routes are registered in `server/routes.ts` with role-based middleware (`requireAuth`, `requireAdmin`, `requireClinician`). The storage layer in `server/storage.ts` provides a clean interface to the database.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` (shared between frontend and backend for type safety)
- **Migrations**: Managed via `drizzle-kit push`

Core entities:
- `users` - Authentication accounts (admin or clinician roles)
- `clinicians` - Clinician profiles with specialties, capacity, insurance panels
- `clients` - Client records with status workflow and intake data
- `timeSlots` - Availability slots (recurring or specific dates)
- `formTemplates` - Dynamic form definitions with conditional logic
- `formSubmissions` - Completed form responses
- `tasks` - Administrative task assignments
- `auditLogs` - System activity tracking

### Authentication Flow
1. Session-based authentication with HTTP-only cookies
2. Login via POST `/api/auth/login` validates credentials and creates session
3. Protected routes check session via `requireAuth` middleware
4. Role-specific access via `requireAdmin` or `requireClinician` middleware
5. Public routes (form filling at `/fill/:clientId/:formId`) bypass authentication

### Key Design Decisions
- **Shared Types**: The `shared/` directory contains schema definitions used by both frontend and backend, ensuring type consistency
- **Display IDs**: Clients have both internal UUIDs and human-readable display IDs (W12345678 format)
- **Slot Types**: Time slots support Recurring (weekly/fortnightly pattern) and Vacation (blocked time). Each slot is an independent 1-hour record. SpecificDate type retained in schema for backward compatibility but no longer created by UI
- **Form Builder**: Dynamic forms support multiple field types with conditional logic for showing/hiding fields based on answers

## External Dependencies

### Database
- PostgreSQL (required, connection via `DATABASE_URL` environment variable)
- Drizzle ORM for type-safe queries and migrations

### Authentication & Sessions
- Passport.js with passport-local strategy
- express-session for session management
- MemoryStore for development (connect-pg-simple available for production)

### UI Framework
- Radix UI primitives (accessible, unstyled components)
- shadcn/ui (styled component layer)
- Lucide React for icons
- Recharts for analytics visualizations
- dnd-kit for drag-and-drop in form builder

### Build & Development
- Vite for frontend bundling and HMR
- esbuild for server bundling
- TypeScript for type checking
- Tailwind CSS v4 for styling

### Email Service
- **Provider**: Resend (transactional email)
- **Features**: Form invitations, password reset emails, task reminders
- **Templates**: HTML/text email templates in `server/email.ts`
- **Endpoints**:
  - `POST /api/email/send-form` - Send form link to client
  - `POST /api/email/task-reminder` - Send task reminder
  - `POST /api/auth/forgot-password` - Request password reset

### Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secret key for session encryption (required in production, warns in development)
- `RESEND_API_KEY` - Resend API key for transactional emails
- `FROM_EMAIL` (optional) - Sender email address (defaults to Resend sandbox)

## Security Implementation

### Current Security Measures
- **Rate limiting**: Login endpoints limited to 5 attempts per 15 minutes; general API limited to 100 requests per 15 minutes
- **Security headers**: Helmet middleware provides HSTS, X-Frame-Options, X-Content-Type-Options, and other security headers
- **Session security**: SESSION_SECRET required in production (throws error if missing); development uses random fallback with warning
- **Password security**: Scrypt hashing with salt via Node.js crypto module
- **Token management**: Password reset and invite tokens stored in database with 7-day expiry, never logged

### Planned Security Enhancements
- **PII encryption at rest**: Email and phone fields in clients table should be encrypted at rest. Implementation requires:
  - Encryption key management (secure storage, rotation strategy)
  - Deterministic encryption or hash-based lookup index for email uniqueness
  - Database migration to add encrypted columns (email_encrypted, email_hash, phone_encrypted)
  - Storage layer updates to encrypt on write, decrypt on read
  - Backfill script for existing data