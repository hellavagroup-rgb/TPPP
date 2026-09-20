import { describe, it, expect } from "vitest";
import {
  addOneHour,
  canCommitSlotSelection,
  createLatestRequestGuard,
  findAvailabilityInSubmissions,
  findSessionFormatPreference,
  getSessionFormatMismatch,
  getSlotUnavailableReason,
  normalizeAvailabilityValue,
  rankSlotsByAvailability,
  slotMatchesAvailability,
  splitIntoHourlySlots,
  TIME_OPTIONS,
} from "./availability-utils";

describe("allocation availability", () => {
  const sessionSubmission = (answer: unknown, options = ["Online", "In-person"]) => [{
    formFields: [{ id: "tenant-specific-random-id", label: "Any tenant wording", type: "checkbox", options }],
    responses: { "tenant-specific-random-id": answer },
  }];

  it.each([
    ["Online", "online"],
    ["In-person", "in_person"],
    [["Online", "In-person"], "both"],
    ["Hybrid", "both"],
    ["Both", "both"],
  ])("finds the configured session-format field and normalizes %j", (answer, expected) => {
    expect(findSessionFormatPreference(sessionSubmission(answer, ["Online", "In-person", "Hybrid"]))).toBe(expected);
  });

  it("ignores labels and historic answers that do not establish a supported preference", () => {
    expect(findSessionFormatPreference(sessionSubmission("At home"))).toBeNull();
    expect(findSessionFormatPreference(sessionSubmission("Online", ["Remote", "In-person"]))).toBeNull();
    expect(findSessionFormatPreference([{ formFields: [], responses: {} }])).toBeNull();
    expect(findSessionFormatPreference(null)).toBeNull();
  });

  it("detects both mismatch directions while allowing matching, both, and missing preferences", () => {
    expect(getSessionFormatMismatch("online", "in_person")).toEqual({ preference: "online", slotFormat: "in_person" });
    expect(getSessionFormatMismatch("in_person", "online")).toEqual({ preference: "in_person", slotFormat: "online" });
    expect(getSessionFormatMismatch("online", "online")).toBeNull();
    expect(getSessionFormatMismatch("both", "online")).toBeNull();
    expect(getSessionFormatMismatch(null, "in_person")).toBeNull();
  });

  it("blocks rapid slot selection until preference data has resolved", () => {
    expect(canCommitSlotSelection(true)).toBe(false);
    expect(canCommitSlotSelection(false)).toBe(true);
  });

  it("rejects a stale preference response after switching clients", () => {
    const requests = createLatestRequestGuard();
    const firstClientRequest = requests.begin();
    const secondClientRequest = requests.begin();
    expect(requests.isLatest(firstClientRequest)).toBe(false);
    expect(requests.isLatest(secondClientRequest)).toBe(true);
  });

  it("normalizes broad periods using documented boundaries and preserves selected terms", () => {
    const result = normalizeAvailabilityValue({ Monday: ["Morning", "Evening"], Sunday: ["Afternoon"] });
    expect(result).toMatchObject({
      status: "available",
      selections: { Monday: ["Morning", "Evening"], Sunday: ["Afternoon"] },
      windows: {
        Monday: [
          { start: "07:00", end: "12:00", label: "Morning" },
          { start: "17:00", end: "21:00", label: "Evening" },
        ],
      },
    });
  });

  it("normalizes exact times as one-hour windows", () => {
    expect(normalizeAvailabilityValue({ Tuesday: ["09:30"] })).toMatchObject({
      status: "available",
      windows: { Tuesday: [{ start: "09:30", end: "10:30", label: "09:30" }] },
    });
  });

  it("requires the full recurring appointment to fit a selected window", () => {
    const availability = normalizeAvailabilityValue({ Monday: ["Morning"] });
    expect(slotMatchesAvailability({ type: "Recurring", day: "Monday", startTime: "11:00", endTime: "12:00" }, availability)).toBe(true);
    expect(slotMatchesAvailability({ type: "Recurring", day: "Monday", startTime: "11:30", endTime: "12:30" }, availability)).toBe(false);
    expect(slotMatchesAvailability({ type: "Recurring", day: "Monday", startTime: "06:45", endTime: "07:45" }, availability)).toBe(false);
  });

  it("derives the weekday for specific-date slots without UTC date drift", () => {
    const availability = normalizeAvailabilityValue({ Monday: ["17:00"] });
    expect(slotMatchesAvailability({ type: "SpecificDate", date: "2026-09-21", startTime: "17:00", endTime: "18:00" }, availability)).toBe(true);
  });

  it("reports missing and malformed historic answers explicitly", () => {
    expect(findAvailabilityInSubmissions([{ responses: { name: "A" } }]).status).toBe("missing");
    expect(findAvailabilityInSubmissions([{ responses: { availability: { Monday: ["Any time"] } } }]).status).toBe("malformed");
    expect(slotMatchesAvailability(
      { day: "Monday", startTime: "09:00", endTime: "10:00" },
      { status: "missing", selections: null, windows: null },
    )).toBeNull();
  });

  it("orders selectable matches before selectable non-matches and unavailable slots", () => {
    const availability = normalizeAvailabilityValue({ Monday: ["Morning"] });
    const slots = [
      { id: "booked", day: "Monday", startTime: "09:00", endTime: "10:00" },
      { id: "outside", day: "Monday", startTime: "14:00", endTime: "15:00" },
      { id: "match", day: "Monday", startTime: "10:00", endTime: "11:00" },
    ];
    expect(rankSlotsByAvailability(slots, availability, slot => slot.id === "booked" ? "Booked" : null).map(slot => slot.id))
      .toEqual(["match", "outside", "booked"]);
  });

  it.each([
    [{ isBooked: true, isPending: false, hasClinicianCapacity: true, adminOverride: false, zoomLinkRequired: false }, "Booked"],
    [{ isBooked: false, isPending: false, hasClinicianCapacity: false, adminOverride: false, zoomLinkRequired: false }, "No clinician capacity"],
    [{ isBooked: false, isPending: false, hasClinicianCapacity: true, adminOverride: false, zoomLinkRequired: true }, "Zoom link required"],
    [{ isBooked: false, isPending: true, hasClinicianCapacity: true, adminOverride: false, zoomLinkRequired: false }, "Not yet available"],
  ])("labels unavailable slots precisely", (input, reason) => {
    expect(getSlotUnavailableReason(input)).toBe(reason);
  });

  it("lets Admin Override bypass capacity without bypassing slot restrictions", () => {
    expect(getSlotUnavailableReason({
      isBooked: false, isPending: false, hasClinicianCapacity: false, adminOverride: true, zoomLinkRequired: false,
    })).toBeNull();
    expect(getSlotUnavailableReason({
      isBooked: true, isPending: false, hasClinicianCapacity: false, adminOverride: true, zoomLinkRequired: false,
    })).toBe("Booked");
  });
});

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
