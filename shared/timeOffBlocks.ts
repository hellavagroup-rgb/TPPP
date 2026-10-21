import { practiceToday } from "./slotEligibility";

const HOUR_TIME = /^(?:0[7-9]|1\d|20):00$/;
const END_TIME = /^(?:0[8-9]|1\d|20|21):00$/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type TimeOffBlockWindow = {
  date: string;
  startTime: string;
  endTime: string;
};

export type DatedAvailabilitySlot = {
  type: string;
  date?: string | null;
  day?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  frequency?: string | null;
  startTime: string;
  endTime: string;
};

export function isValidTimeOffBlockWindow(window: TimeOffBlockWindow): boolean {
  if (!isValidDate(window.date) || !HOUR_TIME.test(window.startTime) || !END_TIME.test(window.endTime)) return false;
  return window.startTime < window.endTime;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function timeRangesOverlap(
  first: Pick<TimeOffBlockWindow, "startTime" | "endTime">,
  second: Pick<TimeOffBlockWindow, "startTime" | "endTime">,
): boolean {
  return first.startTime < second.endTime && second.startTime < first.endTime;
}

function weekStartDay(value: string): number {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Math.floor(date.getTime() / 86_400_000) - ((date.getUTCDay() + 6) % 7);
}

export function slotOccursOnDate(slot: DatedAvailabilitySlot, date: string): boolean {
  if (!isValidDate(date)) return false;
  if (slot.type === "SpecificDate") return slot.date === date;
  if (slot.type !== "Recurring") return false;

  const weekday = WEEKDAYS[new Date(`${date}T12:00:00.000Z`).getUTCDay()];
  if (slot.day !== weekday) return false;
  if (slot.startDate && date < slot.startDate) return false;
  if (slot.endDate && date > slot.endDate) return false;
  if ((slot.frequency || "weekly") === "fortnightly" && slot.startDate) {
    const weeks = Math.floor((weekStartDay(date) - weekStartDay(slot.startDate)) / 7);
    if (weeks < 0 || weeks % 2 !== 0) return false;
  }
  return true;
}

export function timeOffBlockOverlapsSlot(
  block: TimeOffBlockWindow,
  slot: DatedAvailabilitySlot,
  occurrenceDate?: string,
): boolean {
  const date = slot.type === "SpecificDate" ? slot.date : occurrenceDate;
  return !!date && date === block.date && slotOccursOnDate(slot, date) && timeRangesOverlap(block, slot);
}

export function isSlotCoveredByTimeOffBlocks(
  slot: DatedAvailabilitySlot,
  blocks: readonly TimeOffBlockWindow[],
  occurrenceDate?: string,
): boolean {
  return blocks.some(block => timeOffBlockOverlapsSlot(block, slot, occurrenceDate));
}

/** Calendar cells are date-specific; a new recurring booking reserves every future occurrence. */
export function isSlotBlockedForBooking(
  slot: DatedAvailabilitySlot,
  blocks: readonly TimeOffBlockWindow[],
  occurrenceDate?: string,
  today = practiceToday(),
): boolean {
  if (slot.type !== "Recurring") return isSlotCoveredByTimeOffBlocks(slot, blocks, occurrenceDate);
  return blocks.some(block =>
    (block.date >= today || block.date === occurrenceDate)
    && slotOccursOnDate(slot, block.date)
    && timeRangesOverlap(block, slot),
  );
}
