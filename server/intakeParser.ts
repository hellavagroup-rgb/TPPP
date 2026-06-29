/**
 * Parses structured label/value email bodies produced by web intake forms.
 *
 * Supports two formats:
 *
 * Format A – Tab-separated with asterisk-bold labels (Gmail HTML table → plaintext):
 *   *Your Name*\tClare Yassin
 *   *Email*\tclare@example.com
 *   Also handles forwarded email wrappers (strips preamble + forward headers).
 *
 * Format B – Alternating lines (plain-text forms):
 *   Your Name
 *   Clare Yassin
 *   Email
 *   clare@example.com
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

function buildResult(fields: Record<string, string>): ParsedIntakeEmail {
  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  for (const [label, value] of Object.entries(fields)) {
    if (matchesAny(label, NAME_LABELS) && !name) name = value;
    if (matchesAny(label, EMAIL_LABELS) && !email) email = value;
    if (matchesAny(label, PHONE_LABELS) && !phone) phone = value;
  }
  return { fields, name, email, phone };
}

/**
 * Strip forwarded email preamble and headers.
 * Returns the body of the forwarded message (after "Forwarded message" separator
 * and the From/Date/Subject/To header lines).
 */
function stripForwardedWrapper(body: string): string {
  const fwdMatch = body.match(/------+\s*Forwarded message\s*------+/i);
  if (!fwdMatch || fwdMatch.index === undefined) return body;

  const afterSep = body.substring(fwdMatch.index + fwdMatch[0].length);
  const lines = afterSep.split('\n');

  // Skip blank lines and standard email header lines after the separator
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (
      !trimmed ||
      /^(From|Date|Subject|To|Cc|Bcc|Reply-To|Message-ID|Sent|Received)\s*:/i.test(trimmed)
    ) {
      i++;
    } else {
      break;
    }
  }

  return lines.slice(i).join('\n');
}

/**
 * Try to parse Format A: *Label*<TAB>Value lines.
 * Returns null if the body doesn't appear to use this format.
 */
function tryParseAsteriskTabFormat(rawBody: string): ParsedIntakeEmail | null {
  // Extract forwarded message body if present
  const body = stripForwardedWrapper(rawBody);

  // Stop at standard email signature separator (-- on its own line)
  const sigIdx = body.search(/^--\s*$/m);
  const toParse = sigIdx !== -1 ? body.substring(0, sigIdx) : body;

  // Find all *Label* occurrences (label text may contain tabs if cell wraps)
  const LABEL_RE = /\*([^*\n]{1,200})\*/g;
  const matches: Array<{ label: string; start: number; end: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(toParse)) !== null) {
    const rawLabel = m[1]
      .replace(/\t+/g, ' ')  // collapse tabs in label (cell-wrap artifact)
      .replace(/\s+/g, ' ')
      .trim();
    if (rawLabel) {
      matches.push({ label: rawLabel, start: m.index, end: m.index + m[0].length });
    }
  }

  if (matches.length < 2) return null;

  const fields: Record<string, string> = {};
  let emptyRun = 0;

  for (let i = 0; i < matches.length; i++) {
    const { label, end } = matches[i];
    // Value: everything between end of this *Label* and start of next *Label*
    const nextLabelStart = i + 1 < matches.length ? matches[i + 1].start : toParse.length;

    let value = toParse
      .substring(end, nextLabelStart)
      .replace(/\t+/g, ' ')   // tabs → spaces
      .replace(/\n+/g, ' ')   // newlines → spaces
      .replace(/\s+/g, ' ')
      .trim();

    // Remove leading bullet / dash characters
    value = value.replace(/^[-–•]\s*/, '');

    if (!value) {
      emptyRun++;
      // If we've seen 3+ consecutive empty values, this is likely the signature block
      if (emptyRun >= 3) break;
      // Still include the field so optional blank answers appear
      fields[label] = '';
    } else {
      emptyRun = 0;
      fields[label] = value;
    }
  }

  // Require at least 3 non-empty fields to consider this format valid
  const nonEmpty = Object.values(fields).filter(Boolean).length;
  if (nonEmpty < 2) return null;

  return buildResult(fields);
}

/**
 * Format B: alternating label / value lines.
 */
function parseAlternatingFormat(body: string): ParsedIntakeEmail {
  const lines = body
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim());

  const fields: Record<string, string> = {};
  let i = 0;

  while (i < lines.length) {
    const label = lines[i];
    if (!label) { i++; continue; }

    // Look ahead for value on the next non-blank line
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length) break;

    fields[label] = lines[j];
    i = j + 1;
  }

  return buildResult(fields);
}

export function parseIntakeEmailBody(body: string): ParsedIntakeEmail {
  if (!body || !body.trim()) {
    return { fields: {}, name: null, email: null, phone: null };
  }

  // Try the asterisk-tab format first (covers forwarded HTML emails)
  const asteriskResult = tryParseAsteriskTabFormat(body);
  if (asteriskResult && Object.keys(asteriskResult.fields).length >= 2) {
    return asteriskResult;
  }

  // Fall back to plain alternating label/value lines
  return parseAlternatingFormat(body);
}
