import { 
  users, clients, clinicians, timeSlots, availabilityTimeOffBlocks, bookingReservations, formTemplates, formSubmissions, formDeliveries, formDeliveryAttempts, clientCreationRequests, tasks, auditLogs, emailTemplates, inviteTokens, passwordResetTokens, nonEngagementCategories, customInsurers, paymentCharges, intakeMessages, tenants, clientClinicianOptions, bookingSnapshots,
  type User, type InsertUser, type SafeUser,
  type Tenant,
  type Client, type InsertClient, type FormDelivery,
  type Clinician, type InsertClinician,
  type TimeSlot, type InsertTimeSlot, type AvailabilityTimeOffBlock,
  type FormTemplate, type InsertFormTemplate,
  type FormSubmission, type InsertFormSubmission,
  type Task, type InsertTask,
  type AuditLog, type InsertAuditLog,
  type EmailTemplate, type InsertEmailTemplate,
  type InviteToken,
  type PasswordResetToken,
  type NonEngagementCategory, type InsertNonEngagementCategory,
  type CustomInsurer, type InsertCustomInsurer,
  type PaymentCharge, type InsertPaymentCharge,
  type ClientClinicianOption, type InsertClientClinicianOption,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, desc, sql, isNull, inArray, lt } from "drizzle-orm";
import { slotRetirementConflictCopy } from "@shared/slotRetirementCopy";
import {
  RECENT_ACTIVITY_ACTIONS,
  RECENT_ACTIVITY_CATEGORY_ACTIONS,
  type HistoricalActivitySources,
  type RecentActivityCategory,
} from "./activity";
import { shouldResetZoomDelivery } from "@shared/bookingZoom";
import { visibleCalendarSlots } from "@shared/calendarBooking";
import { slotUnavailableReason } from "@shared/slotEligibility";
import { isValidTimeOffBlockWindow, slotOccursOnDate, timeRangesOverlap } from "@shared/timeOffBlocks";
import { findTimeOffBlockForSlot } from "./availabilityTimeOff";
import { isCyaPsychologyTenant } from "@shared/practicePolicies";
import { guardReservationMutation, ReservationError } from "./reservationLifecycle";
import { UNALLOCATED_CLIENT_STATUSES } from "./strandedAllocationRepair";
import {
  ACTIVE_ALLOCATION_STATUSES,
  getSlotIntegrityAction,
  hasActiveClientAllocation,
  hasFinalizedBooking,
} from "./clientAllocationWorkflow";
import {
  confirmBookingInTransaction,
  type BookingConfirmationResult,
} from "./bookingConfirmation";

export type StrandedAllocationRepairRow = {
  clientId: string;
  clientDisplayId: string;
  tenantId: string | null;
  slotId: string;
  status: string;
  reason?: string;
  slotAvailable?: boolean;
};

export type StrandedAllocationRepairResult = {
  identified: number;
  repaired: StrandedAllocationRepairRow[];
  skipped: StrandedAllocationRepairRow[];
};

export class ClientAllocationUpdateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClientAllocationUpdateError";
  }
}

export type ManualAssignmentFailure =
  | "client_not_found"
  | "clinician_not_found"
  | "slot_not_found"
  | "access_denied"
  | "client_already_assigned"
  | "slot_clinician_mismatch"
  | "invalid_occurrence_date"
  | "slot_unavailable"
  | "mutation_failed";

export class ManualAssignmentError extends Error {
  constructor(
    public readonly reason: ManualAssignmentFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManualAssignmentError";
  }
}

export class SlotRetirementConflictError extends Error {
  constructor(public readonly clientIds: string[], ownerStatuses: readonly string[] = []) {
    super(slotRetirementConflictCopy(ownerStatuses));
    this.name = "SlotRetirementConflictError";
  }
}

export class AvailabilityTimeOffConflictError extends Error {
  constructor(message = "This time-off block overlaps an existing appointment or reservation. Resolve it before saving.") {
    super(message);
    this.name = "AvailabilityTimeOffConflictError";
  }
}

export type SlotIntegrityRow = {
  slotId: string;
  tenantId: string | null;
  isBooked: boolean;
  activeOwnerIds: string[];
  issue: string;
  action: "repaired" | "skipped" | "reported";
};

export type SlotIntegrityReport = {
  identified: number;
  repaired: SlotIntegrityRow[];
  skipped: SlotIntegrityRow[];
};

export type ReassignClientResult = {
  client: Client;
  confirmation?: BookingConfirmationResult;
};

class ClientMissingDuringAllocationUpdateError extends Error {}

