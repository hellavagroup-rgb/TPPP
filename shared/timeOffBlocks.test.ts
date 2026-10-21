import { describe, expect, it } from "vitest";
import {
  isSlotCoveredByTimeOffBlocks,
  isValidTimeOffBlockWindow,
  slotOccursOnDate,
  timeRangesOverlap,
} from "./timeOffBlocks";

describe("date-specific time-off blocks", () => {
  const block = { date: "2026-10-21", startTime: "10:00", endTime: "12:00" };

  it("accepts valid whole-hour windows and rejects invalid dates, minutes, and boundaries", () => {
    expect(isValidTimeOffBlockWindow(block)).toBe(true);
    expect(isValidTimeOffBlockWindow({ ...block, date: "2026-02-30" })).toBe(false);
    expect(isValidTimeOffBlockWindow({ ...block, startTime: "10:30" })).toBe(false);
    expect(isValidTimeOffBlockWindow({ ...block, startTime: "06:00" })).toBe(false);
    expect(isValidTimeOffBlockWindow({ ...block, endTime: "22:00" })).toBe(false);
    expect(isValidTimeOffBlockWindow({ ...block, endTime: "10:00" })).toBe(false);
  });

  it("matches only the specified occurrence date, not other weeks of recurring availability", () => {
    const recurring = {
      type: "Recurring",
      day: "Wednesday",
      startDate: "2026-10-07",
      endDate: null,
      frequency: "weekly",
      startTime: "10:00",
      endTime: "11:00",
    };
    expect(slotOccursOnDate(recurring, block.date)).toBe(true);
    expect(isSlotCoveredByTimeOffBlocks(recurring, [block], block.date)).toBe(true);
    expect(isSlotCoveredByTimeOffBlocks(recurring, [block], "2026-10-28")).toBe(false);
    expect(isSlotCoveredByTimeOffBlocks(recurring, [block])).toBe(false);
  });

  it("respects fortnightly recurrence and exact-date slots", () => {
    const fortnightly = {
      type: "Recurring",
      day: "Wednesday",
      startDate: "2026-10-07",
      endDate: null,
      frequency: "fortnightly",
      startTime: "10:00",
      endTime: "11:00",
    };
    expect(slotOccursOnDate(fortnightly, "2026-10-21")).toBe(true);
    expect(slotOccursOnDate(fortnightly, "2026-10-28")).toBe(false);
    expect(isSlotCoveredByTimeOffBlocks({
      ...fortnightly,
      type: "SpecificDate",
      date: block.date,
    }, [block])).toBe(true);
  });

  it("uses half-open overlap boundaries so adjacent hours do not conflict", () => {
    expect(timeRangesOverlap(block, { startTime: "11:00", endTime: "13:00" })).toBe(true);
    expect(timeRangesOverlap(block, { startTime: "12:00", endTime: "13:00" })).toBe(false);
  });
});
