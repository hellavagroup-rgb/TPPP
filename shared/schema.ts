import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, json, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { CLIENT_STATUSES } from "./clientWorkflow";

// ============ TENANTS ============
export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  accentColor: text("accent_color"),
  pmsType: text("pms_type"),
  clinikoApiKey: text("cliniko_api_key"),
  whatsappEnabled: boolean("whatsapp_enabled").default(false),
  gmailAddress: text("gmail_address"),
  gmailIntakeEnabled: boolean("gmail_intake_enabled").default(false),
  fromEmail: text("from_email"),
  stripeSecretKey: text("stripe_secret_key"), // Stored per-tenant for in-app configuration
  stripeWebhookSecret: text("stripe_webhook_secret"),
  // Feature flags — all default true so existing tenants lose no functionality
  paymentsEnabled: boolean("payments_enabled").default(true),
  tasksEnabled: boolean("tasks_enabled").default(true),
  analyticsEnabled: boolean("analytics_enabled").default(true),
  waitlistEnabled: boolean("waitlist_enabled").default(true),
  formsEnabled: boolean("forms_enabled").default(true),
  dataExportEnabled: boolean("data_export_enabled").default(true),
  nonEngagementEnabled: boolean("non_engagement_enabled").default(true),
  clinicianProfileConfig: json("clinician_profile_config").$type<{
    showTier?: boolean;
    showTherapyMode?: boolean;
  }>(),
  defaultLocationType: text("default_location_type").default("online"),
  // CY&A feature flags — all default false so existing tenants are unaffected
  contactPreferenceEnabled: boolean("contact_preference_enabled").default(false),
  intakeClientSummaryEnabled: boolean("intake_client_summary_enabled").default(false),
  multiClinicianAllocationEnabled: boolean("multi_clinician_allocation_enabled").default(false),
  allocationVisibilityEnabled: boolean("allocation_visibility_enabled").default(false),
  autoAllocationEmailEnabled: boolean("auto_allocation_email_enabled").default(false),
  registrationFormEnabled: boolean("registration_form_enabled").default(false),
  intakeDeliveryDiagnosticsEnabled: boolean("intake_delivery_diagnostics_enabled").default(false),
  paymentReconciliationEnabled: boolean("payment_reconciliation_enabled").default(false),
  confirmationRecoveryEnabled: boolean("confirmation_recovery_enabled").default(false),
  // The one tenant-owned template used for every automated intake delivery.
  // Null is an explicit setup-required state for legacy and newly-created tenants.
  intakeFormTemplateId: varchar("intake_form_template_id"),
  // Selected from this tenant's own form templates and used by the public
  // registration journey. A null selection deliberately makes sending unavailable.
  registrationFormTemplateId: varchar("registration_form_template_id"),
  // Tenant-owned consent document. Version is incremented whenever its content changes.
  registrationTermsContent: text("registration_terms_content").notNull().default("By proceeding you agree to the practice's Terms & Conditions."),
  registrationTermsVersion: integer("registration_terms_version").notNull().default(1),
  registrationTermsUpdatedAt: timestamp("registration_terms_updated_at").defaultNow().notNull(),
  bookingConfirmedEmailEnabled: boolean("booking_confirmed_email_enabled").default(false),
  zoomLinkEmailEnabled: boolean("zoom_link_email_enabled").default(false),
  writeuppChecklistEnabled: boolean("writeup_checklist_enabled").default(false),
  completedBookingsEnabled: boolean("completed_bookings_enabled").default(false),
  oneOffSlotsEnabled: boolean("one_off_slots_enabled").default(false),
  timeOffBlocksEnabled: boolean("time_off_blocks_enabled").notNull().default(false),
  flexibleBookingEnabled: boolean("flexible_booking_enabled").notNull().default(false),
  reservationDurationHours: integer("reservation_duration_hours").notNull().default(12),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;

