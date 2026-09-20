import { describe, expect, it } from "vitest";
import {
  nextPaymentReturnCheck,
  PAYMENT_RETURN_POLL_TIMEOUT_MS,
} from "./paymentReturnPolling";

describe("nextPaymentReturnCheck", () => {
  it("keeps polling delayed webhooks within the bounded window", () => {
    expect(nextPaymentReturnCheck({ status: "processing", elapsedMs: 10_000 })).toBe("poll");
  });

  it("stops immediately for every terminal server result", () => {
    for (const status of ["confirmed", "paid", "invalid", "incomplete", "failed"]) {
      expect(nextPaymentReturnCheck({ status, elapsedMs: 0 })).toBe("stop");
    }
  });

  it("times out rather than polling forever", () => {
    expect(nextPaymentReturnCheck({
      status: "processing",
      elapsedMs: PAYMENT_RETURN_POLL_TIMEOUT_MS,
    })).toBe("timeout");
  });
});