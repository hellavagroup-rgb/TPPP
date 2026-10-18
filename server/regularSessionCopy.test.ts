import { beforeEach, describe, expect, it, vi } from "vitest";
import { CYA_PSYCHOLOGY_TENANT_ID, usesRegularSessionCopy, regularSessionConstraints,
  FIRST_SESSION_TO_AGREE, REGULAR_SESSION_NEXT_STEPS, REGULAR_SESSION_CONFIRMED } from "@shared/regularSessionCopy";

vi.mock("./storage", () => ({ storage: { getEmailTemplateByKey: vi.fn() } }));
import { storage } from "./storage";
import { generateAllocationOptionsEmail, generateBookingConfirmedEmail } from "./email";

const cya = { id: CYA_PSYCHOLOGY_TENANT_ID, name: "CY&A Psychology", fromEmail: "practice@example.test" };
const other = { ...cya, id: "another-practice" };
const option = {
  clinicianName: "Dr Test", type: "Recurring", day: "Wednesday", date: null,
  startTime: "15:00", endTime: "16:00", frequency: "weekly", locationType: "online",
  startDate: "2020-10-07", endDate: null, selectionToken: "token",
};
beforeEach(() => { vi.mocked(storage.getEmailTemplateByKey).mockReset().mockResolvedValue(undefined); });

describe("Tenant 2-only recurring session wording", () => {
  it("is an exact tenant policy, not inferred from a name, missing context or other flags", () => {
    expect(usesRegularSessionCopy(cya.id)).toBe(true);
    for (const id of [other.id, "0199f88e-fc37-453f-8e14-1152f790d40b", undefined, null, ""]) {
      expect(usesRegularSessionCopy(id)).toBe(false);
    }
  });

  it("removes historical start dates while preserving real future and end restrictions", () => {
    expect(regularSessionConstraints("2020-10-07", null, "2026-10-18")).toEqual([]);
    expect(regularSessionConstraints("2026-10-18", null, "2026-10-18")).toEqual([]);
    expect(regularSessionConstraints("2026-11-02", "2027-03-01", "2026-10-18")).toEqual([
      "Available from 2 Nov 2026 (earliest possible start; first session date to be agreed).",
      "Regular slot availability ends 1 Mar 2027.",
    ]);
  });

  it.each(["weekly", "fortnightly"])("explains %s offers in HTML and plain text without past dates or deadlines", async frequency => {
    const email = await generateAllocationOptionsEmail([{ ...option, frequency }], "https://app.test/options/token", cya);
    for (const content of [email.text!, email.html]) {
      expect(content).toContain("Regular session slot");
      expect(content).toContain(frequency === "weekly" ? "Weekly" : "Fortnightly");
      expect(content).toContain("Wednesday");
      expect(content).toContain("3:00 PM–4:00 PM");
      expect(content).toContain("Online");
      expect(content).toContain(FIRST_SESSION_TO_AGREE);
      expect(content).toContain(REGULAR_SESSION_NEXT_STEPS);
      expect(content).not.toMatch(/7 Oct 2020|2020-10-07|Availability window|within.*weeks/i);
    }
  });

  it("does not hide a genuine future earliest start in an offer email", async () => {
    const email = await generateAllocationOptionsEmail([{ ...option, startDate: "2099-10-07" }], "https://app.test", cya);
    expect(email.text).toContain("Available from 7 Oct 2099 (earliest possible start; first session date to be agreed).");
  });

  it("keeps Tenant 1 and other practices' existing offer output", async () => {
    const email = await generateAllocationOptionsEmail([option], "https://app.test", other);
    expect(email.text).toContain("Option 1: Weekly — Wednesday, 3:00 PM–4:00 PM (Online)");
    expect(email.text).toContain("Availability window: from 7 Oct 2020 (no end date specified)");
    expect(email.text).toContain("First appointment date to be confirmed.");
    expect(email.text).not.toContain("Regular session slot");
    expect(email.text).not.toContain(REGULAR_SESSION_NEXT_STEPS);
  });

  it("applies the wording inside stored options templates without changing their other content", async () => {
    vi.mocked(storage.getEmailTemplateByKey).mockResolvedValue({
      subject: "Options from {{practice_name}}", bodyText: "Custom introduction\n{{options_list}}\n{{portal_link}}\nCustom footer",
    } as any);
    const email = await generateAllocationOptionsEmail([option], "https://app.test", cya);
    expect(email.subject).toBe("Options from CY&A Psychology");
    expect(email.text).toContain("Custom introduction");
    expect(email.text).toContain("Custom footer");
    expect(email.text).toContain(FIRST_SESSION_TO_AGREE);
    expect(storage.getEmailTemplateByKey).toHaveBeenCalledWith("allocation_options", cya.id);
  });

  it("confirms the regular slot, not a first date, in recurring confirmation emails", async () => {
    const email = await generateBookingConfirmedEmail(option, cya);
    expect(email.subject).toBe("Regular Session Slot Confirmed - CY&A Psychology");
    for (const content of [email.text!, email.html]) {
      expect(content).toContain(REGULAR_SESSION_CONFIRMED);
      expect(content).toContain(FIRST_SESSION_TO_AGREE);
      expect(content).toContain("Our admin team will contact you to agree the date of your first session.");
      expect(content).toContain("Wednesday 15:00–16:00");
      expect(content).not.toMatch(/7 Oct|within.*weeks/i);
    }
  });

  it("preserves custom confirmation content and subject while adding the clarification only for Tenant 2", async () => {
    vi.mocked(storage.getEmailTemplateByKey).mockResolvedValue({
      subject: "Welcome to {{practice_name}}",
      bodyText: "Custom introduction\n{{clinician_name}}\n{{appointment_time}}\nCustom footer",
    } as any);
    const email = await generateBookingConfirmedEmail(option, cya);
    expect(email.subject).toBe("Welcome to CY&A Psychology");
    expect(email.text).toContain("Custom introduction\nDr Test\nWednesday 15:00–16:00\nCustom footer");
    expect(email.text).toContain(REGULAR_SESSION_CONFIRMED);
    const unchanged = await generateBookingConfirmedEmail(option, other);
    expect(unchanged.text).toBe("Custom introduction\nDr Test\nWednesday 15:00–16:00\nCustom footer");
  });

  it("keeps other practices' default confirmation exactly unchanged", async () => {
    const email = await generateBookingConfirmedEmail(option, other);
    expect(email.subject).toBe("Booking Confirmed - CY&A Psychology");
    expect(email.text).toBe(`Your booking is confirmed.

Appointment Details:
Clinician: Dr Test
Time: Wednesday 15:00–16:00

If you have any questions or need to make changes, please don't hesitate to contact us.

Warm regards,
CY&A Psychology Team`);
  });

  it("keeps genuine one-off dates and all one-off email output identical across both policies", async () => {
    const oneoff = { ...option, type: "SpecificDate", date: "2099-10-07", day: null };
    const offers = await Promise.all([cya, other].map(tenant =>
      generateAllocationOptionsEmail([oneoff], "https://app.test", tenant)));
    expect(offers[0]).toEqual(offers[1]);
    expect(offers[0].text).toContain("One-off appointment — 7 Oct 2099");
    const confirmations = await Promise.all([cya, other].map(tenant => generateBookingConfirmedEmail(oneoff, tenant)));
    expect(confirmations[0]).toEqual(confirmations[1]);
    expect(confirmations[0].text).toContain("7 Oct 2099");
    expect(confirmations[0].text).not.toContain(FIRST_SESSION_TO_AGREE);
  });
});