// ============ USERS & AUTHENTICATION ============
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // Will be hashed with bcrypt
  role: text("role", { enum: ["admin", "clinician"] }).notNull(),
  name: text("name").notNull(),
  linkedClinicianId: varchar("linked_clinician_id"), // For admins who are also clinicians
  notificationPrefs: json("notification_prefs").$type<{
    newReferrals?: boolean;
    waitlistUpdates?: boolean;
    taskAssignments?: boolean;
    formCompletions?: boolean;
  }>().default({ newReferrals: true, waitlistUpdates: true, taskAssignments: true, formCompletions: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const selectUserSchema = createSelectSchema(users).omit({ password: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
 
// Separate from tenants so PIN hashes cannot leak through general practice APIs.
export const managerConfirmationSettings = pgTable("manager_confirmation_settings", {
  tenantId: varchar("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash").notNull(),
  managerUserIds: json("manager_user_ids").$type<string[]>().notNull(),
  failedPinAttempts: json("failed_pin_attempts").$type<Record<string, { count: number; lockedUntil: string | null }>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
});
export type User = typeof users.$inferSelect;
export type SafeUser = z.infer<typeof selectUserSchema>;

// Persistent express-session storage. This table is managed through the normal
// Drizzle schema flow so the bundled server never needs connect-pg-simple's
// runtime table.sql asset or startup DDL.
export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").$type<Record<string, unknown>>().notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => [
  index("IDX_user_sessions_expire").on(table.expire),
]);

// ============ CLINICIANS ============
export const clinicians = pgTable("clinicians", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  avatar: text("avatar").notNull(),
  specialties: text("specialties").array().notNull().default(sql`ARRAY[]::text[]`),
  capacity: integer("capacity").notNull().default(20),
  currentLoad: integer("current_load").notNull().default(0),
  maxNewClients: integer("max_new_clients"),
  bio: text("bio"),
  insurers: text("insurers").array().default(sql`ARRAY[]::text[]`),
  contactMethods: text("contact_methods").array().default(sql`ARRAY[]::text[]`), // Email, Text, WhatsApp
  location: text("location"),
  nhsTrust: text("nhs_trust"),
  worksWithCouples: boolean("works_with_couples").default(false),
  allocateForBupa: boolean("allocate_for_bupa").default(false),
  emdrTrained: boolean("emdr_trained").notNull().default(false),
  tier: text("tier", { enum: ["High", "Mid", "Low"] }),
  therapyMode: text("therapy_mode"),
  zoomLink: text("zoom_link"),
  isActive: boolean("is_active").default(true).notNull(),
  lastUpdatedAvailability: timestamp("last_updated_availability"),
  sessionRatePence: integer("session_rate_pence"), // Session rate in pence (e.g. 15000 = £150)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const cliniciansRelations = relations(clinicians, ({ one, many }) => ({
  user: one(users, {
    fields: [clinicians.userId],
    references: [users.id],
  }),
  availability: many(timeSlots),
  clients: many(clients),
}));

export const insertClinicianSchema = createInsertSchema(clinicians).omit({ id: true, createdAt: true, lastUpdatedAvailability: true });
export const selectClinicianSchema = createSelectSchema(clinicians);

export type InsertClinician = z.infer<typeof insertClinicianSchema>;
export type Clinician = typeof clinicians.$inferSelect;

// ============ TIME SLOTS / AVAILABILITY ============
export const timeSlots = pgTable("time_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clinicianId: varchar("clinician_id").references(() => clinicians.id).notNull(),
  type: text("type", { enum: ["Recurring", "SpecificDate", "Vacation"] }).notNull(),
  day: text("day"), // "Monday", "Tuesday", etc.
  date: text("date"), // YYYY-MM-DD for specific dates
  startDate: text("start_date"), // For recurring ranges
  endDate: text("end_date"), // For recurring ranges (null = ongoing)
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isBooked: boolean("is_booked").default(false).notNull(),
  batchId: text("batch_id"), // Groups slots created together for batch operations
  frequency: text("frequency", { enum: ["weekly", "fortnightly"] }).default("weekly"), // Schedule frequency
  isOngoing: boolean("is_ongoing").default(false), // Whether schedule continues indefinitely
  locationType: text("location_type", { enum: ["online", "in_person"] }).notNull().default("online"), // Slot delivery mode
  retiredAt: timestamp("retired_at"),
  retirementReason: text("retirement_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const timeSlotsRelations = relations(timeSlots, ({ one }) => ({
  clinician: one(clinicians, {
    fields: [timeSlots.clinicianId],
    references: [clinicians.id],
  }),
}));

export const insertTimeSlotSchema = createInsertSchema(timeSlots).omit({ id: true, createdAt: true });
export const selectTimeSlotSchema = createSelectSchema(timeSlots);

