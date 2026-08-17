import { format, parseISO } from "date-fns";

export function formatDateUK(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "dd/MM/yyyy");
}

export function formatDateLongUK(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "d MMMM yyyy");
}

/**
 * Formats an assignedSlot string for display.
 * SpecificDate slots are stored as "YYYY-MM-DD HH:mm" and rendered as "16 Aug 2026 09:00".
 * Recurring slots are stored as "Monday HH:mm" and returned unchanged.
 */
export function formatAssignedSlot(slot: string): string {
  // Detect ISO date prefix: starts with 4-digit year, dash, etc.
  const isoDateMatch = slot.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (isoDateMatch) {
    const d = parseISO(isoDateMatch[1]);
    return `${format(d, "d MMM yyyy")} ${isoDateMatch[2]}`;
  }
  return slot;
}
