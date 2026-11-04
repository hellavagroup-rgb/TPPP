import { z } from "zod";
import { isValidDate, slotOccursOnDate, timeRangesOverlap, type DatedAvailabilitySlot } from "./timeOffBlocks";
import { practiceToday } from "./slotEligibility";

const date = z.string().refine(isValidDate, "Enter a valid calendar date.");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time.");
const common = { startTime: time, endTime: time, locationType: z.enum(["online", "in_person"]) };
export const availabilityEditSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("Recurring"),
    day: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
    startDate: date.nullable(), endDate: date.nullable(),
    frequency: z.enum(["weekly", "fortnightly"]),
  }).strict(),
  z.object({ ...common, type: z.literal("SpecificDate"), date }).strict(),
]).superRefine((value, ctx) => {
  if (value.startTime >= value.endTime) ctx.addIssue({ code: "custom", message: "End time must be after start time.", path: ["endTime"] });
  if (value.type === "SpecificDate" && value.date < practiceToday()) {
    ctx.addIssue({ code: "custom", message: "Choose today or a future date.", path: ["date"] });
  }
  if (value.type === "Recurring") {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({ code: "custom", message: "End date must not be before start date.", path: ["endDate"] });
    }
    if (value.endDate && value.endDate < practiceToday()) ctx.addIssue({ code: "custom", message: "The availability range must not have ended.", path: ["endDate"] });
    if (value.frequency === "fortnightly" && !value.startDate) ctx.addIssue({ code: "custom", message: "Fortnightly availability needs a start date.", path: ["startDate"] });
  }
});
export type AvailabilityEdit = z.infer<typeof availabilityEditSchema>;

/** Bind a selection to the appointment the visitor actually saw, not just its ID. */
export function slotScheduleFingerprint(slot: DatedAvailabilitySlot & { locationType?: string | null }): string {
  return JSON.stringify([slot.type, slot.day || null, slot.date || null, slot.startDate || null,
    slot.endDate || null, slot.startTime, slot.endTime, slot.frequency || "weekly", slot.locationType || "online"]);
}

/** Both fortnightly patterns repeat within 14 days of their intersecting windows. */
export function availabilitySlotsOverlap(a: DatedAvailabilitySlot, b: DatedAvailabilitySlot, today = practiceToday()): boolean {
  if (a.type !== "Vacation" && b.type !== "Vacation" && !timeRangesOverlap(a, b)) return false;
  const start = (s: DatedAvailabilitySlot) => s.type === "SpecificDate" ? s.date || today : s.startDate || s.date || today;
  const end = (s: DatedAvailabilitySlot) => s.type === "SpecificDate" ? s.date || today : s.endDate || (s.type === "Vacation" ? s.startDate || s.date || today : "9999-12-31");
  const from = [today, start(a), start(b)].sort().at(-1)!;
  const until = [end(a), end(b)].sort()[0];
  if (from > until) return false;
  const occurs = (s: DatedAvailabilitySlot, day: string) => s.type === "Vacation"
    ? day >= start(s) && day <= end(s) : slotOccursOnDate(s, day);
  const cursor = new Date(`${from}T12:00:00Z`);
  for (let n = 0; n < 15; n++, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    if (day > until) break;
    if (occurs(a, day) && occurs(b, day)) return true;
  }
  return false;
}
