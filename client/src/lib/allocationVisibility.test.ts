import { describe, expect, it } from "vitest";
import { appointmentText } from "@/components/AllocationVisibility";

describe("appointment card copy", () => {
  it("shows a recurring day/time and a dated one-off appointment", () => {
    expect(appointmentText({ clinicianName: "Clinician", type: "Recurring", day: "Tuesday",
      date: null, startTime: "10:00", endTime: "11:00", locationType: "online", retired: false }))
      .toBe("Tuesday 10:00–11:00");
    expect(appointmentText({ clinicianName: "Clinician", type: "SpecificDate", day: null,
      date: "2026-10-01", startTime: "09:00", endTime: "10:00", locationType: "online", retired: false }))
      .toBe("1 Oct 2026 09:00–10:00");
  });
  it("clearly labels missing appointment information", () => {
    expect(appointmentText(null)).toBe("Appointment details unavailable");
  });
  it("retains partial day or time information without inventing a start time", () => {
    const blank = { clinicianName: null, type: "Recurring", day: null, date: null,
      startTime: null, endTime: null, locationType: null, retired: false };
    expect(appointmentText({ ...blank, day: "Tuesday" })).toBe("Tuesday · Time unavailable");
    expect(appointmentText({ ...blank, startTime: "10:00" })).toBe("Day/date unavailable · 10:00");
    expect(appointmentText({ ...blank, endTime: "11:00" }))
      .toBe("Day/date unavailable · End 11:00 · start time unavailable");
    expect(appointmentText(blank)).toBe("Appointment day/time unavailable");
  });
  it("does not crash on invalid historical dates", () => {
    expect(appointmentText({ clinicianName: null, type: "SpecificDate", day: null,
      date: "2026-99-99", startTime: "10:00", endTime: null, locationType: null, retired: false }))
      .toBe("Appointment date unavailable");
  });
});