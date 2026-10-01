import { describe, expect, it } from "vitest";
import { canInspectRegistrationPayment } from "@shared/paymentReconciliationEligibility";

const payment = {
  paymentType: "self_pay", stripePaymentLinkId: "plink_current",
  registrationPaymentAttemptKey: "attempt", registrationFormSubmissionId: "submission",
};

describe("registration payment inspection eligibility", () => {
  it("includes legacy awaiting-confirmation records with submitted registration", () => {
    expect(canInspectRegistrationPayment({ ...payment, status: "AwaitingConfirmation" })).toBe(true);
  });

  it.each(["RegistrationPending", "Scheduled", "BookingConfirmed"])("keeps %s eligible", status => {
    expect(canInspectRegistrationPayment({ ...payment, status })).toBe(true);
  });

  it("excludes unrelated, incomplete and externally paid historic records", () => {
    expect(canInspectRegistrationPayment({ ...payment, status: "Assigned" })).toBe(false);
    expect(canInspectRegistrationPayment({ ...payment, status: "AwaitingConfirmation", registrationFormSubmissionId: null })).toBe(false);
    expect(canInspectRegistrationPayment({ ...payment, status: "AwaitingConfirmation", registrationPaymentAttemptKey: null })).toBe(false);
    expect(canInspectRegistrationPayment({ ...payment, status: "AwaitingConfirmation", stripePaymentLinkId: null })).toBe(false);
    expect(canInspectRegistrationPayment({ ...payment, status: "AwaitingConfirmation", paymentType: "insurer" })).toBe(false);
  });
});