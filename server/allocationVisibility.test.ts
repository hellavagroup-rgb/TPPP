import { describe, expect, it } from "vitest";
import { projectAllocationVisibility, withTenantAllocationVisibility, type AssignmentRow, type OfferRow } from "@shared/allocationVisibility";
import type { Client, TimeSlot, BookingSnapshot } from "@shared/schema";

const client = (status: string, slotId: string | null = "slot-1") =>
  ({ id: "client-1", tenantId: "tenant-1", status, assignedSlotId: slotId,
    assignedClinicianId: "clin-1", assignedSlot: null } as Client);
const slot = (id = "slot-1", retiredAt: Date | null = null) =>
  ({ id, tenantId: "tenant-1", clinicianId: "clin-1",
    type: "Recurring", day: "Tuesday", startTime: "10:00", endTime: "11:00",
    locationType: "online", retiredAt } as TimeSlot);
const assignment = (s: TimeSlot | null, snapshot: BookingSnapshot | null = null): AssignmentRow =>
  ({ clientId: "client-1", tenantId: "tenant-1", clinicianId: "clin-1",
    clinicianTenantId: "tenant-1", slot: s, clinicianName: "Dr Chen", snapshot,
    snapshotClinicianTenantId: snapshot?.clinicianId ? "tenant-1" : null });
const offer = (status: OfferRow["status"], s: TimeSlot | null = slot()): OfferRow => ({
  clientId: "client-1", tenantId: "tenant-1", clinicianId: "clin-1",
  clinicianTenantId: "tenant-1", slotId: s?.id ?? null, status, slot: s, clinicianName: "Dr Chen",
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
    const snapshot = { clientId: "client-1", tenantId: "tenant-1", clinicianId: "clin-1",
      slotId: "slot-1", clinicianName: "Dr Chen", slotType: "SpecificDate",
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

  it("keeps legacy assigned-slot text as raw historical evidence when verified details are blank or partial", () => {
    const assigned = { ...client("Assigned", null), assignedClinicianId: null, assignedSlot: "Tuesday 10am (old record)" };
    const row = { ...assignment(null), clinicianId: null, clinicianTenantId: null, clinicianName: null };
    const result = projectAllocationVisibility(assigned, row, []);
    expect(result.appointment).toBeNull();
    expect(result.legacyAssignedSlot).toBe("Tuesday 10am (old record)");

    const partial = projectAllocationVisibility(
      { ...assigned, assignedSlot: "Tuesday, time not recorded" }, row, [],
    );
    expect(partial.appointment).toBeNull();
    expect(partial.legacyAssignedSlot).toBe("Tuesday, time not recorded");
    expect(projectAllocationVisibility({ ...assigned, assignedSlot: "" }, row, []).legacyAssignedSlot).toBe("");
  });

  it("shows clinician-only assignment context when its clinician is tenant-owned and no slot is assigned", () => {
    const result = projectAllocationVisibility(client("Assigned", null), assignment(null), []);
    expect(result.appointment).toMatchObject({
      clinicianName: "Dr Chen", type: null, day: null, startTime: null,
    });
  });

  it("rejects an assignment whose slot belongs to another tenant or another clinician", () => {
    const crossTenantSlot = { ...slot(), tenantId: "tenant-2" };
    expect(projectAllocationVisibility(client("Assigned"), assignment(crossTenantSlot), [])
      .appointment).toBeNull();

    const mismatchedSlot = { ...slot(), clinicianId: "clin-2" };
    expect(projectAllocationVisibility(client("Assigned"), assignment(mismatchedSlot), [])
      .appointment).toBeNull();
  });

  it("does not combine a selected option clinician with a mismatching slot", () => {
    const mismatchedSlot = { ...slot("slot-1"), clinicianId: "clin-2" };
    const selected = { ...offer("selected", mismatchedSlot) };
    expect(projectAllocationVisibility(client("OptionSelected"), assignment(null), [selected])
      .appointment).toMatchObject({ clinicianName: "Dr Chen", day: null, startTime: null });
    selected.clinicianTenantId = "tenant-2";
    expect(projectAllocationVisibility(client("OptionSelected"), assignment(null), [selected])
      .appointment?.day).toBeNull();
  });

  it("retains selected slot evidence when the tenant-owned clinician name is blank", () => {
    const selected = { ...offer("selected"), clinicianName: null };
    const result = projectAllocationVisibility(client("OptionSelected"), assignment(null), [selected]);
    expect(result.appointment).toMatchObject({ clinicianName: null, day: "Tuesday", startTime: "10:00" });
  });

  it("filters foreign-client and foreign-tenant options instead of exposing their recorded states", () => {
    const foreignClient = { ...offer("declined"), clientId: "another-client" };
    const foreignTenant = { ...offer("pending"), tenantId: "tenant-2" };
    const local = offer("selected");
    const result = projectAllocationVisibility(client("OptionSelected"), assignment(null),
      [foreignClient, foreignTenant, local]);
    expect(result.options).toHaveLength(1);
    expect(result.options[0].status).toBe("selected");
  });

  it("rejects a snapshot whose clinician conflicts with the client's assigned clinician", () => {
    const snapshot = {
      clientId: "client-1", tenantId: "tenant-1", clinicianId: "clin-2",
      slotId: "slot-1", clinicianName: "Dr Other", slotType: "SpecificDate",
      date: "2026-10-01", day: null, startTime: "09:00", endTime: "10:00",
      locationType: "in_person",
    } as BookingSnapshot;
    const result = projectAllocationVisibility(client("BookingConfirmed"), assignment(null, snapshot), []);
    expect(result.appointment?.date).toBeNull();
    expect(result.appointment?.clinicianName).toBe("Dr Chen");
  });

  it("requires allocation source rows to belong to the same client and tenant", () => {
    const foreignRow = { ...assignment(slot()), tenantId: "tenant-2" };
    const result = projectAllocationVisibility(client("Assigned"), foreignRow, []);
    expect(result.appointment).toBeNull();
    expect(result.legacyAssignedSlot).toBeNull();
  });

  it("handles Tenant 2 Assigned and OptionsSent records with notes but no allocation evidence", () => {
    const noAllocation = {
      ...client("Assigned", null), id: "tenant-2-assigned", tenantId: "tenant-2",
      assignedClinicianId: null, assignedSlot: null, notes: "Staff note",
    } as Client;
    const assignedRow: AssignmentRow = {
      clientId: noAllocation.id, tenantId: "tenant-2", clinicianId: null,
      clinicianTenantId: null, slot: null, clinicianName: null, snapshot: null,
    };
    const assignedResult = projectAllocationVisibility(noAllocation, assignedRow, []);
    expect(assignedResult).toMatchObject({ appointment: null, legacyAssignedSlot: null, options: [] });

    const optionsSent = {
      ...noAllocation, id: "tenant-2-options-sent", status: "OptionsSent",
    } as Client;
    const optionsRow = { ...assignedRow, clientId: optionsSent.id };
    expect(projectAllocationVisibility(optionsSent, optionsRow, []))
      .toMatchObject({ appointment: null, legacyAssignedSlot: null, options: [] });
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