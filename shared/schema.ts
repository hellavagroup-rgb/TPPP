import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ============ USERS & AUTHENTICATION ============
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // Will be hashed with bcrypt
  role: text("role", { enum: ["admin", "clinician"] }).notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  endDate: text("end_date"), // For recurring ranges
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isBooked: boolean("is_booked").default(false).notNull(),
  batchId: text("batch_id"), // Groups slots created together for batch operations
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  status: text("status", { enum: ["New", "Forms Sent", "Forms Completed", "Assigned", "Scheduled", "Waitlist"] }).notNull().default("New"),
  presentingIssues: text("presenting_issues").array().default(sql`ARRAY[]::text[]`),
  notes: text("notes"), // Clinical notes - restricted access
  // Assignment
  assignedClinicianId: varchar("assigned_clinician_id").references(() => clinicians.id),
  assignedSlotId: varchar("assigned_slot_id").references(() => timeSlots.id),
  assignedSlot: text("assigned_slot"), // Display string for UI
  allocationMethod: text("allocation_method", { enum: ["form", "manual"] }), // How client was allocated
  isArchived: boolean("is_archived").default(false).notNull(), // Soft delete - archived clients are hidden
  archivedAt: timestamp("archived_at"), // When the client was archived
  // Timestamps
  intakeDate: timestamp("intake_date").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  assignee: text("assignee", { enum: ["Sarah", "Rosie", "Suzanne"] }).notNull(),
  dueDate: timestamp("due_date").notNull(),
  priority: text("priority", { enum: ["High", "Medium", "Low"] }).notNull().default("Medium"),
  status: text("status", { enum: ["Pending", "In Progress", "Completed"] }).notNull().default("Pending"),
  relatedClientId: varchar("related_client_id").references(() => clients.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ============ EMAIL TEMPLATES ============
export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateKey: text("template_key").notNull().unique(), // "form_invite", "password_reset", "task_reminder", "availability_reminder"
  name: text("name").notNull(), // Human-readable name
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(), // Plain text version with placeholders
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
