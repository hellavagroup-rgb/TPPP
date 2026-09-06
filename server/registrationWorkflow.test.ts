import { describe, expect, it } from "vitest";
import {
  canSendRegistration,
  isActiveRegistrationToken,
  isCompletedRegistrationRetry,
  nextTermsVersion,
  optionSelectionProgression,
  registrationCompletionBranch,
  registrationPaymentPrerequisite,
  isCorrelatedRegistrationCheckout,
  registrationRetryResponse,
  validateRegistrationConsent,
} from "./registrationWorkflow";

describe("registration security decisions", () => {
  it("requires explicit acceptance of the exact displayed terms version", () => {
    expect(validateRegistrationConsent(false, 3, 3)).toMatch(/must accept/i);
    expect(validateRegistrationConsent(true, 2, 3)).toMatch(/changed/i);
    expect(validateRegistrationConsent(true, 3, 3)).toBeNull();
  });

  it("rejects revoked and expired bearer registration tokens", () => {
    const now = new Date("2025-01-02T00:00:00Z");
    expect(isActiveRegistrationToken({ registrationToken: "a", registrationTokenExpiresAt: new Date("2025-01-03"), registrationTokenRevokedAt: null }, "a", now)).toBe(true);
    expect(isActiveRegistrationToken({ registrationToken: "a", registrationTokenExpiresAt: new Date("2025-01-01"), registrationTokenRevokedAt: null }, "a", now)).toBe(false);
    expect(isActiveRegistrationToken({ registrationToken: "a", registrationTokenExpiresAt: null, registrationTokenRevokedAt: now }, "a", now)).toBe(false);
  });

  it("recognizes a completed response-loss retry despite token revocation", () => {
    expect(isCompletedRegistrationRetry({ registrationToken: "a" }, "a", "BookingConfirmed")).toBe(true);
    expect(isCompletedRegistrationRetry({ registrationToken: "a" }, "b", "BookingConfirmed")).toBe(false);
    expect(isCompletedRegistrationRetry({ registrationToken: "a" }, "a", "RegistrationPending")).toBe(false);
  });

  it("has safe retry outcomes", () => {
    expect(registrationRetryResponse("BookingConfirmed", null)).toBe("completed");
    expect(registrationRetryResponse("RegistrationPending", "https://pay")).toBe("checkout");
    expect(registrationRetryResponse("RegistrationPending", null)).toBe("processing");
  });

  it("enforces feature, tenant, allocation, and state eligibility for independent sends", () => {
    const eligible = {
      featureEnabled: true,
      requestTenantId: "tenant-a",
      clientTenantId: "tenant-a",
      assignedClinicianId: "clinician",
      assignedSlotId: "slot",
      status: "Assigned",
    };
    expect(canSendRegistration(eligible)).toBe(true);
    expect(canSendRegistration({ ...eligible, featureEnabled: false })).toBe(false);
    expect(canSendRegistration({ ...eligible, clientTenantId: "tenant-b" })).toBe(false);
    expect(canSendRegistration({ ...eligible, assignedSlotId: null })).toBe(false);
    expect(canSendRegistration({ ...eligible, status: "RegistrationPending" })).toBe(false);
    expect(canSendRegistration({ ...eligible, status: "BookingConfirmed" })).toBe(false);
  });

  it("skips registration when the tenant feature is off", () => {
    expect(optionSelectionProgression(false)).toEqual({ status: "BookingConfirmed", requiresRegistration: false });
    expect(optionSelectionProgression(true)).toEqual({ status: "OptionSelected", requiresRegistration: true });
  });

  it("selects Stripe and direct-confirmation branches consistently", () => {
    expect(registrationCompletionBranch({ paymentType: "self_pay", paymentsEnabled: true, agreedRatePence: 12000 })).toBe("stripe");
    expect(registrationCompletionBranch({ paymentType: "insurer", paymentsEnabled: true, agreedRatePence: 12000 })).toBe("confirm");
    expect(registrationCompletionBranch({ paymentType: "self_pay", paymentsEnabled: false, agreedRatePence: 12000 })).toBe("confirm");
    expect(registrationCompletionBranch({ paymentType: "self_pay", paymentsEnabled: true, agreedRatePence: null })).toBe("confirm");
  });

  it("does not silently bypass self-pay prerequisites", () => {
    expect(registrationPaymentPrerequisite({
      paymentType: "self_pay", paymentsEnabled: true, agreedRatePence: null, stripeAvailable: true,
    })).toBe("client_rate_required");
    expect(registrationPaymentPrerequisite({
      paymentType: "self_pay", paymentsEnabled: true, agreedRatePence: 12000, stripeAvailable: false,
    })).toBe("stripe_unavailable");
    expect(registrationPaymentPrerequisite({
      paymentType: "self_pay", paymentsEnabled: true, agreedRatePence: 12000, stripeAvailable: true,
    })).toBe("stripe_required");
    expect(registrationPaymentPrerequisite({
      paymentType: "insurer", paymentsEnabled: true, agreedRatePence: null, stripeAvailable: false,
    })).toBe("confirm_after_form");
    expect(registrationPaymentPrerequisite({
      paymentType: "self_pay", paymentsEnabled: false, agreedRatePence: null, stripeAvailable: false,
    })).toBe("confirm_after_form");
  });

  it("versions editable terms only when content changes", () => {
    expect(nextTermsVersion(false, 4)).toBe(4);
    expect(nextTermsVersion(true, 4)).toBe(5);
  });

  it("accepts only an exact paid registration checkout correlation", () => {
    const exact = {
      paymentStatus: "paid", metadataTenantId: "tenant-a", metadataClientId: "client-a",
      metadataAttemptKey: "attempt-a", paymentLinkId: "plink-a", clientTenantId: "tenant-a",
      clientId: "client-a", currentAttemptKey: "attempt-a", currentPaymentLinkId: "plink-a",
    };
    expect(isCorrelatedRegistrationCheckout(exact)).toBe(true);
    expect(isCorrelatedRegistrationCheckout({ ...exact, paymentStatus: "unpaid" })).toBe(false);
    expect(isCorrelatedRegistrationCheckout({ ...exact, paymentLinkId: "stale-link" })).toBe(false);
    expect(isCorrelatedRegistrationCheckout({ ...exact, metadataAttemptKey: "stale-attempt" })).toBe(false);
    expect(isCorrelatedRegistrationCheckout({ ...exact, metadataTenantId: "tenant-b" })).toBe(false);
  });
});