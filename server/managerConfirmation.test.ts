import express from "express";
import { createServer, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const f = vi.hoisted(() => ({
  settings: null as any,
  users: [] as any[],
  client: null as any,
  options: [] as any[],
  audit: [] as any[],
  auditFails: false,
  slots: [] as any[],
  clinicians: [] as any[],
}));
vi.mock("./auth", () => ({
  hashPassword: vi.fn(async (value: string) => `fixture-hash:${value}`),
  comparePasswords: vi.fn(async (value: string, hash: string) => hash === `fixture-hash:${value}`),
  requireAdmin: (req: any, res: any, next: any) => {
    if (req.headers["x-role"] === "clinician") return res.status(403).json({ error: "Admin required" });
    req.tenant = { id: req.headers["x-tenant"] || "tenant-a" };
    req.user = { id: req.headers["x-user"] || "manager-1", role: "admin" };
    next();
  },
}));
vi.mock("./db", () => {
  const name = (table: any) => {
    const symbol = Object.getOwnPropertySymbols(table).find(s => s.description === "drizzle:Name");
    return symbol ? table[symbol] : "";
  };
  let tail = Promise.resolve();
  const tx: any = {
    execute: vi.fn(async () => []),
    select: () => ({
      from(table: any) {
        let predicate: any;
        const read = () => {
           const { sql, params } = new PgDialect().sqlToQuery(predicate);
          const tenant = params.find(value => typeof value === "string" && value.startsWith("tenant-"));
          if (name(table) === "manager_confirmation_settings") return f.settings?.tenantId === tenant ? [f.settings] : [];
          if (name(table) === "users") {
            const ids = params.filter(value => typeof value === "string" && /^(manager|ordinary|clinician|foreign)-/.test(value));
            return f.users.filter(user => user.tenantId === tenant
              && (!ids.length || ids.includes(user.id))
              && (!params.includes("admin") || user.role === "admin"));
          }
           if (name(table) === "clients") {
             if (!f.client || (tenant && f.client.tenantId !== tenant)) return [];
             if (!params.includes(f.client.id) && !params.includes(f.client.assignedSlotId)) return [];
             if (sql.includes('"clients"."status" in') && !params.includes(f.client.status)) return [];
             if (sql.includes('"clinicians"."id"') && !f.clinicians.some(clinician =>
               clinician.id === f.client.assignedClinicianId && clinician.tenantId === f.client.tenantId)) return [];
             return [f.client];
           }
           if (name(table) === "time_slots") return f.slots.filter(slot =>
             (!sql.includes('"time_slots"."id" =') || params.includes(slot.id))
             && (!sql.includes('"time_slots"."clinician_id" =') || params.includes(slot.clinicianId))
             && (!tenant || slot.tenantId === tenant || slot.tenantId == null)
             && (!sql.includes('"time_slots"."retired_at" is null') || slot.retiredAt == null));
          return [];
        };
        const query: any = {
          where(next: any) { predicate = next; return query; },
           innerJoin() { return query; },
          for() { return query; },
          limit: async () => structuredClone(read()),
          then: (resolve: any, reject: any) => Promise.resolve(structuredClone(read())).then(resolve, reject),
        };
        return query;
      },
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: async (predicate: any) => {
          const { params } = new PgDialect().sqlToQuery(predicate);
          if (name(table) === "manager_confirmation_settings") Object.assign(f.settings, patch);
          if (name(table) === "clients" && params.includes(f.client.id) && params.includes(f.client.tenantId))
            Object.assign(f.client, patch);
           if (name(table) === "clinicians") for (const clinician of f.clinicians) {
             if (params.includes(clinician.id)) Object.assign(clinician, patch);
           }
           if (name(table) === "time_slots") for (const slot of f.slots) {
             if (params.includes(slot.id)) Object.assign(slot, patch);
           }
          if (name(table) === "client_clinician_options") for (const option of f.options) {
            if (params.includes(option.clientId) && params.includes(option.tenantId)
              && ["pending", "selected"].includes(option.status)) Object.assign(option, patch);
          }
        },
      }),
    }),
    insert: (table: any) => ({
      values: (row: any) => {
        const write = async () => {
          if (name(table) === "manager_confirmation_settings") f.settings = structuredClone(row);
          if (name(table) === "audit_logs") {
            if (f.auditFails) throw new Error("Audit store unavailable");
            f.audit.push(structuredClone(row));
          }
          if (name(table) === "time_slots") {
            const rows = structuredClone(Array.isArray(row) ? row : [row]);
            f.slots.push(...rows);
            return rows;
          }
          return [];
        };
        return { then: (resolve: any, reject: any) => write().then(resolve, reject), returning: write };
      },
    }),
  };
  return { db: {
    select: tx.select,
     insert: tx.insert,
     update: tx.update,
    transaction: async (fn: any) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
       const backup = structuredClone({ settings: f.settings, client: f.client, options: f.options, audit: f.audit,
         slots: f.slots, clinicians: f.clinicians });
      try { return await fn(tx); } catch (error) {
        Object.assign(f, backup);
        throw error;
      } finally { release(); }
    },
  } };
});

