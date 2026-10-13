import { format, isValid, parseISO } from "date-fns";

// Form dates (especially DOBs) are calendar days, never UTC instants.
export function selectedFormDate(date: Date | undefined): string | undefined {
  return date && isValid(date) ? format(date, "yyyy-MM-dd") : undefined;
}

export function formCalendarDate(value: unknown): Date | undefined {
  const date = value instanceof Date ? value
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? parseISO(value)
    : undefined;
  return date && isValid(date) ? date : undefined;
}

export function formatFormDate(value: unknown): string {
  // Preserve ambiguous historic UTC answers verbatim; never infer or repair
  // their original selected day from a staff browser's timezone.
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = formCalendarDate(value);
  return date ? format(date, "dd/MM/yyyy") : String(value ?? "");
}

export function serializeFormDates(
  fields: { id: string; type: string }[],
  values: Record<string, any>,
): Record<string, any> {
  const result = { ...values };
  for (const field of fields) {
    if (field.type === "date" && result[field.id] instanceof Date) {
      result[field.id] = selectedFormDate(result[field.id]);
    }
  }
  return result;
}
