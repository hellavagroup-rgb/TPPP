import { describe, expect, it } from "vitest";
import { availabilityEditSchema, availabilitySlotsOverlap } from "./availabilityEdit";
import { parseRegistrationInsurerDetails } from "./insuranceDetails";

const weekly = { type: "Recurring" as const, day: "Monday", startDate: null, endDate: null, frequency: "weekly" as const, startTime: "10:00", endTime: "11:00", locationType: "online" as const };
describe("availability editing validation and overlaps", () => {
  it("accepts an ongoing series but rejects inverted times, arbitrary properties and invalid dates", () => {
    expect(availabilityEditSchema.safeParse(weekly).success).toBe(true);
    expect(availabilityEditSchema.safeParse({ ...weekly, endTime: "09:00" }).success).toBe(false);
    expect(availabilityEditSchema.safeParse({ ...weekly, isBooked: false }).success).toBe(false);
    expect(availabilityEditSchema.safeParse({ ...weekly, startDate: "2099-02-30" }).success).toBe(false);
    expect(availabilityEditSchema.safeParse({ ...weekly, frequency: "fortnightly" }).success).toBe(false);
  });
  it("distinguishes different weekdays, adjacent times and overlapping series", () => {
    expect(availabilitySlotsOverlap(weekly, { ...weekly })).toBe(true);
    expect(availabilitySlotsOverlap(weekly, { ...weekly, day: "Tuesday" })).toBe(false);
    expect(availabilitySlotsOverlap(weekly, { ...weekly, startTime: "11:00", endTime: "12:00" })).toBe(false);
  });
  it("checks actual single dates and nonintersecting date ranges", () => {
    expect(availabilitySlotsOverlap(weekly, { ...weekly, type: "SpecificDate", date: "2099-01-05" })).toBe(true);
    expect(availabilitySlotsOverlap(weekly, { ...weekly, type: "SpecificDate", date: "2099-01-06" })).toBe(false);
    expect(availabilitySlotsOverlap({ ...weekly, endDate: "2099-01-01" }, { ...weekly, startDate: "2099-02-01" })).toBe(false);
  });
  it("allows alternating fortnightly series but rejects matching weeks", () => {
    const a = { ...weekly, frequency: "fortnightly", startDate: "2099-01-05" };
    expect(availabilitySlotsOverlap(a, { ...a, startDate: "2099-01-12" })).toBe(false);
    expect(availabilitySlotsOverlap(a, { ...a, startDate: "2099-01-19" })).toBe(true);
  });
  it("protects whole-day vacation ranges", () => {
    expect(availabilitySlotsOverlap(weekly, { ...weekly, type: "Vacation", startDate: "2099-01-05", endDate: "2099-01-06", startTime: "00:00", endTime: "00:00" })).toBe(true);
  });
});
describe("saved insurance details", () => {
  it("reads all three saved fields without a new form submission", () => {
    expect(parseRegistrationInsurerDetails("Insurer name: Test Insurer\nInsurance policy number: TEST-POLICY\nPreauthorisation code: TEST-AUTH"))
      .toEqual({ insurerName: "Test Insurer", insurancePolicyNumber: "TEST-POLICY", preauthorisationCode: "TEST-AUTH" });
  });
  it("does not treat the following line as a blank field's value", () => {
    expect(parseRegistrationInsurerDetails("Insurer name:\nInsurance policy number:\nPreauthorisation code: TEST-AUTH"))
      .toEqual({ insurerName: "", insurancePolicyNumber: "", preauthorisationCode: "TEST-AUTH" });
  });
  it("preserves legacy details without inventing policy numbers", () => {
    expect(parseRegistrationInsurerDetails("Legacy insurer information")).toEqual({
      insurerName: "Legacy insurer information", insurancePolicyNumber: "", preauthorisationCode: "",
    });
  });
});
