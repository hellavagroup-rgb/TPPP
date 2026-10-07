import { describe, expect, it } from "vitest";
import { bookingCompletionBlocker, bookingCompletionBlockerCode, bookingCompletionDecision, type BookingCompletionEvidence } from "../shared/bookingCompletion";

const confirmed: BookingCompletionEvidence = {
  status: "BookingConfirmed",
  isArchived: false,
  confirmedAt: new Date("2026-04-12"),
  writeuppAppointmentConfirmed: true,
  writeuppDataTransferred: true,
  paymentType: "self_pay",
  paymentStatus: "active",
};
const options = { hasSnapshot: true, checklistEnabled: true };

describe("booking completion evidence", () => {
  it("accepts confirmed self-pay with active payment and both WriteUpp checks", () => {
    expect(bookingCompletionBlocker(confirmed, options)).toBeNull();
    expect(bookingCompletionBlocker({ ...confirmed, paymentType: "insurer", paymentStatus: "none" }, options)).toBeNull();
  });

  it("never interprets archived, unconfirmed, or missing snapshot records as completed", () => {
    expect(bookingCompletionBlocker({ ...confirmed, isArchived: true }, options)).toMatch(/Restore/);
    expect(bookingCompletionBlocker({ ...confirmed, status: "RegistrationPending" }, options)).toMatch(/confirmed booking/);
    expect(bookingCompletionBlocker({ ...confirmed, confirmedAt: null }, options)).toMatch(/confirmed booking/);
    expect(bookingCompletionBlocker(confirmed, { ...options, hasSnapshot: false })).toMatch(/booking record/);
  });

  it("requires both enabled checklist items", () => {
    expect(bookingCompletionBlocker({ ...confirmed, writeuppAppointmentConfirmed: false }, options)).toMatch(/both WriteUpp/);
    expect(bookingCompletionBlocker({ ...confirmed, writeuppDataTransferred: false }, options)).toMatch(/both WriteUpp/);
    expect(bookingCompletionBlocker({ ...confirmed, writeuppDataTransferred: false }, { ...options, checklistEnabled: false })).toBeNull();
  });

  it("blocks pending self-pay and requires an explicit legacy payment-type review", () => {
    expect(bookingCompletionBlocker({ ...confirmed, paymentStatus: "setup_pending" }, options)).toMatch(/Verify self-pay/);
    expect(bookingCompletionBlocker({ ...confirmed, paymentStatus: "none" }, options)).toMatch(/Verify self-pay/);
    expect(bookingCompletionBlocker({ ...confirmed, paymentType: null }, options)).toMatch(/Review and set/);
  });

  it("identifies the payment blocker without overriding missing booking or checklist evidence", () => {
    const pending = { ...confirmed, paymentStatus: "setup_pending" };
    expect(bookingCompletionBlockerCode(pending, options)).toBe("payment_setup_unverified");
    expect(bookingCompletionBlockerCode(pending, { ...options, hasSnapshot: false })).toBe("booking_unverified");
    expect(bookingCompletionBlockerCode({ ...pending, writeuppDataTransferred: false }, options)).toBe("writeupp_incomplete");
    expect(bookingCompletionBlockerCode({ ...pending, isArchived: true }, options)).toBe("archived");
    expect(bookingCompletionBlockerCode(confirmed, options)).toBeNull();
  });

  it("keeps completion tenant-scoped, idempotent and separate from historical archive", () => {
    const client = { ...confirmed, tenantId: "practice-two", completedAt: null };
    const config = { ...options, tenantId: "practice-two", enabled: true };
    expect(bookingCompletionDecision(client, config)).toEqual({ kind: "ready" });
    expect(bookingCompletionDecision({ ...client, completedAt: new Date() }, config)).toEqual({ kind: "already_completed" });
    expect(bookingCompletionDecision(client, { ...config, tenantId: "practice-one" }).kind).toBe("denied");
    expect(bookingCompletionDecision(client, { ...config, enabled: false }).kind).toBe("denied");
    expect(bookingCompletionDecision({ ...client, isArchived: true }, config).kind).toBe("blocked");
  });
});