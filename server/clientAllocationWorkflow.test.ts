import { describe, expect, it } from "vitest";
import { shouldReleaseClientAllocation } from "./clientAllocationWorkflow";

describe("shouldReleaseClientAllocation", () => {
  it("releases a confirmed appointment when moving back to forms completed", () => {
    expect(
      shouldReleaseClientAllocation("BookingConfirmed", "Forms Completed"),
    ).toBe(true);
  });

  it.each([
    "OptionSelected",
    "RegistrationPending",
  ])("releases a reserved slot when moving back from %s", (status) => {
    expect(
      shouldReleaseClientAllocation(status, "Forms Completed"),
    ).toBe(true);
  });

  it("preserves an allocation while moving between allocated states", () => {
    expect(
      shouldReleaseClientAllocation("RegistrationPending", "BookingConfirmed"),
    ).toBe(false);
  });

  it("does not release an allocation for unrelated status changes", () => {
    expect(
      shouldReleaseClientAllocation("Forms Sent", "Forms Completed"),
    ).toBe(false);
  });
});