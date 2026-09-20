import { describe, expect, it } from "vitest";
import {
  ACTIVE_ALLOCATION_STATUSES,
  getOptionStatusForSlot,
  getSlotIntegrityAction,
  hasActiveClientAllocation,
  hasFinalizedBooking,
  shouldReleaseClientAllocation,
} from "./clientAllocationWorkflow";

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

describe("slot lifecycle integrity rules", () => {
  it.each(ACTIVE_ALLOCATION_STATUSES)(
    "treats %s as active ownership evidence",
    (status) => {
      expect(hasActiveClientAllocation(status)).toBe(true);
    },
  );

  it.each([
    [false, 0, "none"],
    [true, 0, "open"],
    [false, 1, "book"],
    [true, 1, "none"],
    [false, 2, "conflict"],
    [true, 2, "conflict"],
  ] as const)(
    "resolves booked=%s owners=%s as %s",
    (isBooked, owners, expected) => {
      expect(getSlotIntegrityAction(isBooked, owners)).toBe(expected);
    },
  );

  it("never re-books a retired slot, even when one active client references it", () => {
    expect(getSlotIntegrityAction(false, 1, true)).toBe("none");
    expect(getSlotIntegrityAction(true, 1, true)).toBe("open");
  });

  it.each(["Scheduled", "BookingConfirmed"])(
    "treats %s as a finalized booking whose slot must be retired",
    (status) => {
      expect(hasFinalizedBooking(status)).toBe(true);
    },
  );

  it("makes only pending options unavailable when a slot is retired", () => {
    expect(getOptionStatusForSlot("pending", false)).toBe("unavailable");
    expect(getOptionStatusForSlot("selected", false)).toBe("selected");
    expect(getOptionStatusForSlot("declined", false)).toBe("declined");
    expect(getOptionStatusForSlot("unavailable", false)).toBe("unavailable");
  });

  it("marks a pending legacy option without a slot unavailable", () => {
    expect(getOptionStatusForSlot("pending", false)).toBe("unavailable");
  });
});