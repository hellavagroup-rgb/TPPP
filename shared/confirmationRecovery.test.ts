import { describe, expect, it } from "vitest";
import { confirmationBlocker, type ConfirmationClient } from "./confirmationRecovery";

const features = { paymentsEnabled: true, registrationEnabled: true, allocationValid: true };
const allocated: ConfirmationClient = {
  status: "AwaitingConfirmation",
  assignedClinicianId: "clinician",
  assignedSlotId: "slot",
  paymentType: "insurer",
  registrationFormSubmissionId: "submission",
};

describe("opt-in confirmation guidance", () => {
  it("separates awaiting registration, registration payment and already confirmed", () => {
    expect(confirmationBlocker({ status: "RegistrationPending" }, features)).toBe("registration_pending");
    expect(confirmationBlocker({
      status: "RegistrationPending", registrationFormSubmissionId: "submission",
      registrationPaymentAttemptKey: "attempt", paymentStatus: "setup_pending", paymentType: "self_pay",
    }, features)).toBe("payment_pending");
    expect(confirmationBlocker({
      status: "RegistrationPending", registrationFormSubmissionId: "submission", paymentType: "insurer",
    }, features)).toBe("booking_progression");
    expect(confirmationBlocker({ status: "BookingConfirmed" }, features)).toBe("already_confirmed");
    expect(confirmationBlocker({ status: "Scheduled" }, features)).toBe("already_confirmed");
  });

  it("rejects missing and stale allocations and never treats a paid badge as Stripe evidence", () => {
    expect(confirmationBlocker({ ...allocated, assignedSlotId: null }, features)).toBe("allocation_missing");
    expect(confirmationBlocker(allocated, { ...features, allocationValid: false })).toBe("allocation_invalid");
    expect(confirmationBlocker({ ...allocated, registrationPaymentAttemptKey: "attempt", paymentStatus: "active" }, features))
      .toBe("registration_payment");
    expect(confirmationBlocker({ ...allocated, paymentType: "self_pay", paymentStatus: "active" }, features))
      .toBe("payment_unverified");
    expect(confirmationBlocker({ ...allocated, paymentType: null }, features)).toBe("payment_unverified");
  });

  it("only permits an allocated awaiting-confirmation insurer without a registration payment", () => {
    expect(confirmationBlocker(allocated, features)).toBeNull();
    // Legacy awaiting-confirmation rows did not go through registration.
    expect(confirmationBlocker({ ...allocated, registrationFormSubmissionId: null }, features)).toBeNull();
    expect(confirmationBlocker({ ...allocated, status: "Assigned" }, features)).toBe("wrong_status");
    expect(confirmationBlocker({ ...allocated, registrationFormSubmissionId: null },
      { ...features, registrationEnabled: false })).toBeNull();
    // Repeated attempts do not make a final status eligible again.
    expect(confirmationBlocker({ ...allocated, status: "BookingConfirmed" }, features)).toBe("already_confirmed");
  });
});