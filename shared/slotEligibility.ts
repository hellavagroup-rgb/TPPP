/** Calendar dates are interpreted in the practice's UK timezone, not the browser's. */
export function practiceToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

type EligibleSlot = {
  type: string;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isBooked?: boolean;
  retiredAt?: unknown;
};

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Availability may be reserved in advance; the start date is not brought forward. */
export function slotUnavailableReason(slot: EligibleSlot, today = practiceToday()): string | null {
  if (slot.retiredAt) return "has been retired";
  if (slot.isBooked) return "is already booked";
  if (slot.type === "Vacation") return "is not available for appointments";
  if (slot.type === "SpecificDate") {
    if (!slot.date || !validDate(slot.date)) return "has no valid appointment date";
    return slot.date < today ? "is no longer available" : null;
  }
  if (slot.type !== "Recurring") return "is not available for appointments";
  if ((slot.startDate && !validDate(slot.startDate)) || (slot.endDate && !validDate(slot.endDate))
    || (slot.startDate && slot.endDate && slot.startDate > slot.endDate)) {
    return "has an invalid availability window";
  }
  if (slot.endDate && slot.endDate < today) return "is no longer available";
  return null;
}