import {
  getManagerConfirmationAccess, managerConfirmationInput, managerConfirmClient,
  registerManagerConfirmationRoutes, saveManagerConfirmationSettings,
} from "./managerConfirmation";
import { insertClientSchema } from "@shared/schema";
import { DatabaseStorage, SlotRetirementConflictError } from "./storage";
import { confirmedSlotRetirementCopy, slotRetirementConflictCopy } from "@shared/slotRetirementCopy";

const identity = { tenantId: "tenant-a", userId: "manager-1", ip: null };
const input = { pin: "864209", reason: "Appointment verified in the practice records; historical portal evidence is incomplete." };
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  f.users = [
    { id: "manager-1", tenantId: "tenant-a", role: "admin", name: "Manager Fixture", password: "fixture-hash:account-fixture" },
    { id: "ordinary-1", tenantId: "tenant-a", role: "admin", name: "Admin Fixture" },
    { id: "clinician-1", tenantId: "tenant-a", role: "clinician" },
    { id: "foreign-1", tenantId: "tenant-b", role: "admin" },
  ];
  f.settings = {
    tenantId: "tenant-a", pinHash: "fixture-hash:864209", managerUserIds: ["manager-1"],
    failedPinAttempts: {}, updatedAt: new Date("2026-10-01T12:00:00Z"),
  };
  f.client = {
    id: "client-a", tenantId: "tenant-a", displayId: "WU-FIXTURE", status: "RegistrationPending",
    isArchived: false, completedAt: null, confirmedAt: null, managerConfirmedAt: null,
    paymentStatus: "setup_pending", registrationFormSubmissionId: null, termsAcceptedAt: null,
    assignedSlotId: "slot-a", assignedClinicianId: "clinician-a", agreedRatePence: 20000,
    registrationToken: "registration-fixture", registrationEmailClaimId: "claim-fixture",
  };
  f.options = [
    { clientId: "client-a", tenantId: "tenant-a", status: "selected" },
    { clientId: "client-a", tenantId: "tenant-b", status: "pending" },
  ];
  f.audit = [];
  f.auditFails = false;
  f.slots = [];
  f.clinicians = [];
  const app = express();
  app.use(express.json());
  registerManagerConfirmationRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("manager confirmation authority and audit", () => {
  it.each([false, true])("allows explicit fresh availability after manager confirmation, preserving the old booking (retired=%s)", async retired => {
    const oldSlot = {
      id: "slot-a", clinicianId: "clinician-a", tenantId: "tenant-a", type: "Recurring" as const,
      day: "Wednesday", date: null, startDate: "2026-10-07", endDate: null,
      startTime: "11:00", endTime: "12:00", isBooked: false, batchId: null,
      frequency: "weekly" as const, isOngoing: true, locationType: "online" as const,
      retiredAt: retired ? new Date("2026-10-17T12:00:00Z") : null, retirementReason: retired ? "Appointment confirmed" : null,
    };
    f.slots = [structuredClone(oldSlot)];
    f.clinicians = [{ id: "clinician-a", tenantId: "tenant-a" }];
    const response = await fetch(`${baseUrl}/api/clients/client-a/manager-confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    const confirmedClient = structuredClone(f.client);
    const audit = structuredClone(f.audit);
    const options = structuredClone(f.options);
    const storage = new DatabaseStorage();
    // The same read feeds calendar display and the add-availability duplicate check.
    expect(await storage.getTimeSlotsByClinicianId("clinician-a")).toEqual([]);
    expect(f.slots).toEqual([oldSlot]); // Confirmation must not automatically re-list time.
    await expect(storage.deleteTimeSlotById("slot-a", "tenant-a")).rejects.toMatchObject({
      message: confirmedSlotRetirementCopy, clientIds: ["client-a"],
    });
    const { id: _oldId, ...newAvailability } = oldSlot;
    const added = await storage.addTimeSlots("clinician-a", [{
      ...newAvailability, startDate: "2026-10-21", retiredAt: null, retirementReason: null,
    }], "tenant-a");
    expect(added).toHaveLength(1);
    expect(added[0].id).not.toBe("slot-a");
    expect(added[0]).toMatchObject({ day: "Wednesday", startTime: "11:00", endTime: "12:00", isBooked: false });
    expect(await storage.getTimeSlotsByClinicianId("clinician-a")).toEqual(added);
    expect(f.slots[0]).toEqual(oldSlot);
    expect(f.client).toEqual(confirmedClient);
    expect(f.audit).toEqual(audit);
    expect(f.options).toEqual(options);
  });

  it.each(["Assigned", "OptionSelected", "RegistrationPending", "AwaitingConfirmation"])(
    "keeps the blocking warning for a genuinely pending %s reservation", async status => {
      f.client.status = status;
      f.slots = [{ id: "slot-a", clinicianId: "clinician-a", tenantId: "tenant-a", retiredAt: null }];
      const before = structuredClone({ client: f.client, slots: f.slots });
      const storage = new DatabaseStorage();
      await expect(storage.deleteTimeSlotById("slot-a", "tenant-a")).rejects.toMatchObject({
        message: slotRetirementConflictCopy([status]), clientIds: ["client-a"],
      });
      expect({ client: f.client, slots: f.slots }).toEqual(before);
    },
  );

  it("does not suggest re-listing when any owner still has a pending reservation", () => {
    expect(new SlotRetirementConflictError(["confirmed", "pending"], ["Scheduled", "RegistrationPending"]).message)
      .not.toContain("Add Availability");
    expect(slotRetirementConflictCopy([])).not.toContain("Add Availability");
    expect(slotRetirementConflictCopy(["BookingConfirmed"])).toBe(confirmedSlotRetirementCopy);
  });
  it("requires a valid PIN and reason, and rejects extra evidence fields", () => {
    expect(managerConfirmationInput.safeParse(input).success).toBe(true);
    expect(managerConfirmationInput.safeParse({ ...input, pin: "123" }).success).toBe(false);
    expect(managerConfirmationInput.safeParse({ ...input, reason: "done" }).success).toBe(false);
    expect(managerConfirmationInput.safeParse({ ...input, paymentStatus: "active" }).success).toBe(false);
  });

  it("does not expose hashes or failure counters through the settings API", async () => {
    const result = await getManagerConfirmationAccess("tenant-a", "manager-1");
    expect(result).toMatchObject({ configured: true, canOverride: true, canConfigure: true });
    expect(JSON.stringify(result)).not.toContain("864209");
    expect(result).not.toHaveProperty("pinHash");
    expect(result).not.toHaveProperty("failedPinAttempts");
    expect(await getManagerConfirmationAccess("tenant-a", "ordinary-1")).toMatchObject({ canOverride: false, canConfigure: false });
  });

  it.each(["New", "Forms Completed", "OptionSelected", "RegistrationPending", "AwaitingConfirmation", "Awaiting Confirmation"])(
    "confirms %s without synthesising payment, registration or booking evidence", async status => {
      f.client.status = status;
      const original = structuredClone(f.client);
      expect(await managerConfirmClient(identity, "client-a", input)).toMatchObject({
        confirmed: true, alreadyConfirmed: false, status: "Scheduled",
      });
      expect(f.client).toMatchObject({
        status: "Scheduled", managerConfirmedBy: "manager-1", managerConfirmationReason: input.reason,
        paymentStatus: original.paymentStatus, registrationFormSubmissionId: null, termsAcceptedAt: null,
        assignedSlotId: original.assignedSlotId, assignedClinicianId: original.assignedClinicianId,
        registrationToken: null, registrationEmailClaimId: null,
      });
      expect(f.client.managerConfirmedAt).toBeInstanceOf(Date);
      expect(f.options.map(option => option.status)).toEqual(["unavailable", "pending"]);
      expect(f.audit).toHaveLength(1);
      expect(f.audit[0]).toMatchObject({
        userId: "manager-1", action: "activity_manager_client_confirmed",
        details: { oldStatus: status, managerName: "Manager Fixture", reason: input.reason, paymentStatusAtOverride: "setup_pending" },
      });
      expect(JSON.stringify(f.audit)).not.toContain("864209");
      expect(f.client).not.toHaveProperty("bookingSnapshot");
      expect(f.client).not.toHaveProperty("bookingConfirmationSentAt");
    },
  );

  it("is idempotent for repeated and simultaneous requests", async () => {
    const results = await Promise.all([managerConfirmClient(identity, "client-a", input), managerConfirmClient(identity, "client-a", input)]);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ alreadyConfirmed: false }), expect.objectContaining({ alreadyConfirmed: true }),
    ]));
    expect(f.audit).toHaveLength(1);
  });

  it.each([
    { ...identity, userId: "ordinary-1" },
    { ...identity, userId: "foreign-1" },
    { ...identity, tenantId: "tenant-b" },
  ])("denies unselected or foreign accounts even with the correct PIN", async actor => {
    expect(await managerConfirmClient(actor, "client-a", input)).toMatchObject({ status: 403 });
    expect(f.client.status).toBe("RegistrationPending");
    expect(f.audit).toEqual([]);
  });

  it("checks the selected account's current role", async () => {
    f.users[0].role = "clinician";
    expect(await managerConfirmClient(identity, "client-a", input)).toMatchObject({ status: 403 });
  });

  it("cannot update another practice's client", async () => {
    f.client.tenantId = "tenant-b";
    expect(await managerConfirmClient(identity, "client-a", input)).toMatchObject({ status: 404 });
    expect(f.audit).toEqual([]);
  });

  it.each([{ isArchived: true }, { completedAt: new Date() }])("requires reopening inactive records", async patch => {
    Object.assign(f.client, patch);
    expect(await managerConfirmClient(identity, "client-a", input)).toMatchObject({ status: 409 });
  });

  it("persists failed PIN attempts and locks after five, without affecting another manager", async () => {
    for (let i = 0; i < 5; i++) await managerConfirmClient(identity, "client-a", { ...input, pin: "000000" });
    expect(f.settings.failedPinAttempts["manager-1"].count).toBe(5);
    expect(await managerConfirmClient(identity, "client-a", input)).toMatchObject({ status: 429 });
    expect(f.client.status).toBe("RegistrationPending");
    f.settings.managerUserIds.push("ordinary-1");
    expect(await managerConfirmClient({ ...identity, userId: "ordinary-1" }, "client-a", input)).toMatchObject({ confirmed: true });
  });

  it("permits retry after lock expiry and resets the counter on success", async () => {
    f.settings.failedPinAttempts["manager-1"] = { count: 5, lockedUntil: new Date(Date.now() - 1000).toISOString() };
    expect(await managerConfirmClient(identity, "client-a", input)).toMatchObject({ confirmed: true });
    expect(f.settings.failedPinAttempts["manager-1"]).toEqual({ count: 0, lockedUntil: null });
  });

  it("rolls back the client and options if the audit cannot be saved", async () => {
    const original = structuredClone(f.client);
    f.auditFails = true;
    await expect(managerConfirmClient(identity, "client-a", input)).rejects.toThrow("Audit store unavailable");
    expect(f.client).toEqual(original);
    expect(f.options[0].status).toBe("selected");
  });

  it("requires selected-manager authority and password re-entry to change permissions", async () => {
    const settingsInput = {
      currentPassword: "account-fixture", managerUserIds: ["manager-1", "ordinary-1"],
      expectedUpdatedAt: f.settings.updatedAt.toISOString(),
    };
    expect(await saveManagerConfirmationSettings({ ...identity, userId: "ordinary-1" }, settingsInput)).toMatchObject({ status: 403 });
    expect(await saveManagerConfirmationSettings(identity, { ...settingsInput, currentPassword: "incorrect" })).toMatchObject({ status: 403 });
    expect(await saveManagerConfirmationSettings(identity, settingsInput)).toEqual({ saved: true });
    expect(f.settings.managerUserIds).toEqual(["manager-1", "ordinary-1"]);
  });

  it("rejects stale settings and foreign or clinician selections", async () => {
    const settingsInput = { currentPassword: "account-fixture", managerUserIds: ["manager-1"], expectedUpdatedAt: f.settings.updatedAt.toISOString() };
    expect(await saveManagerConfirmationSettings(identity, { ...settingsInput, expectedUpdatedAt: null })).toMatchObject({ status: 409 });
    for (const id of ["foreign-1", "clinician-1"]) {
      expect(await saveManagerConfirmationSettings(identity, { ...settingsInput, managerUserIds: ["manager-1", id] })).toMatchObject({ status: 400 });
    }
  });

  it("revokes authority immediately even if the account still has the correct PIN", async () => {
    f.settings.managerUserIds.push("ordinary-1");
    expect(await saveManagerConfirmationSettings(identity, {
      currentPassword: "account-fixture", managerUserIds: ["manager-1"],
      expectedUpdatedAt: f.settings.updatedAt.toISOString(),
    })).toEqual({ saved: true });
    expect(await managerConfirmClient({ ...identity, userId: "ordinary-1" }, "client-a", input))
      .toMatchObject({ status: 403 });
    expect(f.client.status).toBe("RegistrationPending");
  });

  it("bootstraps a hashed PIN with the configuring admin included and supports rotation", async () => {
    f.settings = null;
    const settingsInput = { currentPassword: "account-fixture", newPin: "777888", managerUserIds: ["manager-1"], expectedUpdatedAt: null };
    expect(await saveManagerConfirmationSettings(identity, { ...settingsInput, managerUserIds: ["ordinary-1"] })).toMatchObject({ status: 400 });
    expect(await saveManagerConfirmationSettings(identity, settingsInput)).toEqual({ saved: true });
    expect(f.settings.pinHash).toBe("fixture-hash:777888");
    expect(JSON.stringify(f.audit)).not.toContain("777888");
    expect(await managerConfirmClient(identity, "client-a", input)).toMatchObject({ status: 403 });
    expect(await managerConfirmClient(identity, "client-a", { ...input, pin: "777888" })).toMatchObject({ confirmed: true });
  });

  it("protects manager metadata against ordinary client-create input", () => {
    const fields = insertClientSchema.shape;
    expect(fields).not.toHaveProperty("managerConfirmedAt");
    expect(fields).not.toHaveProperty("managerConfirmedBy");
    expect(fields).not.toHaveProperty("managerConfirmationReason");
  });

  it("enforces admin authentication and validation in the HTTP endpoint", async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${baseUrl}/api/clients/client-a/manager-confirm`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
    });
    expect((await post(input, { "x-role": "clinician" })).status).toBe(403);
    expect((await post(input, { "x-user": "ordinary-1" })).status).toBe(403);
    expect((await post({ pin: "123456" })).status).toBe(400);
    expect((await post(input)).status).toBe(200);
  });
});
