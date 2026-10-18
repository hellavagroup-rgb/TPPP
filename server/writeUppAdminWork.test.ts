import { describe, expect, it } from "vitest";
import { CYA_PSYCHOLOGY_TENANT_ID } from "@shared/practicePolicies";
import { needsWriteUppAdminWork } from "@shared/writeUppAdminWork";
import { isCalendarConfirmed, visibleCalendarSlots } from "@shared/calendarBooking";

const tenantId = CYA_PSYCHOLOGY_TENANT_ID;
const confirmed = {
  tenantId, status: "BookingConfirmed", isArchived: false, completedAt: null,
  writeuppAppointmentConfirmed: false, writeuppDataTransferred: false,
};

describe("Tenant 2 confirmed WriteUpp admin work", () => {
  it.each([
    [false, false, true], [true, false, true], [false, true, true], [true, true, false],
    [null, null, true], [undefined, undefined, true],
  ])("requires both saved checkboxes (appointment=%s, transfer=%s)", (appointment, transferred, pending) => {
    expect(needsWriteUppAdminWork({
      ...confirmed, writeuppAppointmentConfirmed: appointment, writeuppDataTransferred: transferred,
    }, tenantId)).toBe(pending);
  });

  it.each(["Scheduled", "BookingConfirmed"])("includes confirmed state %s", status => {
    expect(needsWriteUppAdminWork({ ...confirmed, status }, tenantId)).toBe(true);
  });

  it.each(["New", "Forms Sent", "Forms Completed", "Waitlist", "Assigned", "OptionsSent", "OptionSelected",
    "RegistrationPending", "AwaitingConfirmation"])("does not reclassify unconfirmed or externally arranged state %s", status => {
    expect(needsWriteUppAdminWork({ ...confirmed, status }, tenantId)).toBe(false);
  });

  it.each(["0199f88e-fc37-453f-8e14-1152f790d40b", "other-practice", undefined, null])(
    "does not change another/missing practice %s", otherTenant => {
      expect(needsWriteUppAdminWork({ ...confirmed, tenantId: otherTenant }, otherTenant)).toBe(false);
      expect(needsWriteUppAdminWork({ ...confirmed, tenantId: otherTenant }, tenantId)).toBe(false);
      expect(needsWriteUppAdminWork(confirmed, otherTenant)).toBe(false);
    },
  );

  it("keeps archived and completed records in their own views", () => {
    expect(needsWriteUppAdminWork({ ...confirmed, isArchived: true }, tenantId)).toBe(false);
    expect(needsWriteUppAdminWork({ ...confirmed, completedAt: "2026-10-18T12:00:00Z" }, tenantId)).toBe(false);
  });

  it("does not undo confirmation, payment evidence or occupied calendar time", () => {
    const client = Object.freeze({
      ...confirmed, assignedSlotId: "occupied-slot", paymentStatus: "paid",
      confirmedAt: "2026-10-18T12:00:00Z", registrationFormSubmissionId: "registration",
    });
    const before = structuredClone(client);
    expect(needsWriteUppAdminWork(client, tenantId)).toBe(true);
    expect(client).toEqual(before);
    expect(isCalendarConfirmed(client)).toBe(true);
    expect(visibleCalendarSlots([{ id: "occupied-slot" }, { id: "free-slot" }], [client]))
      .toEqual([{ id: "free-slot" }]);
  });
});
