import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { isCalendarConfirmed, visibleCalendarSlots } from "@shared/calendarBooking";

const h = vi.hoisted(() => ({
  slots: [] as any[], reservations: [] as any[], selections: [] as any[],
  joinCondition: null as any, whereConditions: [] as any[],
}));
vi.mock("./db", () => ({ db: {
  select: (selection?: any) => {
    h.selections.push(selection);
    const query: any = {
      from: () => query,
      innerJoin: (_table: any, condition: any) => { h.joinCondition = condition; return query; },
      where: (condition: any) => {
        h.whereConditions.push(condition);
        return Promise.resolve(selection ? h.reservations : h.slots);
      },
    };
    return query;
  },
} }));
import { DatabaseStorage } from "./storage";

beforeEach(() => {
  h.slots = [{ id: "slot-1", isBooked: true }, { id: "slot-2", isBooked: false }];
  h.reservations = [];
  h.selections = [];
  h.whereConditions = [];
  h.joinCondition = null;
});

describe("confirmed bookings are not calendar availability", () => {
  it.each(["Scheduled", "BookingConfirmed"])("hides %s bookings even without a WriteUpp acknowledgement", status => {
    expect(isCalendarConfirmed({ status })).toBe(true);
    expect(visibleCalendarSlots(h.slots, [{ assignedSlotId: "slot-1", status }])).toEqual([h.slots[1]]);
  });

  it.each(["AwaitingConfirmation", "RegistrationPending"])("hides existing and new %s WriteUpp bookings automatically", async status => {
    h.reservations = [{ assignedSlotId: "slot-1", status, writeuppArranged: true }];
    const before = structuredClone({ slots: h.slots, clients: h.reservations });
    expect(await new DatabaseStorage().getTimeSlotsByClinicianId("clinician-1")).toEqual([h.slots[1]]);
    expect({ slots: h.slots, clients: h.reservations }).toEqual(before);
  });

  it.each(["New", "Forms Completed", "Assigned", "OptionsSent", "OptionSelected"])("does not use an old arrangement to hide a reopened %s workflow", status => {
    expect(isCalendarConfirmed({ status, writeuppArranged: true })).toBe(false);
    expect(visibleCalendarSlots(h.slots, [{ assignedSlotId: "slot-1", status, writeuppArranged: true }])).toEqual(h.slots);
  });

  it("keeps unconfirmed reservations visible and does not treat an ordinary review as confirmation", async () => {
    h.reservations = [{ assignedSlotId: "slot-1", status: "AwaitingConfirmation", writeuppArranged: false }];
    expect(await new DatabaseStorage().getTimeSlotsByClinicianId("clinician-1")).toEqual(h.slots);
  });

  it("does not reopen occupied time merely because therapy is completed or archived", () => {
    const client = { assignedSlotId: "slot-1", status: "AwaitingConfirmation", writeuppArranged: true,
      isArchived: true, completedAt: new Date() };
    expect(visibleCalendarSlots(h.slots, [client])).toEqual([h.slots[1]]);
  });

  it("does not hide unrelated slots or mutate appointment links", () => {
    expect(visibleCalendarSlots(h.slots, [
      { assignedSlotId: null, status: "BookingConfirmed" },
      { assignedSlotId: "other-slot", status: "AwaitingConfirmation", writeuppArranged: true },
    ])).toEqual(h.slots);
  });

  it("scopes evidence to the client's own practice and verifies ownership through the clinician", async () => {
    await new DatabaseStorage().getTimeSlotsByClinicianId("clinician-1");
    const dialect = new PgDialect();
    const evidence = dialect.sqlToQuery(h.selections[1].writeuppArranged).sql;
    expect(evidence).toContain('arrangement.tenant_id = "clients"."tenant_id"');
    expect(evidence).toContain('arrangement.resource_id = "clients"."id"');
    expect(evidence).toContain("arrangement.resource_type = 'client'");
    expect(evidence).toContain("activity_writeupp_appointment_arranged");
    const parent = dialect.sqlToQuery(h.joinCondition).sql;
    expect(parent).toContain('"clients"."tenant_id" = "clinicians"."tenant_id"');
    expect(parent).toContain('"clients"."assigned_clinician_id" = "clinicians"."id"');
    const scope = dialect.sqlToQuery(h.whereConditions[1]);
    expect(scope.params).toEqual(expect.arrayContaining(["clinician-1", "slot-1", "slot-2"]));
    expect(dialect.sqlToQuery(h.whereConditions[0]).sql).toContain('"time_slots"."retired_at" is null');
  });

  it("avoids a second query when no non-retired slots exist", async () => {
    h.slots = [];
    expect(await new DatabaseStorage().getTimeSlotsByClinicianId("clinician-1")).toEqual([]);
    expect(h.selections).toHaveLength(1);
  });
});
