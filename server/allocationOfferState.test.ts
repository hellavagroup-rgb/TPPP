import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => {
  const options: any[] = [];
  const slots: any[] = [];
  const clinicians: any[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => {
        let condition: any;
        const query: any = {
          where(value: any) {
            condition = value;
            return query;
          },
          orderBy() {
            return query;
          },
          then(resolve: any, reject: any) {
            const { sql, params } = new PgDialect().sqlToQuery(condition);
            const source = sql.includes('"time_slots"') ? slots : sql.includes('"clinicians"') ? clinicians : options;
            const rows = source.filter(option => {
              if (source !== options) return option.tenantId === params[0] && params.slice(1).includes(option.id);
              if (sql.includes('"client_clinician_options"."tenant_id"') && option.tenantId !== params[0]) return false;
              if (sql.includes('"client_clinician_options"."client_id"')) {
                const clientIds = params.slice(1);
                if (!clientIds.includes(option.clientId)) return false;
              }
              return true;
            }).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
            return Promise.resolve(rows).then(resolve, reject);
          },
        };
        return query;
      }),
    })),
  };
  return { options, slots, clinicians, db };
});

vi.mock("./db", () => ({ db: h.db }));

import { getAllocationOfferStates } from "./allocationOfferState";
import type { Client } from "@shared/schema";

