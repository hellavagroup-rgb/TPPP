import { describe, expect, it } from "vitest";
import {
  childNameFromClientNotes,
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
      .toBe("registration-payment-client-attempt-link-v3");
  });
});

describe("childNameFromClientNotes", () => {
  it("extracts the child name recorded during intake conversion", () => {
    expect(childNameFromClientNotes("Client name: Parent Name\nChild's name: Alex Example"))
      .toBe("Alex Example");
  });

  it("supports a typographic apostrophe and omits absent names", () => {
    expect(childNameFromClientNotes("Child’s name: Sam Example")).toBe("Sam Example");
    expect(childNameFromClientNotes("Client name: Adult Example")).toBeUndefined();
  });
});