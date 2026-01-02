# The Perinatal Psychology Practice - Client Management System

## Overview

This is a practice management and client onboarding system for The Perinatal Psychology Practice. It enables staff to manage client intake workflows, clinician scheduling, form creation/distribution, task assignment, and waitlist management. The system supports two user roles: administrators (full access) and clinicians (limited to their own profile and availability).

Key features include:
- Client intake and status tracking (New → Forms Sent → Forms Completed → Assigned → Scheduled)
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
- **Slot Types**: Time slots support three types - Recurring (weekly pattern), SpecificDate (one-off), and Vacation (blocked time)
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

### Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secret key for session encryption (defaults to insecure value in development)