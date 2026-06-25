/**
 * Parses structured label/value email bodies produced by web intake forms.
 *
 * The format is alternating lines:
 *   Label\n
 *   Value\n
 *   Label\n
 *   Value\n
 *   ...
 *
 * Blank lines between pairs are ignored.
 * Returns a plain object mapping raw label → raw value.
 * Also populates canonical top-level fields (name, email, phone).
 */

export interface ParsedIntakeEmail {
  fields: Record<string, string>;
  name: string | null;
  email: string | null;
  phone: string | null;
}

const NAME_LABELS = [
  "your name",
  "name",
  "full name",
  "client name",
  "parent name",
  "guardian name",
];

const EMAIL_LABELS = [
  "email",
  "email address",
  "your email",
];

const PHONE_LABELS = [
  "phone",
  "phone number",
  "telephone",
  "mobile",
  "contact number",
];

function normalise(label: string): string {
  return label.toLowerCase().trim();
}

function matchesAny(label: string, candidates: string[]): boolean {
  const norm = normalise(label);
  return candidates.some((c) => norm === c || norm.startsWith(c));
}

export function parseIntakeEmailBody(body: string): ParsedIntakeEmail {
  const lines = body
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim());

  const fields: Record<string, string> = {};
  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

  let i = 0;
  while (i < lines.length) {
    const label = lines[i];
    if (!label) { i++; continue; }

    // Look ahead for the value on the next non-blank line
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;

    if (j >= lines.length) break;

    const value = lines[j];
    fields[label] = value;

    if (matchesAny(label, NAME_LABELS) && !name) name = value;
    if (matchesAny(label, EMAIL_LABELS) && !email) email = value;
    if (matchesAny(label, PHONE_LABELS) && !phone) phone = value;

    i = j + 1;
  }

  return { fields, name, email, phone };
}
