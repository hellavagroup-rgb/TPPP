import { describe, expect, it } from "vitest";
import {
  paymentLinkCreationIdempotencyKey,
  shouldDeactivatePreviousPaymentLink,
} from "./stripe";

describe("shouldDeactivatePreviousPaymentLink", () => {
  it("never deactivates the link returned by an idempotent retry", () => {
    expect(shouldDeactivatePreviousPaymentLink("plink_same", "plink_same")).toBe(false);
  });

  it("deactivates a genuinely superseded payment link", () => {
    expect(shouldDeactivatePreviousPaymentLink("plink_old", "plink_new")).toBe(true);
  });
});

describe("paymentLinkCreationIdempotencyKey", () => {
  it("does not reuse payment links created under the old lifecycle", () => {
    expect(paymentLinkCreationIdempotencyKey("registration-payment-client-attempt"))
      .toBe("registration-payment-client-attempt-link-v2");
  });
});