const clients = [
  { id: "client-a-pending", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-declined", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-closed", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-failed-reoffer", tenantId: "practice-a", status: "OptionsSent" },
  { id: "client-a-completed", tenantId: "practice-a", status: "BookingConfirmed" },
  { id: "client-b-pending", tenantId: "practice-b", status: "OptionsSent" },
] as Client[];

function addOption(clientId: string, tenantId: string, status: string, createdAt: string, token: string) {
  h.options.push({
    clientId,
    tenantId,
    status,
    createdAt: new Date(createdAt),
    selectionToken: token,
    slotId: "slot-a",
    clinicianId: "clinician-a",
  });
}

describe("allocation offer-state summaries", () => {
  beforeEach(() => {
    h.options.splice(0);
    h.slots.splice(0, h.slots.length, {
      id: "slot-a", clinicianId: "clinician-a", tenantId: "practice-a",
      type: "SpecificDate", date: "2099-01-01", isBooked: false,
    });
    h.clinicians.splice(0, h.clinicians.length, { id: "clinician-a", tenantId: "practice-a" });
    vi.clearAllMocks();

    addOption("client-a-pending", "practice-a", "declined", "2026-01-01T00:00:00Z", "old-a");
    addOption("client-a-pending", "practice-a", "pending", "2026-02-01T00:00:00Z", "current-a");

    addOption("client-a-declined", "practice-a", "unavailable", "2026-01-01T00:00:00Z", "old-declined");
    addOption("client-a-declined", "practice-a", "declined", "2026-02-01T00:00:00Z", "declined-a-1");
    addOption("client-a-declined", "practice-a", "declined", "2026-02-01T00:00:00Z", "declined-a-2");

    addOption("client-a-closed", "practice-a", "declined", "2026-01-01T00:00:00Z", "old-closed");
    addOption("client-a-closed", "practice-a", "unavailable", "2026-02-01T00:00:00Z", "closed-a");

    // A failed fresh send retires the preceding generation and leaves only the
    // newest, undelivered generation unavailable; report that generation closed.
    addOption("client-a-failed-reoffer", "practice-a", "unavailable", "2026-01-01T00:00:00Z", "retired-failed");
    addOption("client-a-failed-reoffer", "practice-a", "unavailable", "2026-02-01T00:00:00Z", "failed-fresh-send");

    addOption("client-b-pending", "practice-b", "pending", "2026-02-01T00:00:00Z", "current-b");
    // Even if a foreign tenant has an option tied to a different client, it
    // cannot influence the summary for practice A.
    addOption("client-a-pending", "practice-b", "declined", "2026-03-01T00:00:00Z", "foreign-a-token");
  });

  it("summarizes the latest offer generation for each practice without exposing tokens", async () => {
    const practiceA = await getAllocationOfferStates(clients, "practice-a");
    expect([...practiceA.entries()].map(([id, summary]) => [id, summary.state])).toEqual([
      ["client-a-pending", "pending"],
      ["client-a-declined", "declined"],
      ["client-a-closed", "closed"],
      ["client-a-failed-reoffer", "closed"],
    ]);
    expect(practiceA.has("client-a-completed")).toBe(false);
    expect(practiceA.has("client-b-pending")).toBe(false);
    expect(JSON.stringify([...practiceA.entries()])).not.toContain("token");

    const practiceB = await getAllocationOfferStates(clients, "practice-b");
    expect([...practiceB.entries()].map(([id, summary]) => [id, summary.state])).toEqual([["client-b-pending", "pending"]]);
    expect(practiceB.has("client-a-pending")).toBe(false);
  });

  it("keeps offer summaries independent of allocation-detail visibility settings", async () => {
    const statesWithDetailsHidden = await getAllocationOfferStates(
      clients.map(client => ({ ...client, allocationVisibilityEnabled: false })) as Client[],
      "practice-a",
    );
    const statesWithDetailsVisible = await getAllocationOfferStates(
      clients.map(client => ({ ...client, allocationVisibilityEnabled: true })) as Client[],
      "practice-a",
    );

    expect(statesWithDetailsHidden).toEqual(statesWithDetailsVisible);
    expect([...statesWithDetailsVisible.values()].map(summary => summary.state)).toEqual(["pending", "declined", "closed", "closed"]);
  });

  it("reports valid pending choices without changing declined or closed history", async () => {
    const summary = await getAllocationOfferStates(clients, "practice-a");
    expect(summary.get("client-a-pending")).toEqual({
      state: "pending", deliveryAcceptedAt: null, eligibility: { pendingCount: 1, availableCount: 1, unavailableCount: 0 },
    });
    expect(summary.get("client-a-declined")).toEqual({ state: "declined", deliveryAcceptedAt: null, eligibility: null });
    expect(summary.get("client-a-closed")).toEqual({ state: "closed", deliveryAcceptedAt: null, eligibility: null });
  });

  it.each([
    ["booked", { isBooked: true }],
    ["expired one-off", { date: "2000-01-01" }],
    ["expired recurring", { type: "Recurring", endDate: "2000-01-01" }],
    ["retired", { retiredAt: new Date() }],
    ["foreign slot", { tenantId: "practice-b" }],
    ["mismatched clinician", { clinicianId: "other-clinician" }],
  ])("reports %s slots as unavailable while preserving pending history", async (_, changes) => {
    Object.assign(h.slots[0], changes);
    const summary = (await getAllocationOfferStates(clients, "practice-a")).get("client-a-pending");
    expect(summary).toEqual({
      state: "pending", deliveryAcceptedAt: null, eligibility: { pendingCount: 1, availableCount: 0, unavailableCount: 1 },
    });
  });

  it.each(["missing slot", "missing clinician", "foreign clinician", "null slot"])("fails closed for %s", async (reason) => {
    if (reason === "missing slot") h.slots.splice(0);
    if (reason === "missing clinician") h.clinicians.splice(0);
    if (reason === "foreign clinician") h.clinicians[0].tenantId = "practice-b";
    if (reason === "null slot") h.options.find(option => option.status === "pending" && option.tenantId === "practice-a").slotId = null;
    expect((await getAllocationOfferStates(clients, "practice-a")).get("client-a-pending")?.eligibility?.unavailableCount).toBe(1);
  });

  it("counts mixed valid/invalid options and ignores foreign options without exposing tokens", async () => {
    h.slots.push({ ...h.slots[0], id: "slot-booked", isBooked: true });
    addOption("client-a-pending", "practice-a", "pending", "2026-02-01T00:00:00Z", "private-selection-token");
    h.options[h.options.length - 1].slotId = "slot-booked";
    addOption("client-a-pending", "practice-b", "pending", "2026-03-01T00:00:00Z", "foreign-token");
    const summary = (await getAllocationOfferStates(clients, "practice-a")).get("client-a-pending");
    expect(summary).toEqual({
      state: "pending", deliveryAcceptedAt: null, eligibility: { pendingCount: 2, availableCount: 1, unavailableCount: 1 },
    });
    expect(JSON.stringify(summary)).not.toMatch(/token|slot|clinician/);
  });

  it("uses delivery evidence only from all current tenant-owned pending choices", async () => {
    const acceptedAt = new Date("2026-02-01T12:00:00Z");
    h.options.find(option => option.clientId === "client-a-pending" && option.tenantId === "practice-a" && option.status === "pending").sentAt = acceptedAt;
    expect((await getAllocationOfferStates(clients, "practice-a")).get("client-a-pending")?.deliveryAcceptedAt).toEqual(acceptedAt);
    addOption("client-a-pending", "practice-a", "pending", "2026-02-01T00:00:00Z", "unsent-choice");
    expect((await getAllocationOfferStates(clients, "practice-a")).get("client-a-pending")?.deliveryAcceptedAt).toBeNull();
    h.options.forEach(option => { if (option.tenantId === "practice-a") option.sentAt = null; });
    h.options.find(option => option.clientId === "client-a-pending" && option.tenantId === "practice-b").sentAt = acceptedAt;
    expect((await getAllocationOfferStates(clients, "practice-a")).get("client-a-pending")?.deliveryAcceptedAt).toBeNull();
  });

  it("does not query data for foreign clients or completed appointments", async () => {
    expect(await getAllocationOfferStates(clients.filter(client => client.status !== "OptionsSent" || client.tenantId !== "practice-a"), "practice-a")).toEqual(new Map());
    expect(h.db.select).not.toHaveBeenCalled();
  });
});