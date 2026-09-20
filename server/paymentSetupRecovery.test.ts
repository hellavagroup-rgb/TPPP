import { describe, expect, it } from "vitest";
import {
  classifyPaymentSetupProviderFailure,
  paymentSetupFailureMessage,
  paymentSetupRecoveryHref,
} from "./paymentSetupRecovery";

describe("automatic payment setup recovery", () => {
  it("keeps administrator warnings actionable and free of provider details", () => {
    expect(paymentSetupFailureMessage("client_rate_required")).toContain("agreed session rate");
    expect(paymentSetupFailureMessage("stripe_unavailable")).toContain("Payment settings");
    expect(paymentSetupFailureMessage("provider_rejected")).toContain("Stripe account");
    expect(paymentSetupFailureMessage("provider_transient")).toContain("Retry");
    expect(paymentSetupFailureMessage("interrupted")).toContain("interrupted");
  });

  it("separates provider rejection from retryable or ambiguous failures", () => {
    expect(classifyPaymentSetupProviderFailure({ type: "StripeInvalidRequestError", message: "secret detail" }))
      .toBe("provider_rejected");
    expect(classifyPaymentSetupProviderFailure({ statusCode: 429 })).toBe("provider_transient");
    expect(classifyPaymentSetupProviderFailure(new Error("network failure"))).toBe("provider_transient");
  });

  it("routes configuration failures to settings and client-specific failures to the client", () => {
    expect(paymentSetupRecoveryHref("stripe_unavailable", "client-a")).toBe("/settings?tab=payments");
    expect(paymentSetupRecoveryHref("client_rate_required", "client a")).toBe("/clients?clientId=client%20a");
  });
});