import { describe, expect, it } from "vitest";
import { paymentProgress, registrationProgress } from "../shared/clientProgress";

describe("durable client progress", () => {
  it("uses persisted registration delivery and submission records", () => {
    expect(registrationProgress({ status: "OptionsSent" })).toBe("waiting_for_option");
    expect(registrationProgress({ status: "Assigned" })).toBe("allocation_incomplete");
    expect(registrationProgress({
      status: "Assigned",
      assignedClinicianId: "clinician",
      assignedSlotId: "slot",
    })).toBe("automatic_pending");
    expect(registrationProgress({ registrationEmailSendingAt: "2026-01-01" })).toBe("sending");
    expect(registrationProgress({ registrationEmailFailedAt: "2026-01-01" })).toBe("failed");
    expect(registrationProgress({ registrationEmailSentAt: "2026-01-01" })).toBe("sent");
    expect(registrationProgress({
      registrationEmailSendingAt: "2026-01-01",
      registrationFormSubmissionId: "submission",
    })).toBe("completed");
  });

  it("distinguishes automatic payment setup from client action and recovery", () => {
    const enabled = { paymentsEnabled: true };
    expect(paymentProgress({ paymentType: "insurer", registrationPaymentAttemptKey: "attempt" }, enabled)).toBe("not_required");
    expect(paymentProgress({
      status: "RegistrationPending",
      paymentType: "self_pay",
      registrationFormSubmissionId: "submission",
    }, enabled)).toBe("automatic_pending");
    expect(paymentProgress({
      status: "RegistrationPending",
      paymentType: "self_pay",
      registrationFormSubmissionId: "submission",
      registrationPaymentAttemptKey: "attempt",
      registrationPaymentFailedAt: "2026-01-01",
    }, enabled)).toBe("recovery_needed");
    expect(paymentProgress({
      status: "RegistrationPending",
      paymentType: "self_pay",
      registrationPaymentAttemptKey: "attempt",
      stripeCheckoutUrl: "https://checkout.example",
      paymentStatus: "setup_pending",
    }, enabled)).toBe("awaiting_client");
    expect(paymentProgress({ paymentStatus: "active" }, enabled)).toBe("active");
  });

  it("does not report recovery for direct confirmation when payments are disabled", () => {
    expect(paymentProgress({
      status: "BookingConfirmed",
      paymentType: "self_pay",
      registrationFormSubmissionId: "submission",
      registrationPaymentAttemptKey: "direct-confirmation-attempt",
    }, { paymentsEnabled: false })).toBe("not_required");
  });
});
