import { describe, expect, it } from "vitest";
import { shouldDeactivatePreviousPaymentLink } from "./stripe";

describe("shouldDeactivatePreviousPaymentLink", () => {
  it("never deactivates the link returned by an idempotent retry", () => {
    expect(shouldDeactivatePreviousPaymentLink("plink_same", "plink_same")).toBe(false);
  });

  it("deactivates a genuinely superseded payment link", () => {
    expect(shouldDeactivatePreviousPaymentLink("plink_old", "plink_new")).toBe(true);
  });
});