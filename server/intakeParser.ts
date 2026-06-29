/**
 * Parses structured label/value email bodies produced by web intake forms.
 *
 * Supports three formats:
 *
 * Format A – Tab-separated with asterisk-bold labels (Gmail HTML table → plaintext):
 *   *Your Name*\tClare Yassin
 *   *Email*\tclare@example.com
 *   Also handles forwarded email wrappers (strips preamble + forward headers).
 *
 * Format B – Alternating lines with asterisk-bold labels (forwarded plain-text form):
 *   *Your Name*
 *   Clare Yassin
 *   *Our current fees are £200–250 per session (clinician dependant). Does this
 *   feel manageable for you?*
 *   Yes
 *   Multi-line labels (opening * on one line, closing * on next) are joined.
 *   Multi-line values (lines before next *label*) are joined with a space.
 *
 * Format C – Plain alternating lines (no asterisk wrapping):
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
 * Format A: *Label*<TAB>Value on the same line.
 * Only attempted when the inner body actually contains "*...*\t" patterns.
 * Returns null if not applicable.
 */
function tryParseAsteriskTabFormat(rawBody: string): ParsedIntakeEmail | null {
  const body = stripForwardedWrapper(rawBody);

  // Only use this format when there are actual *Label*<TAB>Value lines
  if (!/\*[^*\n]+\*\t/.test(body)) return null;

  const sigIdx = body.search(/^--\s*$/m);
  const toParse = sigIdx !== -1 ? body.substring(0, sigIdx) : body;

  const LABEL_RE = /\*([^*\n]{1,200})\*/g;
  const matches: Array<{ label: string; start: number; end: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(toParse)) !== null) {
    const rawLabel = m[1]
      .replace(/\t+/g, ' ')
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
    const nextLabelStart = i + 1 < matches.length ? matches[i + 1].start : toParse.length;

    let value = toParse
      .substring(end, nextLabelStart)
      .replace(/\t+/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    value = value.replace(/^[-–•]\s*/, '');

    if (!value) {
      emptyRun++;
      if (emptyRun >= 3) break;
      fields[label] = '';
    } else {
      emptyRun = 0;
      fields[label] = value;
    }
  }

  const nonEmpty = Object.values(fields).filter(Boolean).length;
  if (nonEmpty < 2) return null;

  return buildResult(fields);
}

/**
 * Format B: Alternating lines where labels are wrapped in *...*
 * Labels may span multiple lines (opening * on one line, closing * on next).
 * Values are all non-empty lines between labels (joined with a space).
 * Returns null if no asterisk-wrapped labels are found.
 */
function parseAsteriskAlternatingFormat(rawBody: string): ParsedIntakeEmail | null {
  const body = stripForwardedWrapper(rawBody);
  const lines = body.split('\n').map(l => l.trim()).filter(l => l !== '');

  // Only use this format if there are lines starting with *
  if (!lines.some(l => l.startsWith('*'))) return null;

  const fields: Record<string, string> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.startsWith('*')) {
      // Non-label line before any label — skip (preamble remnants)
      i++;
      continue;
    }

    // Accumulate the full label, which may span multiple lines
    let label = line;
    i++;

    while (!label.endsWith('*') && i < lines.length) {
      // Next line could continue the label or be a value — keep accumulating
      // until we find the closing *
      label += ' ' + lines[i];
      i++;
      if (label.endsWith('*')) break;
      // Safety: if we've accumulated more than 400 chars without finding *, give up
      if (label.length > 400) break;
    }

    // Strip surrounding asterisks
    const cleanLabel = label.replace(/^\*+/, '').replace(/\*+$/, '').replace(/\s+/g, ' ').trim();
    if (!cleanLabel) continue;

    // Collect value lines: everything until the next line starting with *
    const valueLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith('*')) {
      valueLines.push(lines[i]);
      i++;
    }

    fields[cleanLabel] = valueLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  const nonEmpty = Object.values(fields).filter(Boolean).length;
  if (nonEmpty < 2) return null;

  return buildResult(fields);
}

/**
 * Format C: Plain alternating label / value lines (no asterisk wrapping).
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

  // Format A: *Label*<TAB>Value (tab-separated, same line)
  const tabResult = tryParseAsteriskTabFormat(body);
  if (tabResult && Object.keys(tabResult.fields).length >= 2) {
    return tabResult;
  }

  // Format B: *Label* on one line, value on next line(s) — may have multi-line labels
  const asteriskAltResult = parseAsteriskAlternatingFormat(body);
  if (asteriskAltResult && Object.keys(asteriskAltResult.fields).length >= 2) {
    return asteriskAltResult;
  }

  // Format C: plain alternating label/value lines
  return parseAlternatingFormat(body);
}
