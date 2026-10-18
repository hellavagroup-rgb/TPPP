// Drizzle wraps PostgreSQL errors in Error.cause. The outer message contains
// SQL/parameters, not necessarily the database code or constraint.
export function clientCreationConflict(error: unknown): string | undefined {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const detail = current as { code?: string; constraint?: string; cause?: unknown };
    if (detail.code === "23505") {
      return detail.constraint === "clients_display_id_unique"
        ? "A client with this W-number already exists. Check existing records, including confirmed and archived clients, or verify the W-number."
        : "A client with these details already exists.";
    }
    current = detail.cause;
  }
  return undefined;
}
