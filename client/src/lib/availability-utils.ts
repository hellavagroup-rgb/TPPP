import { format } from "date-fns";

/**
 * Splits a time range into consecutive 1-hour slots.
 * E.g. "09:00"→"11:00" produces [{start:"09:00",end:"10:00"},{start:"10:00",end:"11:00"}]
 */
export function splitIntoHourlySlots(
  startTime: string,
  endTime: string,
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  for (let mins = startMinutes; mins + 60 <= endMinutes; mins += 60) {
    const slotStartHour = Math.floor(mins / 60);
    const slotStartMin = mins % 60;
    const slotEndHour = Math.floor((mins + 60) / 60);
    const slotEndMin = (mins + 60) % 60;

    slots.push({
      start: `${String(slotStartHour).padStart(2, "0")}:${String(slotStartMin).padStart(2, "0")}`,
      end: `${String(slotEndHour).padStart(2, "0")}:${String(slotEndMin).padStart(2, "0")}`,
    });
  }

  return slots;
}

/**
 * Returns the time one hour after `time`, capped at "21:00".
 * Any start time ≥ 20:00 returns "21:00" (the hard end-of-day ceiling).
 */
export function addOneHour(time: string): string {
  const [hour, min] = time.split(":").map(Number);
  const newHour = hour + 1;
  if (newHour > 21 || (newHour === 21 && min > 0)) return "21:00";
  return `${String(newHour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * All selectable times from 07:00 to 21:00 in 15-minute increments.
 * Start-time dropdown is filtered to ≤ 20:00; end-time shows the full list.
 */
export const TIME_OPTIONS: string[] = Array.from({ length: 14 * 4 + 1 }, (_, i) => {
  const hour = Math.floor(i / 4) + 7;
  const minute = (i % 4) * 15;
  const date = new Date();
  date.setHours(hour, minute);
  return format(date, "HH:mm");
});