export type InsertTimeSlot = z.infer<typeof insertTimeSlotSchema>;
export type TimeSlot = typeof timeSlots.$inferSelect;

// Date-specific unavailability is separate from appointment slots: blocks never
// reserve a slot row or become eligible for allocation.
export const availabilityTimeOffBlocks = pgTable("availability_time_off_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  clinicianId: varchar("clinician_id").notNull().references(() => clinicians.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("availability_time_off_blocks_tenant_clinician_date_idx").on(table.tenantId, table.clinicianId, table.date),
]);

export type AvailabilityTimeOffBlock = typeof availabilityTimeOffBlocks.$inferSelect;

// ============ CLIENTS (GDPR-Compliant) ============
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  displayId: text("display_id").notNull().unique(), // W12345678 - anonymized identifier
  // PII - Encrypted and access-controlled
  email: text("email").notNull(),
  phone: text("phone"),
  // Clinical Data
  referralSource: text("referral_source"),
  insurer: text("insurer"),
  status: text("status", { enum: CLIENT_STATUSES }).notNull().default("New"),
  presentingIssues: text("presenting_issues").array().default(sql`ARRAY[]::text[]`),
  notes: text("notes"), // Clinical notes - restricted access
  // Assignment
  assignedClinicianId: varchar("assigned_clinician_id").references(() => clinicians.id),
  assignedSlotId: varchar("assigned_slot_id").references(() => timeSlots.id),
  assignedLocationType: text("assigned_location_type", { enum: ["online", "in_person"] }),
  assignedSlot: text("assigned_slot"), // Display string for UI
  allocationMethod: text("allocation_method", { enum: ["form", "manual"] }), // How client was allocated
  allocationReason: text("allocation_reason"), // Admin's reason for this allocation
  isArchived: boolean("is_archived").default(false).notNull(),
  archivedAt: timestamp("archived_at"),
  archiveReason: text("archive_reason"),
  archiveCategory: text("archive_category"),
  completedAt: timestamp("completed_at"),
  managerConfirmedAt: timestamp("manager_confirmed_at"),
  managerConfirmedBy: varchar("manager_confirmed_by").references(() => users.id, { onDelete: "set null" }),
  managerConfirmationReason: text("manager_confirmation_reason"),
  // Workflow Stage Timestamps
  formsSentAt: timestamp("forms_sent_at"), // When forms were sent to client
  formsCompletedAt: timestamp("forms_completed_at"), // When client completed forms
  allocatedAt: timestamp("allocated_at"), // When client was allocated to clinician
  awaitingConfirmationAt: timestamp("awaiting_confirmation_at"), // When email sent to client for confirmation
  confirmedAt: timestamp("confirmed_at"), // When appointment was confirmed
  // Stripe / Payment
  agreedRatePence: integer("agreed_rate_pence"), // Agreed session rate in pence
  stripeCustomerId: text("stripe_customer_id"), // Stripe Customer ID (cus_...)
  stripePaymentMethodId: text("stripe_payment_method_id"), // Stripe PaymentMethod ID (pm_...)
  stripeCheckoutUrl: text("stripe_checkout_url"), // Payment link URL sent to client
  stripePaymentLinkId: text("stripe_payment_link_id"), // Stripe Payment Link ID (plink_...) for deactivation
  registrationPaymentAttemptKey: text("registration_payment_attempt_key"),
  registrationPaymentFailedAt: timestamp("registration_payment_failed_at"),
  registrationPaymentFailureCode: text("registration_payment_failure_code", {
    enum: ["client_rate_required", "stripe_unavailable", "provider_rejected", "provider_transient", "interrupted"],
  }),
  registrationPaymentFailureReason: text("registration_payment_failure_reason"),
  registrationFormSubmissionId: varchar("registration_form_submission_id"),
  paymentStatus: text("payment_status", { enum: ["none", "setup_pending", "active"] }).default("none"),
  // CY&A fields
  contactPreference: text("contact_preference", { enum: ["email", "phone"] }),
  needsAdminCall: boolean("needs_admin_call").default(false),
  writeuppAppointmentConfirmed: boolean("writeup_appointment_confirmed").default(false),
  writeuppDataTransferred: boolean("writeup_data_transferred").default(false),
  paymentType: text("payment_type", { enum: ["self_pay", "insurer"] }),
  insurerDetails: text("insurer_details"),
  // CY&A registration token (for the registration form portal link)
  registrationToken: text("registration_token"),
  registrationTokenExpiresAt: timestamp("registration_token_expires_at"),
  registrationTokenRevokedAt: timestamp("registration_token_revoked_at"),
  registrationEmailSentAt: timestamp("registration_email_sent_at"),
  registrationEmailSendingAt: timestamp("registration_email_sending_at"),
  registrationEmailFailedAt: timestamp("registration_email_failed_at"),
  registrationEmailFailureReason: text("registration_email_failure_reason"),
  registrationEmailAttemptKey: text("registration_email_attempt_key"),
  registrationEmailClaimId: text("registration_email_claim_id"),
  registrationEmailPendingToken: text("registration_email_pending_token"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  termsAcceptedVersion: integer("terms_accepted_version"),
  termsAcceptedContent: text("terms_accepted_content"),
  bookingConfirmationSentAt: timestamp("booking_confirmation_sent_at"),
  zoomLinkSentAt: timestamp("zoom_link_sent_at"),
  // Timestamps
  intakeDate: timestamp("intake_date").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const clientsRelations = relations(clients, ({ one, many }) => ({
  assignedClinician: one(clinicians, {
    fields: [clients.assignedClinicianId],
    references: [clinicians.id],
  }),
  formSubmissions: many(formSubmissions),
}));

// A client-creation request is retained so an interrupted browser request can
// safely be repeated without creating a second referral or notification.
export const clientCreationRequests = pgTable("client_creation_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("client_creation_requests_tenant_key_unique").on(table.tenantId, table.idempotencyKey),
]);

