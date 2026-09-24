import { describe, expect, it } from "vitest";
import { projectAllocationVisibility, withTenantAllocationVisibility, type AssignmentRow, type OfferRow } from "@shared/allocationVisibility";
import type { Client, TimeSlot, BookingSnapshot } from "@shared/schema";

const client = (status: string, slotId: string | null = "slot-1") =>
  ({ id: "client-1", status, assignedSlotId: slotId, assignedSlot: null } as Client);
const slot = (id = "slot-1", retiredAt: Date | null = null) =>
  ({ id, type: "Recurring", day: "Tuesday", startTime: "10:00", endTime: "11:00",
    locationType: "online", retiredAt } as TimeSlot);
const assignment = (s: TimeSlot | null, snapshot: BookingSnapshot | null = null): AssignmentRow =>
  ({ clientId: "client-1", slot: s, clinicianName: "Dr Chen", snapshot });
const offer = (status: OfferRow["status"], s: TimeSlot | null = slot()): OfferRow => ({
  clientId: "client-1", slotId: s?.id ?? null, status, slot: s, clinicianName: "Dr Chen",
  createdAt: new Date("2026-09-01"), sentAt: null,
});

describe("allocation display projection", () => {
  it.each(["OptionSelected", "RegistrationPending", "AwaitingConfirmation", "BookingConfirmed"])(
    "shows authoritative selection in %s without a legacy display string", status => {
      const result = projectAllocationVisibility(client(status), assignment(slot()), [offer("selected")]);
      expect(result.appointment).toMatchObject({ clinicianName: "Dr Chen", day: "Tuesday",
        startTime: "10:00", locationType: "online" });
      expect(result.options[0].status).toBe("selected");
    },
  );

  it("recovers an older selection from its option when the assigned slot reference is absent", () => {
    const result = projectAllocationVisibility(client("OptionSelected", null), assignment(null), [offer("selected")]);
    expect(result.appointment?.day).toBe("Tuesday");
  });

  it("preserves each recorded offer state and delivery evidence without fabricating a send time", () => {
    const options = [offer("selected"), offer("declined", slot("slot-2")),
      offer("unavailable", null), offer("pending", slot("slot-3"))];
    options[0].sentAt = new Date("2026-09-02");
    const result = projectAllocationVisibility(client("RegistrationPending"), assignment(slot()), options);
    expect(result.options.map(o => o.status)).toEqual(["selected", "declined", "unavailable", "pending"]);
    expect(result.options[0].sentAt).toEqual(new Date("2026-09-02"));
    expect(result.options[1].sentAt).toBeNull();
    expect(result.options[2].slot).toBeNull();
  });

  it("uses the booking snapshot for a retired or removed slot only when it matches the assignment", () => {
    const snapshot = { slotId: "slot-1", clinicianName: "Dr Chen", slotType: "SpecificDate",
      date: "2026-10-01", day: null, startTime: "09:00", endTime: "10:00",
      locationType: "in_person" } as BookingSnapshot;
    expect(projectAllocationVisibility(client("BookingConfirmed"), assignment(null, snapshot), [])
      .appointment).toMatchObject({ date: "2026-10-01", locationType: "in_person" });
    expect(projectAllocationVisibility(client("BookingConfirmed"), assignment(slot("slot-1", new Date()), null), [])
      .appointment?.retired).toBe(true);
    expect(projectAllocationVisibility(client("BookingConfirmed", "slot-2"), assignment(null, snapshot), [])
      .appointment).toMatchObject({ clinicianName: "Dr Chen", day: null, startTime: null });
  });

  it("does not invent an appointment from a different option or missing slot", () => {
    expect(projectAllocationVisibility(client("OptionSelected"), assignment(null), [offer("selected", slot("other"))])
      .appointment).toMatchObject({ clinicianName: "Dr Chen", day: null, startTime: null });
    expect(projectAllocationVisibility(client("OptionSelected"), assignment(null), [offer("selected", null)])
      .appointment).toMatchObject({ clinicianName: "Dr Chen", day: null, startTime: null, locationType: null });
  });
});

describe("tenant-gated client response", () => {
  it("leaves Tenant 1's API client response unchanged even if another tenant has visibility data", () => {
    const original = { id: "client-1", tenantId: "tenant-1", status: "OptionSelected", assignedSlot: null };
    const map = new Map([["client-1", projectAllocationVisibility(client("OptionSelected"),
      assignment(slot()), [offer("selected")])]]);
    expect(withTenantAllocationVisibility(original, "tenant-1", false, map)).toBe(original);
    expect(withTenantAllocationVisibility(original, "tenant-2", true, map)).toBe(original);
    expect(withTenantAllocationVisibility(original, "tenant-1", true, map)).toHaveProperty("allocationVisibility");
  });
});