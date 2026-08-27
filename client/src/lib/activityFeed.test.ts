import { describe, expect, it } from "vitest";
import { ACTIVITY_TABS, DEFAULT_ACTIVITY_CATEGORY } from "./activityFeed";

describe("activity feed tabs", () => {
  it("opens on All Activity and lists it first", () => {
    expect(DEFAULT_ACTIVITY_CATEGORY).toBe("all");
    expect(ACTIVITY_TABS[0]).toEqual({ value: "all", label: "All Activity" });
  });
});