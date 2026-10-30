import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { confirmedSlotRetirementCopy } from "@shared/slotRetirementCopy";

const h = vi.hoisted(() => ({ state: {} as any, failAudit: false }));
vi.mock("./db", () => {
  let tail = Promise.resolve();
  const tableName = (table: any) => table[Object.getOwnPropertySymbols(table).find(s => s.description === "drizzle:Name")!];
  const matches = (row: any, predicate: any) => {
    const { sql, params } = new PgDialect().sqlToQuery(predicate);
    const value = (column: string) => row[column.replace(/_([a-z])/g, (_, char) => char.toUpperCase())];
    for (const match of sql.matchAll(/"[^"]+"\."([^"]+)"\s*=\s*\$(\d+)/g)) {
      if (value(match[1]) !== params[Number(match[2]) - 1]) return false;
    }
    for (const match of sql.matchAll(/"[^"]+"\."([^"]+)"\s+in\s*\(([^)]*)\)/gi)) {
      const allowed = [...match[2].matchAll(/\$(\d+)/g)].map(m => params[Number(m[1]) - 1]);
      if (!allowed.includes(value(match[1]))) return false;
    }
    return true;
  };
  return { db: { transaction: (callback: any) => {
    const result = tail.then(async () => {
      const draft = structuredClone(h.state);
      const tx = {
        select: () => ({ from: (table: any) => {
          let predicate: any;
          let max = Infinity;
          const query: any = {
            where: (condition: any) => { predicate = condition; return query; },
            for: () => query,
            limit: (count: number) => { max = count; return query; },
            then: (resolve: any, reject: any) => Promise.resolve(
              draft[tableName(table)].filter((row: any) => matches(row, predicate)).slice(0, max),
            ).then(resolve, reject),
          };
          return query;
        } }),
        update: (table: any) => ({ set: (patch: any) => ({ where: async (predicate: any) => {
          for (const row of draft[tableName(table)]) if (matches(row, predicate)) Object.assign(row, patch);
        } }) }),
        insert: (table: any) => ({ values: async (row: any) => {
          if (h.failAudit) throw new Error("audit write failed");
          draft[tableName(table)].push(row);
        } }),
      };
      const output = await callback(tx);
      h.state = draft;
      return output;
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  } } };
});

import { writeuppSlotRetirement } from "./writeuppSlotRetirement";

const input = { tenantId: "practice-a", clinicianId: "clinician-a", slotId: "slot-a" };
const confirm = () => writeuppSlotRetirement({ ...input, confirm: true, expectedClientId: "client-a", actorId: "admin-a" });

it.each([
  ["Scheduled", false], ["Scheduled", true], ["BookingConfirmed", false], ["BookingConfirmed", true],
])("explains re-listing confirmed history without changing it (status=%s, retired=%s)", async (status, retired) => {
  h.state.clients[0].status = status;
  if (retired) h.state.time_slots[0].retiredAt = new Date("2026-10-17T12:00:00Z");
  const before = structuredClone(h.state);
  const preview = await writeuppSlotRetirement(input);
  expect(preview).toMatchObject({ eligible: false, confirmedBooking: true });
  expect(preview.reason).toContain(confirmedSlotRetirementCopy);
  if (retired) expect(preview.reason).toContain("already been retired");
  await expect(confirm()).rejects.toThrow(confirmedSlotRetirementCopy);
  expect(h.state).toEqual(before);
});

it("does not suggest re-listing when a second owner has a pending reservation", async () => {
  h.state.clients[0].status = "Scheduled";
  h.state.clients.push({ ...h.state.clients[0], id: "pending-client", status: "RegistrationPending" });
  const preview = await writeuppSlotRetirement(input);
  expect(preview.eligible).toBe(false);
  expect(preview).not.toHaveProperty("confirmedBooking");
  expect(preview.reason).not.toContain("Add Availability");
});

it("does not infer confirmed history from a foreign practice's reference", async () => {
  h.state.clients[0].status = "Scheduled";
  h.state.clients[0].tenantId = "practice-b";
  const preview = await writeuppSlotRetirement(input);
  expect(preview.eligible).toBe(false);
  expect(preview).not.toHaveProperty("confirmedBooking");
});

beforeEach(() => {
  h.failAudit = false;
  h.state = {
    clinicians: [{ id: "clinician-a", tenantId: "practice-a" }],
    time_slots: [{ id: "slot-a", tenantId: "practice-a", clinicianId: "clinician-a", type: "Recurring",
      day: "Tuesday", startTime: "13:00", endTime: "14:00", isBooked: true, retiredAt: null }],
    clients: [{ id: "client-a", tenantId: "practice-a", displayId: "WU1", status: "AwaitingConfirmation",
      assignedSlotId: "slot-a", assignedClinicianId: "clinician-a", isArchived: false, completedAt: null,
      paymentStatus: "setup_pending", confirmedAt: null }],
    audit_logs: [{ id: "arrangement-a", tenantId: "practice-a", resourceType: "client", resourceId: "client-a",
      action: "activity_writeupp_appointment_arranged" }],
    booking_snapshots: [],
    client_clinician_options: [
      { slotId: "slot-a", tenantId: "practice-a", status: "pending" },
      { slotId: "slot-a", tenantId: "practice-a", status: "selected" },
      { slotId: "slot-other", tenantId: "practice-a", status: "pending" },
      { slotId: "slot-a", tenantId: "practice-b", status: "pending" },
    ],
  };
});

describe("occupied WriteUpp slot retirement", () => {
  it("previews eligibility without changing any data", async () => {
    const before = structuredClone(h.state);
    expect(await writeuppSlotRetirement(input)).toEqual({ eligible: true, clientId: "client-a", clientDisplayId: "WU1" });
    expect(h.state).toEqual(before);
  });

  it.each(["AwaitingConfirmation", "RegistrationPending"])("retires %s slots without altering clinical or payment evidence", async status => {
    h.state.clients[0].status = status;
    const client = structuredClone(h.state.clients[0]);
    expect(await confirm()).toEqual({ retired: true, alreadyRetired: false });
    expect(h.state.time_slots[0]).toMatchObject({ isBooked: false, retirementReason: "Occupied appointment arranged in WriteUpp" });
    expect(h.state.time_slots[0].retiredAt).toBeInstanceOf(Date);
    expect(h.state.clients[0]).toEqual(client);
    expect(h.state.booking_snapshots).toEqual([]);
    expect(h.state.client_clinician_options.map((option: any) => option.status))
      .toEqual(["unavailable", "selected", "pending", "pending"]);
    expect(h.state.audit_logs[1]).toMatchObject({ action: "activity_writeupp_slot_retired",
      userId: "admin-a", tenantId: "practice-a", resourceId: "slot-a", details: { appointmentLinksPreserved: true } });
  });

  it.each([
    ["no acknowledgement", () => { h.state.audit_logs = []; }],
    ["another tenant's acknowledgement", () => { h.state.audit_logs[0].tenantId = "practice-b"; }],
    ["another client's acknowledgement", () => { h.state.audit_logs[0].resourceId = "client-b"; }],
    ["a review without an arrangement", () => { h.state.audit_logs[0].action = "activity_external_booking_reviewed"; }],
    ["a reopened matching workflow", () => { h.state.clients[0].status = "Assigned"; }],
    ["a portal confirmation", () => { h.state.clients[0].status = "BookingConfirmed"; }],
    ["a portal snapshot", () => { h.state.booking_snapshots.push({ clientId: "client-a", slotId: "slot-a" }); }],
    ["an archived client", () => { h.state.clients[0].isArchived = true; }],
    ["a completed client", () => { h.state.clients[0].completedAt = new Date(); }],
    ["a conflicting owner", () => { h.state.clients.push({ ...h.state.clients[0], id: "client-b" }); }],
    ["a foreign owner", () => { h.state.clients[0].tenantId = "practice-b"; }],
    ["an inconsistent clinician", () => { h.state.clients[0].assignedClinicianId = "clinician-b"; }],
  ] as const)("blocks %s without making changes", async (_label, change) => {
    change();
    const before = structuredClone(h.state);
    expect(await writeuppSlotRetirement(input)).toMatchObject({ eligible: false });
    await expect(confirm()).rejects.toMatchObject({ status: 409 });
    expect(h.state).toEqual(before);
  });

  it("rejects a different practice and mismatched slot parent without leaking client details", async () => {
    await expect(writeuppSlotRetirement({ ...input, tenantId: "practice-b" })).rejects.toMatchObject({ status: 404 });
    h.state.time_slots[0].clinicianId = "clinician-b";
    await expect(confirm()).rejects.toMatchObject({ status: 404 });
  });

  it("supports a legacy null slot tenant only through a verified parent clinician", async () => {
    h.state.time_slots[0].tenantId = null;
    expect(await confirm()).toMatchObject({ retired: true });
  });

  it("rechecks the client displayed at confirmation", async () => {
    await expect(writeuppSlotRetirement({ ...input, confirm: true, expectedClientId: "different-client", actorId: "admin-a" }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.state.time_slots[0].retiredAt).toBeNull();
  });

  it("rolls all changes back if auditing fails", async () => {
    const before = structuredClone(h.state);
    h.failAudit = true;
    await expect(confirm()).rejects.toThrow("audit write failed");
    expect(h.state).toEqual(before);
  });

  it("handles simultaneous confirmations idempotently with one audit entry", async () => {
    const results = await Promise.all([confirm(), confirm()]);
    expect(results.map(result => result.alreadyRetired)).toEqual([false, true]);
    expect(h.state.audit_logs.filter((entry: any) => entry.action === "activity_writeupp_slot_retired")).toHaveLength(1);
  });
});