export const insertClientSchema = createInsertSchema(clients, {
  intakeDate: z.coerce.date().optional(),
}).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  managerConfirmedAt: true,
  managerConfirmedBy: true,
  managerConfirmationReason: true,
  assignedLocationType: true,
});
export const selectClientSchema = createSelectSchema(clients);

export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// New-generation bookings only. Legacy options and assignments never acquire a hold.
export const clinicianInvitations = pgTable("clinician_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  clinicianIds: json("clinician_ids").$type<string[]>().notNull(),
  previousStatus: text("previous_status").notNull().default("Forms Completed"),
  status: text("status", { enum: ["prepared", "sent", "uncertain", "selected", "declined", "closed"] }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  emailAttemptKey: text("email_attempt_key").notNull().default(sql`gen_random_uuid()`),
  emailAttemptStartedAt: timestamp("email_attempt_started_at").notNull().defaultNow(),
  emailAttemptAcceptedAt: timestamp("email_attempt_accepted_at"),
}, table => [index("clinician_invitations_client_idx").on(table.clientId)]);

export const bookingReservations = pgTable("booking_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  invitationId: varchar("invitation_id").references(() => clinicianInvitations.id),
  clinicianId: varchar("clinician_id").notNull().references(() => clinicians.id),
  slotId: varchar("slot_id").notNull().references(() => timeSlots.id),
  route: text("route", { enum: ["online", "phone"] }).notNull(),
  previousStatus: text("previous_status").notNull().default("Forms Completed"),
  durationHours: integer("duration_hours").notNull(),
  deadline: timestamp("deadline").notNull(),
  status: text("status", { enum: ["active", "payment_check", "expired", "cancelled", "confirmed", "payment_review"] }).notNull(),
  reason: text("reason"),
  clinicianName: text("clinician_name").notNull(),
  appointmentLabel: text("appointment_label").notNull(),
  locationType: text("location_type", { enum: ["online", "in_person"] }),
  // Historic payment ownership survives the client's next reservation.
  paymentAttemptKey: text("payment_attempt_key"),
  paymentLinkId: text("payment_link_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  lastCheckedAt: timestamp("last_checked_at"),
  latePaymentReviewRequired: boolean("late_payment_review_required").notNull().default(false),
  followUpPending: boolean("follow_up_pending").notNull().default(false),
}, table => [
  index("booking_reservations_due_idx").on(table.status, table.deadline),
  uniqueIndex("booking_reservations_active_client_unique").on(table.clientId)
    .where(sql`${table.status} in ('active', 'payment_check', 'payment_review')`),
]);

export type BookingReservation = typeof bookingReservations.$inferSelect;

