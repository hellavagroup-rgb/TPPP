import { describe, expect, it } from "vitest";
import { formatEuropeLondonDateTime } from "./europeLondonTime";

describe("formatEuropeLondonDateTime", () => {
  it("formats summer deadlines in the London timezone with an explicit timezone label", () => {
    expect(formatEuropeLondonDateTime("2026-08-01T12:00:00.000Z")).toBe("1 Aug 2026, 13:00 BST (Europe/London)");
  });

  it("uses London winter time and handles invalid values", () => {
    expect(formatEuropeLondonDateTime("2026-01-01T12:00:00.000Z")).toBe("1 Jan 2026, 12:00 GMT (Europe/London)");
    expect(formatEuropeLondonDateTime("not-a-date")).toBe("Date unavailable (Europe/London)");
  });
});
