import { 
  users, clients, clinicians, timeSlots, formTemplates, formSubmissions, tasks, auditLogs, emailTemplates, inviteTokens, passwordResetTokens, nonEngagementCategories, customInsurers,
  type User, type InsertUser, type SafeUser,
  type Client, type InsertClient,
  type Clinician, type InsertClinician,
  type TimeSlot, type InsertTimeSlot,
  type FormTemplate, type InsertFormTemplate,
  type FormSubmission, type InsertFormSubmission,
  type Task, type InsertTask,
  type AuditLog, type InsertAuditLog,
  type EmailTemplate, type InsertEmailTemplate,
  type InviteToken,
  type PasswordResetToken,
  type NonEngagementCategory, type InsertNonEngagementCategory,
  type CustomInsurer, type InsertCustomInsurer
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, desc, sql, isNull, inArray } from "drizzle-orm";

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
  
  // ============ INVITE TOKENS ============
  createInviteToken(userId: string, token: string, expiresAt: Date): Promise<InviteToken>;
  getInviteTokenByToken(token: string): Promise<InviteToken | undefined>;
  markInviteTokenUsed(tokenId: string): Promise<void>;
  
  // ============ PASSWORD RESET TOKENS ============
  createPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getPasswordResetTokenByToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(tokenId: string): Promise<void>;
  
  // ============ CLINICIANS ============
  getAllClinicians(): Promise<Clinician[]>;
  getClinicianById(id: string): Promise<Clinician | undefined>;
  getClinicianByUserId(userId: string): Promise<Clinician | undefined>;
  createClinician(clinician: InsertClinician): Promise<Clinician>;
  updateClinician(id: string, updates: Partial<InsertClinician>): Promise<Clinician | undefined>;
  deleteClinician(id: string): Promise<void>;
  
  // ============ TIME SLOTS ============
  getTimeSlotsByClinicianId(clinicianId: string): Promise<TimeSlot[]>;
  createTimeSlot(slot: InsertTimeSlot): Promise<TimeSlot>;
  deleteTimeSlot(id: string): Promise<void>;
  addTimeSlots(clinicianId: string, newSlots: Omit<TimeSlot, 'id' | 'createdAt'>[]): Promise<TimeSlot[]>;
  deleteTimeSlotById(id: string): Promise<boolean>;
  getAllTimeSlots(): Promise<TimeSlot[]>;
  
  // ============ CLIENTS ============
  getAllClients(includeArchived?: boolean): Promise<Client[]>;
  getClientById(id: string): Promise<Client | undefined>;
  getClientByDisplayId(displayId: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, updates: Partial<InsertClient>): Promise<Client | undefined>;
  archiveClient(id: string, reason?: string, category?: string): Promise<Client | undefined>;
  restoreClient(id: string): Promise<Client | undefined>;
  deleteClientPermanently(id: string): Promise<boolean>;
  assignClinicianToClient(clientId: string, clinicianId: string, slotId: string, allocationMethod?: "form" | "manual", allocationReason?: string): Promise<void>;
  reassignClient(clientId: string, newClinicianId: string | null, newSlotId: string | null, newStatus: string): Promise<Client | undefined>;
  
  // ============ FORMS ============
  getAllFormTemplates(): Promise<FormTemplate[]>;
  getFormTemplateById(id: string): Promise<FormTemplate | undefined>;
  createFormTemplate(form: InsertFormTemplate): Promise<FormTemplate>;
  updateFormTemplate(id: string, updates: Partial<InsertFormTemplate>): Promise<FormTemplate | undefined>;
  deleteFormTemplate(id: string): Promise<void>;
  
  // ============ FORM SUBMISSIONS ============
  getAllCompletedFormSubmissions(): Promise<{ submission: FormSubmission; clientName: string; clientDisplayId: string; formTitle: string; formFields: any[] }[]>;
  getFormSubmissionsByClientId(clientId: string): Promise<FormSubmission[]>;
  createFormSubmission(submission: InsertFormSubmission): Promise<FormSubmission>;
  getDraftSubmission(clientId: string, formTemplateId: string): Promise<FormSubmission | undefined>;
  saveOrUpdateDraft(clientId: string, formTemplateId: string, responses: any): Promise<FormSubmission>;
  submitDraft(submissionId: string, responses: any): Promise<FormSubmission | undefined>;
  
  // ============ TASKS ============
  getAllTasks(): Promise<Task[]>;
  getTaskById(id: string): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<void>;
  
  // ============ AUDIT LOGS (GDPR) ============
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByUserId(userId: string): Promise<AuditLog[]>;
  getRecentAuditLogs(limit?: number, action?: string): Promise<AuditLog[]>;

  // ============ EMAIL TEMPLATES ============
  getAllEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplateByKey(templateKey: string): Promise<EmailTemplate | undefined>;
  upsertEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate>;

  // ============ NON-ENGAGEMENT CATEGORIES ============
  getAllNonEngagementCategories(): Promise<NonEngagementCategory[]>;
  createNonEngagementCategory(category: InsertNonEngagementCategory): Promise<NonEngagementCategory>;
  deleteNonEngagementCategory(id: string): Promise<boolean>;

  // ============ CUSTOM INSURERS ============
  getCustomInsurers(): Promise<CustomInsurer[]>;
  addCustomInsurer(name: string): Promise<CustomInsurer>;
}

