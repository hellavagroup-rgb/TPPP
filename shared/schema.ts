import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

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
  }>().default({ newReferrals: true, waitlistUpdates: true, taskAssignments: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const selectUserSchema = createSelectSchema(users).omit({ password: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = z.infer<typeof selectUserSchema>;

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
  tier: text("tier", { enum: ["High", "Mid", "Low"] }),
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

// ============ CLIENTS (GDPR-Compliant) ============
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  displayId: text("display_id").notNull().unique(), // W12345678 - anonymized identifier
  // PII - Encrypted and access-controlled
  email: text("email").notNull().unique(),
  phone: text("phone"),
  // Clinical Data
  referralSource: text("referral_source"),
  insurer: text("insurer"),
  status: text("status", { enum: ["New", "Forms Sent", "Forms Completed", "Assigned", "AwaitingConfirmation", "Scheduled", "Waitlist"] }).notNull().default("New"),
  presentingIssues: text("presenting_issues").array().default(sql`ARRAY[]::text[]`),
  notes: text("notes"), // Clinical notes - restricted access
  // Assignment
  assignedClinicianId: varchar("assigned_clinician_id").references(() => clinicians.id),
  assignedSlotId: varchar("assigned_slot_id").references(() => timeSlots.id),
  assignedSlot: text("assigned_slot"), // Display string for UI
  allocationMethod: text("allocation_method", { enum: ["form", "manual"] }), // How client was allocated
  allocationReason: text("allocation_reason"), // Admin's reason for this allocation
  isArchived: boolean("is_archived").default(false).notNull(),
  archivedAt: timestamp("archived_at"),
  archiveReason: text("archive_reason"),
  archiveCategory: text("archive_category"),
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
  stripeCheckoutUrl: text("stripe_checkout_url"), // Checkout URL sent to client
  paymentStatus: text("payment_status", { enum: ["none", "setup_pending", "active"] }).default("none"),
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

export const insertClientSchema = createInsertSchema(clients, {
  intakeDate: z.coerce.date().optional(),
}).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true
});
export const selectClientSchema = createSelectSchema(clients);

export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

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
  formTemplateId: varchar("form_template_id").references(() => formTemplates.id).notNull(),
  responses: json("responses").notNull(), // Encrypted sensitive health data
  isDraft: boolean("is_draft").default(false).notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
});

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
});

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
