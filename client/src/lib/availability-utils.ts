import { format } from "date-fns";

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type Weekday = typeof WEEKDAYS[number];
export type AvailabilityPeriod = "Morning" | "Afternoon" | "Evening";
export type AvailabilityWindow = { start: string; end: string; label: string };
export type NormalizedAvailability =
  | { status: "available"; selections: Partial<Record<Weekday, string[]>>; windows: Partial<Record<Weekday, AvailabilityWindow[]>> }
  | { status: "missing" | "malformed"; selections: null; windows: null };

export type SessionFormat = "online" | "in_person";
export type SessionFormatPreference = SessionFormat | "both" | null;

export function formatSessionFormatPreference(preference: SessionFormatPreference): string | null {
  if (preference === "online") return "Online";
  if (preference === "in_person") return "In-person";
  if (preference === "both") return "Both";
  return null;
}

type FormField = {
  id?: unknown;
  name?: unknown;
  options?: unknown;
};

function normalizedFormatTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function formatFromAnswer(value: unknown): SessionFormatPreference {
  const values = Array.isArray(value) ? value : [value];
  let online = false;
  let inPerson = false;
  for (const item of values) {
    const term = normalizedFormatTerm(item);
    if (term === "online") online = true;
    else if (term === "in person") inPerson = true;
    else if (term === "hybrid" || term === "both" || term === "online and in person" || term === "online & in person") {
      online = true;
      inPerson = true;
    }
  }
  if (online && inPerson) return "both";
  if (online) return "online";
  if (inPerson) return "in_person";
  return null;
}

/**
 * Finds a session-format response by the configured choices, not a tenant-specific
 * field id or label. Unknown historic formats are deliberately ignored.
 */
export function findSessionFormatPreference(submissions: unknown): SessionFormatPreference {
  if (!Array.isArray(submissions)) return null;
  for (const submission of submissions) {
    if (!submission || typeof submission !== "object") continue;
    const { formFields, responses } = submission as { formFields?: unknown; responses?: unknown };
    if (!Array.isArray(formFields) || !responses || typeof responses !== "object" || Array.isArray(responses)) continue;
    for (const field of formFields as FormField[]) {
      if (!field || !Array.isArray(field.options)) continue;
      const optionTerms = field.options.map(normalizedFormatTerm);
      if (!optionTerms.includes("online") || !optionTerms.includes("in person")) continue;
      const key = typeof field.id === "string" ? field.id : typeof field.name === "string" ? field.name : null;
      if (!key) continue;
      const preference = formatFromAnswer((responses as Record<string, unknown>)[key]);
      if (preference) return preference;
    }
  }
  return null;
}

export function getSessionFormatMismatch(
  preference: SessionFormatPreference,
  slotFormat: unknown,
): { preference: SessionFormat; slotFormat: SessionFormat } | null {
  if (!preference || preference === "both") return null;
  const normalizedSlot = normalizedFormatTerm(slotFormat);
  const slot = normalizedSlot === "online" ? "online" : normalizedSlot === "in person" ? "in_person" : null;
  return slot && slot !== preference ? { preference, slotFormat: slot } : null;
}

export function canCommitSlotSelection(preferenceLoading: boolean): boolean {
  return !preferenceLoading;
}

export function createLatestRequestGuard() {
  let latestRequest = 0;
  return {
    begin(): number {
      latestRequest += 1;
      return latestRequest;
    },
    isLatest(request: number): boolean {
      return request === latestRequest;
    },
  };
}

/**
 * Broad intake periods use these fixed boundaries throughout allocation:
 * Morning 07:00–12:00, Afternoon 12:00–17:00, Evening 17:00–21:00.
 */