// Database implementation with PostgreSQL
export class DatabaseStorage implements IStorage {
  // ============ USERS & AUTH ============
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
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
  async getAllClinicians(): Promise<(Clinician & { name: string })[]> {
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
        isActive: clinicians.isActive,
        lastUpdatedAvailability: clinicians.lastUpdatedAvailability,
        createdAt: clinicians.createdAt,
        name: users.name,
        email: users.email,
      })
      .from(clinicians)
      .leftJoin(users, eq(clinicians.userId, users.id))
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

  async createClinician(insertClinician: InsertClinician): Promise<Clinician> {
    const [clinician] = await db.insert(clinicians).values(insertClinician).returning();
    return clinician;
  }

  async updateClinician(id: string, updates: Partial<InsertClinician>): Promise<Clinician | undefined> {
    const [clinician] = await db.update(clinicians).set({
      ...updates,
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
    return await db.select().from(timeSlots).where(eq(timeSlots.clinicianId, clinicianId));
  }

  async createTimeSlot(slot: InsertTimeSlot): Promise<TimeSlot> {
    const [newSlot] = await db.insert(timeSlots).values(slot).returning();
    return newSlot;
  }

  async deleteTimeSlot(id: string): Promise<void> {
    await db.delete(timeSlots).where(eq(timeSlots.id, id));
  }

  async addTimeSlots(clinicianId: string, newSlots: Omit<TimeSlot, 'id' | 'createdAt'>[]): Promise<TimeSlot[]> {
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
    }))).returning();
    
    await db.update(clinicians).set({
      lastUpdatedAvailability: new Date()
    }).where(eq(clinicians.id, clinicianId));
    
    return insertedSlots;
  }

  async deleteTimeSlotById(id: string): Promise<boolean> {
    const [slot] = await db.select().from(timeSlots).where(eq(timeSlots.id, id));
    if (!slot) return false;
    
    if (slot.isBooked) {
      const clientsWithSlot = await db.select().from(clients).where(eq(clients.assignedSlotId, id));
      for (const client of clientsWithSlot) {
        await db.update(clients).set({ assignedSlotId: null }).where(eq(clients.id, client.id));
      }
    }
    
    await db.delete(timeSlots).where(eq(timeSlots.id, id));
    return true;
  }

  async getAllTimeSlots(): Promise<TimeSlot[]> {
    return await db.select().from(timeSlots);
  }

  // ============ CLIENTS ============
  async getAllClients(includeArchived?: boolean): Promise<Client[]> {
    if (includeArchived) {
      return await db.select().from(clients)
        .orderBy(desc(clients.intakeDate));
    }
    return await db.select().from(clients)
      .where(eq(clients.isArchived, false))
      .orderBy(desc(clients.intakeDate));
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
      if (existing.assignedSlotId) {
        await tx.update(timeSlots)
          .set({ isBooked: false, bookedByClientId: null })
          .where(eq(timeSlots.id, existing.assignedSlotId));
      }

      await tx.delete(formSubmissions).where(eq(formSubmissions.clientId, id));
      await tx.delete(clients).where(eq(clients.id, id));
    });
    return true;
  }

  async archiveClient(id: string, reason?: string, category?: string): Promise<Client | undefined> {
    // First, get the client to find their assigned slot and clinician
    const [existingClient] = await db.select().from(clients).where(eq(clients.id, id));
    
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
        let [foundSlot] = await db.select().from(timeSlots)
          .where(and(
            eq(timeSlots.clinicianId, existingClient.assignedClinicianId),
            eq(timeSlots.day, dayOrDate),
            eq(timeSlots.startTime, startTime),
            eq(timeSlots.isBooked, true)
          ));

        if (!foundSlot) {
          [foundSlot] = await db.select().from(timeSlots)
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
        await db.update(timeSlots).set({
          isBooked: false
        }).where(eq(timeSlots.id, slotIdToRelease));

        // Decrement clinician load
        await db.update(clinicians).set({
          currentLoad: sql`GREATEST(${clinicians.currentLoad} - 1, 0)`
        }).where(eq(clinicians.id, existingClient.assignedClinicianId));
      }
    }

    const [client] = await db.update(clients).set({
      isArchived: true,
      archivedAt: new Date(),
      archiveReason: reason || null,
      archiveCategory: category || null,
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

  async createClient(insertClient: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(insertClient).returning();
    return client;
  }

  async updateClient(id: string, updates: Partial<InsertClient>): Promise<Client | undefined> {
    const [client] = await db.update(clients).set({
      ...updates,
      updatedAt: new Date()
    }).where(eq(clients.id, id)).returning();
    return client || undefined;
  }

  async assignClinicianToClient(clientId: string, clinicianId: string, slotId: string, allocationMethod: "form" | "manual" = "form", allocationReason?: string): Promise<void> {
    // Get the slot details
    const [slot] = await db.select().from(timeSlots).where(eq(timeSlots.id, slotId));
    
    if (!slot) throw new Error("Slot not found");

    // Store slot identifier: "day startTime" for recurring, "date startTime" for specific date
    const slotString = slot.type === "SpecificDate" 
      ? `${slot.date} ${slot.startTime}` 
      : `${slot.day} ${slot.startTime}`;

    // Start transaction
    await db.transaction(async (tx) => {
      // Update client
      await tx.update(clients).set({
        status: "Assigned",
        assignedClinicianId: clinicianId,
        assignedSlotId: slotId,
        assignedSlot: slotString,
        allocationMethod: allocationMethod,
        allocationReason: allocationReason || null,
        allocatedAt: new Date(),
        updatedAt: new Date()
      }).where(eq(clients.id, clientId));

      // Mark slot as booked
      await tx.update(timeSlots).set({
        isBooked: true
      }).where(eq(timeSlots.id, slotId));

      // Increment clinician load
      await tx.update(clinicians).set({
        currentLoad: sql`${clinicians.currentLoad} + 1`
      }).where(eq(clinicians.id, clinicianId));
    });
  }

  async reassignClient(clientId: string, newClinicianId: string | null, newSlotId: string | null, newStatus: string): Promise<Client | undefined> {
    const [existingClient] = await db.select().from(clients).where(eq(clients.id, clientId));
    if (!existingClient) return undefined;

    const oldClinicianId = existingClient.assignedClinicianId;
    let oldSlotIdToRelease = existingClient.assignedSlotId;
    // Statuses where the slot should remain booked
    const isAllocatedStatus = newStatus === "Assigned" || newStatus === "AwaitingConfirmation" || newStatus === "Scheduled";
    // Only consider it a reassign if a NEW slot is being assigned (different from current)
    const isReassigning = newSlotId !== null && newSlotId !== existingClient.assignedSlotId;

    // Check if client has any allocation (either by slotId or legacy slot string)
    const hasAllocation = oldClinicianId && (oldSlotIdToRelease || existingClient.assignedSlot);

    await db.transaction(async (tx) => {
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
            eq(timeSlots.day, dayOrDate),
            eq(timeSlots.startTime, startTime),
            eq(timeSlots.isBooked, true)
          ));

        if (!foundSlot) {
          [foundSlot] = await tx.select().from(timeSlots)
            .where(and(
              eq(timeSlots.clinicianId, oldClinicianId),
              eq(timeSlots.date, dayOrDate),
              eq(timeSlots.startTime, startTime),
              eq(timeSlots.isBooked, true)
            ));
        }
        return foundSlot?.id || null;
      };

      // Case 1: Status-only change to allocated status (keep current slot)
      if (isAllocatedStatus && !isReassigning && hasAllocation) {
        const statusUpdates: any = {
          status: newStatus as any,
          updatedAt: new Date()
        };
        // Set appropriate timestamp based on new status
        if (newStatus === "Assigned") {
          statusUpdates.allocatedAt = new Date();
        } else if (newStatus === "AwaitingConfirmation") {
          statusUpdates.awaitingConfirmationAt = new Date();
        } else if (newStatus === "Scheduled") {
          statusUpdates.confirmedAt = new Date();
        }
        await tx.update(clients).set(statusUpdates).where(eq(clients.id, clientId));
        return;
      }

      // Case 2: Reassign to a new slot
      if (isAllocatedStatus && isReassigning && newClinicianId) {
        // Validate new slot exists, belongs to clinician, and is available
        const [newSlot] = await tx.select().from(timeSlots).where(eq(timeSlots.id, newSlotId));
        if (!newSlot) throw new Error("New slot not found");
        if (newSlot.clinicianId !== newClinicianId) throw new Error("Slot does not belong to selected clinician");
        if (newSlot.isBooked) throw new Error("Slot is already booked");

        // Release old slot if was allocated
        if (hasAllocation) {
          const slotToRelease = await findOldSlotId();
          if (slotToRelease) {
            await tx.update(timeSlots).set({ isBooked: false }).where(eq(timeSlots.id, slotToRelease));
          }

          // Decrement old clinician load only if changing clinicians
          if (oldClinicianId !== newClinicianId) {
            await tx.update(clinicians).set({
              currentLoad: sql`GREATEST(0, ${clinicians.currentLoad} - 1)`
            }).where(eq(clinicians.id, oldClinicianId));
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
          updatedAt: new Date()
        };
        if (newStatus === "Assigned") {
          clientUpdates.allocatedAt = new Date();
        } else if (newStatus === "Scheduled") {
          clientUpdates.confirmedAt = new Date();
        }
        await tx.update(clients).set(clientUpdates).where(eq(clients.id, clientId));

        // Mark new slot as booked
        await tx.update(timeSlots).set({ isBooked: true }).where(eq(timeSlots.id, newSlotId));

        // Increment new clinician load only if changing clinicians or wasn't allocated before
        if (!hasAllocation || oldClinicianId !== newClinicianId) {
          await tx.update(clinicians).set({
            currentLoad: sql`${clinicians.currentLoad} + 1`
          }).where(eq(clinicians.id, newClinicianId));
        }
        return;
      }

      // Case 3: Change to non-allocated status (release slot and clear assignment)
      if (!isAllocatedStatus) {
        if (hasAllocation && oldClinicianId) {
          const slotToRelease = await findOldSlotId();
          if (slotToRelease) {
            await tx.update(timeSlots).set({ isBooked: false }).where(eq(timeSlots.id, slotToRelease));
          }

          // Decrement old clinician load
          await tx.update(clinicians).set({
            currentLoad: sql`GREATEST(0, ${clinicians.currentLoad} - 1)`
          }).where(eq(clinicians.id, oldClinicianId));
        }

        await tx.update(clients).set({
          status: newStatus as any,
          assignedClinicianId: null,
          assignedSlotId: null,
          assignedSlot: null,
          updatedAt: new Date()
        }).where(eq(clients.id, clientId));
        return;
      }

      // Case 4: Trying to set allocated status without existing allocation or new slot
      // Just update the status (edge case - shouldn't normally happen)
      await tx.update(clients).set({
        status: newStatus as any,
        updatedAt: new Date()
      }).where(eq(clients.id, clientId));
    });

    const [updated] = await db.select().from(clients).where(eq(clients.id, clientId));
    return updated;
  }

  // ============ FORMS ============
  async getAllFormTemplates(): Promise<FormTemplate[]> {
    return await db.select().from(formTemplates).orderBy(formTemplates.createdAt);
  }

  async getFormTemplateById(id: string): Promise<FormTemplate | undefined> {
    const [form] = await db.select().from(formTemplates).where(eq(formTemplates.id, id));
    return form || undefined;
  }

  async createFormTemplate(insertForm: InsertFormTemplate): Promise<FormTemplate> {
    const [form] = await db.insert(formTemplates).values(insertForm).returning();
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
    await db.delete(formTemplates).where(eq(formTemplates.id, id));
  }

  // ============ FORM SUBMISSIONS ============
  async getAllCompletedFormSubmissions(): Promise<{ submission: FormSubmission; clientName: string; clientDisplayId: string; formTitle: string; formFields: any[] }[]> {
    const submissions = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.isDraft, false))
      .orderBy(formSubmissions.submittedAt);

    if (submissions.length === 0) return [];

    const clientIds = [...new Set(submissions.map(s => s.clientId))];
    const templateIds = [...new Set(submissions.map(s => s.formTemplateId))];

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
        formTitle: template?.title ?? "",
        formFields: Array.isArray(template?.fields) ? template.fields as any[] : [],
      };
    });
  }

  async getFormSubmissionsByClientId(clientId: string): Promise<FormSubmission[]> {
    return await db.select().from(formSubmissions).where(eq(formSubmissions.clientId, clientId));
  }

  async createFormSubmission(submission: InsertFormSubmission): Promise<FormSubmission> {
    const [newSubmission] = await db.insert(formSubmissions).values(submission).returning();
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

  async saveOrUpdateDraft(clientId: string, formTemplateId: string, responses: any): Promise<FormSubmission> {
    // Check if a draft already exists
    const existingDraft = await this.getDraftSubmission(clientId, formTemplateId);
    
    if (existingDraft) {
      // Update existing draft
      const [updated] = await db.update(formSubmissions)
        .set({ responses, submittedAt: new Date() })
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
      }).returning();
      return newDraft;
    }
  }

  async submitDraft(submissionId: string, responses: any): Promise<FormSubmission | undefined> {
    const [submitted] = await db.update(formSubmissions)
      .set({ 
        responses, 
        isDraft: false, 
        submittedAt: new Date() 
      })
      .where(eq(formSubmissions.id, submissionId))
      .returning();
    return submitted || undefined;
  }

  // ============ TASKS ============
  async getAllTasks(): Promise<Task[]> {
    return await db.select().from(tasks).orderBy(desc(tasks.dueDate));
  }

  async getTaskById(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task || undefined;
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const [task] = await db.insert(tasks).values(insertTask).returning();
    return task;
  }

  async updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined> {
    const [task] = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
    return task || undefined;
  }

  async deleteTask(id: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
  }

  // ============ AUDIT LOGS (GDPR) ============
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [auditLog] = await db.insert(auditLogs).values(log).returning();
    return auditLog;
  }

  async getAuditLogsByUserId(userId: string): Promise<AuditLog[]> {
    return await db.select().from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.timestamp));
  }

  async getRecentAuditLogs(limit: number = 10, action?: string): Promise<AuditLog[]> {
    if (action) {
      return await db.select().from(auditLogs)
        .where(eq(auditLogs.action, action))
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit);
    }
    return await db.select().from(auditLogs)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);
  }

  // ============ EMAIL TEMPLATES ============
  async getAllEmailTemplates(): Promise<EmailTemplate[]> {
    return await db.select().from(emailTemplates);
  }

  async getEmailTemplateByKey(templateKey: string): Promise<EmailTemplate | undefined> {
    const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.templateKey, templateKey));
    return template || undefined;
  }

  async upsertEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate> {
    const [result] = await db
      .insert(emailTemplates)
      .values(template)
      .onConflictDoUpdate({
        target: emailTemplates.templateKey,
        set: {
          name: template.name,
          subject: template.subject,
          bodyText: template.bodyText,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  // ============ NON-ENGAGEMENT CATEGORIES ============
  async getAllNonEngagementCategories(): Promise<NonEngagementCategory[]> {
    return await db.select().from(nonEngagementCategories).orderBy(nonEngagementCategories.name);
  }

  async createNonEngagementCategory(category: InsertNonEngagementCategory): Promise<NonEngagementCategory> {
    const [result] = await db.insert(nonEngagementCategories).values(category).returning();
    return result;
  }

  async deleteNonEngagementCategory(id: string): Promise<boolean> {
    const result = await db.delete(nonEngagementCategories).where(eq(nonEngagementCategories.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // ============ CUSTOM INSURERS ============
  async getCustomInsurers(): Promise<CustomInsurer[]> {
    return await db.select().from(customInsurers).orderBy(customInsurers.name);
  }

  async addCustomInsurer(name: string): Promise<CustomInsurer> {
    const [result] = await db.insert(customInsurers).values({ name }).returning();
    return result;
  }
}

export const storage = new DatabaseStorage();
