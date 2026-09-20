import { describe, expect, it } from "vitest";
import { confirmationStatus } from "./bookingConfirmation";

describe("booking confirmation contract", () => {
  it.each([
    [true, "BookingConfirmed"],
    [false, "Scheduled"],
  ] as const)("derives the final status for tenant feature state", (enabled, expected) => {
    expect(confirmationStatus(enabled)).toBe(expected);
  });
});