export const AVAILABILITY_PERIOD_WINDOWS: Record<AvailabilityPeriod, { start: string; end: string }> = {
  Morning: { start: "07:00", end: "12:00" },
  Afternoon: { start: "12:00", end: "17:00" },
  Evening: { start: "17:00", end: "21:00" },
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function normalizeAvailabilityValue(value: unknown): NormalizedAvailability {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "malformed", selections: null, windows: null };
  }

  const entries = Object.entries(value);
  const dayEntries = entries.filter(([day]) => WEEKDAYS.includes(day as Weekday));
  if (dayEntries.length === 0) return { status: "malformed", selections: null, windows: null };
  if (entries.some(([day]) => !WEEKDAYS.includes(day as Weekday))) {
    return { status: "malformed", selections: null, windows: null };
  }

  const selections: Partial<Record<Weekday, string[]>> = {};
  const windows: Partial<Record<Weekday, AvailabilityWindow[]>> = {};
  for (const [day, rawSelections] of dayEntries) {
    if (!Array.isArray(rawSelections) || rawSelections.some(item => typeof item !== "string")) {
      return { status: "malformed", selections: null, windows: null };
    }
    const labels = rawSelections as string[];
    const dayWindows: AvailabilityWindow[] = [];
    for (const label of labels) {
      if (label in AVAILABILITY_PERIOD_WINDOWS) {
        const period = AVAILABILITY_PERIOD_WINDOWS[label as AvailabilityPeriod];
        dayWindows.push({ ...period, label });
      } else if (TIME_PATTERN.test(label)) {
        const start = minutes(label);
        if (start + 60 > 24 * 60) return { status: "malformed", selections: null, windows: null };
        const endMinutes = start + 60;
        dayWindows.push({
          start: label,
          end: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
          label,
        });
      } else {
        return { status: "malformed", selections: null, windows: null };
      }
    }
    selections[day as Weekday] = [...labels];
    windows[day as Weekday] = dayWindows;
  }
  return { status: "available", selections, windows };
}

export function findAvailabilityInSubmissions(submissions: unknown): NormalizedAvailability {
  if (!Array.isArray(submissions)) return { status: "missing", selections: null, windows: null };
  let foundMalformedCandidate = false;
  for (const submission of submissions) {
    const responses = submission && typeof submission === "object"
      ? (submission as { responses?: unknown }).responses
      : null;
    if (!responses || typeof responses !== "object" || Array.isArray(responses)) continue;
    for (const value of Object.values(responses)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (!Object.keys(value).some(key => WEEKDAYS.includes(key as Weekday))) continue;
      const normalized = normalizeAvailabilityValue(value);
      if (normalized.status === "available") return normalized;
      foundMalformedCandidate = true;
    }
  }
  return { status: foundMalformedCandidate ? "malformed" : "missing", selections: null, windows: null };
}

export type MatchableSlot = {
  type?: string | null;
  day?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

export function slotMatchesAvailability(slot: MatchableSlot, availability: NormalizedAvailability): boolean | null {
  if (availability.status !== "available") return null;
  let day = slot.day;
  if (slot.type === "SpecificDate" && slot.date) {
    const date = new Date(`${slot.date}T12:00:00`);
    day = WEEKDAYS[(date.getDay() + 6) % 7];
  }
  if (!day || !WEEKDAYS.includes(day as Weekday) || !slot.startTime || !slot.endTime
      || !TIME_PATTERN.test(slot.startTime) || !TIME_PATTERN.test(slot.endTime)) return null;
  const start = minutes(slot.startTime);
  const end = minutes(slot.endTime);
  if (end <= start) return null;
  return (availability.windows[day as Weekday] || []).some(window =>
    start >= minutes(window.start) && end <= minutes(window.end)
  );
}

export type SlotUnavailableReason = "Booked" | "No clinician capacity" | "Zoom link required" | "Not yet available";

export function getSlotUnavailableReason(input: {
  isBooked: boolean;
  isPending: boolean;
  hasClinicianCapacity: boolean;
  adminOverride: boolean;
  zoomLinkRequired: boolean;
}): SlotUnavailableReason | null {
  if (input.isBooked) return "Booked";
  if (!input.hasClinicianCapacity && !input.adminOverride) return "No clinician capacity";
  if (input.zoomLinkRequired) return "Zoom link required";
  // Pending denotes a future start date, not a booking restriction.
  return null;
}

export function rankSlotsByAvailability<T extends MatchableSlot>(
  slots: T[],
  availability: NormalizedAvailability,
  unavailableReason: (slot: T) => SlotUnavailableReason | null,
): T[] {
  return [...slots].sort((a, b) => {
    const rank = (slot: T) => unavailableReason(slot) ? 2 : slotMatchesAvailability(slot, availability) === true ? 0 : 1;
    return rank(a) - rank(b);
  });
}

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
