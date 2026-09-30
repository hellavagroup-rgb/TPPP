import { describe, expect, it } from "vitest";
import {
  formatOfferDate,
  formatOfferFrequency,
  formatOfferTimeRange,
  formatOfferWindow,
} from "@shared/offerSchedule";

describe("offer schedule presentation", () => {
  it("formats a schedule window without deriving an appointment occurrence", () => {
    expect(formatOfferWindow("2026-06-01", "2026-11-30"))
      .toBe("Availability window: 1 Jun 2026 – 30 Nov 2026");
  });

  it("labels weekly and fortnightly frequency and presents a readable time range", () => {
    expect(formatOfferFrequency("weekly")).toBe("Weekly");
    expect(formatOfferFrequency("fortnightly")).toBe("Fortnightly");
    expect(formatOfferTimeRange("09:00", "10:30")).toBe("9:00 AM–10:30 AM");
  });

  it("formats an exact one-off date without changing its calendar day", () => {
    expect(formatOfferDate("2026-08-16")).toBe("16 Aug 2026");
    expect(formatOfferWindow("2026-08-16", null))
      .toBe("Availability window: from 16 Aug 2026 (no end date specified)");
  });
});