// Storage interface for all CRUD operations
export interface IStorage {
  // ============ USERS & AUTH ============
  getUser(id: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByName(name: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;
  getAdminUsers(): Promise<User[]>;
  getAdminUsersByTenantId(tenantId: string): Promise<User[]>;
  
  // ============ INVITE TOKENS ============
  createInviteToken(userId: string, token: string, expiresAt: Date): Promise<InviteToken>;
  getInviteTokenByToken(token: string): Promise<InviteToken | undefined>;
  markInviteTokenUsed(tokenId: string): Promise<void>;
  
  // ============ PASSWORD RESET TOKENS ============
  createPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getPasswordResetTokenByToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(tokenId: string): Promise<void>;
  
  // ============ CLINICIANS ============
  getAllClinicians(tenantId?: string | null): Promise<Clinician[]>;
  getClinicianById(id: string): Promise<Clinician | undefined>;
  getClinicianByUserId(userId: string): Promise<Clinician | undefined>;
  createClinician(clinician: InsertClinician, tenantId?: string | null): Promise<Clinician>;
  updateClinician(id: string, updates: Partial<InsertClinician>): Promise<Clinician | undefined>;
  deleteClinician(id: string): Promise<void>;
  
  // ============ TIME SLOTS ============
  getTimeSlotsByClinicianId(clinicianId: string): Promise<TimeSlot[]>;
  getTimeSlotById(id: string): Promise<TimeSlot | undefined>;
  createTimeSlot(slot: InsertTimeSlot): Promise<TimeSlot>;
  deleteTimeSlot(id: string): Promise<void>;
  addTimeSlots(clinicianId: string, newSlots: Omit<TimeSlot, 'id' | 'createdAt'>[], tenantId?: string | null): Promise<TimeSlot[]>;
  deleteTimeSlotById(id: string, tenantId?: string, reason?: string): Promise<boolean>;
  getAllTimeSlots(): Promise<TimeSlot[]>;
  getAvailabilityTimeOffBlocks(tenantId: string): Promise<AvailabilityTimeOffBlock[]>;
  createAvailabilityTimeOffBlock(input: Omit<AvailabilityTimeOffBlock, "id" | "createdAt">): Promise<AvailabilityTimeOffBlock>;
  deleteAvailabilityTimeOffBlock(id: string, tenantId: string): Promise<boolean>;
  updateTimeSlotLocationType(id: string, tenantId: string, locationType: string, actor: Pick<User, "id" | "role">): Promise<{ slot: TimeSlot; previousLocationType: string } | undefined>;
  
  // ============ CLIENTS ============
  getAllClients(includeArchived?: boolean, tenantId?: string): Promise<Client[]>;
  getClientById(id: string): Promise<Client | undefined>;
  getClientByDisplayId(displayId: string): Promise<Client | undefined>;
  createClient(client: InsertClient, tenantId?: string | null): Promise<Client>;
  createClientIdempotently(client: InsertClient, tenantId: string, idempotencyKey?: string): Promise<{ client: Client; created: boolean }>;
  updateClient(id: string, updates: Partial<InsertClient>): Promise<Client | undefined>;
  updateClientAndReleaseSlot(id: string, updates: Partial<InsertClient>, slotId: string | null, clinicianId: string | null, tenantId: string): Promise<Client | undefined>;
  updateClientAndRetireSlot(id: string, updates: Partial<InsertClient>, slotId: string | null, tenantId: string): Promise<Client | undefined>;
  archiveClient(id: string, reason?: string, category?: string): Promise<Client | undefined>;
  restoreClient(id: string): Promise<Client | undefined>;
  deleteClientPermanently(id: string): Promise<boolean>;
  assignClinicianToClient(clientId: string, clinicianId: string, slotId: string, tenantId: string, allocationMethod?: "form" | "manual", allocationReason?: string, occurrenceDate?: string): Promise<Client>;
  reassignClient(
    clientId: string,
    newClinicianId: string | null,
    newSlotId: string | null,
    newStatus: string,
    tenantId: string,
    confirmationIdempotencyKey?: string,
    occurrenceDate?: string,
  ): Promise<ReassignClientResult | undefined>;
  repairStrandedClientAllocations(ipAddress?: string | null): Promise<StrandedAllocationRepairResult>;
  repairSlotIntegrity(tenantId?: string, ipAddress?: string | null): Promise<SlotIntegrityReport>;
  
  // ============ FORMS ============
  getAllFormTemplates(tenantId?: string | null): Promise<FormTemplate[]>;
  getFormTemplateById(id: string): Promise<FormTemplate | undefined>;
  createFormTemplate(form: InsertFormTemplate, tenantId?: string | null): Promise<FormTemplate>;
  updateFormTemplate(id: string, updates: Partial<InsertFormTemplate>): Promise<FormTemplate | undefined>;
  deleteFormTemplate(id: string): Promise<void>;
  
  // ============ FORM SUBMISSIONS ============
  getAllCompletedFormSubmissions(tenantId?: string | null): Promise<{ submission: FormSubmission; clientName: string; clientDisplayId: string; formTitle: string; formDescription: string; formFields: any[] }[]>;
  getFormSubmissionsByClientId(clientId: string): Promise<FormSubmission[]>;
  createFormSubmission(submission: InsertFormSubmission, tenantId?: string | null): Promise<FormSubmission>;
  getDraftSubmission(clientId: string, formTemplateId: string): Promise<FormSubmission | undefined>;
  saveOrUpdateDraft(clientId: string, formTemplateId: string, responses: any, tenantId?: string | null): Promise<FormSubmission>;
  submitDraft(submissionId: string, responses: any, tenantId?: string | null): Promise<FormSubmission | undefined>;
  backfillFormSubmissionTenantIds(): Promise<number>;
  getFormDeliveries(clientId: string, tenantId: string): Promise<FormDelivery[]>;
  prepareFormDeliveries(clientId: string, formTemplateIds: string[], tenantId: string): Promise<FormDelivery[]>;
  updateFormDelivery(id: string, tenantId: string, updates: Partial<FormDelivery>): Promise<FormDelivery | undefined>;
  claimFormDelivery(id: string, tenantId: string, leaseToken: string, staleBefore: Date): Promise<FormDelivery | undefined>;
  finishFormDeliveryClaim(id: string, tenantId: string, leaseToken: string, status: "sent" | "failed", error?: string): Promise<FormDelivery | undefined>;
  
  // ============ TASKS ============
  getAllTasks(tenantId?: string | null): Promise<Task[]>;
  getTaskById(id: string): Promise<Task | undefined>;
  createTask(task: InsertTask, tenantId?: string | null): Promise<Task>;
  updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<void>;
  getOpenTasksWithoutCreationActivity(tenantId: string, limit?: number): Promise<Task[]>;
  
  // ============ AUDIT LOGS (GDPR) ============
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByUserId(userId: string): Promise<AuditLog[]>;
  getRecentAuditLogs(limit?: number, action?: string, tenantId?: string | null): Promise<AuditLog[]>;
  getRecentActivityLogs(limit?: number, tenantId?: string | null, category?: RecentActivityCategory): Promise<AuditLog[]>;
  getHistoricalActivitySources(tenantId: string, limit?: number): Promise<HistoricalActivitySources>;

  // ============ EMAIL TEMPLATES ============
  getAllEmailTemplates(tenantId?: string | null): Promise<EmailTemplate[]>;
  getEmailTemplateByKey(templateKey: string, tenantId?: string | null): Promise<EmailTemplate | undefined>;
  upsertEmailTemplate(template: InsertEmailTemplate & { tenantId?: string | null }): Promise<EmailTemplate>;
  getTenantById(id: string): Promise<Tenant | undefined>;

  // ============ NON-ENGAGEMENT CATEGORIES ============
  getAllNonEngagementCategories(tenantId?: string | null): Promise<NonEngagementCategory[]>;
  createNonEngagementCategory(category: InsertNonEngagementCategory, tenantId?: string | null): Promise<NonEngagementCategory>;
  deleteNonEngagementCategory(id: string, tenantId?: string | null): Promise<boolean>;

  // ============ CUSTOM INSURERS ============
  getCustomInsurers(tenantId?: string | null): Promise<CustomInsurer[]>;
  addCustomInsurer(name: string, tenantId?: string | null): Promise<CustomInsurer>;
  deleteCustomInsurer(id: string, tenantId?: string | null): Promise<boolean>;

  // ============ CLIENT CLINICIAN OPTIONS (CY&A) ============
  createClientClinicianOptions(options: InsertClientClinicianOption[]): Promise<ClientClinicianOption[]>;
  getClientClinicianOptions(clientId: string): Promise<ClientClinicianOption[]>;
  getClientClinicianOptionByToken(token: string): Promise<ClientClinicianOption | undefined>;

  // ============ PAYMENT CHARGES ============
  createPaymentCharge(charge: InsertPaymentCharge): Promise<PaymentCharge>;
  getPaymentChargesByClientId(clientId: string): Promise<PaymentCharge[]>;
  getAllPaymentCharges(tenantId?: string | null): Promise<(PaymentCharge & { clientDisplayId: string; clinicianName: string | null })[]>;
  updatePaymentCharge(id: string, updates: Partial<InsertPaymentCharge>): Promise<PaymentCharge | undefined>;
  getClientsWithFailedPayments(tenantId?: string | null): Promise<{ clientId: string; failureReason: string | null }[]>;
}

// Database implementation with PostgreSQL
export class DatabaseStorage implements IStorage {
  // ============ USERS & AUTH ============
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
    return user || undefined;
  }

  async getUserByName(name: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.name, name));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser as any).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users).set(updates as any).where(eq(users.id, id)).returning();
    return user || undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getAdminUsers(): Promise<User[]> {
    return db.select().from(users).where(eq(users.role, "admin"));
  }

  async getAdminUsersByTenantId(tenantId: string): Promise<User[]> {
    return db.select().from(users).where(
      and(eq(users.role, "admin"), eq(users.tenantId, tenantId))
    );
  }

  // ============ INVITE TOKENS ============
  async createInviteToken(userId: string, token: string, expiresAt: Date): Promise<InviteToken> {
    const [inviteToken] = await db.insert(inviteTokens).values({
      userId,
      token,
      expiresAt,
    }).returning();
    return inviteToken;
  }

  async getInviteTokenByToken(token: string): Promise<InviteToken | undefined> {
    const [inviteToken] = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token));
    return inviteToken || undefined;
  }

  async markInviteTokenUsed(tokenId: string): Promise<void> {
    await db.update(inviteTokens).set({ usedAt: new Date() }).where(eq(inviteTokens.id, tokenId));
  }

  // ============ PASSWORD RESET TOKENS ============
  async createPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<PasswordResetToken> {
    const [resetToken] = await db.insert(passwordResetTokens).values({
      userId,
      token,
      expiresAt,
    }).returning();
    return resetToken;
  }

  async getPasswordResetTokenByToken(token: string): Promise<PasswordResetToken | undefined> {
    const [resetToken] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token));
    return resetToken || undefined;
  }

  async markPasswordResetTokenUsed(tokenId: string): Promise<void> {
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, tokenId));
  }

  // ============ CLINICIANS ============
  async getAllClinicians(tenantId?: string | null): Promise<(Clinician & { name: string })[]> {
    const result = await db
      .select({
        id: clinicians.id,
        userId: clinicians.userId,
        avatar: clinicians.avatar,
        specialties: clinicians.specialties,
        capacity: clinicians.capacity,
        currentLoad: clinicians.currentLoad,
        maxNewClients: clinicians.maxNewClients,
        bio: clinicians.bio,
        insurers: clinicians.insurers,
        contactMethods: clinicians.contactMethods,
        location: clinicians.location,
        nhsTrust: clinicians.nhsTrust,
        worksWithCouples: clinicians.worksWithCouples,
        allocateForBupa: clinicians.allocateForBupa,
        tier: clinicians.tier,
        therapyMode: clinicians.therapyMode,
        zoomLink: clinicians.zoomLink,
        isActive: clinicians.isActive,
        sessionRatePence: clinicians.sessionRatePence,
        lastUpdatedAvailability: clinicians.lastUpdatedAvailability,
        createdAt: clinicians.createdAt,
        name: users.name,
        email: users.email,
      })
      .from(clinicians)
      .leftJoin(users, eq(clinicians.userId, users.id))
      .where(tenantId ? eq(clinicians.tenantId, tenantId) : undefined)
      .orderBy(clinicians.createdAt);
    return result.map(r => ({ ...r, name: r.name || 'Unknown' }));
  }

  async getClinicianById(id: string): Promise<Clinician | undefined> {
    const [clinician] = await db.select().from(clinicians).where(eq(clinicians.id, id));
    return clinician || undefined;
  }

  async getClinicianByUserId(userId: string): Promise<Clinician | undefined> {
    const [clinician] = await db.select().from(clinicians).where(eq(clinicians.userId, userId));
    return clinician || undefined;
  }

  async createClinician(insertClinician: InsertClinician, tenantId?: string | null): Promise<Clinician> {
    const [clinician] = await db.insert(clinicians).values({ ...insertClinician, ...(tenantId ? { tenantId } : {}) }).returning();
    return clinician;
  }

  async updateClinician(id: string, updates: Partial<InsertClinician>): Promise<Clinician | undefined> {
    // Never let a caller reassign a clinician's tenant or linked user account
    // through a general-purpose profile update — these fields are only ever
    // supposed to change via the dedicated tenant-reassignment/user-linking
    // flows. Stripping them here protects every current and future caller,
    // even ones that pass through most of req.body unfiltered.
    const { tenantId, userId, ...safeUpdates } = updates as Partial<InsertClinician> & { tenantId?: unknown; userId?: unknown };
    const [clinician] = await db.update(clinicians).set({
      ...safeUpdates,
      lastUpdatedAvailability: new Date()
    }).where(eq(clinicians.id, id)).returning();
    return clinician || undefined;
  }

  async deleteClinician(id: string): Promise<void> {
    await db.delete(timeSlots).where(eq(timeSlots.clinicianId, id));
    await db.delete(clinicians).where(eq(clinicians.id, id));
  }

  // ============ TIME SLOTS ============
  async getTimeSlotsByClinicianId(clinicianId: string): Promise<TimeSlot[]> {
    const slots = await db.select().from(timeSlots).where(and(
      eq(timeSlots.clinicianId, clinicianId),
      isNull(timeSlots.retiredAt),
    ));
    if (!slots.length) return slots;
    // Existing WriteUpp bookings must disappear automatically too. Read the
    // recorded arrangement without rewriting clinical/payment/portal evidence.
    // Verify the client's practice through the reliably scoped parent clinician;
    // legacy slot rows can have a null tenantId.
    const reservations = await db.select({
      assignedSlotId: clients.assignedSlotId,
      status: clients.status,
      writeuppArranged: sql<boolean>`exists (
        select 1 from audit_logs arrangement
        where arrangement.tenant_id = ${clients.tenantId}
          and arrangement.resource_id = ${clients.id}
          and arrangement.resource_type = 'client'
          and arrangement.action = 'activity_writeupp_appointment_arranged'
      )`,
    }).from(clients).innerJoin(clinicians, and(
      eq(clients.assignedClinicianId, clinicians.id),
      eq(clients.tenantId, clinicians.tenantId),
    )).where(and(
      eq(clinicians.id, clinicianId),
      inArray(clients.assignedSlotId, slots.map(slot => slot.id)),
      inArray(clients.status, ["Scheduled", "BookingConfirmed", "AwaitingConfirmation", "RegistrationPending"]),
    ));
    return visibleCalendarSlots(slots, reservations);
  }

  async createTimeSlot(slot: InsertTimeSlot): Promise<TimeSlot> {
    const [newSlot] = await db.insert(timeSlots).values(slot).returning();
    return newSlot;
  }

  async deleteTimeSlot(id: string): Promise<void> {
    await this.deleteTimeSlotById(id, undefined, "Appointment confirmed");
  }

  async addTimeSlots(clinicianId: string, newSlots: Omit<TimeSlot, 'id' | 'createdAt'>[], tenantId?: string | null): Promise<TimeSlot[]> {
    if (newSlots.length === 0) return [];
    
    const insertedSlots = await db.insert(timeSlots).values(newSlots.map((slot, index) => ({
      id: `ts-${Date.now()}-${index}-${slot.day || slot.date || 'slot'}`,
      clinicianId,
      type: slot.type,
      day: slot.day,
      date: slot.date,
      startDate: slot.startDate,
      endDate: slot.endDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      isBooked: slot.isBooked || false,
      batchId: slot.batchId,
      frequency: (slot as any).frequency || "weekly",
      isOngoing: (slot as any).isOngoing || false,
      locationType: (slot as any).locationType || "online",
      ...(tenantId ? { tenantId } : {}),
    }))).returning();
    
    await db.update(clinicians).set({
      lastUpdatedAvailability: new Date()
    }).where(eq(clinicians.id, clinicianId));
    
    return insertedSlots;
  }

  async getTimeSlotById(id: string): Promise<TimeSlot | undefined> {
    const [slot] = await db.select().from(timeSlots).where(eq(timeSlots.id, id));
    return slot;
  }

  async deleteTimeSlotById(id: string, tenantId?: string, reason = "Administrative retirement"): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [slot] = await tx.select().from(timeSlots).where(and(
        eq(timeSlots.id, id),
        ...(tenantId ? [or(eq(timeSlots.tenantId, tenantId), isNull(timeSlots.tenantId))!] : []),
      )).for("update");
      if (!slot) return false;
      const owners = await tx.select({ id: clients.id, status: clients.status }).from(clients).where(and(
        eq(clients.assignedSlotId, id),
        inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
        ...(tenantId ? [eq(clients.tenantId, tenantId)] : []),
      ));
      if (owners.length) throw new SlotRetirementConflictError(
        owners.map(({ id: clientId }) => clientId), owners.map(owner => owner.status),
      );
      await tx.update(timeSlots).set({
        retiredAt: new Date(),
        retirementReason: reason,
        isBooked: false,
      }).where(eq(timeSlots.id, id));
      await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
        eq(clientClinicianOptions.slotId, id),
        eq(clientClinicianOptions.status, "pending"),
        ...(tenantId ? [eq(clientClinicianOptions.tenantId, tenantId)] : []),
      ));
      return true;
    });
  }

  async getAllTimeSlots(): Promise<TimeSlot[]> {
    return await db.select().from(timeSlots);
  }

  async getAvailabilityTimeOffBlocks(tenantId: string): Promise<AvailabilityTimeOffBlock[]> {
    return db.select().from(availabilityTimeOffBlocks).where(eq(availabilityTimeOffBlocks.tenantId, tenantId));
  }

  async createAvailabilityTimeOffBlock(
    input: Omit<AvailabilityTimeOffBlock, "id" | "createdAt">,
  ): Promise<AvailabilityTimeOffBlock> {
    if (!isValidTimeOffBlockWindow(input)) {
      throw new ReservationError(400, "Choose a valid date and a whole-hour range between 07:00 and 21:00.");
    }

    return db.transaction(async tx => {
      // Assignment and reservation paths lock the clinician too, so a block
      // cannot be created in parallel with a new booking for the same clinician.
      const [clinician] = await tx.select().from(clinicians).where(and(
        eq(clinicians.id, input.clinicianId),
        eq(clinicians.tenantId, input.tenantId),
      )).for("update");
      if (!clinician) throw new ReservationError(404, "Clinician not found");

      const existingBlocks: AvailabilityTimeOffBlock[] = await tx.select().from(availabilityTimeOffBlocks).where(and(
        eq(availabilityTimeOffBlocks.tenantId, input.tenantId),
        eq(availabilityTimeOffBlocks.clinicianId, input.clinicianId),
        eq(availabilityTimeOffBlocks.date, input.date),
      ));
      if (existingBlocks.some(block => timeRangesOverlap(block, input))) {
        throw new ReservationError(409, "This time already overlaps another time-off block.");
      }

      const slots: TimeSlot[] = await tx.select().from(timeSlots).where(and(
        or(eq(timeSlots.tenantId, input.tenantId), isNull(timeSlots.tenantId)),
        eq(timeSlots.clinicianId, input.clinicianId),
        isNull(timeSlots.retiredAt),
      )).for("update");
      const relevantSlots = slots.filter(slot =>
        slotOccursOnDate(slot, input.date) && timeRangesOverlap(slot, input),
      );
      const relevantSlotIds = relevantSlots.map(slot => slot.id);
      const activeOwners = relevantSlotIds.length
        ? await tx.select({
            assignedSlotId: clients.assignedSlotId,
            assignedSlot: clients.assignedSlot,
          }).from(clients).where(and(
            eq(clients.tenantId, input.tenantId),
            eq(clients.assignedClinicianId, input.clinicianId),
            inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
          ))
        : [];
      const reservations = relevantSlotIds.length
        ? await tx.select({ slotId: bookingReservations.slotId }).from(bookingReservations).where(and(
            eq(bookingReservations.tenantId, input.tenantId),
            eq(bookingReservations.clinicianId, input.clinicianId),
            inArray(bookingReservations.slotId, relevantSlotIds),
            inArray(bookingReservations.status, ["active", "payment_check", "payment_review"]),
          ))
        : [];
      const snapshots = await tx.select({
        startTime: bookingSnapshots.startTime,
        endTime: bookingSnapshots.endTime,
      }).from(bookingSnapshots).where(and(
        eq(bookingSnapshots.tenantId, input.tenantId),
        eq(bookingSnapshots.clinicianId, input.clinicianId),
        eq(bookingSnapshots.date, input.date),
      ));

      const occupied = relevantSlots.some(slot =>
        slot.isBooked
        || reservations.some(reservation => reservation.slotId === slot.id)
        || activeOwners.some(owner =>
          owner.assignedSlotId === slot.id
          || (!owner.assignedSlotId && owner.assignedSlot?.toLowerCase() === `${slot.day || slot.date} ${slot.startTime}`.toLowerCase()),
        ),
      ) || snapshots.some(snapshot => timeRangesOverlap(snapshot, input));
      if (occupied) throw new AvailabilityTimeOffConflictError();

      const [block] = await tx.insert(availabilityTimeOffBlocks).values(input).returning();
      await tx.update(clinicians).set({ lastUpdatedAvailability: new Date() }).where(eq(clinicians.id, clinician.id));
      return block;
    });
  }

  async deleteAvailabilityTimeOffBlock(id: string, tenantId: string): Promise<boolean> {
    return db.transaction(async tx => {
      const [block] = await tx.select().from(availabilityTimeOffBlocks).where(and(
        eq(availabilityTimeOffBlocks.id, id),
        eq(availabilityTimeOffBlocks.tenantId, tenantId),
      )).for("update");
      if (!block) return false;
      const [clinician] = await tx.select({ id: clinicians.id }).from(clinicians).where(and(
        eq(clinicians.id, block.clinicianId),
        eq(clinicians.tenantId, tenantId),
      )).for("update");
      if (!clinician) return false;
      const deleted = await tx.delete(availabilityTimeOffBlocks).where(and(
        eq(availabilityTimeOffBlocks.id, id),
        eq(availabilityTimeOffBlocks.tenantId, tenantId),
      )).returning({ id: availabilityTimeOffBlocks.id });
      if (deleted.length === 1) {
        await tx.update(clinicians).set({ lastUpdatedAvailability: new Date() }).where(eq(clinicians.id, clinician.id));
      }
      return deleted.length === 1;
    });
  }

  async updateTimeSlotLocationType(id: string, tenantId: string, locationType: string, actor: Pick<User, "id" | "role">): Promise<{ slot: TimeSlot; previousLocationType: string } | undefined> {
    if (locationType !== "online" && locationType !== "in_person") throw new ReservationError(400, "Invalid locationType");
    if (!actor || !["admin", "clinician"].includes(actor.role)) return undefined;
    return db.transaction(async tx => {
      const [observed] = await tx.select().from(timeSlots).where(eq(timeSlots.id, id));
      if (!observed) return undefined;
      // Same clinician -> slot lock order as online reservations. Authorise through
      // the parent, including legacy slots that have no per-slot tenant tag.
      const [clinician] = await tx.select().from(clinicians).where(and(
        eq(clinicians.id, observed.clinicianId), eq(clinicians.tenantId, tenantId),
      )).for("update");
      if (!clinician || (actor.role === "clinician" && clinician.userId !== actor.id)) return undefined;
      const [slot] = await tx.select().from(timeSlots).where(eq(timeSlots.id, id)).for("update");
      if (!slot || slot.clinicianId !== clinician.id || (slot.tenantId && slot.tenantId !== tenantId)) return undefined;
      if (slot.retiredAt) throw new ReservationError(409, "This slot has been retired. Add new availability instead.");
      if (slot.isBooked) throw new ReservationError(409, "Booked slots cannot change format. Review the booking before changing availability.");
      // Do not trust a stale isBooked flag; protect active and legacy assignments,
      // inconsistent cross-practice references and immutable booking history too.
      const owners = await tx.select({ id: clients.id }).from(clients).where(and(
        inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
        or(eq(clients.assignedSlotId, slot.id), and(
          isNull(clients.assignedSlotId), eq(clients.assignedClinicianId, clinician.id),
          sql`lower(${clients.assignedSlot}) = lower(${`${slot.day || slot.date} ${slot.startTime}`})`,
        )),
      )).limit(1);
      const snapshots = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots)
        .where(eq(bookingSnapshots.slotId, slot.id)).limit(1);
      if (owners.length || snapshots.length) throw new ReservationError(409, "This slot is linked to a booking or reservation and cannot change format. Refresh availability.");
      const [updated] = await tx.update(timeSlots).set({ locationType })
        .where(and(eq(timeSlots.id, id), eq(timeSlots.clinicianId, clinician.id), isNull(timeSlots.retiredAt), eq(timeSlots.isBooked, false)))
        .returning();
      return updated ? { slot: updated, previousLocationType: slot.locationType } : undefined;
    });
  }

  // ============ CLIENTS ============
  async getAllClients(includeArchived?: boolean, tenantId?: string): Promise<Client[]> {
    const baseWhere = includeArchived
      ? (tenantId ? eq(clients.tenantId, tenantId) : undefined)
      : (tenantId
          ? and(eq(clients.isArchived, false), eq(clients.tenantId, tenantId))
          : eq(clients.isArchived, false));

    const rows = await db
      .select({
        client: clients,
        slotLocationType: timeSlots.locationType,
        bookingSnapshot: bookingSnapshots,
      })
      .from(clients)
      .leftJoin(timeSlots, and(eq(clients.assignedSlotId, timeSlots.id), eq(clients.tenantId, timeSlots.tenantId)))
      .leftJoin(bookingSnapshots, and(eq(clients.id, bookingSnapshots.clientId), eq(clients.tenantId, bookingSnapshots.tenantId)))
      .where(baseWhere)
      .orderBy(desc(clients.intakeDate));

    return rows.map(r => ({
      ...r.client,
      slotLocationType: r.bookingSnapshot?.locationType ?? r.slotLocationType ?? null,
      bookingSnapshot: r.bookingSnapshot ?? null,
    })) as any;
  }

  async restoreClient(id: string): Promise<Client | undefined> {
    const [updated] = await db.update(clients)
      .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return updated;
  }

  async deleteClientPermanently(id: string): Promise<boolean> {
    const [existing] = await db.select().from(clients).where(eq(clients.id, id));
    if (!existing) return false;

    await db.transaction(async (tx) => {
      // Release any booked time slot
      if (existing.assignedSlotId) {
        await tx.update(timeSlots)
          .set({ isBooked: false, bookedByClientId: null })
          .where(eq(timeSlots.id, existing.assignedSlotId));
      }

      // Delete child records that belong to the client
      await tx.delete(formSubmissions).where(eq(formSubmissions.clientId, id));
      await tx.delete(formDeliveries).where(eq(formDeliveries.clientId, id));
      await tx.delete(clientCreationRequests).where(eq(clientCreationRequests.clientId, id));
      await tx.delete(paymentCharges).where(eq(paymentCharges.clientId, id));

      // Nullify soft references (keep the row but remove the client pointer)
      await tx.update(tasks)
        .set({ relatedClientId: null })
        .where(eq(tasks.relatedClientId, id));
      await tx.update(intakeMessages)
        .set({ linkedClientId: null })
        .where(eq(intakeMessages.linkedClientId, id));
      // auditLogs has no FK to clients — resourceId is plain text, no constraint

      await tx.delete(clients).where(eq(clients.id, id));
    });
    return true;
  }

  async archiveClient(id: string, reason?: string, category?: string): Promise<Client | undefined> {
    const scoped = await this.getClientById(id);
    if (isCyaPsychologyTenant(scoped?.tenantId)) return db.transaction(async tx => {
      await tx.select().from(clients).where(eq(clients.id, id)).for("update");
      await guardReservationMutation(id, scoped!.tenantId!, tx);
      return this.archiveClientRecord(id, reason, category, tx);
    });
    return this.archiveClientRecord(id, reason, category, db);
  }

  private async archiveClientRecord(id: string, reason: string | undefined, category: string | undefined, executor: any): Promise<Client | undefined> {
    // First, get the client to find their assigned slot and clinician
    const [existingClient] = await executor.select().from(clients).where(eq(clients.id, id));
    
    if (!existingClient) return undefined;

    // If client was assigned to a slot, release it
    if (existingClient.assignedClinicianId) {
      let slotIdToRelease = existingClient.assignedSlotId;
      
      // Fallback for legacy records without assignedSlotId but with assignedSlot string
      if (!slotIdToRelease && existingClient.assignedSlot) {
        const slotParts = existingClient.assignedSlot.split(' ');
        const dayOrDate = slotParts[0];
        const startTime = slotParts[1];

        // Try to find by day (recurring) first, then by date (specific date)
        let [foundSlot] = await executor.select().from(timeSlots)
          .where(and(
            eq(timeSlots.clinicianId, existingClient.assignedClinicianId),
            eq(timeSlots.day, dayOrDate),
            eq(timeSlots.startTime, startTime),
            eq(timeSlots.isBooked, true)
          ));

        if (!foundSlot) {
          [foundSlot] = await executor.select().from(timeSlots)
            .where(and(
              eq(timeSlots.clinicianId, existingClient.assignedClinicianId),
              eq(timeSlots.date, dayOrDate),
              eq(timeSlots.startTime, startTime),
              eq(timeSlots.isBooked, true)
            ));
        }
        slotIdToRelease = foundSlot?.id || null;
      }

      if (slotIdToRelease) {
        // Release the slot
        await executor.update(timeSlots).set({
          isBooked: false
        }).where(eq(timeSlots.id, slotIdToRelease));

        // Decrement clinician load
        await executor.update(clinicians).set({
          currentLoad: sql`GREATEST(${clinicians.currentLoad} - 1, 0)`
        }).where(eq(clinicians.id, existingClient.assignedClinicianId));
      }
    }

    // Always clear the FK reference to the released slot so there is no stale
    // assignedSlotId pointing at a slot that is no longer booked. Leaving it set
    // causes a FK-constraint error if an admin later tries to delete that slot
    // (the slot's isBooked flag is false so the old guard skipped cleanup).
    const [client] = await executor.update(clients).set({
      isArchived: true,
      archivedAt: new Date(),
      archiveReason: reason || null,
      archiveCategory: category || null,
      assignedSlotId: null,
      assignedSlot: null,
      assignedClinicianId: null,
      updatedAt: new Date()
    }).where(eq(clients.id, id)).returning();
    return client || undefined;
  }

  async getClientById(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client || undefined;
  }

  async getClientByDisplayId(displayId: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.displayId, displayId));
    return client || undefined;
  }

  async repairStrandedClientAllocations(ipAddress?: string | null): Promise<StrandedAllocationRepairResult> {
    return db.transaction(async (tx) => {
      // This is a deliberately short, one-time maintenance transaction. Both
      // normal allocation paths update these tables, so table-level write locks
      // prevent a concurrent allocation from creating a new slot reference
      // between our exclusivity check and availability verification.
      await tx.execute(sql`LOCK TABLE clients, time_slots IN SHARE ROW EXCLUSIVE MODE`);

      const statuses = sql.join(
        UNALLOCATED_CLIENT_STATUSES.map((status) => sql`${status}`),
        sql`, `,
      );
      const candidateResult = await tx.execute(sql`
        SELECT
          c.id AS "clientId",
          c.display_id AS "clientDisplayId",
          c.tenant_id AS "tenantId",
          c.assigned_slot_id AS "slotId",
          c.status,
          CASE
            WHEN c.tenant_id IS NULL THEN 'client_has_no_tenant'
            WHEN s.id IS NULL THEN 'assigned_slot_missing'
            WHEN c.assigned_clinician_id IS NULL THEN 'client_has_no_assigned_clinician'
            WHEN c.assigned_clinician_id <> s.clinician_id THEN 'client_slot_clinician_mismatch'
            WHEN s.tenant_id IS NULL THEN 'slot_has_no_tenant'
            WHEN s.tenant_id <> c.tenant_id THEN 'client_slot_tenant_mismatch'
            WHEN slot_clinician.id IS NULL THEN 'slot_clinician_missing'
            WHEN slot_clinician.tenant_id IS NULL THEN 'slot_clinician_has_no_tenant'
            WHEN slot_clinician.tenant_id <> c.tenant_id THEN 'client_slot_clinician_tenant_mismatch'
            WHEN (
              SELECT COUNT(*)
              FROM clients other_client
              WHERE other_client.assigned_slot_id = c.assigned_slot_id
            ) <> 1 THEN 'slot_referenced_by_multiple_clients'
            ELSE NULL
          END AS reason
        FROM clients c
        LEFT JOIN time_slots s ON s.id = c.assigned_slot_id
        LEFT JOIN clinicians slot_clinician ON slot_clinician.id = s.clinician_id
        WHERE c.assigned_slot_id IS NOT NULL
          AND c.status IN (${statuses})
        ORDER BY c.display_id
        FOR UPDATE OF c
      `);

      const candidates = candidateResult.rows as StrandedAllocationRepairRow[];
      const eligible = candidates.filter((candidate) => !candidate.reason);
      const repaired: StrandedAllocationRepairRow[] = [];

      for (const candidate of eligible) {
        const released = await tx.update(timeSlots)
          .set({ isBooked: false })
          .where(and(
            eq(timeSlots.id, candidate.slotId),
            eq(timeSlots.tenantId, candidate.tenantId!),
          ))
          .returning({ id: timeSlots.id });
        if (released.length !== 1) {
          throw new Error(`Verified slot ${candidate.slotId} could not be released`);
        }

        const cleared = await tx.update(clients)
          .set({
            assignedSlotId: null,
            assignedSlot: null,
            assignedClinicianId: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(clients.id, candidate.clientId),
            eq(clients.tenantId, candidate.tenantId!),
            eq(clients.assignedSlotId, candidate.slotId),
          ))
          .returning({ id: clients.id });
        if (cleared.length !== 1) {
          throw new Error(`Verified client ${candidate.clientId} could not be cleared`);
        }

        const verification = await tx.execute(sql`
          SELECT
            NOT s.is_booked
              AND NOT EXISTS (
                SELECT 1 FROM clients c WHERE c.assigned_slot_id = s.id
              ) AS "slotAvailable"
          FROM time_slots s
          WHERE s.id = ${candidate.slotId}
            AND s.tenant_id = ${candidate.tenantId}
        `);
        const slotAvailable = verification.rows[0]?.slotAvailable === true;
        if (!slotAvailable) {
          throw new Error(`Released slot ${candidate.slotId} failed availability verification`);
        }
        await tx.insert(auditLogs).values({
          userId: null,
          action: "repair_stranded_allocation",
          resourceType: "client",
          resourceId: candidate.clientId,
          tenantId: candidate.tenantId,
          ipAddress: ipAddress || null,
          details: {
            clientDisplayId: candidate.clientDisplayId,
            previousStatus: candidate.status,
            releasedSlotId: candidate.slotId,
            slotAvailable,
          },
        });
        repaired.push({ ...candidate, slotAvailable });
      }

      return {
        identified: candidates.length,
        repaired,
        skipped: candidates.filter((candidate) => Boolean(candidate.reason)),
      };
    });
  }

  async repairSlotIntegrity(tenantId?: string, ipAddress?: string | null): Promise<SlotIntegrityReport> {
    return db.transaction(async (tx) => {
      const slots = await tx.select().from(timeSlots).where(
        tenantId ? eq(timeSlots.tenantId, tenantId) : undefined,
      ).for("update");
      const report: SlotIntegrityReport = { identified: 0, repaired: [], skipped: [] };
      for (const slot of slots) {
        const owners = await tx.select({
          id: clients.id,
          displayId: clients.displayId,
          status: clients.status,
        }).from(clients).where(and(
          eq(clients.assignedSlotId, slot.id),
          inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
          ...(tenantId ? [eq(clients.tenantId, tenantId)] : []),
        )).orderBy(clients.displayId);
        if (owners.length === 1 && hasFinalizedBooking(owners[0].status) && !slot.retiredAt) {
          report.identified++;
          await tx.update(timeSlots).set({
            isBooked: false,
            retiredAt: new Date(),
            retirementReason: "Appointment confirmed",
          }).where(eq(timeSlots.id, slot.id));
          await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
            eq(clientClinicianOptions.slotId, slot.id),
            eq(clientClinicianOptions.status, "pending"),
            ...(slot.tenantId ? [eq(clientClinicianOptions.tenantId, slot.tenantId)] : []),
          ));
          report.repaired.push({
            slotId: slot.id,
            tenantId: slot.tenantId,
            isBooked: slot.isBooked,
            activeOwnerIds: [owners[0].id],
            issue: "confirmed_owner_on_active_slot",
            action: "repaired",
          });
          continue;
        }
        const action = getSlotIntegrityAction(slot.isBooked, owners.length, Boolean(slot.retiredAt));
        if (action === "none") continue;
        const issue = action === "conflict"
          ? "competing_active_owners"
          : action === "book"
            ? "active_owner_without_booking"
            : "booked_without_active_owner";
        report.identified++;
        const row: SlotIntegrityRow = {
          slotId: slot.id,
          tenantId: slot.tenantId,
          isBooked: slot.isBooked,
          activeOwnerIds: owners.map(owner => owner.id),
          issue,
          action: action === "conflict" ? "skipped" : "repaired",
        };
        if (action === "conflict") {
          report.skipped.push(row);
          continue;
        }
        await tx.update(timeSlots).set({ isBooked: action === "book" }).where(eq(timeSlots.id, slot.id));
        report.repaired.push(row);
      }
      const pendingOptions = await tx.select({
        id: clientClinicianOptions.id,
        slotId: clientClinicianOptions.slotId,
        tenantId: clientClinicianOptions.tenantId,
      }).from(clientClinicianOptions)
        .leftJoin(timeSlots, eq(clientClinicianOptions.slotId, timeSlots.id))
        .where(and(
          eq(clientClinicianOptions.status, "pending"),
          isNull(timeSlots.id),
          ...(tenantId ? [eq(clientClinicianOptions.tenantId, tenantId)] : []),
        ));
      for (const option of pendingOptions) {
        await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(eq(clientClinicianOptions.id, option.id));
      }
      const retiredOptions = await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
        eq(clientClinicianOptions.status, "pending"),
        ...(tenantId ? [eq(clientClinicianOptions.tenantId, tenantId)] : []),
        sql`${clientClinicianOptions.slotId} IN (SELECT id FROM time_slots WHERE retired_at IS NOT NULL)`,
      )).returning({ id: clientClinicianOptions.id });
      report.identified += pendingOptions.length + retiredOptions.length;
      if (ipAddress) {
        await tx.insert(auditLogs).values({
          userId: null, action: "repair_slot_integrity", resourceType: "timeslot",
          resourceId: null, tenantId: tenantId || null, ipAddress,
          details: { identified: report.identified, repaired: report.repaired.length, skipped: report.skipped.length },
        });
      }
      return report;
    });
  }

  async createClient(insertClient: InsertClient, tenantId?: string | null): Promise<Client> {
    const [client] = await db.insert(clients).values({ ...insertClient, ...(tenantId ? { tenantId } : {}) }).returning();
    return client;
  }

  async createClientIdempotently(insertClient: InsertClient, tenantId: string, idempotencyKey?: string): Promise<{ client: Client; created: boolean }> {
    if (!idempotencyKey) return { client: await this.createClient(insertClient, tenantId), created: true };
    const [alreadyCreated] = await db.select().from(clientCreationRequests).where(
      and(eq(clientCreationRequests.tenantId, tenantId), eq(clientCreationRequests.idempotencyKey, idempotencyKey))
    );
    if (alreadyCreated) {
      const client = await this.getClientById(alreadyCreated.clientId);
      if (!client || client.tenantId !== tenantId) throw new Error("Idempotency record references an inaccessible client");
      return { client, created: false };
    }

    const clientId = crypto.randomUUID();
    try {
      const client = await db.transaction(async (tx) => {
        const [created] = await tx.insert(clients).values({ ...insertClient, id: clientId, tenantId }).returning();
        await tx.insert(clientCreationRequests).values({ tenantId, idempotencyKey, clientId: created.id });
        return created;
      });
      return { client, created: true };
    } catch (error: any) {
      // A simultaneous retry may win the unique key race. Its transaction has
      // committed the client and request together, so returning that client is safe.
      if (error?.code !== "23505") throw error;
      const [existing] = await db.select().from(clientCreationRequests).where(
        and(eq(clientCreationRequests.tenantId, tenantId), eq(clientCreationRequests.idempotencyKey, idempotencyKey))
      );
      if (!existing) throw error;
      const client = await this.getClientById(existing.clientId);
      if (!client || client.tenantId !== tenantId) throw error;
      return { client, created: false };
    }
  }

  async updateClient(id: string, updates: Partial<InsertClient>): Promise<Client | undefined> {
    if (["status", "assignedClinicianId", "assignedSlotId", "assignedSlot", "isArchived", "paymentStatus", "stripeCheckoutUrl", "stripePaymentLinkId", "registrationToken"].some(key => key in updates)) {
      const scoped = await this.getClientById(id);
      if (isCyaPsychologyTenant(scoped?.tenantId)) return db.transaction(async tx => {
        const [current] = await tx.select().from(clients).where(eq(clients.id, id)).for("update");
        if (current && ["status", "assignedClinicianId", "assignedSlotId", "assignedSlot", "isArchived", "paymentStatus", "stripeCheckoutUrl", "stripePaymentLinkId", "registrationToken"]
          .some(key => key in updates && (updates as any)[key] !== (current as any)[key])) {
          await guardReservationMutation(id, scoped!.tenantId!, tx);
        }
        const [client] = await tx.update(clients).set({ ...updates, updatedAt: new Date() }).where(eq(clients.id, id)).returning();
        return client;
      });
    }
    const [client] = await db.update(clients).set({
      ...updates,
      updatedAt: new Date()
    }).where(eq(clients.id, id)).returning();
    return client || undefined;
  }

  async updateClientAndReleaseSlot(
    id: string,
    updates: Partial<InsertClient>,
    slotId: string | null,
    clinicianId: string | null,
    tenantId: string,
  ): Promise<Client | undefined> {
    try {
      return await db.transaction(async (tx) => {
        if (isCyaPsychologyTenant(tenantId)) {
          await tx.select().from(clients).where(eq(clients.id, id)).for("update");
          await guardReservationMutation(id, tenantId, tx);
        }
        if (slotId) {
          const releasedSlots = await tx.update(timeSlots)
            .set({ isBooked: false })
            .where(and(
              eq(timeSlots.id, slotId),
              eq(timeSlots.tenantId, tenantId),
            ))
            .returning({ id: timeSlots.id });
          if (releasedSlots.length !== 1) {
            throw new ClientAllocationUpdateError("The client's assigned slot could not be released");
          }
        }

        if (clinicianId) {
          await tx.update(clinicians)
            .set({ currentLoad: sql`GREATEST(${clinicians.currentLoad} - 1, 0)` })
            .where(and(
              eq(clinicians.id, clinicianId),
              eq(clinicians.tenantId, tenantId),
            ));
        }

        await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
          eq(clientClinicianOptions.clientId, id),
          eq(clientClinicianOptions.tenantId, tenantId),
          inArray(clientClinicianOptions.status, ["pending", "selected"]),
        ));

        const [client] = await tx.update(clients).set({
          ...updates,
          updatedAt: new Date(),
        }).where(eq(clients.id, id)).returning();
        if (!client) {
          throw new ClientMissingDuringAllocationUpdateError();
        }
        if (updates.status === "Scheduled" && slotId) {
          await tx.update(timeSlots).set({
            retiredAt: new Date(),
            retirementReason: "Appointment confirmed",
            isBooked: false,
          }).where(and(
            eq(timeSlots.id, slotId),
            eq(timeSlots.tenantId, tenantId),
          ));
        }
        return client;
      });
    } catch (error) {
      if (error instanceof ClientMissingDuringAllocationUpdateError) {
        return undefined;
      }
      if (error instanceof ClientAllocationUpdateError || error instanceof ReservationError) {
        throw error;
      }
      throw new ClientAllocationUpdateError(
        "The client and slot could not be updated together",
        { cause: error },
      );
    }
  }

  async updateClientAndRetireSlot(
    id: string,
    updates: Partial<InsertClient>,
    slotId: string | null,
    tenantId: string,
  ): Promise<Client | undefined> {
    return db.transaction(async (tx) => {
      const [client] = await tx.update(clients).set({
        ...updates,
        updatedAt: new Date(),
      }).where(and(
        eq(clients.id, id),
        eq(clients.tenantId, tenantId),
      )).returning();
      if (!client) return undefined;
      if (!slotId) return client;

      const retired = await tx.update(timeSlots).set({
        isBooked: false,
        retiredAt: new Date(),
        retirementReason: "Appointment confirmed",
      }).where(and(
        eq(timeSlots.id, slotId),
        or(eq(timeSlots.tenantId, tenantId), isNull(timeSlots.tenantId)),
      )).returning({ id: timeSlots.id });
      if (retired.length !== 1) {
        throw new ClientAllocationUpdateError("The client's assigned slot could not be retired");
      }
      await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
        eq(clientClinicianOptions.slotId, slotId),
        eq(clientClinicianOptions.tenantId, tenantId),
        eq(clientClinicianOptions.status, "pending"),
      ));
      return client;
    });
  }

  async assignClinicianToClient(
    clientId: string,
    clinicianId: string,
    slotId: string,
    tenantId: string,
    allocationMethod: "form" | "manual" = "form",
    allocationReason?: string,
    occurrenceDate?: string,
  ): Promise<Client> {
    try {
      return await db.transaction(async (tx) => {
        const [client] = await tx.select()
          .from(clients)
          .where(eq(clients.id, clientId))
          .for("update");
        if (!client) {
          throw new ManualAssignmentError("client_not_found", "Client not found");
        }
        if (client.tenantId !== tenantId) {
          throw new ManualAssignmentError("access_denied", "Access denied");
        }
        if (client.completedAt) {
          throw new ManualAssignmentError("client_already_assigned", "Reopen this completed booking before assigning a new slot.");
        }
        if (client.assignedSlotId || client.assignedClinicianId || client.assignedSlot) {
          if (client.assignedSlotId === slotId) {
            throw new ManualAssignmentError(
              "slot_unavailable",
              "The selected appointment slot is no longer available",
            );
          }
          throw new ManualAssignmentError(
            "client_already_assigned",
            "This client already has a clinician assignment",
          );
        }

        const [clinician] = await tx.select().from(clinicians).where(and(
          eq(clinicians.id, clinicianId),
          eq(clinicians.tenantId, tenantId),
        )).for("update");
        if (!clinician) {
          throw new ManualAssignmentError("clinician_not_found", "Clinician not found");
        }
        if (clinician.tenantId !== tenantId) {
          throw new ManualAssignmentError("access_denied", "Access denied");
        }

        const [slot] = await tx.select().from(timeSlots).where(eq(timeSlots.id, slotId)).for("update");
        if (!slot) {
          throw new ManualAssignmentError("slot_not_found", "Appointment slot not found");
        }
        if (slot.tenantId !== tenantId || slot.retiredAt) {
          throw new ManualAssignmentError("access_denied", "Access denied");
        }
        if (slot.clinicianId !== clinicianId) {
          throw new ManualAssignmentError(
            "slot_clinician_mismatch",
            "The selected appointment slot does not belong to this clinician",
          );
        }
        if (slot.type === "Recurring" && occurrenceDate && !slotOccursOnDate(slot, occurrenceDate)) {
          throw new ManualAssignmentError("invalid_occurrence_date", "Choose a date that matches this recurring slot.");
        }
        const unavailable = slotUnavailableReason(slot);
        if (unavailable) {
          throw new ManualAssignmentError(
            "slot_unavailable",
            `The selected appointment slot ${unavailable}`,
          );
        }
        const timeOffBlock = await findTimeOffBlockForSlot(tx, tenantId, slot, occurrenceDate);
        if (timeOffBlock) {
          throw new ManualAssignmentError(
            "slot_unavailable",
            `The selected appointment slot is blocked as time off on ${timeOffBlock.date}`,
          );
        }

        const claimedSlots = await tx.update(timeSlots)
          .set({ isBooked: true })
          .where(and(
            eq(timeSlots.id, slotId),
            eq(timeSlots.tenantId, tenantId),
            eq(timeSlots.clinicianId, clinicianId),
            eq(timeSlots.isBooked, false),
            isNull(timeSlots.retiredAt),
          ))
          .returning({ id: timeSlots.id });
        if (claimedSlots.length !== 1) {
          throw new ManualAssignmentError(
            "slot_unavailable",
            "The selected appointment slot is no longer available",
          );
        }

        const updatedClinicians = await tx.update(clinicians)
          .set({ currentLoad: sql`${clinicians.currentLoad} + 1` })
          .where(and(
            eq(clinicians.id, clinicianId),
            eq(clinicians.tenantId, tenantId),
          ))
          .returning({ id: clinicians.id });
        if (updatedClinicians.length !== 1) {
          throw new Error("Clinician workload update failed");
        }

        const slotString = slot.type === "SpecificDate"
          ? `${slot.date} ${slot.startTime}`
          : `${slot.day} ${slot.startTime}`;
        const [updatedClient] = await tx.update(clients).set({
          status: "Assigned",
          assignedClinicianId: clinicianId,
          assignedSlotId: slotId,
          assignedSlot: slotString,
          zoomLinkSentAt: null,
          allocationMethod,
          allocationReason: allocationReason || null,
          allocatedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(clients.id, clientId),
          eq(clients.tenantId, tenantId),
        )).returning();
        if (!updatedClient) {
          throw new Error("Client assignment update failed");
        }

        return updatedClient;
      });
    } catch (error) {
      if (error instanceof ManualAssignmentError) throw error;
      throw new ManualAssignmentError(
        "mutation_failed",
        "The client, slot, and clinician could not be updated together",
        { cause: error },
      );
    }
  }

  async reassignClient(
    clientId: string,
    newClinicianId: string | null,
    newSlotId: string | null,
    newStatus: string,
    tenantId: string,
    confirmationIdempotencyKey?: string,
    occurrenceDate?: string,
  ): Promise<ReassignClientResult | undefined> {
    return db.transaction(async (tx) => {
      const [existingClient] = await tx.select().from(clients).where(and(
        eq(clients.id, clientId),
        eq(clients.tenantId, tenantId),
      )).for("update");
      if (!existingClient) return undefined;
      await guardReservationMutation(clientId, tenantId, tx);
      // This lock also serializes against completion: a stale status-edit request
      // must not replace a completed booking without an explicit reopen.
      if (existingClient.completedAt) {
        throw new Error("Reopen this completed booking before editing its status or allocation.");
      }
      if (existingClient.managerConfirmedAt && !["Scheduled", "BookingConfirmed"].includes(newStatus)) {
        await tx.update(clients).set({
          managerConfirmedAt: null,
          managerConfirmedBy: null,
          managerConfirmationReason: null,
        }).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)));
      }

      const oldClinicianId = existingClient.assignedClinicianId;
      const oldSlotIdToRelease = existingClient.assignedSlotId;
      const isAllocatedStatus = hasActiveClientAllocation(newStatus);
      const isReassigning = newSlotId !== null && newSlotId !== existingClient.assignedSlotId;
      const zoomDeliveryIdentityChanged = shouldResetZoomDelivery(existingClient, {
        assignedClinicianId: newClinicianId,
        assignedSlotId: newSlotId,
      });
      const hasAllocation = !!(oldClinicianId && (oldSlotIdToRelease || existingClient.assignedSlot));

      if (confirmationIdempotencyKey && !isReassigning && hasAllocation) {
        const confirmation = await confirmBookingInTransaction(tx, {
          clientId,
          tenantId,
          source: "reassignment",
          idempotencyKey: confirmationIdempotencyKey,
        });
        return { client: confirmation.client, confirmation };
      }

      if (isAllocatedStatus && !isReassigning && hasAllocation && newClinicianId !== oldClinicianId) {
        throw new Error("Current slot does not belong to selected clinician");
      }
      if (isAllocatedStatus && !hasAllocation && (!newClinicianId || !newSlotId)) {
        throw new Error("A clinician and appointment slot are required for allocation");
      }

      if (oldClinicianId) {
        const [oldClinician] = await tx.select().from(clinicians).where(and(
          eq(clinicians.id, oldClinicianId),
          eq(clinicians.tenantId, tenantId),
        ));
        if (!oldClinician) throw new ManualAssignmentError("access_denied", "Access denied");
      }

      // Helper function to find old slot ID with fallback for legacy records
      const findOldSlotId = async (): Promise<string | null> => {
        if (oldSlotIdToRelease) return oldSlotIdToRelease;
        if (!oldClinicianId || !existingClient.assignedSlot) return null;

        const slotParts = existingClient.assignedSlot.split(' ');
        const dayOrDate = slotParts[0];
        const startTime = slotParts[1];

        // Try to find by day (recurring) first, then by date (specific date)
        let [foundSlot] = await tx.select().from(timeSlots)
          .where(and(
            eq(timeSlots.clinicianId, oldClinicianId),
            eq(timeSlots.tenantId, tenantId),
            eq(timeSlots.day, dayOrDate),
            eq(timeSlots.startTime, startTime),
            eq(timeSlots.isBooked, true)
          ));

        if (!foundSlot) {
          [foundSlot] = await tx.select().from(timeSlots)
            .where(and(
              eq(timeSlots.clinicianId, oldClinicianId),
              eq(timeSlots.tenantId, tenantId),
              eq(timeSlots.date, dayOrDate),
              eq(timeSlots.startTime, startTime),
              eq(timeSlots.isBooked, true)
            ));
        }
        return foundSlot?.id || null;
      };

      // Case 1: Status-only change to allocated status (keep current slot)
      if (isAllocatedStatus && !isReassigning && hasAllocation) {
        // Confirmation retires active availability while preserving the slot row
        // for historical option display and audit.
        if (newStatus === "Scheduled") {
          const slotToRelease = await findOldSlotId();
          if (slotToRelease) {
            await tx.update(timeSlots).set({
              isBooked: false,
              retiredAt: new Date(),
              retirementReason: "Appointment confirmed",
            }).where(and(
              eq(timeSlots.id, slotToRelease),
              eq(timeSlots.tenantId, tenantId),
              eq(timeSlots.clinicianId, oldClinicianId!),
            ));
            await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
              eq(clientClinicianOptions.slotId, slotToRelease),
              eq(clientClinicianOptions.status, "pending"),
              eq(clientClinicianOptions.tenantId, tenantId),
            ));
          }
          const [updated] = await tx.update(clients).set({
            status: "Scheduled" as any,
            assignedSlotId: null,
            assignedSlot: null,
            assignedClinicianId: null,
            zoomLinkSentAt: null,
            confirmedAt: new Date(),
            updatedAt: new Date()
          }).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).returning();
          if (!updated) throw new Error("Client reassignment update failed");
          return { client: updated };
        }
        const statusUpdates: any = {
          status: newStatus as any,
          updatedAt: new Date()
        };
        if (newStatus === "Assigned") {
          statusUpdates.allocatedAt = new Date();
        } else if (newStatus === "AwaitingConfirmation") {
          statusUpdates.awaitingConfirmationAt = new Date();
        }
        const [updated] = await tx.update(clients).set(statusUpdates)
          .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).returning();
        if (!updated) throw new Error("Client reassignment update failed");
        return { client: updated };
      }

      // Case 2: Reassign to a new slot
      if (isAllocatedStatus && isReassigning && newClinicianId) {
        // Validate new slot exists, belongs to clinician, and is available
        const [newClinician] = await tx.select().from(clinicians).where(and(
          eq(clinicians.id, newClinicianId),
          eq(clinicians.tenantId, tenantId),
        )).for("update");
        if (!newClinician) throw new ManualAssignmentError("access_denied", "Access denied");

        const [newSlot] = await tx.select().from(timeSlots).where(and(
          eq(timeSlots.id, newSlotId),
          eq(timeSlots.tenantId, tenantId),
        )).for("update");
        if (!newSlot) throw new Error("New slot not found");
        if (newSlot.clinicianId !== newClinicianId) throw new Error("Slot does not belong to selected clinician");
        if (newSlot.type === "Recurring" && occurrenceDate && !slotOccursOnDate(newSlot, occurrenceDate)) {
          throw new ManualAssignmentError("invalid_occurrence_date", "Choose a date that matches this recurring slot.");
        }
        const timeOffBlock = await findTimeOffBlockForSlot(tx, tenantId, newSlot, occurrenceDate);
        if (timeOffBlock) {
          throw new ManualAssignmentError("slot_unavailable", `The selected appointment slot is blocked as time off on ${timeOffBlock.date}`);
        }
        const claimedSlots = await tx.update(timeSlots).set({ isBooked: true }).where(and(
          eq(timeSlots.id, newSlotId),
          eq(timeSlots.tenantId, tenantId),
          eq(timeSlots.clinicianId, newClinicianId),
          eq(timeSlots.isBooked, false),
          isNull(timeSlots.retiredAt),
        )).returning({ id: timeSlots.id });
        if (claimedSlots.length !== 1) throw new Error("Slot is already booked");

        // Release old slot if was allocated
        if (hasAllocation) {
          const slotToRelease = await findOldSlotId();
          if (slotToRelease) {
            await tx.update(timeSlots).set({ isBooked: false }).where(and(
              eq(timeSlots.id, slotToRelease),
              eq(timeSlots.tenantId, tenantId),
              eq(timeSlots.clinicianId, oldClinicianId!),
              sql`NOT EXISTS (
                SELECT 1 FROM clients other_client
                WHERE other_client.assigned_slot_id = ${slotToRelease}
                  AND other_client.id <> ${clientId}
                  AND other_client.status IN (${sql.join(ACTIVE_ALLOCATION_STATUSES.map(status => sql`${status}`), sql`, `)})
              )`,
            ));
          }

          // Decrement old clinician load only if changing clinicians
          if (oldClinicianId !== newClinicianId) {
            await tx.update(clinicians).set({
              currentLoad: sql`GREATEST(0, ${clinicians.currentLoad} - 1)`
            }).where(and(eq(clinicians.id, oldClinicianId!), eq(clinicians.tenantId, tenantId)));
          }
        }

        // Store slot identifier: "day startTime" for recurring, "date startTime" for specific date
        const slotString = newSlot.type === "SpecificDate" 
          ? `${newSlot.date} ${newSlot.startTime}` 
          : `${newSlot.day} ${newSlot.startTime}`;

        // Update client with new assignment
        const clientUpdates: any = {
          status: newStatus as any,
          assignedClinicianId: newClinicianId,
          assignedSlotId: newSlotId,
          assignedSlot: slotString,
          ...(zoomDeliveryIdentityChanged ? { zoomLinkSentAt: null } : {}),
          updatedAt: new Date()
        };
        if (newStatus === "Assigned") {
          clientUpdates.allocatedAt = new Date();
        } else if (newStatus === "Scheduled") {
          clientUpdates.confirmedAt = new Date();
        }
        const [updated] = await tx.update(clients).set(clientUpdates)
          .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).returning();
        if (!updated) throw new Error("Client reassignment update failed");

        // Increment new clinician load only if changing clinicians or wasn't allocated before
        if (!hasAllocation || oldClinicianId !== newClinicianId) {
          const incremented = await tx.update(clinicians).set({
            currentLoad: sql`${clinicians.currentLoad} + 1`
          }).where(and(eq(clinicians.id, newClinicianId), eq(clinicians.tenantId, tenantId)))
            .returning({ id: clinicians.id });
          if (incremented.length !== 1) throw new Error("Clinician workload update failed");
        }
        if (confirmationIdempotencyKey) {
          const confirmation = await confirmBookingInTransaction(tx, {
            clientId,
            tenantId,
            source: "reassignment",
            idempotencyKey: confirmationIdempotencyKey,
            expectedStatus: newStatus as Client["status"],
          });
          return { client: confirmation.client, confirmation };
        }
        return { client: updated };
      }

      // Case 3: Change to non-allocated status (release slot and clear assignment)
      if (!isAllocatedStatus) {
        if (hasAllocation && oldClinicianId) {
          const slotToRelease = await findOldSlotId();
          if (slotToRelease) {
            await tx.update(timeSlots).set({ isBooked: false }).where(and(
              eq(timeSlots.id, slotToRelease),
              eq(timeSlots.tenantId, tenantId),
              eq(timeSlots.clinicianId, oldClinicianId),
              sql`NOT EXISTS (
                SELECT 1 FROM clients other_client
                WHERE other_client.assigned_slot_id = ${slotToRelease}
                  AND other_client.id <> ${clientId}
                  AND other_client.status IN (${sql.join(ACTIVE_ALLOCATION_STATUSES.map(status => sql`${status}`), sql`, `)})
              )`,
            ));
          }

          // Decrement old clinician load
          await tx.update(clinicians).set({
            currentLoad: sql`GREATEST(0, ${clinicians.currentLoad} - 1)`
          }).where(and(eq(clinicians.id, oldClinicianId), eq(clinicians.tenantId, tenantId)));
        }

        const [updated] = await tx.update(clients).set({
          status: newStatus as any,
          assignedClinicianId: null,
          assignedSlotId: null,
          assignedSlot: null,
          zoomLinkSentAt: null,
          updatedAt: new Date()
        }).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).returning();
        if (!updated) throw new Error("Client reassignment update failed");
        return { client: updated };
      }

      // Case 4: Trying to set allocated status without existing allocation or new slot
      // Just update the status (edge case - shouldn't normally happen)
      const [updated] = await tx.update(clients).set({
        status: newStatus as any,
        updatedAt: new Date()
      }).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).returning();
      if (!updated) throw new Error("Client reassignment update failed");
      return { client: updated };
    });
  }

  // ============ FORMS ============
  async getAllFormTemplates(tenantId?: string | null): Promise<FormTemplate[]> {
    return await db.select().from(formTemplates).where(tenantId ? eq(formTemplates.tenantId, tenantId) : undefined).orderBy(formTemplates.createdAt);
  }

  async getFormTemplateById(id: string): Promise<FormTemplate | undefined> {
    const [form] = await db.select().from(formTemplates).where(eq(formTemplates.id, id));
    return form || undefined;
  }

  async createFormTemplate(insertForm: InsertFormTemplate, tenantId?: string | null): Promise<FormTemplate> {
    const [form] = await db.insert(formTemplates).values({ ...insertForm, ...(tenantId ? { tenantId } : {}) }).returning();
    return form;
  }

  async updateFormTemplate(id: string, updates: Partial<InsertFormTemplate>): Promise<FormTemplate | undefined> {
    const [form] = await db.update(formTemplates).set({
      ...updates,
      updatedAt: new Date()
    }).where(eq(formTemplates.id, id)).returning();
    return form || undefined;
  }

  async deleteFormTemplate(id: string): Promise<void> {
    // Historical deliveries/submissions are audit records and must never be
    // removed merely because an administrator deletes a template. The database
    // rejects deletion while either history or a tenant designation references it.
    await db.delete(formTemplates).where(eq(formTemplates.id, id));
  }

  // ============ FORM SUBMISSIONS ============
  async getAllCompletedFormSubmissions(tenantId?: string | null): Promise<{ submission: FormSubmission; clientName: string; clientDisplayId: string; formTitle: string; formDescription: string; formFields: any[] }[]> {
    const submissions = await db
      .select()
      .from(formSubmissions)
      .where(tenantId
        ? and(eq(formSubmissions.isDraft, false), eq(formSubmissions.tenantId, tenantId))
        : eq(formSubmissions.isDraft, false))
      .orderBy(formSubmissions.submittedAt);

    if (submissions.length === 0) return [];

    const clientIds = [...new Set(submissions.map(s => s.clientId))];
    const templateIds = [...new Set(submissions.map(s => s.formTemplateId).filter((id): id is string => !!id))];

    const [clientRows, templateRows] = await Promise.all([
      db.select().from(clients).where(inArray(clients.id, clientIds)),
      db.select().from(formTemplates).where(inArray(formTemplates.id, templateIds)),
    ]);

    const clientMap = new Map(clientRows.map(c => [c.id, c]));
    const templateMap = new Map(templateRows.map(t => [t.id, t]));

    return submissions.map(submission => {
      const client = clientMap.get(submission.clientId);
      const template = templateMap.get(submission.formTemplateId);
      return {
        submission,
        clientName: client?.name ?? "",
        clientDisplayId: client?.displayId ?? "",
        // Registration responses must retain their original questions even
        // when the configurable template is subsequently edited or deleted.
        formTitle: submission.registrationTemplateTitle ?? template?.title ?? "",
        formDescription: submission.registrationTemplateDescription ?? template?.description ?? "",
        formFields: Array.isArray(submission.registrationTemplateFields)
          ? submission.registrationTemplateFields as any[]
          : Array.isArray(template?.fields) ? template.fields as any[] : [],
      };
    });
  }

  async getFormSubmissionsByClientId(clientId: string): Promise<FormSubmission[]> {
    return await db.select().from(formSubmissions).where(eq(formSubmissions.clientId, clientId));
  }

  async createFormSubmission(submission: InsertFormSubmission, tenantId?: string | null): Promise<FormSubmission> {
    const [newSubmission] = await db.insert(formSubmissions).values({ ...submission, ...(tenantId ? { tenantId } : {}) }).returning();
    return newSubmission;
  }

  async getDraftSubmission(clientId: string, formTemplateId: string): Promise<FormSubmission | undefined> {
    const [draft] = await db.select().from(formSubmissions).where(
      and(
        eq(formSubmissions.clientId, clientId),
        eq(formSubmissions.formTemplateId, formTemplateId),
        eq(formSubmissions.isDraft, true)
      )
    );
    return draft || undefined;
  }

  async saveOrUpdateDraft(clientId: string, formTemplateId: string, responses: any, tenantId?: string | null): Promise<FormSubmission> {
    // Check if a draft already exists
    const existingDraft = await this.getDraftSubmission(clientId, formTemplateId);
    
    if (existingDraft) {
      // Update existing draft. Also self-heal tenantId here in case this draft
      // was originally created before per-submission tenant tagging existed.
      const [updated] = await db.update(formSubmissions)
        .set({ responses, submittedAt: new Date(), ...(tenantId ? { tenantId } : {}) })
        .where(eq(formSubmissions.id, existingDraft.id))
        .returning();
      return updated;
    } else {
      // Create new draft
      const [newDraft] = await db.insert(formSubmissions).values({
        clientId,
        formTemplateId,
        responses,
        isDraft: true,
        ...(tenantId ? { tenantId } : {}),
      }).returning();
      return newDraft;
    }
  }

  async getFormDeliveries(clientId: string, tenantId: string): Promise<FormDelivery[]> {
    return db.select().from(formDeliveries).where(and(
      eq(formDeliveries.clientId, clientId),
      eq(formDeliveries.tenantId, tenantId),
    )).orderBy(formDeliveries.createdAt);
  }

  async prepareFormDeliveries(clientId: string, formTemplateIds: string[], tenantId: string): Promise<FormDelivery[]> {
    for (const formTemplateId of Array.from(new Set(formTemplateIds))) {
      await db.insert(formDeliveries).values({
        tenantId,
        clientId,
        formTemplateId,
        idempotencyKey: `form-delivery-${tenantId}-${clientId}-${formTemplateId}`,
      }).onConflictDoNothing();
    }
    return this.getFormDeliveries(clientId, tenantId);
  }

  async updateFormDelivery(id: string, tenantId: string, updates: Partial<FormDelivery>): Promise<FormDelivery | undefined> {
    const [delivery] = await db.update(formDeliveries).set({
      ...updates,
      updatedAt: new Date(),
    }).where(and(eq(formDeliveries.id, id), eq(formDeliveries.tenantId, tenantId))).returning();
    return delivery || undefined;
  }

  async claimFormDelivery(id: string, tenantId: string, leaseToken: string, staleBefore: Date, resend = false): Promise<FormDelivery | undefined> {
    const now = new Date();
    return db.transaction(async (tx) => {
    const [previous] = resend ? await tx.select().from(formDeliveries).where(and(
      eq(formDeliveries.id, id), eq(formDeliveries.tenantId, tenantId),
    )).for("update") : [];
    const [delivery] = await tx.update(formDeliveries).set({
      status: "sending",
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      attemptCount: sql`${formDeliveries.attemptCount} + 1`,
      ...(resend ? {
        idempotencyKey: sql`CASE WHEN ${formDeliveries.status} = 'sent' THEN ${`form-delivery-${tenantId}-${id}-${leaseToken}`} ELSE ${formDeliveries.idempotencyKey} END`,
        providerMessageId: sql`CASE WHEN ${formDeliveries.status} = 'sent' THEN NULL ELSE ${formDeliveries.providerMessageId} END`,
        providerEvent: sql`CASE WHEN ${formDeliveries.status} = 'sent' THEN NULL ELSE ${formDeliveries.providerEvent} END`,
      } : {}),
      updatedAt: now,
    }).where(and(
      eq(formDeliveries.id, id),
      eq(formDeliveries.tenantId, tenantId),
      or(
        eq(formDeliveries.status, "pending"),
        eq(formDeliveries.status, "failed"),
        ...(resend ? [eq(formDeliveries.status, "sent")] : []),
        and(eq(formDeliveries.status, "sending"), lt(formDeliveries.leaseExpiresAt, staleBefore)),
      ),
    )).returning();
    if (delivery && previous?.status === "sent" && previous.idempotencyKey !== delivery.idempotencyKey) {
      // Keep the prior accepted invitation visible, including pre-diagnostics
      // records which never had a provider message ID.
      await tx.insert(formDeliveryAttempts).values({
        tenantId, deliveryId: id, idempotencyKey: previous.idempotencyKey,
        providerMessageId: previous.providerMessageId, providerEvent: previous.providerEvent,
        outcome: "accepted", createdAt: previous.sentAt || now,
      }).onConflictDoNothing();
    }
    return delivery || undefined;
    });
  }

  async finishFormDeliveryClaim(id: string, tenantId: string, leaseToken: string, status: "sent" | "failed", error?: string, providerMessageId?: string, diagnostics = false, outcome: "rejected" | "unknown" = "unknown"): Promise<FormDelivery | undefined> {
    const now = new Date();
    return db.transaction(async (tx) => {
    const [delivery] = await tx.update(formDeliveries).set({
      status,
      sentAt: status === "sent" ? now : undefined,
      failedAt: status === "failed" ? now : undefined,
      lastError: status === "failed" ? (error || "delivery_failed") : null,
      ...(diagnostics ? { providerMessageId: providerMessageId || null, providerEvent: null } : {}),
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    }).where(and(
      eq(formDeliveries.id, id),
      eq(formDeliveries.tenantId, tenantId),
      eq(formDeliveries.status, "sending"),
      eq(formDeliveries.leaseToken, leaseToken),
    )).returning();
    if (delivery && diagnostics) {
      await tx.insert(formDeliveryAttempts).values({
        tenantId, deliveryId: id, idempotencyKey: delivery.idempotencyKey,
        providerMessageId: providerMessageId || null, outcome: status === "sent" ? "accepted" : outcome,
      }).onConflictDoUpdate({
        target: [formDeliveryAttempts.tenantId, formDeliveryAttempts.idempotencyKey],
        set: { providerMessageId: providerMessageId || null, outcome: status === "sent" ? "accepted" : outcome },
      });
    }
    return delivery || undefined;
    });
  }

  async getFormDeliveryAttempts(deliveryId: string, tenantId: string) {
    return db.select().from(formDeliveryAttempts).where(and(
      eq(formDeliveryAttempts.deliveryId, deliveryId), eq(formDeliveryAttempts.tenantId, tenantId),
    )).orderBy(formDeliveryAttempts.createdAt);
  }

  async updateFormDeliveryAttemptEvent(id: string, tenantId: string, event: string) {
    await db.update(formDeliveryAttempts).set({ providerEvent: event }).where(and(
      eq(formDeliveryAttempts.id, id), eq(formDeliveryAttempts.tenantId, tenantId),
    ));
  }

  async submitDraft(submissionId: string, responses: any, tenantId?: string | null): Promise<FormSubmission | undefined> {
    const [submitted] = await db.update(formSubmissions)
      .set({ 
        responses, 
        isDraft: false, 
        submittedAt: new Date(),
        ...(tenantId ? { tenantId } : {}),
      })
      .where(eq(formSubmissions.id, submissionId))
      .returning();
    return submitted || undefined;
  }

  // One-time repair for form_submissions rows created before per-submission
  // tenant tagging existed on the public submit/draft routes (they always had
  // a null tenantId because req.tenant is never resolved on public routes).
  // Derives the correct tenant from the row's own client, which is always
  // reliably tenant-tagged — never guesses or falls back to "first tenant".
  async backfillFormSubmissionTenantIds(): Promise<number> {
    const result = await db.execute(sql`
      UPDATE form_submissions fs
      SET tenant_id = c.tenant_id
      FROM clients c
      WHERE fs.client_id = c.id
        AND fs.tenant_id IS NULL
        AND c.tenant_id IS NOT NULL
    `);
    return result.rowCount ?? 0;
  }

  // ============ TASKS ============
  async getAllTasks(tenantId?: string | null): Promise<Task[]> {
    return await db.select().from(tasks).where(tenantId ? eq(tasks.tenantId, tenantId) : undefined).orderBy(desc(tasks.dueDate));
  }

  async getTaskById(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task || undefined;
  }

  async createTask(insertTask: InsertTask, tenantId?: string | null): Promise<Task> {
    const [task] = await db.insert(tasks).values({ ...insertTask, ...(tenantId ? { tenantId } : {}) }).returning();
    return task;
  }

  async updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined> {
    const [task] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
    return task || undefined;
  }

  async deleteTask(id: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  async getOpenTasksWithoutCreationActivity(tenantId: string, limit: number = 25): Promise<Task[]> {
    const rows = await db.select({ task: tasks })
      .from(tasks)
      .leftJoin(auditLogs, and(
        eq(auditLogs.resourceType, "task"),
        eq(auditLogs.resourceId, tasks.id),
        eq(auditLogs.action, "activity_task_created"),
        eq(auditLogs.tenantId, tenantId),
      ))
      .where(and(
        eq(tasks.tenantId, tenantId),
        inArray(tasks.status, ["Pending", "In Progress"]),
        isNull(auditLogs.id),
      ))
      .orderBy(desc(tasks.createdAt))
      .limit(limit);

    return rows.map((row) => row.task);
  }

  // ============ AUDIT LOGS (GDPR) ============
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [auditLog] = await db.insert(auditLogs).values(log).returning();
    return auditLog;
  }

  async getAuditLogsByUserId(userId: string): Promise<AuditLog[]> {
    return await db.select().from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.timestamp));
  }

  async getRecentAuditLogs(limit: number = 10, action?: string, tenantId?: string | null): Promise<AuditLog[]> {
    const conditions = [];
    if (action) conditions.push(eq(auditLogs.action, action));
    if (tenantId) {
      const tenantMatch = eq(auditLogs.tenantId, tenantId);

      // Older slot audit records were written before tenantId was included.
      // Their resourceId is the clinician ID, so recover their tenant safely
      // from that parent record instead of dropping valid activity or guessing
      // based on tenant creation order.
      if (action === "add_slots") {
        conditions.push(or(
          tenantMatch,
          and(
            isNull(auditLogs.tenantId),
            eq(auditLogs.resourceType, "timeslot"),
            sql`EXISTS (
              SELECT 1
              FROM clinicians AS audit_clinician
              WHERE audit_clinician.id = ${auditLogs.resourceId}
                AND audit_clinician.tenant_id = ${tenantId}
            )`,
          ),
        ));
      } else {
        conditions.push(tenantMatch);
      }
    }
    return await db.select().from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);
  }

  async getRecentActivityLogs(limit: number = 25, tenantId?: string | null, category?: RecentActivityCategory): Promise<AuditLog[]> {
    if (!tenantId) return [];

    const actions = category ? RECENT_ACTIVITY_CATEGORY_ACTIONS[category] : RECENT_ACTIVITY_ACTIONS;
    return await db.select().from(auditLogs)
      .where(and(
        inArray(auditLogs.action, actions),
        or(
          eq(auditLogs.tenantId, tenantId),
          ...(category === "clients" || category === "tasks"
            ? []
            : [
                and(
                  isNull(auditLogs.tenantId),
                  eq(auditLogs.resourceType, "timeslot"),
                  inArray(auditLogs.action, ["add_slots", "activity_slot_added"]),
                  sql`EXISTS (
                    SELECT 1
                    FROM clinicians AS activity_clinician
                    WHERE activity_clinician.id = ${auditLogs.resourceId}
                      AND activity_clinician.tenant_id = ${tenantId}
                  )`,
                ),
              ]),
        ),
      ))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);
  }

  async getHistoricalActivitySources(tenantId: string, limit: number = 25): Promise<HistoricalActivitySources> {
    // Keep enough candidates for structured activity logs to remove duplicates
    // during the merge without requiring an unbounded historical read.
    const sourceLimit = Math.max(1, Math.floor(limit)) * 2;
    const latestClientActivityAt = sql`
      GREATEST(
        ${clients.intakeDate},
        ${clients.formsSentAt},
        ${clients.formsCompletedAt},
        ${clients.allocatedAt},
        ${clients.awaitingConfirmationAt},
        ${clients.confirmedAt},
        ${clients.archivedAt}
      )
    `;

    const [tenantClients, tenantFormTemplates, tenantFormSubmissions] = await Promise.all([
      db.select({
        id: clients.id,
        displayId: clients.displayId,
        tenantId: clients.tenantId,
        intakeDate: clients.intakeDate,
        formsSentAt: clients.formsSentAt,
        formsCompletedAt: clients.formsCompletedAt,
        allocatedAt: clients.allocatedAt,
        awaitingConfirmationAt: clients.awaitingConfirmationAt,
        confirmedAt: clients.confirmedAt,
        isArchived: clients.isArchived,
        archivedAt: clients.archivedAt,
      })
        .from(clients)
        .where(eq(clients.tenantId, tenantId))
        .orderBy(desc(latestClientActivityAt))
        .limit(sourceLimit),
      db.select({
        id: formTemplates.id,
        title: formTemplates.title,
        tenantId: formTemplates.tenantId,
        createdAt: formTemplates.createdAt,
        updatedAt: formTemplates.updatedAt,
      })
        .from(formTemplates)
        .where(eq(formTemplates.tenantId, tenantId))
        .orderBy(desc(formTemplates.updatedAt), desc(formTemplates.createdAt))
        .limit(sourceLimit),
      db.select({
        id: formSubmissions.id,
        clientId: formSubmissions.clientId,
        formTemplateId: formSubmissions.formTemplateId,
        clientDisplayId: clients.displayId,
        formTitle: formTemplates.title,
        isDraft: formSubmissions.isDraft,
        submittedAt: formSubmissions.submittedAt,
      })
        .from(formSubmissions)
        .innerJoin(clients, eq(formSubmissions.clientId, clients.id))
        .innerJoin(formTemplates, eq(formSubmissions.formTemplateId, formTemplates.id))
        .where(and(
          eq(clients.tenantId, tenantId),
          eq(formTemplates.tenantId, tenantId),
          eq(formSubmissions.isDraft, false),
        ))
        .orderBy(desc(formSubmissions.submittedAt))
        .limit(sourceLimit),
    ]);

    return {
      clients: tenantClients,
      formTemplates: tenantFormTemplates,
      formSubmissions: tenantFormSubmissions,
    };
  }

  // ============ EMAIL TEMPLATES ============
  async getAllEmailTemplates(tenantId?: string | null): Promise<EmailTemplate[]> {
    return await db.select().from(emailTemplates).where(tenantId ? eq(emailTemplates.tenantId, tenantId) : undefined);
  }

  async getEmailTemplateByKey(templateKey: string, tenantId?: string | null): Promise<EmailTemplate | undefined> {
    if (tenantId) {
      // Try tenant-specific template first
      const [tenantTemplate] = await db.select().from(emailTemplates)
        .where(and(eq(emailTemplates.templateKey, templateKey), eq(emailTemplates.tenantId, tenantId)));
      if (tenantTemplate) return tenantTemplate;
      // Fall back to global (null tenantId)
      const [globalTemplate] = await db.select().from(emailTemplates)
        .where(and(eq(emailTemplates.templateKey, templateKey), isNull(emailTemplates.tenantId)));
      return globalTemplate || undefined;
    }
    const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.templateKey, templateKey));
    return template || undefined;
  }

  async getTenantById(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant || undefined;
  }

  async upsertEmailTemplate(template: InsertEmailTemplate & { tenantId?: string | null }): Promise<EmailTemplate> {
    const existing = await db
      .select()
      .from(emailTemplates)
      .where(template.tenantId
        ? and(eq(emailTemplates.templateKey, template.templateKey), eq(emailTemplates.tenantId, template.tenantId))
        : eq(emailTemplates.templateKey, template.templateKey)
      )
      .limit(1);

    if (existing.length > 0) {
      const [result] = await db
        .update(emailTemplates)
        .set({
          name: template.name,
          subject: template.subject,
          bodyText: template.bodyText,
          updatedAt: new Date(),
        })
        .where(eq(emailTemplates.id, existing[0].id))
        .returning();
      return result;
    } else {
      const [result] = await db
        .insert(emailTemplates)
        .values(template)
        .returning();
      return result;
    }
  }

  // ============ NON-ENGAGEMENT CATEGORIES ============
  async getAllNonEngagementCategories(tenantId?: string | null): Promise<NonEngagementCategory[]> {
    return await db.select().from(nonEngagementCategories).where(tenantId ? eq(nonEngagementCategories.tenantId, tenantId) : undefined).orderBy(nonEngagementCategories.name);
  }

  async createNonEngagementCategory(category: InsertNonEngagementCategory, tenantId?: string | null): Promise<NonEngagementCategory> {
    const [result] = await db.insert(nonEngagementCategories).values({ ...category, ...(tenantId ? { tenantId } : {}) }).returning();
    return result;
  }

  async deleteNonEngagementCategory(id: string, tenantId?: string | null): Promise<boolean> {
    const result = await db.delete(nonEngagementCategories).where(
      tenantId
        ? and(eq(nonEngagementCategories.id, id), eq(nonEngagementCategories.tenantId, tenantId))
        : eq(nonEngagementCategories.id, id)
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============ CUSTOM INSURERS ============
  async getCustomInsurers(tenantId?: string | null): Promise<CustomInsurer[]> {
    return await db.select().from(customInsurers).where(tenantId ? eq(customInsurers.tenantId, tenantId) : undefined).orderBy(customInsurers.name);
  }

  async addCustomInsurer(name: string, tenantId?: string | null): Promise<CustomInsurer> {
    const [result] = await db.insert(customInsurers).values({ name, ...(tenantId ? { tenantId } : {}) }).returning();
    return result;
  }

  async deleteCustomInsurer(id: string, tenantId?: string | null): Promise<boolean> {
    const where = tenantId
      ? and(eq(customInsurers.id, id), eq(customInsurers.tenantId, tenantId))
      : eq(customInsurers.id, id);
    const result = await db.delete(customInsurers).where(where).returning();
    return result.length > 0;
  }

  // ============ PAYMENT CHARGES ============
  async createPaymentCharge(charge: InsertPaymentCharge): Promise<PaymentCharge> {
    const [result] = await db.insert(paymentCharges).values(charge)
      // The database index is partial (only non-null intent IDs); no explicit
      // conflict target lets PostgreSQL safely handle that index as well.
      .onConflictDoNothing()
      .returning();
    if (result) return result;
    if (charge.stripePaymentIntentId) {
      const [existing] = await db.select().from(paymentCharges)
        .where(eq(paymentCharges.stripePaymentIntentId, charge.stripePaymentIntentId)).limit(1);
      if (existing) return existing;
    }
    throw new Error("Payment charge could not be created");
  }

  async getPaymentChargesByClientId(clientId: string): Promise<PaymentCharge[]> {
    return await db.select().from(paymentCharges)
      .where(eq(paymentCharges.clientId, clientId))
      .orderBy(desc(paymentCharges.chargedAt));
  }

  async getAllPaymentCharges(tenantId?: string | null): Promise<(PaymentCharge & { clientDisplayId: string; clinicianName: string | null })[]> {
    const cliniciansAlias = clinicians;
    const usersAlias = users;
    const rows = await db
      .select({
        id: paymentCharges.id,
        clientId: paymentCharges.clientId,
        amountPence: paymentCharges.amountPence,
        stripePaymentIntentId: paymentCharges.stripePaymentIntentId,
        status: paymentCharges.status,
        notes: paymentCharges.notes,
        chargedByUserId: paymentCharges.chargedByUserId,
        chargedAt: paymentCharges.chargedAt,
        tenantId: paymentCharges.tenantId,
        clientDisplayId: clients.displayId,
        clinicianName: usersAlias.name,
      })
      .from(paymentCharges)
      .leftJoin(clients, eq(paymentCharges.clientId, clients.id))
      .leftJoin(cliniciansAlias, eq(clients.assignedClinicianId, cliniciansAlias.id))
      .leftJoin(usersAlias, eq(cliniciansAlias.userId, usersAlias.id))
      .where(tenantId ? eq(paymentCharges.tenantId, tenantId) : undefined)
      .orderBy(desc(paymentCharges.chargedAt));
    return rows.map(r => ({ ...r, clientDisplayId: r.clientDisplayId ?? '', clinicianName: r.clinicianName ?? null }));
  }

  async updatePaymentCharge(id: string, updates: Partial<InsertPaymentCharge>): Promise<PaymentCharge | undefined> {
    const [result] = await db.update(paymentCharges).set(updates).where(eq(paymentCharges.id, id)).returning();
    return result || undefined;
  }

  // ============ CLIENT CLINICIAN OPTIONS (CY&A) ============
  async createClientClinicianOptions(options: InsertClientClinicianOption[]): Promise<ClientClinicianOption[]> {
    if (options.length === 0) return [];
    return await db.insert(clientClinicianOptions).values(options as any).returning();
  }

  async getClientClinicianOptions(clientId: string): Promise<ClientClinicianOption[]> {
    return await db.select().from(clientClinicianOptions).where(eq(clientClinicianOptions.clientId, clientId));
  }

  async getClientClinicianOptionByToken(token: string): Promise<ClientClinicianOption | undefined> {
    const [row] = await db.select().from(clientClinicianOptions).where(eq(clientClinicianOptions.selectionToken, token)).limit(1);
    return row;
  }

  async getClientsWithFailedPayments(tenantId?: string | null): Promise<{ clientId: string; failureReason: string | null }[]> {
    try {
      const rows = await db.execute(sql`
        SELECT pc.client_id, pc.failure_reason
        FROM payment_charges pc
        WHERE pc.status = 'failed'
          ${tenantId ? sql`AND pc.tenant_id = ${tenantId}` : sql``}
          AND pc.charged_at = (
            SELECT MAX(pc2.charged_at)
            FROM payment_charges pc2
            WHERE pc2.client_id = pc.client_id
              ${tenantId ? sql`AND pc2.tenant_id = ${tenantId}` : sql``}
          )
      `);
      return (rows as any[]).map((r: any) => ({ clientId: r.client_id, failureReason: r.failure_reason ?? null }));
    } catch {
      // payment_charges table not yet migrated — return empty until Stripe is set up
      return [];
    }
  }
}

export const storage = new DatabaseStorage();
