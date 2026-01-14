import { 
  users, clients, clinicians, timeSlots, formTemplates, formSubmissions, tasks, auditLogs,
  type User, type InsertUser, type SafeUser,
  type Client, type InsertClient,
  type Clinician, type InsertClinician,
  type TimeSlot, type InsertTimeSlot,
  type FormTemplate, type InsertFormTemplate,
  type FormSubmission, type InsertFormSubmission,
  type Task, type InsertTask,
  type AuditLog, type InsertAuditLog
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

// Storage interface for all CRUD operations
export interface IStorage {
  // ============ USERS & AUTH ============
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<InsertUser>): Promise<User | undefined>;
  
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
  updateTimeSlot(id: string, updates: Partial<InsertTimeSlot>): Promise<TimeSlot | undefined>;
  deleteTimeSlot(id: string): Promise<void>;
  bulkUpdateTimeSlots(clinicianId: string, slots: TimeSlot[]): Promise<void>;
  
  // ============ CLIENTS ============
  getAllClients(): Promise<Client[]>;
  getClientById(id: string): Promise<Client | undefined>;
  getClientByDisplayId(displayId: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, updates: Partial<InsertClient>): Promise<Client | undefined>;
  archiveClient(id: string): Promise<Client | undefined>;
  assignClinicianToClient(clientId: string, clinicianId: string, slotId: string, allocationMethod?: "form" | "manual"): Promise<void>;
  
  // ============ FORMS ============
  getAllFormTemplates(): Promise<FormTemplate[]>;
  getFormTemplateById(id: string): Promise<FormTemplate | undefined>;
  createFormTemplate(form: InsertFormTemplate): Promise<FormTemplate>;
  updateFormTemplate(id: string, updates: Partial<InsertFormTemplate>): Promise<FormTemplate | undefined>;
  deleteFormTemplate(id: string): Promise<void>;
  
  // ============ FORM SUBMISSIONS ============
  getFormSubmissionsByClientId(clientId: string): Promise<FormSubmission[]>;
  createFormSubmission(submission: InsertFormSubmission): Promise<FormSubmission>;
  
  // ============ TASKS ============
  getAllTasks(): Promise<Task[]>;
  getTaskById(id: string): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<void>;
  
  // ============ AUDIT LOGS (GDPR) ============
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByUserId(userId: string): Promise<AuditLog[]>;
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return user || undefined;
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

  async updateTimeSlot(id: string, updates: Partial<InsertTimeSlot>): Promise<TimeSlot | undefined> {
    const [slot] = await db.update(timeSlots).set(updates).where(eq(timeSlots.id, id)).returning();
    return slot || undefined;
  }

  async deleteTimeSlot(id: string): Promise<void> {
    await db.delete(timeSlots).where(eq(timeSlots.id, id));
  }

  async bulkUpdateTimeSlots(clinicianId: string, slots: TimeSlot[]): Promise<void> {
    // Delete all existing slots for this clinician
    await db.delete(timeSlots).where(eq(timeSlots.clinicianId, clinicianId));
    
    // Insert new slots with fresh IDs to avoid conflicts
    if (slots.length > 0) {
      await db.insert(timeSlots).values(slots.map((slot, index) => ({
        id: `ts-${Date.now()}-${index}-${slot.day || slot.date || 'slot'}`,
        clinicianId,
        type: slot.type,
        day: slot.day,
        date: slot.date,
        startDate: slot.startDate,
        endDate: slot.endDate,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBooked: slot.isBooked,
      })));
    }
    
    // Update lastUpdatedAvailability
    await db.update(clinicians).set({
      lastUpdatedAvailability: new Date()
    }).where(eq(clinicians.id, clinicianId));
  }

  // ============ CLIENTS ============
  async getAllClients(): Promise<Client[]> {
    return await db.select().from(clients)
      .where(eq(clients.isArchived, false))
      .orderBy(desc(clients.intakeDate));
  }

  async archiveClient(id: string): Promise<Client | undefined> {
    // First, get the client to find their assigned slot and clinician
    const [existingClient] = await db.select().from(clients).where(eq(clients.id, id));
    
    if (!existingClient) return undefined;

    // If client was assigned to a slot, release it
    if (existingClient.assignedClinicianId && existingClient.assignedSlot) {
      // Parse the slot string "Day HH:MM" to find the matching slot
      const slotParts = existingClient.assignedSlot.split(' ');
      const day = slotParts[0];
      const startTime = slotParts[1];

      // Find and release the booked slot for this clinician
      const [slot] = await db.select().from(timeSlots)
        .where(and(
          eq(timeSlots.clinicianId, existingClient.assignedClinicianId),
          eq(timeSlots.day, day),
          eq(timeSlots.startTime, startTime),
          eq(timeSlots.isBooked, true)
        ));

      if (slot) {
        // Release the slot
        await db.update(timeSlots).set({
          isBooked: false
        }).where(eq(timeSlots.id, slot.id));

        // Decrement clinician load
        await db.update(clinicians).set({
          currentLoad: sql`GREATEST(${clinicians.currentLoad} - 1, 0)`
        }).where(eq(clinicians.id, existingClient.assignedClinicianId));
      }
    }

    // Archive the client
    const [client] = await db.update(clients).set({
      isArchived: true,
      archivedAt: new Date(),
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

  async assignClinicianToClient(clientId: string, clinicianId: string, slotId: string, allocationMethod: "form" | "manual" = "form"): Promise<void> {
    // Get the slot details
    const [slot] = await db.select().from(timeSlots).where(eq(timeSlots.id, slotId));
    
    if (!slot) throw new Error("Slot not found");

    const slotString = `${slot.day} ${slot.startTime}`;

    // Start transaction
    await db.transaction(async (tx) => {
      // Update client
      await tx.update(clients).set({
        status: "Assigned",
        assignedClinicianId: clinicianId,
        assignedSlot: slotString,
        allocationMethod: allocationMethod,
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
  async getFormSubmissionsByClientId(clientId: string): Promise<FormSubmission[]> {
    return await db.select().from(formSubmissions).where(eq(formSubmissions.clientId, clientId));
  }

  async createFormSubmission(submission: InsertFormSubmission): Promise<FormSubmission> {
    const [newSubmission] = await db.insert(formSubmissions).values(submission).returning();
    return newSubmission;
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
}

export const storage = new DatabaseStorage();
