import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const fixture = vi.hoisted(() => ({
  client: { id: "client-a", tenantId: "tenant-a", displayId: "WU1", status: "RegistrationPending",
    isArchived: false, completedAt: null, assignedSlotId: "slot-a", assignedClinicianId: "clinician-a" } as any,
  slot: { id: "slot-a", tenantId: "tenant-a", clinicianId: "clinician-a", isBooked: true, retiredAt: null,
    type: "InPerson", day: "Wednesday", date: "2026-09-30", startTime: "10:00", endTime: "11:00" } as any,
  otherClaim: null as any,
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
          if (!query.params.includes("tenant-a")) return [];
          switch (name(table)) {
            case "clients": return [fixture.client, fixture.otherClaim].filter(Boolean);
            case "time_slots": return fixture.slot ? [fixture.slot] : [];
            case "booking_snapshots": return fixture.snapshot ? [{ id: "snapshot-a", clientId: "client-a" }] : [];
            case "audit_logs": {
              const action = query.params.find((param: unknown) => typeof param === "string"
                && ["activity_external_booking_reviewed", "activity_writeupp_appointment_arranged",
                  "activity_booking_confirmed", "activity_appointment_option_selected"].includes(param));
              return action
                ? fixture.audit.filter(item => item.tenantId === "tenant-a" && item.action === action)
                : fixture.audit.filter(item => item.tenantId === "tenant-a");
            }
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
  return { db: { transaction: (fn: any) => fn(tx), select: tx.select } };
});

import {
  appointmentKey, externalBookingReview, historicReconciliationInventory, recordExternalBookingReview,
} from "./historicReconciliation";

const review = {
  externalReference: "diary-1", clinicianReference: "Dr Example", appointmentDate: "2026-09-30",
  startTime: "10:00", familyMessageReview: "Staff checked the family message; it was not available.",
  diaryVerified: true as const,
};
const parsedReview = (arrangedInWriteupp = false) => externalBookingReview.parse({ ...review, arrangedInWriteupp });
const allocationCases: [string, Record<string, unknown>, boolean, any][] = [
  ["missing allocation", { assignedSlotId: null, assignedClinicianId: null }, false, null],
  ["invalid allocation", { assignedSlotId: "missing-slot", assignedClinicianId: "other-clinician" }, false, null],
  ["duplicate allocation", { assignedSlotId: "slot-a", assignedClinicianId: "clinician-a" }, true, {
    id: "client-b", tenantId: "tenant-a", displayId: "WU2", status: "RegistrationPending",
    isArchived: false, completedAt: null, assignedSlotId: "slot-a", assignedClinicianId: "clinician-a",
  }],
];

beforeEach(() => {
  fixture.client = { id: "client-a", tenantId: "tenant-a", displayId: "WU1", status: "RegistrationPending",
    isArchived: false, completedAt: null, assignedSlotId: "slot-a", assignedClinicianId: "clinician-a",
    registrationFormSubmissionId: null, termsAcceptedAt: null, paymentType: null, paymentStatus: null,
    bookingConfirmationSentAt: null };
  fixture.slot = { id: "slot-a", tenantId: "tenant-a", clinicianId: "clinician-a", isBooked: true, retiredAt: null,
    type: "InPerson", day: "Wednesday", date: "2026-09-30", startTime: "10:00", endTime: "11:00" };
  fixture.otherClaim = null;
  fixture.snapshot = false;
  fixture.audit = [];
});

describe("audited external booking review", () => {
  it("rejects invalid dates or missing external verification and defaults arrangement to false", () => {
    expect(externalBookingReview.safeParse({ ...review, appointmentDate: "2026-02-31" }).success).toBe(false);
    expect(externalBookingReview.safeParse({ ...review, diaryVerified: false }).success).toBe(false);
    expect(externalBookingReview.parse(review).arrangedInWriteupp).toBe(false);
  });

  it("rejects foreign clients and does not write an audit event", async () => {
    await expect(recordExternalBookingReview("tenant-b", "client-a", "admin", null, parsedReview())).rejects.toThrow();
    expect(fixture.audit).toHaveLength(0);
  });

  it.each(allocationCases)("allows an independently verified external appointment with %s", async (_reason, allocation, slotAvailable, otherClaim) => {
    Object.assign(fixture.client, allocation);
    fixture.slot = slotAvailable ? { id: "slot-a", tenantId: "tenant-a", clinicianId: "clinician-a", isBooked: true,
      retiredAt: null, type: "InPerson", day: "Wednesday", date: "2026-09-30", startTime: "10:00", endTime: "11:00" } : null;
    fixture.otherClaim = otherClaim;
    const result = await recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview());
    expect(result).toEqual({ alreadyReviewed: false });
    expect(fixture.audit.map(item => item.action)).toEqual(["activity_external_booking_reviewed"]);
    expect(fixture.client.status).toBe("RegistrationPending");
  });

  it("still blocks an existing portal snapshot", async () => {
    fixture.snapshot = true;
    await expect(recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview())).rejects.toThrow(/snapshot/);
    expect(fixture.audit).toHaveLength(0);
  });

  it("records a review once and safely upgrades that exact review to an arrangement", async () => {
    expect(await recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview())).toEqual({ alreadyReviewed: false });
    expect(await recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview(true))).toEqual({ alreadyReviewed: true });
    expect(await recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview(true))).toEqual({ alreadyReviewed: true });
    expect(fixture.client.status).toBe("RegistrationPending");
    expect(fixture.audit.map(item => item.action)).toEqual([
      "activity_external_booking_reviewed", "activity_writeupp_appointment_arranged",
    ]);
    expect(fixture.audit[0].details).not.toHaveProperty("paymentStatus");
    expect(fixture.client.assignedSlotId).toBe("slot-a");
    expect(fixture.client.assignedClinicianId).toBe("clinician-a");
    expect(fixture.client.paymentStatus).toBeNull();
    expect(appointmentKey(parsedReview())).toBe("dr example|2026-09-30|10:00");
  });

  it("rejects reuse of an external appointment or reference for another client", async () => {
    await recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview());
    fixture.client.id = "client-b";
    await expect(recordExternalBookingReview("tenant-a", "client-b", "admin", null, parsedReview())).rejects.toThrow(/another client/);
  });

  it("keeps external reference uniqueness scoped to the tenant", async () => {
    fixture.audit.push({
      tenantId: "tenant-b", userId: "admin-b", action: "activity_external_booking_reviewed",
      resourceType: "client", resourceId: "client-other-tenant",
      details: { appointmentKey: appointmentKey(parsedReview()), externalReference: review.externalReference },
      timestamp: new Date(),
    });
    expect(await recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview())).toEqual({ alreadyReviewed: false });
  });

  it("classifies WriteUpp arrangement only from explicit arrangement evidence", async () => {
    await recordExternalBookingReview("tenant-a", "client-a", "admin", null, parsedReview());
    let inventory = await historicReconciliationInventory("tenant-a");
    expect(inventory[0].externalReview?.clinicianReference).toBe("Dr Example");
    expect(inventory[0].writeuppArranged).toBe(false);
    fixture.audit.push({
      tenantId: "tenant-a", userId: "admin", action: "activity_writeupp_appointment_arranged",
      resourceType: "client", resourceId: "client-a",
      details: { appointmentKey: appointmentKey(parsedReview()), externalReference: review.externalReference },
      timestamp: new Date(),
    });
    inventory = await historicReconciliationInventory("tenant-a");
    expect(inventory[0].writeuppArranged).toBe(true);
  });
});