// Immutable history of a confirmed appointment.  Assignment rows are retired
// after confirmation, so confirmation views and delivery retries must never
// depend on the live allocation relationship.
export const bookingSnapshots = pgTable("booking_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  slotId: varchar("slot_id").references(() => timeSlots.id, { onDelete: "set null" }),
  clinicianId: varchar("clinician_id").references(() => clinicians.id, { onDelete: "set null" }),
  clinicianName: text("clinician_name").notNull(),
  slotType: text("slot_type").notNull(),
  date: text("date"),
  day: text("day"),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  locationType: text("location_type").notNull(),
  confirmedAt: timestamp("confirmed_at").defaultNow().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
}, (table) => [
  index("booking_snapshots_client_history_idx").on(table.tenantId, table.clientId, table.confirmedAt),
  uniqueIndex("booking_snapshots_idempotency_unique").on(table.tenantId, table.idempotencyKey),
]);

export const insertBookingSnapshotSchema = createInsertSchema(bookingSnapshots).omit({ id: true, confirmedAt: true });
export const selectBookingSnapshotSchema = createSelectSchema(bookingSnapshots);
export type BookingSnapshot = typeof bookingSnapshots.$inferSelect;

// ============ FORM TEMPLATES ============
export const formTemplates = pgTable("form_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  fields: json("fields").notNull(), // Store form structure as JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const insertFormTemplateSchema = createInsertSchema(formTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const selectFormTemplateSchema = createSelectSchema(formTemplates);

export type InsertFormTemplate = z.infer<typeof insertFormTemplateSchema>;
export type FormTemplate = typeof formTemplates.$inferSelect;

// ============ FORM SUBMISSIONS ============
export const formSubmissions = pgTable("form_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  // Historic registration submissions retain their immutable template snapshot
  // after a configurable template is deleted.
  formTemplateId: varchar("form_template_id").references(() => formTemplates.id, { onDelete: "set null" }),
  responses: json("responses").notNull(), // Encrypted sensitive health data
  isDraft: boolean("is_draft").default(false).notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  // Present only for the registration portal. It makes a response-loss retry
  // return/link the same immutable submission rather than creating another one.
  registrationAttemptKey: text("registration_attempt_key"),
  registrationTemplateTitle: text("registration_template_title"),
  registrationTemplateDescription: text("registration_template_description"),
  registrationTemplateFields: json("registration_template_fields"),
  registrationConsentEvidence: json("registration_consent_evidence"),
  registrationTermsAcceptedAt: timestamp("registration_terms_accepted_at"),
  registrationTermsAcceptedVersion: integer("registration_terms_accepted_version"),
  registrationTermsAcceptedContent: text("registration_terms_accepted_content"),
}, (table) => [
  uniqueIndex("form_submissions_registration_attempt_key_unique")
    .on(table.registrationAttemptKey)
    .where(sql`${table.registrationAttemptKey} is not null`),
]);

export const formSubmissionsRelations = relations(formSubmissions, ({ one }) => ({
  client: one(clients, {
    fields: [formSubmissions.clientId],
    references: [clients.id],
  }),
  formTemplate: one(formTemplates, {
    fields: [formSubmissions.formTemplateId],
    references: [formTemplates.id],
  }),
}));

export const insertFormSubmissionSchema = createInsertSchema(formSubmissions).omit({ id: true, submittedAt: true });
export const selectFormSubmissionSchema = createSelectSchema(formSubmissions);

export type InsertFormSubmission = z.infer<typeof insertFormSubmissionSchema>;
export type FormSubmission = typeof formSubmissions.$inferSelect;

// One durable delivery per tenant/client/form.  This is deliberately separate
// from submissions: a form can be delivered, fail, be retried, and eventually
// completed without losing that audit trail.
export const formDeliveries = pgTable("form_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  formTemplateId: varchar("form_template_id").references(() => formTemplates.id).notNull(),
  status: text("status", { enum: ["pending", "sending", "sent", "failed", "completed"] }).notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  lastError: text("last_error"),
  providerMessageId: text("provider_message_id"),
  providerEvent: text("provider_event"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("form_deliveries_tenant_client_form_unique").on(table.tenantId, table.clientId, table.formTemplateId),
  uniqueIndex("form_deliveries_idempotency_key_unique").on(table.idempotencyKey),
]);

