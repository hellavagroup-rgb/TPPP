import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const fixture = vi.hoisted(() => ({
  client: { id: "client-a", tenantId: "tenant-a", displayId: "WU1", status: "RegistrationPending",
    isArchived: false, completedAt: null, assignedSlotId: "slot-a", assignedClinicianId: "clinician-a" } as any,
  slot: { id: "slot-a", tenantId: "tenant-a", clinicianId: "clinician-a", isBooked: true, retiredAt: null } as any,
  conflict: false,
  confirmedConflict: false,
  snapshot: false,
  audit: [] as any[],
}));
vi.mock("./db", () => {
  const name = (table: any) => {
    const symbol = Object.getOwnPropertySymbols(table).find(s => s.description === "drizzle:Name");
    return symbol ? table[symbol] : "";
  };
  const tx: any = {
    execute: vi.fn(async () => []),
    select: (selection?: any) => ({
      from: (table: any) => {
        let conditions: any;
        const builder: any = {
          where: (predicate: any) => { conditions = predicate; return builder; },
          for: () => builder,
          limit: async () => read(),
          then: (resolve: any, reject: any) => Promise.resolve(read()).then(resolve, reject),
        };
        const read = () => {
          const query = conditions ? new PgDialect().sqlToQuery(conditions) : { sql: "", params: [] };
          const tenant = query.params.includes("tenant-a");
          if (!tenant) return [];
          switch (name(table)) {
            case "clients": return selection?.id
              ? fixture.conflict ? [{ id: "client-b" }] : []
              : fixture.client ? [fixture.client] : [];
            case "time_slots": return fixture.slot ? [fixture.slot] : [];
            case "booking_snapshots": return fixture.snapshot || fixture.confirmedConflict
              ? [{ id: "snapshot-b" }] : [];
            case "audit_logs": return fixture.audit;
            default: return [];
          }
        };
        return builder;
      },
    }),
    insert: (table: any) => ({
      values: async (row: any) => {
        if (name(table) === "audit_logs") fixture.audit.push({ ...row, timestamp: new Date() });
      },
    }),
  };
  return { db: { transaction: (fn: any) => fn(tx) } };
});

import { appointmentKey, externalBookingReview, recordExternalBookingReview } from "./historicReconciliation";

const review = {
  externalReference: "diary-1", clinicianReference: "Dr Example", appointmentDate: "2026-09-30",
  startTime: "10:00", familyMessageReview: "Staff checked the family message; it was not available.",
  diaryVerified: true as const,
};
beforeEach(() => {
  fixture.client = { id: "client-a", tenantId: "tenant-a", displayId: "WU1", status: "RegistrationPending",
    isArchived: false, completedAt: null, assignedSlotId: "slot-a", assignedClinicianId: "clinician-a" };
  fixture.slot = { id: "slot-a", tenantId: "tenant-a", clinicianId: "clinician-a", isBooked: true, retiredAt: null };
  fixture.conflict = false; fixture.confirmedConflict = false; fixture.snapshot = false; fixture.audit = [];
});

describe("audited external booking review", () => {
  it("rejects invalid dates or missing external verification", () => {
    expect(externalBookingReview.safeParse({ ...review, appointmentDate: "2026-02-31" }).success).toBe(false);
    expect(externalBookingReview.safeParse({ ...review, diaryVerified: false }).success).toBe(false);
  });
  it("rejects foreign clients and does not write an audit event", async () => {
    await expect(recordExternalBookingReview("tenant-b", "client-a", "admin", null, review)).rejects.toThrow();
    expect(fixture.audit).toHaveLength(0);
  });
  it.each(["duplicate active allocation", "confirmed slot claim", "missing allocation validity", "existing portal snapshot"])(
    "blocks %s", async reason => {
      if (reason === "duplicate active allocation") fixture.conflict = true;
      if (reason === "confirmed slot claim") fixture.confirmedConflict = true;
      if (reason === "missing allocation validity") fixture.slot = null;
      if (reason === "existing portal snapshot") fixture.snapshot = true;
      await expect(recordExternalBookingReview("tenant-a", "client-a", "admin", null, review)).rejects.toThrow();
      expect(fixture.audit).toHaveLength(0);
    },
  );
  it("records a review once, preserves status and evidence, and rejects reuse by another client", async () => {
    fixture.client.assignedSlotId = null;
    expect(await recordExternalBookingReview("tenant-a", "client-a", "admin", null, review)).toEqual({ alreadyReviewed: false });
    expect(await recordExternalBookingReview("tenant-a", "client-a", "admin", null, review)).toEqual({ alreadyReviewed: true });
    expect(fixture.client.status).toBe("RegistrationPending");
    expect(fixture.audit).toHaveLength(1);
    expect(fixture.audit[0].details).not.toHaveProperty("paymentStatus");
    fixture.client.id = "client-b";
    await expect(recordExternalBookingReview("tenant-a", "client-b", "admin", null, review)).rejects.toThrow(/another client/);
    expect(appointmentKey(review)).toBe("dr example|2026-09-30|10:00");
  });
});