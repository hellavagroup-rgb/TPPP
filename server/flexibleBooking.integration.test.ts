import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { CYA_PSYCHOLOGY_TENANT_ID as CYA } from "@shared/practicePolicies";
import { flexibleBookingAvailable, reservationDeadline, validReservationHours } from "@shared/reservationPolicy";

const isolated = vi.hoisted(() => ({ pool: null as any, admin: null as any, schema: "", failMail: false, stripe: null as any }));
// Actual PostgreSQL locks/transactions in an isolated schema, never practice records.
vi.mock("./db", async () => {
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { readFile } = await import("node:fs/promises");
  const tables = await import("@shared/schema");
  isolated.schema = `booking_test_${crypto.randomUUID().replaceAll("-", "")}`;
  isolated.admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await isolated.admin.query(`CREATE SCHEMA "${isolated.schema}"`);
  isolated.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${isolated.schema}`, max: 8 });
  for (const name of ["tenants", "users", "clients", "clinicians", "time_slots", "form_templates", "form_submissions", "audit_logs", "booking_snapshots", "client_clinician_options", "payment_charges"]) {
    await isolated.pool.query(`CREATE TABLE "${name}" (LIKE public."${name}" INCLUDING ALL)`);
  }
  await isolated.pool.query(await readFile("migrations/0020_flexible_booking.sql", "utf8"));
  await isolated.pool.query(await readFile("migrations/0021_availability_time_off_blocks.sql", "utf8"));
  return { db: drizzle(isolated.pool, { schema: tables }), pool: isolated.pool };
});
vi.mock("./auth", () => ({
  requireAdmin: (req: any, res: any, next: any) => req.user?.role === "admin" ? next() : res.status(403).json({ error: "Admin required" }),
}));
vi.mock("./email", () => ({
  sendEmail: vi.fn(async () => ({ success: !isolated.failMail, outcome: isolated.failMail ? "uncertain" : "accepted" })),
  buildFromAddress: () => "Test Practice <test@example.invalid>",
  wrapInHtmlTemplate: (text: string) => text,
  generateBookingConfirmedEmail: async () => ({ subject: "Confirmed" }),
}));
vi.mock("./registrationDelivery", () => ({ deliverRegistration: vi.fn(async () => ({ success: true })) }));
vi.mock("./encryption", () => ({ decryptSecret: (value: string) => value }));
vi.mock("./stripe", () => ({ createPaymentLink: vi.fn(), childNameFromClientNotes: () => undefined }));
vi.mock("stripe", () => ({ default: class { constructor() { if (!isolated.stripe) throw new Error("No fake provider configured"); return isolated.stripe; } } }));

import { db } from "./db";
import { registerFlexibleBookingRoutes, reserveFlexibleSlot } from "./flexibleBooking";
import { latestReservation, settleReservation, assertReservationOpen, flagLateReservationPayment, bindReservationPayment, reservationPaymentLock } from "./reservationLifecycle";
import { reconcileRegistrationPayment } from "./paymentReconciliation";
import { confirmBooking } from "./bookingConfirmation";
import { AvailabilityTimeOffConflictError, storage } from "./storage";

let server: Server;
let base: string;
const OTHER = "other-practice";
async function request(path: string, body?: unknown, tenant = CYA, admin = true) {
  return fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : path.endsWith("booking-settings") ? "PATCH" : "POST",
    headers: { "content-type": "application/json", "x-test-tenant": tenant, "x-test-role": admin ? "admin" : "clinician" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function fixture() {
  await db.insert(schema.tenants).values([
    { id: CYA, name: "Test Practice", flexibleBookingEnabled: true, paymentReconciliationEnabled: true, multiClinicianAllocationEnabled: true, registrationFormEnabled: true, registrationFormTemplateId: "registration", oneOffSlotsEnabled: true, timeOffBlocksEnabled: true },
    { id: OTHER, name: "Other Practice" },
  ]);
  await db.insert(schema.users).values({ id: "admin", email: "admin@example.invalid", password: "not-a-real-password", role: "admin", name: "Test Admin", tenantId: CYA });
  await db.insert(schema.formTemplates).values({ id: "registration", title: "Registration", description: "Test", fields: [], tenantId: CYA });
  await db.insert(schema.clinicians).values([
    { id: "clinician", avatar: "T", maxNewClients: 10, capacity: 10, currentLoad: 0, insurers: ["Test Insurance"], sessionRatePence: 10000, tenantId: CYA },
    { id: "other-clinician", avatar: "O", maxNewClients: 10, capacity: 10, tenantId: OTHER },
  ]);
  await db.insert(schema.clients).values([
    { id: "client", displayId: "TEST-1", email: "family@example.invalid", status: "Forms Completed", tenantId: CYA },
    { id: "client-2", displayId: "TEST-2", email: "family2@example.invalid", status: "Forms Completed", tenantId: CYA },
    { id: "other-client", displayId: "TEST-3", email: "other@example.invalid", status: "Forms Completed", tenantId: OTHER },
  ]);
  await db.insert(schema.timeSlots).values([
    { id: "slot", clinicianId: "clinician", type: "Recurring", day: "Monday", startTime: "10:00", endTime: "11:00", tenantId: CYA },
    { id: "slot-2", clinicianId: "clinician", type: "Recurring", day: "Tuesday", startTime: "10:00", endTime: "11:00", tenantId: CYA },
    { id: "other-slot", clinicianId: "other-clinician", type: "Recurring", day: "Monday", startTime: "10:00", endTime: "11:00", tenantId: OTHER },
  ]);
}
async function reserve(clientId = "client", slotId = "slot") {
  return reserveFlexibleSlot({ clientId, slotId, clinicianId: "clinician", tenantId: CYA, route: "phone" });
}
async function overdue(id: string) {
  await db.update(schema.bookingReservations).set({ deadline: new Date(Date.now() - 1000) }).where(eq(schema.bookingReservations.id, id));
}
async function client(id = "client") {
  return (await db.select().from(schema.clients).where(eq(schema.clients.id, id)))[0];
}
beforeAll(async () => {
  vi.stubEnv("APP_BASE_URL", "https://booking.example.invalid");
  const app = express();
  app.use(express.json());
  app.use(async (req: any, _res, next) => {
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, String(req.headers["x-test-tenant"] || CYA)));
    req.tenant = tenant;
    req.user = { id: "admin", role: req.headers["x-test-role"] || "admin" };
    next();
  });
  registerFlexibleBookingRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(async () => {
  isolated.failMail = false;
  isolated.stripe = null;
  const { rows } = await isolated.pool.query("SELECT tablename FROM pg_tables WHERE schemaname = $1", [isolated.schema]);
  await isolated.pool.query(`TRUNCATE ${rows.map((row: any) => `"${row.tablename}"`).join(",")} CASCADE`);
  await fixture();
});
afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  await isolated.pool?.end();
  if (isolated.schema) await isolated.admin.query(`DROP SCHEMA "${isolated.schema}" CASCADE`);
  await isolated.admin?.end();
  vi.unstubAllEnvs();
});

describe("slot format editing with real database ownership and booking guards", () => {
  const actor = { id: "clinician-user", role: "clinician" as const };
  const admin = { id: "admin", role: "admin" as const };
  beforeEach(async () => {
    await db.insert(schema.users).values({ id: actor.id, name: "Test Clinician", email: "clinician@example.invalid", password: "test-only", role: "clinician", tenantId: CYA });
    await db.update(schema.clinicians).set({ userId: actor.id }).where(eq(schema.clinicians.id, "clinician"));
  });
  it("allows both directions on the clinician's own free slot", async () => {
    expect(await storage.updateTimeSlotLocationType("slot", CYA, "in_person", actor))
      .toMatchObject({ previousLocationType: "online", slot: { locationType: "in_person" } });
    expect(await storage.updateTimeSlotLocationType("slot", CYA, "online", actor))
      .toMatchObject({ previousLocationType: "in_person", slot: { locationType: "online" } });
  });
  it("keeps administrator access to a practice's free slot", async () => {
    expect(await storage.updateTimeSlotLocationType("slot", CYA, "in_person", admin))
      .toMatchObject({ slot: { locationType: "in_person" } });
  });
  it("rejects another clinician even within the same practice", async () => {
    await db.insert(schema.clinicians).values({ id: "colleague", avatar: "C", tenantId: CYA });
    await db.insert(schema.timeSlots).values({ id: "colleague-slot", clinicianId: "colleague", type: "Recurring", day: "Tuesday", startTime: "09:00", endTime: "10:00", tenantId: CYA });
    expect(await storage.updateTimeSlotLocationType("colleague-slot", CYA, "in_person", actor)).toBeUndefined();
    expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "colleague-slot")))[0].locationType).toBe("online");
  });
  it.each(["admin", "clinician"] as const)("rejects a cross-practice slot for %s", async role => {
    expect(await storage.updateTimeSlotLocationType("other-slot", CYA, "in_person", { id: role === "admin" ? "admin" : actor.id, role })).toBeUndefined();
  });
  it("uses the scoped parent for a legacy slot without a tenant tag", async () => {
    await db.update(schema.timeSlots).set({ tenantId: null }).where(eq(schema.timeSlots.id, "slot"));
    expect(await storage.updateTimeSlotLocationType("slot", CYA, "in_person", actor)).toMatchObject({ slot: { locationType: "in_person" } });
    expect(await storage.updateTimeSlotLocationType("slot", OTHER, "online", admin)).toBeUndefined();
  });
  it("rejects an inconsistent non-null slot tenant tag", async () => {
    await db.update(schema.timeSlots).set({ tenantId: OTHER }).where(eq(schema.timeSlots.id, "slot"));
    expect(await storage.updateTimeSlotLocationType("slot", CYA, "in_person", actor)).toBeUndefined();
  });
  it.each(["admin", "clinician"] as const)("protects booked and retired slots from %s edits", async role => {
    const user = { id: role === "admin" ? "admin" : actor.id, role };
    await db.update(schema.timeSlots).set({ isBooked: true }).where(eq(schema.timeSlots.id, "slot"));
    await expect(storage.updateTimeSlotLocationType("slot", CYA, "in_person", user)).rejects.toMatchObject({ status: 409 });
    await db.update(schema.timeSlots).set({ isBooked: false, retiredAt: new Date() }).where(eq(schema.timeSlots.id, "slot"));
    await expect(storage.updateTimeSlotLocationType("slot", CYA, "in_person", user)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["OptionSelected", "RegistrationPending", "BookingConfirmed"] as const)("protects a %s assignment even if isBooked is stale", async status => {
    await db.update(schema.clients).set({ status, assignedClinicianId: "clinician", assignedSlotId: "slot" }).where(eq(schema.clients.id, "client"));
    await expect(storage.updateTimeSlotLocationType("slot", CYA, "in_person", actor)).rejects.toMatchObject({ status: 409 });
  });
  it("protects a legacy text-only assignment even if isBooked is stale", async () => {
    await db.update(schema.clients).set({ status: "Assigned", assignedClinicianId: "clinician", assignedSlot: "Monday 10:00" }).where(eq(schema.clients.id, "client"));
    await expect(storage.updateTimeSlotLocationType("slot", CYA, "in_person", actor)).rejects.toMatchObject({ status: 409 });
  });
  it("does not change a held slot's format when a reservation competes with editing", async () => {
    const [held] = await Promise.allSettled([reserve(), storage.updateTimeSlotLocationType("slot", CYA, "in_person", actor)]);
    expect(held.status).toBe("fulfilled");
    const reservation = (await latestReservation("client"))!;
    const [slot] = await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot"));
    expect(reservation.appointmentLabel).toContain(slot.locationType === "in_person" ? "in person" : "online");
    await expect(storage.updateTimeSlotLocationType("slot", CYA, "online", actor)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects invalid format values without changing the slot", async () => {
    await expect(storage.updateTimeSlotLocationType("slot", CYA, "invalid", actor)).rejects.toMatchObject({ status: 400 });
    expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].locationType).toBe("online");
  });
});

describe("hourly time-off blocks with real PostgreSQL transactions", () => {
  const blockInput = {
    tenantId: CYA, clinicianId: "clinician", date: "2099-01-05",
    startTime: "10:00", endTime: "11:00", createdByUserId: "admin",
  };
  const admin = { id: "admin", role: "admin" as const };
  const editedWindow = { date: "2099-01-06", startTime: "12:00", endTime: "14:00" };

  it("lets owners and practice admins edit in place, preserving provenance and recurring slots", async () => {
    await db.update(schema.clinicians).set({ userId: admin.id }).where(eq(schema.clinicians.id, "clinician"));
    const slots = await db.select().from(schema.timeSlots);
    const block = await storage.createAvailabilityTimeOffBlock(blockInput);
    const edited = await storage.updateAvailabilityTimeOffBlock(block.id, CYA, editedWindow, { ...admin, role: "clinician" });
    expect(edited).toEqual({ ...block, ...editedWindow });
    // Unchanged range must not conflict with itself.
    expect(await storage.updateAvailabilityTimeOffBlock(block.id, CYA, editedWindow, admin)).toEqual(edited);
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toEqual([edited]);
    expect(await db.select().from(schema.timeSlots)).toEqual(slots);
  });

  it("rejects colleague, unsupported-role, missing-block and cross-practice edits", async () => {
    const block = await storage.createAvailabilityTimeOffBlock(blockInput);
    await expect(storage.updateAvailabilityTimeOffBlock(block.id, CYA, editedWindow, { id: "colleague", role: "clinician" }))
      .rejects.toMatchObject({ status: 403 });
    await expect(storage.updateAvailabilityTimeOffBlock(block.id, CYA, editedWindow, { id: "unknown", role: "unknown" }))
      .rejects.toMatchObject({ status: 403 });
    await expect(storage.updateAvailabilityTimeOffBlock(block.id, OTHER, editedWindow, admin))
      .rejects.toMatchObject({ status: 404 });
    await expect(storage.updateAvailabilityTimeOffBlock("missing", CYA, editedWindow, admin))
      .rejects.toMatchObject({ status: 404 });
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toEqual([block]);
  });

  it.each([
    { startTime: "10:30" }, { endTime: "21:30" }, { startTime: "06:00" },
    { date: "2099-02-30" }, { endTime: "10:00" }, { endTime: "09:00" },
  ])("preserves the original after invalid edit %j", async patch => {
    const block = await storage.createAvailabilityTimeOffBlock(blockInput);
    await expect(storage.updateAvailabilityTimeOffBlock(block.id, CYA, { ...blockInput, ...patch }, admin))
      .rejects.toMatchObject({ status: 400 });
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toEqual([block]);
  });

  it("rejects overlapping edits but allows adjacent hours and excludes the edited block itself", async () => {
    const block = await storage.createAvailabilityTimeOffBlock(blockInput);
    const other = await storage.createAvailabilityTimeOffBlock({ ...blockInput, startTime: "12:00", endTime: "14:00" });
    await expect(storage.updateAvailabilityTimeOffBlock(block.id, CYA, { ...blockInput, endTime: "13:00" }, admin))
      .rejects.toMatchObject({ status: 409 });
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toEqual(expect.arrayContaining([block, other]));
    await expect(storage.updateAvailabilityTimeOffBlock(block.id, CYA, { ...blockInput, endTime: "12:00" }, admin))
      .resolves.toMatchObject({ id: block.id, endTime: "12:00" });
  });

  it.each(["assignment", "reservation", "snapshot"])("preserves the old block and %s after a booking conflict", async kind => {
    const block = await storage.createAvailabilityTimeOffBlock({ ...blockInput, startTime: "12:00", endTime: "13:00" });
    if (kind === "assignment") {
      await storage.assignClinicianToClient("client", "clinician", "slot", CYA, "manual", undefined, blockInput.date);
    } else if (kind === "reservation") {
      await reserve();
    } else {
      await db.update(schema.timeSlots).set({ retiredAt: new Date() }).where(eq(schema.timeSlots.id, "slot"));
      await db.update(schema.clients).set({ status: "Scheduled" }).where(eq(schema.clients.id, "client"));
      await db.insert(schema.bookingSnapshots).values({
        tenantId: CYA, clientId: "client", clinicianId: "clinician", slotId: "slot",
        clinicianName: "Test Clinician", slotType: "Recurring", day: "Monday",
        startTime: "10:00", endTime: "11:00", locationType: "online", idempotencyKey: "edit-conflict",
      });
    }
    const before = await client();
    const slots = await db.select().from(schema.timeSlots);
    const reservation = await latestReservation("client");
    await expect(storage.updateAvailabilityTimeOffBlock(block.id, CYA, blockInput, admin))
      .rejects.toBeInstanceOf(AvailabilityTimeOffConflictError);
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toEqual([block]);
    expect(await client()).toEqual(before);
    expect(await db.select().from(schema.timeSlots)).toEqual(slots);
    expect(await latestReservation("client")).toEqual(reservation);
  });

  it("serializes competing edits and never saves overlapping blocks", async () => {
    const first = await storage.createAvailabilityTimeOffBlock(blockInput);
    const second = await storage.createAvailabilityTimeOffBlock({ ...blockInput, startTime: "12:00", endTime: "13:00" });
    const results = await Promise.allSettled([
      storage.updateAvailabilityTimeOffBlock(first.id, CYA, editedWindow, admin),
      storage.updateAvailabilityTimeOffBlock(second.id, CYA, editedWindow, admin),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toHaveLength(2);
  });

  it.each(["reservation", "assignment"])("never commits both an edit and an overlapping %s under competition", async kind => {
    const block = await storage.createAvailabilityTimeOffBlock({ ...blockInput, startTime: "12:00", endTime: "13:00" });
    const results = await Promise.allSettled([
      storage.updateAvailabilityTimeOffBlock(block.id, CYA, blockInput, admin),
      kind === "reservation" ? reserve()
        : storage.assignClinicianToClient("client", "clinician", "slot", CYA, "manual", undefined, blockInput.date),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const [saved] = await storage.getAvailabilityTimeOffBlocks(CYA);
    expect(saved.startTime).toBe(results[0].status === "fulfilled" ? "10:00" : "12:00");
  });

  it("creates and removes date-specific hours without changing recurring availability", async () => {
    const before = await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot"));
    const block = await storage.createAvailabilityTimeOffBlock({ ...blockInput, endTime: "12:00" });
    expect(await storage.getAvailabilityTimeOffBlocks(OTHER)).toEqual([]);
    expect(await storage.deleteAvailabilityTimeOffBlock(block.id, OTHER)).toBe(false);
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toHaveLength(1);
    expect(await storage.deleteAvailabilityTimeOffBlock(block.id, CYA)).toBe(true);
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toEqual([]);
    expect(await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot"))).toEqual(before);
  });

  it("rejects another practice's clinician and invalid whole-hour windows", async () => {
    await expect(storage.createAvailabilityTimeOffBlock({ ...blockInput, clinicianId: "other-clinician" }))
      .rejects.toMatchObject({ status: 404 });
    await expect(storage.createAvailabilityTimeOffBlock({ ...blockInput, startTime: "10:30" }))
      .rejects.toMatchObject({ status: 400 });
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toEqual([]);
  });

  it("serializes duplicate blocks but allows adjacent hours", async () => {
    const results = await Promise.allSettled([
      storage.createAvailabilityTimeOffBlock(blockInput),
      storage.createAvailabilityTimeOffBlock(blockInput),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await storage.createAvailabilityTimeOffBlock({ ...blockInput, startTime: "11:00", endTime: "12:00" });
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toHaveLength(2);
  });

  it("rejects recurring assignment even when another week is selected, but allows a separate one-off date", async () => {
    await storage.createAvailabilityTimeOffBlock(blockInput);
    await expect(storage.assignClinicianToClient("client", "clinician", "slot", CYA, "manual", undefined, blockInput.date))
      .rejects.toMatchObject({ reason: "slot_unavailable" });
    expect((await client()).assignedSlotId).toBeNull();
    expect((await storage.getTimeSlotById("slot"))?.isBooked).toBe(false);
    await expect(storage.assignClinicianToClient("client", "clinician", "slot", CYA, "manual", undefined, "2099-01-12"))
      .rejects.toMatchObject({ reason: "slot_unavailable" });
    await db.insert(schema.timeSlots).values({
      id: "unblocked-dated-slot", clinicianId: "clinician", type: "SpecificDate",
      date: "2099-01-12", startTime: "10:00", endTime: "11:00", tenantId: CYA,
    });
    await expect(storage.assignClinicianToClient("client", "clinician", "unblocked-dated-slot", CYA, "manual"))
      .resolves.toMatchObject({ assignedSlotId: "unblocked-dated-slot", status: "Assigned" });
  });

  it("rejects an invalid recurrence date and preserves the previous allocation on failed reassignment", async () => {
    await storage.assignClinicianToClient("client", "clinician", "slot-2", CYA, "manual", undefined, "2099-01-06");
    const before = await client();
    await storage.createAvailabilityTimeOffBlock(blockInput);
    await expect(storage.reassignClient("client", "clinician", "slot", "Assigned", CYA, undefined, "2099-01-06"))
      .rejects.toMatchObject({ reason: "invalid_occurrence_date" });
    await expect(storage.reassignClient("client", "clinician", "slot", "Assigned", CYA, undefined, blockInput.date))
      .rejects.toMatchObject({ reason: "slot_unavailable" });
    await expect(storage.reassignClient("client", "clinician", "slot", "Assigned", CYA, undefined, "2099-01-12"))
      .rejects.toMatchObject({ reason: "slot_unavailable" });
    expect(await client()).toEqual(before);
    expect((await storage.getTimeSlotById("slot-2"))?.isBooked).toBe(true);
    expect((await storage.getTimeSlotById("slot"))?.isBooked).toBe(false);
  });

  it("rejects time off over a booked recurring allocation without changing the client", async () => {
    await storage.assignClinicianToClient("client", "clinician", "slot", CYA, "manual", undefined, blockInput.date);
    const before = await client();
    await expect(storage.createAvailabilityTimeOffBlock(blockInput)).rejects.toBeInstanceOf(AvailabilityTimeOffConflictError);
    expect(await client()).toEqual(before);
    expect((await storage.getTimeSlotById("slot"))?.isBooked).toBe(true);
  });

  it("protects confirmed recurring snapshots, respecting fortnightly weeks and completed bookings", async () => {
    await db.update(schema.timeSlots).set({
      retiredAt: new Date(), startDate: blockInput.date, frequency: "fortnightly",
    }).where(eq(schema.timeSlots.id, "slot"));
    await db.update(schema.clients).set({ status: "Scheduled" }).where(eq(schema.clients.id, "client"));
    await db.insert(schema.bookingSnapshots).values({
      tenantId: CYA, clientId: "client", clinicianId: "clinician", slotId: "slot",
      clinicianName: "Test Clinician", slotType: "Recurring", day: "Monday",
      startTime: "10:00", endTime: "11:00", locationType: "online", idempotencyKey: "test-confirmation",
    });
    await expect(storage.createAvailabilityTimeOffBlock({ ...blockInput, date: "2099-01-19" }))
      .rejects.toBeInstanceOf(AvailabilityTimeOffConflictError);
    await expect(storage.createAvailabilityTimeOffBlock({ ...blockInput, date: "2099-01-12" })).resolves.toBeDefined();
    await db.update(schema.clients).set({ completedAt: new Date() }).where(eq(schema.clients.id, "client"));
    await expect(storage.createAvailabilityTimeOffBlock({ ...blockInput, date: "2099-01-19" })).resolves.toBeDefined();
  });

  it("rejects a recurring reservation when time off was saved first", async () => {
    await storage.createAvailabilityTimeOffBlock(blockInput);
    await expect(reserve()).rejects.toMatchObject({ status: 409 });
    expect(await latestReservation("client")).toBeUndefined();
    expect((await client()).assignedSlotId).toBeNull();
    expect((await storage.getTimeSlotById("slot"))?.isBooked).toBe(false);
  });

  it("removes blocked recurring choices from an existing invitation and rejects stale selection", async () => {
    expect((await request("/api/clients/client/clinician-invitation", { clinicianIds: ["clinician"] })).status).toBe(200);
    const [invitation] = await db.select().from(schema.clinicianInvitations);
    await storage.createAvailabilityTimeOffBlock(blockInput);
    const portal = await (await request(`/api/public/booking/${invitation.token}`)).json();
    expect(portal.clinicians[0].slots.map((slot: any) => slot.id)).toEqual(["slot-2"]);
    expect((await request(`/api/public/booking/${invitation.token}`, { clinicianId: "clinician", slotId: "slot" })).status).toBe(409);
    expect(await latestReservation("client")).toBeUndefined();
    expect((await storage.getTimeSlotById("slot"))?.isBooked).toBe(false);
  });

  it("never commits both a reservation and an overlapping time-off block under competition", async () => {
    await db.insert(schema.timeSlots).values({
      id: "dated-race-slot", clinicianId: "clinician", type: "SpecificDate",
      date: blockInput.date, startTime: "10:00", endTime: "11:00", tenantId: CYA,
    });
    const results = await Promise.allSettled([
      storage.createAvailabilityTimeOffBlock(blockInput),
      reserveFlexibleSlot({ clientId: "client", slotId: "dated-race-slot", clinicianId: "clinician", tenantId: CYA, route: "phone" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  });
});

describe("flexible booking with actual PostgreSQL ownership", () => {
  it("requires reconciliation for both availability and settings, without abandoning existing holds", async () => {
    expect(flexibleBookingAvailable({ id: CYA, flexibleBookingEnabled: true, paymentReconciliationEnabled: false })).toBe(false);
    const held = await reserve();
    await db.update(schema.tenants).set({ paymentReconciliationEnabled: false }).where(eq(schema.tenants.id, CYA));
    expect((await request("/api/tenant/booking-settings", { enabled: true, durationHours: 12 })).status).toBe(409);
    await expect(reserve("client-2", "slot-2")).rejects.toMatchObject({ status: 404 });
    expect((await settleReservation(held.reservation.id, CYA, true))?.status).toBe("cancelled");
    expect((await request("/api/tenant/booking-settings", { enabled: false, durationHours: 12 })).status).toBe(200);
  });
  it("pins the attempt before resource creation and never allows a different attempt or link", async () => {
    const held = await reserve();
    async function bind(attempt: string, link: string | null) {
      return db.transaction(async tx => {
        await reservationPaymentLock(tx, "client", CYA);
        const [current] = await tx.select().from(schema.clients).where(eq(schema.clients.id, "client")).for("update");
        await bindReservationPayment(current, attempt, link, tx);
        await tx.update(schema.clients).set({ registrationPaymentAttemptKey: attempt, stripePaymentLinkId: link }).where(eq(schema.clients.id, "client"));
      });
    }
    await bind("attempt", null);
    expect((await latestReservation("client"))?.paymentAttemptKey).toBe("attempt");
    await bind("attempt", "link");
    await bind("attempt", "link");
    await expect(bind("replacement", "new-link")).rejects.toMatchObject({ status: 409 });
    await expect(bind("attempt", "new-link")).rejects.toMatchObject({ status: 409 });
    expect(await latestReservation("client")).toMatchObject({ id: held.reservation.id, paymentAttemptKey: "attempt", paymentLinkId: "link" });
  });
  it("validates duration and preserves elapsed hours across DST", () => {
    expect([0, -1, 1.5, 169, "12", NaN].every(value => !validReservationHours(value))).toBe(true);
    expect(reservationDeadline(12, new Date("2026-10-24T23:00:00Z")).toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });
  it("persists admin settings and rejects non-admin and cross-practice access", async () => {
    expect((await request("/api/tenant/booking-settings", { enabled: true, durationHours: 24 })).status).toBe(200);
    expect(await (await request("/api/tenant/booking-settings")).json()).toEqual({ enabled: true, durationHours: 24 });
    expect((await request("/api/tenant/booking-settings", { enabled: true, durationHours: 0 })).status).toBe(400);
    expect((await request("/api/tenant/booking-settings", undefined, CYA, false)).status).toBe(403);
    expect((await request("/api/tenant/booking-settings", { enabled: true, durationHours: 1 }, OTHER)).status).toBe(404);
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "activity_booking_settings_changed"));
    expect(logs).toHaveLength(1);
  });
  it("applies setting edits only to new holds and keeps a retry's original deadline", async () => {
    const first = await reserve();
    await request("/api/tenant/booking-settings", { enabled: true, durationHours: 24 });
    const retry = await reserve();
    const second = await reserve("client-2", "slot-2");
    expect(retry.reservation.id).toBe(first.reservation.id);
    expect(retry.reservation.deadline).toEqual(first.reservation.deadline);
    expect(second.reservation.durationHours).toBe(24);
    expect(first.reservation.durationHours).toBe(12);
  });
  it("reserves only one client's slot under simultaneous real transactions", async () => {
    const results = await Promise.allSettled([reserve("client"), reserve("client-2")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await db.select().from(schema.bookingReservations))).toHaveLength(1);
    const [clinician] = await db.select().from(schema.clinicians).where(eq(schema.clinicians.id, "clinician"));
    expect(clinician.currentLoad).toBe(1);
  });
  it("does not expose another practice's slots and revalidates insurer/capacity", async () => {
    await expect(reserveFlexibleSlot({ clientId: "client", slotId: "other-slot", clinicianId: "other-clinician", tenantId: CYA, route: "phone" })).rejects.toMatchObject({ status: 409 });
    await db.update(schema.clients).set({ insurer: "Not accepted" }).where(eq(schema.clients.id, "client"));
    await expect(reserve()).rejects.toMatchObject({ status: 409 });
    await db.update(schema.clients).set({ insurer: "Private" }).where(eq(schema.clients.id, "client"));
    await db.update(schema.clinicians).set({ currentLoad: 10 }).where(eq(schema.clinicians.id, "clinician"));
    await expect(reserve()).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a date-specific time-off block over an active reservation without releasing it", async () => {
    await db.insert(schema.timeSlots).values({
      id: "dated-slot", clinicianId: "clinician", type: "SpecificDate", day: "Wednesday",
      date: "2026-10-21", startTime: "10:00", endTime: "11:00", tenantId: CYA,
    });
    const held = await reserveFlexibleSlot({
      clientId: "client", slotId: "dated-slot", clinicianId: "clinician", tenantId: CYA, route: "phone",
    });
    await expect(storage.createAvailabilityTimeOffBlock({
      tenantId: CYA, clinicianId: "clinician", date: "2026-10-21",
      startTime: "10:00", endTime: "11:00", createdByUserId: "admin",
    })).rejects.toBeInstanceOf(AvailabilityTimeOffConflictError);
    expect((await latestReservation("client"))?.id).toBe(held.reservation.id);
    expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "dated-slot")))[0].isBooked).toBe(true);
    expect(await storage.getAvailabilityTimeOffBlocks(CYA)).toHaveLength(0);
  });
  it("releases an unpaid hold once and permits fresh booking without replaying the old token", async () => {
    const held = await reserve();
    const token = held.client.registrationToken;
    await overdue(held.reservation.id);
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("expired");
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("expired");
    await expect(assertReservationOpen(await client())).rejects.toMatchObject({ status: 410 });
    const fresh = await reserve();
    expect(fresh.client.registrationToken).not.toBe(token);
    expect(fresh.reservation.id).not.toBe(held.reservation.id);
    expect(fresh.client.status).toBe("OptionSelected");
  });
  it("does not retrofit or expire legacy assignments", async () => {
    await db.update(schema.clients).set({ assignedSlotId: "slot", assignedClinicianId: "clinician", status: "Assigned" }).where(eq(schema.clients.id, "client"));
    expect(await assertReservationOpen(await client())).toBeUndefined();
    expect(await latestReservation("client")).toBeUndefined();
  });
  it("keeps an uncertain payment unavailable, including after explicit cancellation", async () => {
    const held = await reserve();
    await db.update(schema.clients).set({ registrationPaymentAttemptKey: "attempt", stripePaymentLinkId: "plink_test", paymentStatus: "setup_pending" }).where(eq(schema.clients.id, "client"));
    await overdue(held.reservation.id);
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("payment_check");
    expect((await settleReservation(held.reservation.id, CYA, true))?.status).toBe("payment_check");
    const [slot] = await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot"));
    expect(slot.isBooked).toBe(true);
    await expect(reserve("client-2")).rejects.toMatchObject({ status: 409 });
  });
  async function paymentFixture(outcome: "paid" | "unpaid" | "processing" | "race") {
    const held = await reserve();
    await db.update(schema.tenants).set({ stripeSecretKey: "synthetic-test-key" }).where(eq(schema.tenants.id, CYA));
    await db.update(schema.bookingReservations).set({ paymentAttemptKey: "attempt", paymentLinkId: "plink_test" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.update(schema.clients).set({
      status: "RegistrationPending", paymentType: "self_pay", registrationPaymentAttemptKey: "attempt",
      stripePaymentLinkId: "plink_test", stripeCheckoutUrl: "https://checkout.example.invalid",
      paymentStatus: "setup_pending",
    }).where(eq(schema.clients.id, "client"));
    const metadata = { tenantId: CYA, clientId: "client", registrationAttemptKey: "attempt" };
    const session: any = { id: "cs_test", payment_link: "plink_test", metadata,
      status: outcome === "paid" || outcome === "processing" ? "complete" : "open",
      payment_status: outcome === "paid" ? "paid" : "unpaid", payment_intent: outcome === "unpaid" ? null : "pi_test",
      amount_total: 10000, currency: "gbp", customer: null };
    const intent: any = { id: "pi_test", status: outcome === "processing" ? "processing" : "succeeded", amount_received: 10000, currency: "gbp", metadata, payment_method: null };
    isolated.stripe = {
      paymentLinks: { retrieve: vi.fn(async () => ({ id: "plink_test", metadata, active: true })), update: vi.fn(async () => ({})) },
      checkout: { sessions: {
        list: () => ({ async *[Symbol.asyncIterator]() { yield { ...session }; } }),
        expire: vi.fn(async () => {
          if (outcome === "race") { session.status = "complete"; session.payment_status = "paid"; throw new Error("Already complete"); }
          session.status = "expired";
          return session;
        }),
      } },
      paymentIntents: { retrieve: vi.fn(async () => intent), cancel: vi.fn(async () => ({ status: "canceled" })) },
    };
    await overdue(held.reservation.id);
    return held;
  }
  function configureConflictStripe(
    linkAttempts: Record<string, string>,
    sessionsByLink: Record<string, any[]> = {},
    intents: Record<string, any> = {},
    raceOnExpire = false,
  ) {
    const links = Object.fromEntries(Object.entries(linkAttempts).map(([id, registrationAttemptKey]) => [
      id, { id, metadata: { tenantId: CYA, clientId: "client", registrationAttemptKey }, active: true },
    ]));
    const sessionRows = sessionsByLink;
    const stripe = {
      paymentLinks: {
        retrieve: vi.fn(async (id: string) => {
          if (!links[id]) throw new Error("No such payment link in this Stripe account");
          return links[id];
        }),
        update: vi.fn(async (id: string) => {
          if (!links[id]) throw new Error("No such payment link in this Stripe account");
          links[id].active = false;
          return links[id];
        }),
      },
      checkout: { sessions: {
        list: ({ payment_link }: { payment_link: string }) => ({
          async *[Symbol.asyncIterator]() {
            for (const session of sessionRows[payment_link] || []) yield session;
          },
        }),
        expire: vi.fn(async (id: string) => {
          const session = Object.values(sessionRows).flat().find((candidate: any) => candidate.id === id) as any;
          if (!session) throw new Error("No such checkout session");
          if (raceOnExpire) {
            session.status = "complete";
            session.payment_status = "paid";
            throw new Error("Checkout completed while expiry was racing");
          }
          session.status = "expired";
          return session;
        }),
      } },
      paymentIntents: {
        retrieve: vi.fn(async (id: string) => {
          if (!intents[id]) throw new Error("No such payment intent in this Stripe account");
          return intents[id];
        }),
        cancel: vi.fn(async (id: string) => {
          if (!intents[id]) throw new Error("No such payment intent in this Stripe account");
          intents[id].status = "canceled";
          return intents[id];
        }),
      },
      charges: {
        retrieve: vi.fn(async (id: string) => {
          const intent = Object.values(intents).find((candidate: any) => candidate.latest_charge === id) as any;
          if (!intent) throw new Error("No such charge in this Stripe account");
          return {
            id, payment_intent: intent.id, paid: true, captured: true,
            amount_captured: intent.amount_received, currency: intent.currency,
            amount_refunded: 0, refunded: false, disputed: false,
          };
        }),
      },
    };
    isolated.stripe = stripe;
    return stripe;
  }
  describe.each([false, true])("reservation safety with paymentReconciliationEnabled=%s", reconciliation => {
    it.each([
      ["paid", false], ["paid", true], ["processing", false], ["processing", true],
    ] as const)("keeps a progressed %s payment when BOTH records lost their identity (cancel=%s)", async (outcome, cancel) => {
      const held = await paymentFixture(outcome);
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      await db.update(schema.bookingReservations).set({ paymentAttemptKey: null, paymentLinkId: null }).where(eq(schema.bookingReservations.id, held.reservation.id));
      await db.update(schema.clients).set({
        registrationPaymentAttemptKey: null, stripePaymentLinkId: null, stripeCheckoutUrl: null,
        // Even loss of the pending-payment badge does not erase registration progress.
        paymentStatus: "none",
      }).where(eq(schema.clients.id, "client"));
      expect((await settleReservation(held.reservation.id, CYA, cancel))?.status).toBe("payment_check");
      expect((await settleReservation(held.reservation.id, CYA, cancel))?.status).toBe("payment_check");
      expect(await latestReservation("client")).toMatchObject({ paymentAttemptKey: null, paymentLinkId: null });
      expect((await client()).assignedSlotId).toBe("slot");
      expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].isBooked).toBe(true);
      expect((await db.select().from(schema.clinicians).where(eq(schema.clinicians.id, "clinician")))[0].currentLoad).toBe(1);
      expect(isolated.stripe.paymentLinks.retrieve).not.toHaveBeenCalled();
      expect(await db.select().from(schema.bookingSnapshots)).toHaveLength(0);
      await expect(assertReservationOpen(await client())).rejects.toMatchObject({ status: 409 });
    });
    it.each([false, true])("still releases a pristine hold with no payment journey (cancel=%s)", async cancel => {
      const held = await reserve();
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      await overdue(held.reservation.id);
      expect((await settleReservation(held.reservation.id, CYA, cancel))?.status).toBe(cancel ? "cancelled" : "expired");
      expect((await client()).assignedSlotId).toBeNull();
      expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].isBooked).toBe(false);
    });
    it.each(["link_only", "cleared"] as const)("retains the original evidence if current pointers are %s", async change => {
      const held = await paymentFixture("paid");
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      await db.update(schema.clients).set(change === "link_only"
        ? { stripePaymentLinkId: "replacement-link" }
        : { stripePaymentLinkId: null, registrationPaymentAttemptKey: null }).where(eq(schema.clients.id, "client"));
      expect((await settleReservation(held.reservation.id, CYA, true))?.status).toBe("payment_check");
      expect(await latestReservation("client")).toMatchObject({ paymentAttemptKey: "attempt", paymentLinkId: "plink_test" });
      expect((await client()).assignedSlotId).toBe("slot");
      expect(isolated.stripe.paymentLinks.retrieve).not.toHaveBeenCalled();
    });
    it.each([
      ["paid", false], ["paid", true], ["processing", false], ["processing", true],
    ] as const)("keeps an earlier %s attempt after link replacement (cancel=%s)", async (outcome, cancel) => {
      const held = await paymentFixture(outcome);
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      await db.update(schema.clients).set({ registrationPaymentAttemptKey: "new-attempt", stripePaymentLinkId: "new-link" }).where(eq(schema.clients.id, "client"));
      expect((await settleReservation(held.reservation.id, CYA, cancel))?.status).toBe("payment_check");
      expect((await settleReservation(held.reservation.id, CYA, cancel))?.status).toBe("payment_check");
      expect(await latestReservation("client")).toMatchObject({ paymentAttemptKey: "attempt", paymentLinkId: "plink_test" });
      // No current-link-only provider check is allowed to erase the older evidence.
      expect(isolated.stripe.paymentLinks.retrieve).not.toHaveBeenCalled();
      expect((await client()).assignedSlotId).toBe("slot");
      expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].isBooked).toBe(true);
      expect((await db.select().from(schema.clinicians).where(eq(schema.clinicians.id, "clinician")))[0].currentLoad).toBe(1);
      await expect(assertReservationOpen(await client())).rejects.toMatchObject({ status: 409 });
      await expect(confirmBooking({ clientId: "client", tenantId: CYA, source: "stripe" })).rejects.toThrow();
      expect(await db.select().from(schema.bookingSnapshots)).toHaveLength(0);
    });
    it.each([false, true])("does not release missing historical identity (cancel=%s)", async cancel => {
      const held = await paymentFixture("paid");
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      await db.update(schema.bookingReservations).set({ paymentAttemptKey: null, paymentLinkId: null }).where(eq(schema.bookingReservations.id, held.reservation.id));
      expect((await settleReservation(held.reservation.id, CYA, cancel))?.status).toBe("payment_check");
      expect(await latestReservation("client")).toMatchObject({ paymentAttemptKey: null, paymentLinkId: null });
      expect((await client()).assignedSlotId).toBe("slot");
    });
    it.each(["paid", "processing", "unpaid"] as const)("settles a matching %s attempt even after the flag is changed", async outcome => {
      const held = await paymentFixture(outcome);
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      const results = await Promise.all([
        settleReservation(held.reservation.id, CYA),
        settleReservation(held.reservation.id, CYA, true),
      ]);
      const expected = outcome === "paid" ? "confirmed" : outcome === "processing" ? "payment_check" : results[0]?.status;
      expect(results.map(result => result?.status)).toEqual([expected, expected]);
      expect((await client()).assignedSlotId).toBe(outcome === "processing" ? "slot" : null);
      if (outcome === "paid") {
        // Confirmation retires the slot and preserves the appointment snapshot,
        // rather than leaving an allocatable assignedSlotId on the client.
        const [slot] = await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot"));
        expect(slot.isBooked).toBe(false);
        expect(slot.retiredAt).toBeTruthy();
        expect(await db.select().from(schema.bookingSnapshots)).toHaveLength(1);
      }
      expect(await db.select().from(schema.paymentCharges)).toHaveLength(outcome === "paid" ? 1 : 0);
    });
    it("serializes duplicate earlier-link webhook handling against expiry and cancellation", async () => {
      const held = await paymentFixture("paid");
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      await db.update(schema.clients).set({ registrationPaymentAttemptKey: "new-attempt", stripePaymentLinkId: "new-link" }).where(eq(schema.clients.id, "client"));
      const outcomes = await Promise.all([
        flagLateReservationPayment(CYA, "client", "attempt", "plink_test"),
        flagLateReservationPayment(CYA, "client", "attempt", "plink_test"),
        settleReservation(held.reservation.id, CYA),
        settleReservation(held.reservation.id, CYA, true),
      ]);
      expect(outcomes.slice(0, 2)).toEqual([true, true]);
      expect(await latestReservation("client")).toMatchObject({ status: "payment_review", paymentAttemptKey: "attempt", paymentLinkId: "plink_test" });
      expect((await client()).assignedSlotId).toBe("slot");
      expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "activity_reservation_payment_review"))).toHaveLength(1);
      expect(await db.select().from(schema.bookingSnapshots)).toHaveLength(0);
    });
    it("converges concurrent current-link webhook reconciliation and expiry on one booking and charge", async () => {
      const held = await paymentFixture("paid");
      const [tenant] = await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA)).returning();
      const results = await Promise.all([
        reconcileRegistrationPayment(tenant, "client", "cs_test"),
        reconcileRegistrationPayment(tenant, "client", "cs_test"),
        settleReservation(held.reservation.id, CYA),
      ]);
      expect(results[0]).toMatchObject({ state: "recorded" });
      expect(results[1]).toMatchObject({ state: "recorded" });
      expect(await latestReservation("client")).toMatchObject({ status: "confirmed" });
      expect(await db.select().from(schema.bookingSnapshots)).toHaveLength(1);
      expect(await db.select().from(schema.paymentCharges)).toHaveLength(1);
    });
    it("rejects provider ownership mismatches and provider failure without releasing", async () => {
      const held = await paymentFixture("unpaid");
      await db.update(schema.tenants).set({ paymentReconciliationEnabled: reconciliation }).where(eq(schema.tenants.id, CYA));
      isolated.stripe.paymentLinks.retrieve.mockResolvedValueOnce({ metadata: { tenantId: OTHER, clientId: "client", registrationAttemptKey: "attempt" } });
      expect((await settleReservation(held.reservation.id, CYA, true))?.status).toBe("payment_check");
      expect(isolated.stripe.paymentLinks.update).not.toHaveBeenCalled();
      isolated.stripe.paymentLinks.retrieve.mockRejectedValueOnce(new Error("provider offline"));
      expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("payment_check");
      await expect(settleReservation(held.reservation.id, OTHER, true)).rejects.toMatchObject({ status: 404 });
      expect(await flagLateReservationPayment(OTHER, "client", "attempt", "plink_test")).toBe(false);
      expect((await client()).assignedSlotId).toBe("slot");
    });
  });
  it("releases a conflicting hold only after every recorded link is closed and unpaid, then allows a fresh booking", async () => {
    const held = await paymentFixture("unpaid");
    await db.update(schema.bookingReservations).set({ status: "payment_check" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.update(schema.clients).set({
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
      paymentStatus: "setup_pending",
    }).where(eq(schema.clients.id, "client"));
    const stripe = configureConflictStripe({ plink_test: "attempt", plink_current: "current-attempt" });
    const payload = {
      reservationId: held.reservation.id, decision: "release_unpaid", paymentLinkIds: [],
      reviewedAllAttempts: true,
    };
    const responses = await Promise.all([
      request("/api/clients/client/resolve-reservation-payment", payload),
      request("/api/clients/client/resolve-reservation-payment", payload),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const successful = await Promise.all(responses.filter(response => response.status === 200).map(response => response.json()));
    expect(successful[0]).toMatchObject({ status: "cancelled", resolved: true });
    expect(await latestReservation("client")).toMatchObject({ status: "cancelled", paymentAttemptKey: "attempt", paymentLinkId: "plink_test" });
    expect(await client()).toMatchObject({ stripePaymentLinkId: "plink_current", registrationPaymentAttemptKey: "current-attempt", assignedSlotId: null });
    expect(stripe.paymentLinks.update).toHaveBeenCalledTimes(2);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "activity_reservation_payment_conflict_resolution"))).toHaveLength(1);
    expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].isBooked).toBe(false);
    const fresh = await reserve("client", "slot-2");
    expect(fresh.reservation.status).toBe("active");
    expect(fresh.client.stripePaymentLinkId).toBeNull();
  });
  it("supports a deliberately supplied older Stripe link when the reservation's historic identity is missing", async () => {
    const held = await paymentFixture("unpaid");
    await db.update(schema.bookingReservations).set({ status: "payment_review", paymentAttemptKey: null, paymentLinkId: null })
      .where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.update(schema.clients).set({
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
      paymentStatus: "setup_pending",
    }).where(eq(schema.clients.id, "client"));
    configureConflictStripe({
      plink_current: "current-attempt", plink_historic: "historic-attempt",
    });
    const response = await request("/api/clients/client/resolve-reservation-payment", {
      reservationId: held.reservation.id, decision: "release_unpaid",
      paymentLinkIds: ["plink_historic"], reviewedAllAttempts: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "cancelled", resolved: true });
    expect(await latestReservation("client")).toMatchObject({
      status: "cancelled", paymentAttemptKey: null, paymentLinkId: null,
    });
    const [log] = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "activity_reservation_payment_conflict_resolution"));
    expect(log).toMatchObject({ userId: "admin" });
    expect(log.details).toMatchObject({
      decision: "release_unpaid", result: "released_unpaid",
      additionalPaymentLinkIds: ["plink_historic"],
    });
  });
  it("records and confirms exactly one tenant-verified payment without replacing the hold's original identity", async () => {
    const held = await paymentFixture("paid");
    await db.update(schema.bookingReservations).set({ status: "payment_review" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.update(schema.clients).set({
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
      paymentStatus: "setup_pending",
    }).where(eq(schema.clients.id, "client"));
    const oldMetadata = { tenantId: CYA, clientId: "client", registrationAttemptKey: "attempt" };
    const paidSession = {
      id: "cs_original", payment_link: "plink_test", metadata: oldMetadata,
      status: "complete", payment_status: "paid", payment_intent: "pi_original",
      amount_total: 10000, currency: "gbp", customer: null,
    };
    configureConflictStripe(
      { plink_test: "attempt", plink_current: "current-attempt" },
      { plink_test: [paidSession] },
      { pi_original: {
        id: "pi_original", status: "succeeded", amount_received: 10000, amount: 10000,
        currency: "gbp", metadata: oldMetadata, payment_method: null, latest_charge: "ch_original",
      } },
    );
    const response = await request("/api/clients/client/resolve-reservation-payment", {
      reservationId: held.reservation.id, decision: "confirm_verified_payment",
      paymentLinkIds: [], reviewedAllAttempts: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "confirmed", resolved: true });
    expect(await latestReservation("client")).toMatchObject({
      status: "confirmed", paymentAttemptKey: "attempt", paymentLinkId: "plink_test",
    });
    expect(await client()).toMatchObject({
      status: "Scheduled", paymentStatus: "active",
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
    });
    expect(await db.select().from(schema.paymentCharges)).toMatchObject([
      { stripePaymentIntentId: "pi_original", amountPence: 10000, status: "succeeded", tenantId: CYA },
    ]);
    expect(await db.select().from(schema.bookingSnapshots)).toHaveLength(1);
    const [log] = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "activity_reservation_payment_conflict_resolution"));
    expect(log.details).toMatchObject({
      decision: "confirm_verified_payment", result: "payment_verified", paymentIntentId: "pi_original",
      inspectedPaymentLinks: [
        { paymentLinkId: "plink_test", attemptKey: "attempt" },
        { paymentLinkId: "plink_current", attemptKey: "current-attempt" },
      ],
      inspectedSessionIds: ["cs_original"], inspectedPaymentIntentIds: ["pi_original"],
    });
  });
  it.each(["refunded", "disputed"] as const)("does not confirm a %s payment as a valid reservation payment", async paymentIssue => {
    const held = await paymentFixture("paid");
    await db.update(schema.bookingReservations).set({ status: "payment_review" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.update(schema.clients).set({
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
      paymentStatus: "setup_pending",
    }).where(eq(schema.clients.id, "client"));
    const metadata = { tenantId: CYA, clientId: "client", registrationAttemptKey: "attempt" };
    const stripe = configureConflictStripe(
      { plink_test: "attempt", plink_current: "current-attempt" },
      { plink_test: [{
        id: "cs_review", payment_link: "plink_test", metadata,
        status: "complete", payment_status: "paid", payment_intent: "pi_review",
        amount_total: 10000, currency: "gbp", customer: null,
      }] },
      { pi_review: {
        id: "pi_review", status: "succeeded", amount_received: 10000, amount: 10000,
        currency: "gbp", metadata, payment_method: null, latest_charge: "ch_review",
      } },
    );
    stripe.charges.retrieve.mockResolvedValueOnce({
      id: "ch_review", payment_intent: "pi_review", paid: true, captured: true,
      amount_captured: 10000, currency: "gbp",
      amount_refunded: paymentIssue === "refunded" ? 10000 : 0,
      refunded: paymentIssue === "refunded", disputed: paymentIssue === "disputed",
    } as any);
    const response = await request("/api/clients/client/resolve-reservation-payment", {
      reservationId: held.reservation.id, decision: "confirm_verified_payment",
      paymentLinkIds: [], reviewedAllAttempts: true,
    });
    expect(await response.json()).toMatchObject({ status: "payment_review", resolved: false });
    expect(await db.select().from(schema.paymentCharges)).toHaveLength(0);
    expect(await db.select().from(schema.bookingSnapshots)).toHaveLength(0);
    expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].isBooked).toBe(true);
  });
  it("keeps the slot reserved when a Checkout Session completes while Stripe is expiring it", async () => {
    const held = await paymentFixture("unpaid");
    await db.update(schema.bookingReservations).set({ status: "payment_check" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.update(schema.clients).set({
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
      paymentStatus: "setup_pending",
    }).where(eq(schema.clients.id, "client"));
    const metadata = { tenantId: CYA, clientId: "client", registrationAttemptKey: "attempt" };
    const racedSession = {
      id: "cs_race", payment_link: "plink_test", metadata,
      status: "open", payment_status: "unpaid", payment_intent: "pi_race",
      amount_total: 10000, currency: "gbp", customer: null,
    };
    const stripe = configureConflictStripe(
      { plink_test: "attempt", plink_current: "current-attempt" },
      { plink_test: [racedSession] },
      { pi_race: {
        id: "pi_race", status: "succeeded", amount_received: 10000, amount: 10000,
        currency: "gbp", metadata, payment_method: null, latest_charge: "ch_race",
      } },
      true,
    );
    const response = await request("/api/clients/client/resolve-reservation-payment", {
      reservationId: held.reservation.id, decision: "release_unpaid", paymentLinkIds: [],
      reviewedAllAttempts: true,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "payment_review", resolved: false });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_race");
    expect(await latestReservation("client")).toMatchObject({ status: "payment_review" });
    expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].isBooked).toBe(true);
    expect(await db.select().from(schema.paymentCharges)).toHaveLength(0);
  });
  it("rejects clinicians and other practices from reservation conflict resolution", async () => {
    const held = await paymentFixture("unpaid");
    await db.update(schema.bookingReservations).set({ status: "payment_check" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    const payload = {
      reservationId: held.reservation.id, decision: "release_unpaid", paymentLinkIds: [],
      reviewedAllAttempts: true,
    };
    expect((await request("/api/clients/client/resolve-reservation-payment", payload, CYA, false)).status).toBe(403);
    expect((await request("/api/clients/client/resolve-reservation-payment", payload, OTHER)).status).toBe(404);
    expect(isolated.stripe.paymentLinks.retrieve).not.toHaveBeenCalled();
  });
  it("does not offer reservation conflict resolution for a late-payment alert", async () => {
    const held = await paymentFixture("paid");
    await db.update(schema.clients).set({
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
    }).where(eq(schema.clients.id, "client"));
    expect(await flagLateReservationPayment(CYA, "client", "attempt", "plink_test")).toBe(true);
    const response = await request("/api/booking-reservations");
    const [summary] = await response.json();
    expect(summary).toMatchObject({ id: held.reservation.id, status: "payment_review", canResolvePaymentConflict: false });
  });
  it("does not release an unpaid decision if any payment intent is still processing", async () => {
    const held = await paymentFixture("unpaid");
    await db.update(schema.bookingReservations).set({ status: "payment_check" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.update(schema.clients).set({
      registrationPaymentAttemptKey: "current-attempt", stripePaymentLinkId: "plink_current",
      paymentStatus: "setup_pending",
    }).where(eq(schema.clients.id, "client"));
    const metadata = { tenantId: CYA, clientId: "client", registrationAttemptKey: "attempt" };
    configureConflictStripe(
      { plink_test: "attempt", plink_current: "current-attempt" },
      { plink_test: [{
        id: "cs_processing", payment_link: "plink_test", metadata,
        status: "complete", payment_status: "unpaid", payment_intent: "pi_processing",
        amount_total: 10000, currency: "gbp", customer: null,
      }] },
      { pi_processing: {
        id: "pi_processing", status: "processing", amount_received: 0, amount: 10000,
        currency: "gbp", metadata, payment_method: null,
      } },
    );
    const response = await request("/api/clients/client/resolve-reservation-payment", {
      reservationId: held.reservation.id, decision: "release_unpaid", paymentLinkIds: [],
      reviewedAllAttempts: true,
    });
    expect(await response.json()).toMatchObject({ status: "payment_review", resolved: false });
    expect(await latestReservation("client")).toMatchObject({ status: "payment_review" });
    expect((await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot")))[0].isBooked).toBe(true);
  });
  it("disables the link and expires open Stripe sessions before releasing an unpaid slot", async () => {
    const held = await paymentFixture("unpaid");
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("expired");
    expect(isolated.stripe.paymentLinks.update).toHaveBeenCalledWith("plink_test", { active: false });
    expect(isolated.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_test");
    expect((await client()).assignedSlotId).toBeNull();
  });
  it.each(["paid", "race"] as const)("preserves and confirms a %s payment despite expiry", async outcome => {
    const held = await paymentFixture(outcome);
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("confirmed");
    expect((await client()).paymentStatus).toBe("active");
    expect((await db.select().from(schema.bookingSnapshots))).toHaveLength(1);
    expect((await db.select().from(schema.paymentCharges))).toHaveLength(1);
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("confirmed");
  });
  it("never releases a processing payment", async () => {
    const held = await paymentFixture("processing");
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("payment_check");
    expect((await client()).assignedSlotId).toBe("slot");
    expect((await db.select().from(schema.bookingSnapshots))).toHaveLength(0);
  });
  it("returns a phone intake client to their actual previous stage, not fabricated completed intake", async () => {
    await db.update(schema.clients).set({ status: "New" }).where(eq(schema.clients.id, "client"));
    const held = await reserve();
    await settleReservation(held.reservation.id, CYA, true);
    expect((await client()).status).toBe("New");
  });
  it("confirms completed insurer registration once and never expires its retired slot", async () => {
    const held = await reserve();
    // Real registration pins its workflow attempt even when no Stripe link is needed.
    await db.update(schema.bookingReservations).set({ paymentAttemptKey: "insurer-registration" }).where(eq(schema.bookingReservations.id, held.reservation.id));
    await db.insert(schema.formSubmissions).values({ id: "submitted", clientId: "client", tenantId: CYA, responses: {}, isDraft: false });
    await db.update(schema.clients).set({ registrationPaymentAttemptKey: "insurer-registration", paymentType: "insurer", registrationFormSubmissionId: "submitted", termsAcceptedAt: new Date(), status: "RegistrationPending" }).where(eq(schema.clients.id, "client"));
    const result = await confirmBooking({ clientId: "client", tenantId: CYA, source: "registration" });
    expect(result.newlyConfirmed).toBe(true);
    expect((await latestReservation("client"))?.status).toBe("confirmed");
    await overdue(held.reservation.id);
    expect((await settleReservation(held.reservation.id, CYA))?.status).toBe("confirmed");
    expect((await db.select().from(schema.bookingSnapshots))).toHaveLength(1);
    const [slot] = await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, "slot"));
    expect(slot.retiredAt).toBeTruthy();
  });
  it("sends live clinician scope without reserving all choices, then selects atomically", async () => {
    expect((await request("/api/clients/client/clinician-invitation", { clinicianIds: ["clinician"] })).status).toBe(200);
    const [inv] = await db.select().from(schema.clinicianInvitations);
    expect((await db.select().from(schema.bookingReservations))).toHaveLength(0);
    await db.insert(schema.timeSlots).values({ id: "new-slot", clinicianId: "clinician", type: "Recurring", day: "Friday", startTime: "12:00", endTime: "13:00", tenantId: CYA });
    const data = await (await request(`/api/public/booking/${inv.token}`)).json();
    expect(data.clinicians[0].slots.map((slot: any) => slot.id)).toContain("new-slot");
    expect(data.clinicians).toHaveLength(1);
    expect((await request(`/api/public/booking/${inv.token}`, { clinicianId: "other-clinician", slotId: "other-slot" })).status).toBe(410);
    const selected = await request(`/api/public/booking/${inv.token}`, { clinicianId: "clinician", slotId: "new-slot" });
    expect(selected.status).toBe(200);
    const { registrationUrl } = await selected.json();
    expect(registrationUrl).toContain("/register/client/");
    const resumed = await request(`/api/public/booking/${inv.token}`);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ status: "selected", registrationUrl });
    const hold = (await latestReservation("client"))!;
    expect(hold.route).toBe("online");
    await overdue(hold.id);
    expect((await request(`/api/public/booking/${inv.token}`)).status).toBe(410);
  });
  it("does not activate uncertain delivery and retries the same invitation without duplication", async () => {
    isolated.failMail = true;
    expect((await request("/api/clients/client/clinician-invitation", { clinicianIds: ["clinician"] })).status).toBe(502);
    const [inv] = await db.select().from(schema.clinicianInvitations);
    expect((await request(`/api/public/booking/${inv.token}`)).status).toBe(410);
    isolated.failMail = false;
    expect((await request("/api/clients/client/clinician-invitation", { clinicianIds: ["clinician"] })).status).toBe(200);
    expect((await db.select().from(schema.clinicianInvitations))).toHaveLength(1);
  });
  it("serializes decline versus selection so a closed invitation cannot reserve a slot", async () => {
    await request("/api/clients/client/clinician-invitation", { clinicianIds: ["clinician"] });
    const [inv] = await db.select().from(schema.clinicianInvitations);
    expect((await request(`/api/public/booking/${inv.token}`, { decline: true })).status).toBe(200);
    expect((await request(`/api/public/booking/${inv.token}`, { clinicianId: "clinician", slotId: "slot" })).status).toBe(410);
    expect((await client()).needsAdminCall).toBe(true);
  });
  it("fences a late old payment away from a newer reservation", async () => {
    const old = await reserve();
    await settleReservation(old.reservation.id, CYA, true);
    // Historical evidence is immutable, separate from a new hold.
    await db.update(schema.bookingReservations).set({ paymentAttemptKey: "old-attempt", paymentLinkId: "old-link" }).where(eq(schema.bookingReservations.id, old.reservation.id));
    const fresh = await reserve("client", "slot-2");
    expect(await flagLateReservationPayment(CYA, "client", "old-attempt", "old-link")).toBe(true);
    expect((await latestReservation("client"))?.id).toBe(fresh.reservation.id);
    expect((await client()).assignedSlotId).toBe("slot-2");
    expect((await db.select().from(schema.bookingSnapshots))).toHaveLength(0);
  });
});
