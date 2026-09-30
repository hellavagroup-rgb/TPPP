export function formatOfferDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day))
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatOfferTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;

  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour24 > 23 || minute > 59) return value;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${match[2]} ${period}`;
}

export function formatOfferTimeRange(startTime: string, endTime: string): string {
  return `${formatOfferTime(startTime)}–${formatOfferTime(endTime)}`;
}

export function formatOfferFrequency(frequency?: string | null): string {
  switch (frequency?.toLowerCase()) {
    case "weekly": return "Weekly";
    case "fortnightly": return "Fortnightly";
    default: return frequency ? `${frequency[0].toUpperCase()}${frequency.slice(1)}` : "Recurring";
  }
}

export function formatOfferWindow(startDate?: string | null, endDate?: string | null): string {
  const start = startDate ? formatOfferDate(startDate) : null;
  const end = endDate ? formatOfferDate(endDate) : null;
  if (start && end) return `Availability window: ${start} – ${end}`;
  if (start) return `Availability window: from ${start} (no end date specified)`;
  if (end) return `Availability window: ends ${end}; start date not specified`;
  return "Availability window dates not specified";
}