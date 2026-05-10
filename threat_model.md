# Threat Model

## Project Overview

This project is a React + Express + PostgreSQL practice-management system for a perinatal psychology clinic. It stores administrator and clinician accounts, client contact details, scheduling data, intake-form responses, and operational audit/export data. The production deployment serves a React frontend from the same Express process and uses session-based authentication for staff, while client intake forms are intentionally reachable through public routes.

Production assumptions for future scans:
- `NODE_ENV=production` in deployed environments.
- The mockup sandbox and dev-only Vite/HMR paths are out of scope unless production reachability is demonstrated.
- TLS between browsers and the deployed app is provided by the platform.

## Assets

- **Staff accounts and sessions** — admin and clinician accounts, password hashes, invite tokens, password-reset tokens, and session cookies. Compromise allows unauthorized access to client records and operational actions.
- **Client PII** — names, email addresses, phone numbers, archive reasons, workflow status, and allocation details. This is sensitive personal data that should only be visible to authorized staff or the intended client.
- **Special-category clinical data** — intake-form answers, notes, therapy history, safety and risk disclosures, and neurodiversity accommodations. Exposure would be especially harmful because it includes mental-health information.
- **Scheduling and allocation data** — clinician availability, slot bookings, and client-to-clinician assignments. Tampering can disrupt care delivery and leak internal practice operations.
- **Operational secrets and service credentials** — database credentials, session secret, and Resend API key. Exposure would allow broader system compromise or impersonation.
- **Audit and export data** — audit logs and downloadable exports aggregate sensitive records and become high-value exfiltration targets.

## Trust Boundaries

- **Browser to API** — all frontend requests cross from untrusted clients into the Express API. Every request parameter, body, and header must be treated as attacker-controlled.
- **Public client link to private records** — public form-fill and draft endpoints intentionally bypass staff authentication. They therefore require strong possession checks because they still touch client identifiers and clinical responses.
- **Authenticated staff to privileged admin actions** — clinicians and admins share the same session system but should not have the same authority. Admin-only routes must be enforced server-side.
- **API to PostgreSQL** — the server has direct read/write access to highly sensitive data. Broken authorization or unsafe query patterns at the API layer directly expose the database-backed records.
- **API to email provider** — the server sends password resets, invites, reminders, and referral notifications through Resend. URLs and content sent across this boundary must not trust attacker-controlled hostnames or unescaped data.
- **Application to logs/exports** — responses and audit data can leave the request path and persist in logs or downloadable files. This boundary matters because logging or export overreach can disclose clinical data even without a direct route bypass.

## Scan Anchors

- **Production entry points:** `server/index.ts`, `server/routes.ts`, `server/auth.ts`, `server/storage.ts`, `client/src/main.tsx`, `client/src/App.tsx`.
- **Highest-risk code areas:** public form routes and drafts in `server/routes.ts`; auth/session/reset/invite logic in `server/auth.ts` and `server/routes.ts`; client/submission/export handlers in `server/routes.ts`; DB access and record shaping in `server/storage.ts`; email generation in `server/email.ts`.
- **Public surface:** `/api/auth/login`, `/api/auth/forgot-password`, `/api/forms/:id`, `/api/clients/public/:id`, `/api/form-drafts/*`, `/api/form-submissions`, invite acceptance routes.
- **Authenticated surface:** shared clinician/admin account routes and clinician profile/availability routes.
- **Admin surface:** client CRUD, submissions, exports, email template management, clinician management, task management.
- **Usually dev-only / lower priority:** `server/vite.ts`, frontend mock data, local build tooling, seed helpers unless directly reachable from production routes.

## Threat Categories

### Spoofing

The application relies on session cookies for staff and bearer-style public links for client intake. The system must ensure session cookies are only issued after valid authentication, reset/invite links are bound to trustworthy origins, and public form access cannot be spoofed simply by knowing or manipulating identifiers.

Required guarantees:
- Password reset and invite links MUST be generated from a trusted application origin, not from request headers supplied by the caller.
- Session-protected routes MUST require a live authenticated session and enforce role checks server-side.
- Public form access MUST be protected by a possession factor that is unguessable, scoped to a specific client/form flow, and revocable.

### Tampering

Clinicians and admins can change scheduling, tasks, client workflow state, and email templates. Attackers who can reach the wrong mutation path could alter bookings, overwrite intake drafts, or submit forms on behalf of clients.

Required guarantees:
- Mutation routes MUST verify that the target resource actually belongs to the actor’s allowed scope, not just trust a URL parameter.
- Public draft and submission endpoints MUST prevent unauthorized overwrites or forced submissions.
- Workflow and scheduling changes MUST validate ownership and state transitions on the server.

### Information Disclosure

This system handles client contact details and mental-health intake answers, including draft responses. Disclosure can happen through route overexposure, predictable public identifiers, exports, or overly verbose logs.

Required guarantees:
- Sensitive client and form-response data MUST only be returned to authorized staff or the intended public-link holder.
- API logging MUST avoid storing full JSON responses or other plaintext clinical/PII payloads.
- Exports and admin-only data views MUST remain strictly restricted to admin users.
- Sensitive fields should not be unnecessarily exposed across internal staff boundaries.

### Denial of Service

Public login, reset, and intake endpoints are internet-facing. Attackers could abuse them to flood email workflows, exhaust server resources, or interfere with scheduling state.

Required guarantees:
- Public auth and submission endpoints MUST be rate-limited and validate request size/shape.
- Expensive or state-changing public endpoints MUST not allow repeated abuse that blocks legitimate intake processing.
- Scheduling mutations MUST not let one clinician disrupt another clinician’s availability.

### Elevation of Privilege

The main privilege boundary is clinician versus admin, plus unauthenticated clients versus staff-only data. A failure here could allow clinicians to tamper with other clinicians’ schedules or outsiders to access special-category clinical data.

Required guarantees:
- Every admin-only route MUST remain inaccessible to clinician accounts.
- Clinician-scoped routes MUST enforce object-level ownership for the concrete resource being accessed or modified.
- Public intake endpoints MUST not expose draft or submission data for arbitrary clients through ID-based access alone.
