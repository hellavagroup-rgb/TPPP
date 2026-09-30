import { describe, expect, it } from "vitest";
import { practiceToday, slotUnavailableReason } from "@shared/slotEligibility";

describe("slot eligibility", () => {
  it("uses the practice's UK calendar date", () => {
    expect(practiceToday(new Date("2026-07-01T23:30:00.000Z"))).toBe("2026-07-02");
  });

  it("accepts a future one-off appointment and one on the current date", () => {
    expect(slotUnavailableReason({ type: "SpecificDate", date: "2999-09-10" }, "2026-09-10")).toBeNull();
    expect(slotUnavailableReason({ type: "SpecificDate", date: "2026-09-10" }, "2026-09-10")).toBeNull();
  });

  it("rejects past one-off appointments and invalid dates", () => {
    expect(slotUnavailableReason({ type: "SpecificDate", date: "2026-09-09" }, "2026-09-10"))
      .toBe("is no longer available");
    expect(slotUnavailableReason({ type: "SpecificDate", date: "2026-02-30" }, "2026-09-10"))
      .toBe("has no valid appointment date");
    expect(slotUnavailableReason({ type: "SpecificDate", date: null }, "2026-09-10"))
      .toBe("has no valid appointment date");
  });

  it("allows recurring availability on both inclusive start and end dates", () => {
    expect(slotUnavailableReason({
      type: "Recurring", startDate: "2026-09-10", endDate: "2026-09-10",
    }, "2026-09-10")).toBeNull();
    expect(slotUnavailableReason({ type: "Recurring", startDate: "2026-09-10" }, "2026-09-10")).toBeNull();
    expect(slotUnavailableReason({ type: "Recurring", endDate: "2026-09-10" }, "2026-09-10")).toBeNull();
  });

  it("rejects recurring windows before their start or after their end", () => {
    expect(slotUnavailableReason({ type: "Recurring", startDate: "2026-09-11" }, "2026-09-10"))
      .toBe("is not yet available");
    expect(slotUnavailableReason({ type: "Recurring", endDate: "2026-09-09" }, "2026-09-10"))
      .toBe("is no longer available");
  });

  it("rejects invalid recurring dates and reversed windows", () => {
    expect(slotUnavailableReason({ type: "Recurring", startDate: "2026-02-30" }, "2026-09-10"))
      .toBe("has an invalid availability window");
    expect(slotUnavailableReason({
      type: "Recurring", startDate: "2026-09-11", endDate: "2026-09-10",
    }, "2026-09-10")).toBe("has an invalid availability window");
  });

  it.each([
    [{ type: "Vacation" }, "is not available for appointments"],
    [{ type: "Recurring", retiredAt: new Date("2026-01-01") }, "has been retired"],
    [{ type: "SpecificDate", date: "2999-09-10", isBooked: true }, "is already booked"],
    [{ type: "Unrecognized" }, "is not available for appointments"],
  ])("rejects unavailable slot state %j", (slot, reason) => {
    expect(slotUnavailableReason(slot, "2026-09-10")).toBe(reason);
  });
});