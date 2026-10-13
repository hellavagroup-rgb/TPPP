import { describe, expect, it } from "vitest";
import { formCalendarDate, formatFormDate, selectedFormDate, serializeFormDates } from "./formDates";

const fields = [{ id: "dob", type: "date" }, { id: "notes", type: "textarea" }];

describe("calendar-only form dates", () => {
  it.each([
    [1992, 9, 14, "1992-09-14", "14/09/1992"],
    [1992, 1, 14, "1992-01-14", "14/01/1992"],
    [1992, 2, 29, "1992-02-29", "29/02/1992"],
    [1992, 12, 31, "1992-12-31", "31/12/1992"],
    [2026, 3, 29, "2026-03-29", "29/03/2026"],
    [2026, 10, 25, "2026-10-25", "25/10/2026"],
  ])("preserves %s-%s-%s through selection, JSON and draft reload", (year, month, day, iso, uk) => {
    const selected = selectedFormDate(new Date(year, month - 1, day));
    const submitted = JSON.parse(JSON.stringify(serializeFormDates(fields, { dob: selected, notes: "same" })));
    expect(submitted).toEqual({ dob: iso, notes: "same" });
    const restored = formCalendarDate(submitted.dob)!;
    expect([restored.getFullYear(), restored.getMonth() + 1, restored.getDate()]).toEqual([year, month, day]);
    expect(selectedFormDate(restored)).toBe(iso);
    expect(formatFormDate(submitted.dob)).toBe(uk);
  });

  it("also protects submission/draft boundaries from Date instances", () => {
    const input = { dob: new Date(1992, 8, 14), notes: "unchanged", availability: { Monday: ["Morning"] } };
    expect(JSON.parse(JSON.stringify(serializeFormDates(fields, input)))).toEqual({
      dob: "1992-09-14", notes: "unchanged", availability: { Monday: ["Morning"] },
    });
    expect(input.dob).toBeInstanceOf(Date);
  });

  it("does not reinterpret historic timestamp answers or other fields", () => {
    const old = { dob: "1992-09-13T23:00:00.000Z", notes: "1992-09-14" };
    expect(serializeFormDates(fields, old)).toEqual(old);
    expect(formatFormDate(old.dob)).toBe(old.dob);
    expect(formCalendarDate(old.dob)).toBeInstanceOf(Date);
  });

  it("handles empty, cleared and invalid dates without crashing", () => {
    expect(selectedFormDate(undefined)).toBeUndefined();
    expect(selectedFormDate(new Date("invalid"))).toBeUndefined();
    expect(formCalendarDate(null)).toBeUndefined();
    expect(formCalendarDate("invalid")).toBeUndefined();
    expect(formCalendarDate("1992-02-30")).toBeUndefined();
    expect(formatFormDate("1992-02-30")).toBe("1992-02-30");
    expect(formatFormDate(undefined)).toBe("");
  });
});
