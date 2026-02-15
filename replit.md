# The Perinatal Psychology Practice - Client Management System

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