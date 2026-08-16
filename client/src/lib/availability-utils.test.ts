import { describe, it, expect } from "vitest";
import { addOneHour, splitIntoHourlySlots, TIME_OPTIONS } from "./availability-utils";

// ---------------------------------------------------------------------------
// addOneHour
// ---------------------------------------------------------------------------
describe("addOneHour", () => {
  it("adds one hour to a normal mid-day time", () => {
    expect(addOneHour("09:00")).toBe("10:00");
    expect(addOneHour("14:30")).toBe("15:30");
  });

  it("returns 21:00 when start is 20:00 (on-the-hour cap)", () => {
    expect(addOneHour("20:00")).toBe("21:00");
  });

  it("returns 21:00 when start is 20:30 (half-hour cap)", () => {
    expect(addOneHour("20:30")).toBe("21:00");
  });

  it("returns 21:00 when start is 20:15", () => {
    expect(addOneHour("20:15")).toBe("21:00");
  });

  it("returns 21:00 when start is 20:45", () => {
    expect(addOneHour("20:45")).toBe("21:00");
  });

  it("returns 21:00 for start times already at 21:00", () => {
    // 21:00 + 1 = 22:00 > 21 → capped
    expect(addOneHour("21:00")).toBe("21:00");
  });

  it("handles the boundary just below the cap: 19:00 → 20:00", () => {
    expect(addOneHour("19:00")).toBe("20:00");
  });

  it("handles the boundary just below the cap: 19:30 → 20:30", () => {
    expect(addOneHour("19:30")).toBe("20:30");
  });
});

// ---------------------------------------------------------------------------
// splitIntoHourlySlots – late-evening window
// ---------------------------------------------------------------------------
describe("splitIntoHourlySlots – late-evening window", () => {
  it("produces a single 20:00–21:00 slot when start=20:00 end=21:00", () => {
    const slots = splitIntoHourlySlots("20:00", "21:00");
    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual({ start: "20:00", end: "21:00" });
  });

  it("produces no slots when start=20:30 end=21:00 (< 1 full hour)", () => {
    // 30-minute gap cannot fill a 1-hour slot
    const slots = splitIntoHourlySlots("20:30", "21:00");
    expect(slots).toHaveLength(0);
  });

  it("produces a single 20:00–21:00 slot for start=20:00 end=21:00 (exact)", () => {
    const slots = splitIntoHourlySlots("20:00", "21:00");
    expect(slots[0].start).toBe("20:00");
    expect(slots[0].end).toBe("21:00");
  });

  it("produces two slots for 19:00–21:00", () => {
    const slots = splitIntoHourlySlots("19:00", "21:00");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({ start: "19:00", end: "20:00" });
    expect(slots[1]).toEqual({ start: "20:00", end: "21:00" });
  });

  it("produces three slots for 18:00–21:00", () => {
    const slots = splitIntoHourlySlots("18:00", "21:00");
    expect(slots).toHaveLength(3);
    expect(slots[2]).toEqual({ start: "20:00", end: "21:00" });
  });

  it("returns empty array when start equals end", () => {
    expect(splitIntoHourlySlots("20:00", "20:00")).toHaveLength(0);
  });

  it("returns empty array when range is less than one hour", () => {
    expect(splitIntoHourlySlots("20:00", "20:30")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TIME_OPTIONS – range and late-evening entries
// ---------------------------------------------------------------------------
describe("TIME_OPTIONS", () => {
  it("starts at 07:00", () => {
    expect(TIME_OPTIONS[0]).toBe("07:00");
  });

  it("ends at 21:00", () => {
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1]).toBe("21:00");
  });

  it("includes 20:00", () => {
    expect(TIME_OPTIONS).toContain("20:00");
  });

  it("includes 20:15", () => {
    expect(TIME_OPTIONS).toContain("20:15");
  });

  it("includes 20:30", () => {
    expect(TIME_OPTIONS).toContain("20:30");
  });

  it("includes 20:45", () => {
    expect(TIME_OPTIONS).toContain("20:45");
  });

  it("includes 21:00 as the last valid end time", () => {
    expect(TIME_OPTIONS).toContain("21:00");
  });

  it("does NOT include times after 21:00", () => {
    const afterCap = TIME_OPTIONS.filter(t => t > "21:00");
    expect(afterCap).toHaveLength(0);
  });

  it("start-time dropdown (≤ 20:00) includes 20:00 as the last entry", () => {
    const startOptions = TIME_OPTIONS.filter(t => t <= "20:00");
    expect(startOptions[startOptions.length - 1]).toBe("20:00");
  });

  it("start-time dropdown (≤ 20:00) does NOT include 20:15 or later", () => {
    const startOptions = TIME_OPTIONS.filter(t => t <= "20:00");
    expect(startOptions).not.toContain("20:15");
    expect(startOptions).not.toContain("20:30");
    expect(startOptions).not.toContain("20:45");
    expect(startOptions).not.toContain("21:00");
  });
});