export type FormDelivery = typeof formDeliveries.$inferSelect;

export const formDeliveryAttempts = pgTable("form_delivery_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  deliveryId: varchar("delivery_id").references(() => formDeliveries.id, { onDelete: "cascade" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  providerMessageId: text("provider_message_id"),
  providerEvent: text("provider_event"),
  outcome: text("outcome").notNull(),
  alertClaimedAt: timestamp("alert_claimed_at"),
  alertedAt: timestamp("alerted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("form_delivery_attempt_key_unique").on(table.tenantId, table.idempotencyKey),
]);

// ============ TASKS ============
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  assignee: text("assignee").notNull(),
  dueDate: timestamp("due_date").notNull(),
  priority: text("priority", { enum: ["High", "Medium", "Low"] }).notNull().default("Medium"),
  status: text("status", { enum: ["Pending", "In Progress", "Completed"] }).notNull().default("Pending"),
  comments: text("comments"), // Comments added during task progress
  relatedClientId: varchar("related_client_id").references(() => clients.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const tasksRelations = relations(tasks, ({ one }) => ({
  relatedClient: one(clients, {
    fields: [tasks.relatedClientId],
    references: [clients.id],
  }),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export const selectTaskSchema = createSelectSchema(tasks);

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ============ AUDIT LOG (GDPR Compliance) ============
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(), // "view", "edit", "delete", "export"
  resourceType: text("resource_type").notNull(), // "client", "clinician", "form"
  resourceId: varchar("resource_id"),
  ipAddress: text("ip_address"),
  details: json("details").$type<Record<string, unknown>>(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ============ EMAIL TEMPLATES ============
export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateKey: text("template_key").notNull(), // "form_invite", "password_reset", "task_reminder", "availability_reminder"
  name: text("name").notNull(), // Human-readable name
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(), // Plain text version with placeholders
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true, updatedAt: true });
export const selectEmailTemplateSchema = createSelectSchema(emailTemplates);

export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;

// ============ INVITE TOKENS ============
export const inviteTokens = pgTable("invite_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInviteTokenSchema = createInsertSchema(inviteTokens).omit({ id: true, createdAt: true, usedAt: true });
export type InsertInviteToken = z.infer<typeof insertInviteTokenSchema>;
export type InviteToken = typeof inviteTokens.$inferSelect;

// ============ CUSTOM INSURERS ============
export const customInsurers = pgTable("custom_insurers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const insertCustomInsurerSchema = createInsertSchema(customInsurers).omit({ id: true, createdAt: true });
export type InsertCustomInsurer = z.infer<typeof insertCustomInsurerSchema>;
export type CustomInsurer = typeof customInsurers.$inferSelect;

// ============ NON-ENGAGEMENT CATEGORIES ============
export const nonEngagementCategories = pgTable("non_engagement_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const insertNonEngagementCategorySchema = createInsertSchema(nonEngagementCategories).omit({ id: true, createdAt: true });
export type InsertNonEngagementCategory = z.infer<typeof insertNonEngagementCategorySchema>;
export type NonEngagementCategory = typeof nonEngagementCategories.$inferSelect;

// ============ PAYMENT CHARGES ============
export const stripeWebhookFailures = pgTable("stripe_webhook_failures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  clientId: varchar("client_id").references(() => clients.id),
  reason: text("reason").notNull(),
  attempts: integer("attempts").notNull().default(1),
  generation: integer("generation").notNull().default(1),
  firstFailedAt: timestamp("first_failed_at").notNull().defaultNow(),
  lastFailedAt: timestamp("last_failed_at").notNull().defaultNow(),
  alertClaimedAt: timestamp("alert_claimed_at"),
  alertedAt: timestamp("alerted_at"),
  resolvedAt: timestamp("resolved_at"),
}, table => [
  uniqueIndex("stripe_webhook_failures_tenant_event_unique").on(table.tenantId, table.eventId),
  index("stripe_webhook_failures_tenant_open_idx").on(table.tenantId, table.resolvedAt),
]);

export const paymentCharges = pgTable("payment_charges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  amountPence: integer("amount_pence").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull().default("pending"),
  notes: text("notes"),
  failureReason: text("failure_reason"),
  chargedByUserId: varchar("charged_by_user_id").references(() => users.id),
  chargedAt: timestamp("charged_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
}, (table) => [
  uniqueIndex("payment_charges_stripe_payment_intent_unique")
    .on(table.stripePaymentIntentId)
    .where(sql`${table.stripePaymentIntentId} is not null`),
]);

export const insertPaymentChargeSchema = createInsertSchema(paymentCharges).omit({ id: true, chargedAt: true });
export type InsertPaymentCharge = z.infer<typeof insertPaymentChargeSchema>;
export type PaymentCharge = typeof paymentCharges.$inferSelect;

// ============ INTAKE MESSAGES ============
export const intakeMessages = pgTable("intake_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  channel: text("channel", { enum: ["email", "whatsapp", "phone"] }).notNull(),
  threadId: text("thread_id"),
  gmailMessageId: text("gmail_message_id"),
  fromAddress: text("from_address").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  extractedName: text("extracted_name"),
  extractedPhone: text("extracted_phone"),
  extractedData: json("extracted_data").$type<Record<string, string>>(),
  status: text("status", { enum: ["new", "linked", "ignored"] }).notNull().default("new"),
  linkedClientId: varchar("linked_client_id").references(() => clients.id),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

export const insertIntakeMessageSchema = createInsertSchema(intakeMessages).omit({ id: true, receivedAt: true });
export type InsertIntakeMessage = z.infer<typeof insertIntakeMessageSchema>;
export type IntakeMessage = typeof intakeMessages.$inferSelect;

// ============ GMAIL CONNECTIONS ============
export const gmailConnections = pgTable("gmail_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  gmailAddress: text("gmail_address").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiry: timestamp("token_expiry"),
  historyId: text("history_id"),
  lastSyncAt: timestamp("last_sync_at"),
  isActive: boolean("is_active").default(true).notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type GmailConnection = typeof gmailConnections.$inferSelect;

// ============ PASSWORD RESET TOKENS ============
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true, createdAt: true, usedAt: true });
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ============ CLIENT CLINICIAN OPTIONS (CY&A multi-clinician allocation) ============
export const clientClinicianOptions = pgTable("client_clinician_options", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  clinicianId: varchar("clinician_id").references(() => clinicians.id).notNull(),
  slotId: varchar("slot_id").references(() => timeSlots.id),
  locationType: text("location_type", { enum: ["online", "in_person"] }),
  status: text("status", { enum: ["pending", "selected", "declined", "unavailable"] }).notNull().default("pending"),
  selectionToken: text("selection_token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
});

// Durable snapshot of a newly generated offer email. It is committed before
// contacting the provider so delivery/finalization can recover the same tokens,
// branding, and provider idempotency key after a process or DB failure.
export const allocationOfferDeliveries = pgTable("allocation_offer_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  generationKey: text("generation_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status", { enum: ["prepared", "sending", "accepted", "finalized", "failed", "uncertain"] }).notNull().default("prepared"),
  optionTokens: json("option_tokens").$type<string[]>().notNull(),
  emailPayload: json("email_payload").$type<{
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
  }>().notNull(),
  sendStartedAt: timestamp("send_started_at"),
  dedupExpiresAt: timestamp("dedup_expires_at"),
  acceptedAt: timestamp("accepted_at"),
  providerMessageId: text("provider_message_id"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("allocation_offer_deliveries_generation_unique").on(table.generationKey),
  uniqueIndex("allocation_offer_deliveries_idempotency_unique").on(table.idempotencyKey),
  index("allocation_offer_deliveries_client_status_idx").on(table.tenantId, table.clientId, table.status),
]);

export const clientClinicianOptionsRelations = relations(clientClinicianOptions, ({ one }) => ({
  client: one(clients, {
    fields: [clientClinicianOptions.clientId],
    references: [clients.id],
  }),
  clinician: one(clinicians, {
    fields: [clientClinicianOptions.clinicianId],
    references: [clinicians.id],
  }),
  slot: one(timeSlots, {
    fields: [clientClinicianOptions.slotId],
    references: [timeSlots.id],
  }),
}));

export const insertClientClinicianOptionSchema = createInsertSchema(clientClinicianOptions).omit({ id: true, createdAt: true });
export type InsertClientClinicianOption = z.infer<typeof insertClientClinicianOptionSchema>;
export type ClientClinicianOption = typeof clientClinicianOptions.$inferSelect;
