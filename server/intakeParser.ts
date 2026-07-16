/**
 * Parses structured label/value email bodies produced by web intake forms.
 *
 * Supports three formats applied to the inner email body (after the forwarded
 * wrapper is stripped):
 *
 * Format A – Tab-separated with asterisk-bold labels (Gmail HTML table → plaintext):
 *   *Your Name*\tClare Yassin
 *   *Email*\tclare@example.com
 *
 * Format B – Alternating lines with asterisk-bold labels:
 *   *Your Name*
 *   Clare Yassin
 *   *Our current fees… Does this
 *   feel manageable for you?*
 *   Yes
 *   Multi-line labels (opening * on one line, closing * on the next) are joined.
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
 * Strip forwarded email preamble and headers, returning just the inner message body.
 * Handles the standard Gmail "---------- Forwarded message ---------" separator.
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
 * Prepare the body for parsing:
 * 1. Strip any forwarded-message wrapper.
 * 2. Truncate at the RFC-3676 signature separator (-- on its own line), which
 *    can appear both in the outer email (Clare's signature before the forwarded
 *    block) and in the inner form email footer.
 */
function prepareBody(rawBody: string): string {
  const inner = stripForwardedWrapper(rawBody);
  // Remove anything from the standalone "-- " signature separator onwards
  const sigIdx = inner.search(/^--\s*$/m);
  return sigIdx !== -1 ? inner.substring(0, sigIdx) : inner;
}

/**
 * Format A: *Label*<TAB>Value on the same line.
 * Only attempted when the body actually contains "*...*\t" patterns.
 * Returns null if not applicable.
 */
function tryParseAsteriskTabFormat(body: string): ParsedIntakeEmail | null {
  // Only use this format when there are actual *Label*<TAB>Value lines
  if (!/\*[^*\n]+\*\t/.test(body)) return null;

  const LABEL_RE = /\*([^*\n]{1,200})\*/g;
  const matches: Array<{ label: string; start: number; end: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(body)) !== null) {
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
    const nextLabelStart = i + 1 < matches.length ? matches[i + 1].start : body.length;

    let value = body
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
 * Also handles the mixed case where a single line has *Label*<TAB>Value.
 * Labels may span multiple lines (opening * on one line, closing * on the next).
 * Values are all non-empty lines between labels (joined with a space).
 * Returns null if no asterisk-wrapped labels are found.
 */
function parseAsteriskAlternatingFormat(body: string): ParsedIntakeEmail | null {
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

    // Check for single-line *Label*<TAB>Value (tab-separated format mixed in)
    const tabMatch = line.match(/^\*([^*]+)\*\t+(.*)/);
    if (tabMatch) {
      const cleanLabel = tabMatch[1].replace(/\s+/g, ' ').trim();
      const value = tabMatch[2].replace(/\s+/g, ' ').trim();
      if (cleanLabel) fields[cleanLabel] = value;
      i++;
      continue;
    }

    // Accumulate the full label, which may span multiple lines
    let label = line;
    i++;

    while (!label.endsWith('*') && i < lines.length) {
      label += ' ' + lines[i];
      i++;
      if (label.endsWith('*')) break;
      // Safety: give up on accumulating if the label grows too long
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

/**
 * If the parsed fields have no recognisable name/email/phone keys but the
 * INVERTED dict (swapping keys and values) does, return the inverted version.
 *
 * This corrects HTML-only emails where the form template emits each answer
 * BEFORE its label (e.g. CYA Psychology), causing the alternating-line parser
 * to store { answer: label } instead of { label: answer }.
 */
function autoCorrectIfReversed(result: ParsedIntakeEmail): ParsedIntakeEmail {
  if (result.name || result.email || result.phone) return result;
  if (Object.keys(result.fields).length < 2) return result;

  const inverted: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.fields)) {
    if (v) inverted[v] = k;
  }
  const invertedResult = buildResult(inverted);
  if (invertedResult.name || invertedResult.email || invertedResult.phone) {
    return invertedResult;
  }
  return result;
}

export function parseIntakeEmailBody(rawBody: string): ParsedIntakeEmail {
  if (!rawBody || !rawBody.trim()) {
    return { fields: {}, name: null, email: null, phone: null };
  }

  // Strip the forwarded wrapper and any trailing signature ONCE here.
  // This removes Clare's preamble + "-- " signature that precede the forwarded
  // separator, so every downstream parser sees only the inner form body.
  const body = prepareBody(rawBody);

  // Format A: *Label*<TAB>Value (tab-separated, same line)
  const tabResult = tryParseAsteriskTabFormat(body);
  if (tabResult && Object.keys(tabResult.fields).length >= 2) {
    return autoCorrectIfReversed(tabResult);
  }

  // Format B: *Label* on one line, value on next line(s) — may have multi-line labels
  const asteriskAltResult = parseAsteriskAlternatingFormat(body);
  if (asteriskAltResult && Object.keys(asteriskAltResult.fields).length >= 2) {
    return autoCorrectIfReversed(asteriskAltResult);
  }

  // Format C: plain alternating label/value lines
  return autoCorrectIfReversed(parseAlternatingFormat(body));
}
