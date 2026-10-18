import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { CYA_PSYCHOLOGY_TENANT_ID as CYA } from "@shared/practicePolicies";
import { reservationDeadline, validReservationHours } from "@shared/reservationPolicy";

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
import { latestReservation, settleReservation, assertReservationOpen, flagLateReservationPayment } from "./reservationLifecycle";
import { confirmBooking } from "./bookingConfirmation";

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
    { id: CYA, name: "Test Practice", flexibleBookingEnabled: true, multiClinicianAllocationEnabled: true, registrationFormEnabled: true, registrationFormTemplateId: "registration", oneOffSlotsEnabled: true },
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

describe("flexible booking with actual PostgreSQL ownership", () => {
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
    await db.insert(schema.formSubmissions).values({ id: "submitted", clientId: "client", tenantId: CYA, responses: {}, isDraft: false });
    await db.update(schema.clients).set({ paymentType: "insurer", registrationFormSubmissionId: "submitted", termsAcceptedAt: new Date(), status: "RegistrationPending" }).where(eq(schema.clients.id, "client"));
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
    await db.update(schema.bookingReservations).set({ paymentAttemptKey: "old-attempt", paymentLinkId: "old-link" }).where(eq(schema.bookingReservations.id, old.reservation.id));
    await settleReservation(old.reservation.id, CYA, true);
    // Settlement copies current client attempt ownership.
    await db.update(schema.bookingReservations).set({ paymentAttemptKey: "old-attempt", paymentLinkId: "old-link" }).where(eq(schema.bookingReservations.id, old.reservation.id));
    const fresh = await reserve("client", "slot-2");
    expect(await flagLateReservationPayment(CYA, "client", "old-attempt", "old-link")).toBe(true);
    expect((await latestReservation("client"))?.id).toBe(fresh.reservation.id);
    expect((await client()).assignedSlotId).toBe("slot-2");
    expect((await db.select().from(schema.bookingSnapshots))).toHaveLength(0);
  });
});
