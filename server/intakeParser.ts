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
 * Strip email-client reply-quote characters from every line.
 * Handles "Re:" replies where the original form is included as a quoted block
 * with one or more leading ">" characters (>, >>, >>> etc.) per line.
 * This is a no-op for lines that don't start with ">".
 */
function stripEmailQuotes(body: string): string {
  return body
    .split('\n')
    .map((line) => line.replace(/^(>\s?)+/, ''))
    .join('\n');
}

/**
 * Prepare the body for parsing:
 * 1. Strip any forwarded-message wrapper.
 * 2. Strip email reply-quote characters ("> ") so RE: replies are parsed
 *    correctly — the quoted original form content is recovered intact.
 * 3. Truncate at the RFC-3676 signature separator (-- on its own line), which
 *    can appear both in the outer email (Clare's signature before the forwarded
 *    block) and in the inner form email footer.
 */
function prepareBody(rawBody: string): string {
  const inner = stripForwardedWrapper(rawBody);
  const unquoted = stripEmailQuotes(inner);
  // Remove anything from the standalone "-- " signature separator onwards
  const sigIdx = unquoted.search(/^--\s*$/m);
  return sigIdx !== -1 ? unquoted.substring(0, sigIdx) : unquoted;
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
 * Build a label→value dict from alternating lines, starting at `startOffset`.
 * Lines before `startOffset` are skipped entirely.
 *
 * This lets callers try different starting positions to handle "orphan" leading
 * lines (e.g. a value with no label, like a child's age appearing at the top
 * of a CYA Psychology form email).
 */
function buildAlternatingFields(
  lines: string[],
  startOffset: number,
): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = startOffset;
  while (i < lines.length) {
    const label = lines[i];
    if (!label) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length) break;
    fields[label] = lines[j];
    i = j + 1;
  }
  return fields;
}

/**
 * Format C: Plain alternating label / value lines (no asterisk wrapping).
 *
 * Tries three candidate interpretations and returns whichever scores highest:
 *   1. Offset 0 — standard label-value-label-value… starting from the first line
 *   2. Offset 1 — skip the first line (handles a leading orphan value with no
 *      label, which shifts pairs by one when read naïvely)
 *   3. Inversion of offset-0 — handles emails where each VALUE appears before
 *      its LABEL throughout the whole body
 *
 * Each candidate is scored by how well recognised label keys (Email, Phone,
 * Name…) match the expected format of their values.  The highest scorer wins.
 */
function parseAlternatingFormat(body: string): ParsedIntakeEmail {
  const lines = body
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim());

  const fields0 = buildAlternatingFields(lines, 0);
  const fields1 = buildAlternatingFields(lines, 1);
  const fieldsInv = invertFields(fields0);

  const candidates: Record<string, string>[] = [fields0, fields1, fieldsInv].filter(
    (f) => Object.keys(f).length >= 2,
  );

  let bestFields = fields0;
  let bestScore = scoreFields(fields0);

  for (const candidate of candidates.slice(1)) {
    const s = scoreFields(candidate);
    if (s > bestScore) {
      bestScore = s;
      bestFields = candidate;
    }
  }

  return buildResult(bestFields);
}

// ---------------------------------------------------------------------------
// Semantic scoring helpers
// ---------------------------------------------------------------------------

function isEmailLike(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s]+$/.test(s.trim());
}

function isPhoneLike(s: string): boolean {
  return /^[+\d][\d\s().\-]{5,19}$/.test(s.trim());
}

function isNameLike(s: string): boolean {
  const t = s.trim();
  return (
    /^[A-Z][a-z]/.test(t) &&
    !isEmailLike(t) &&
    !isPhoneLike(t) &&
    t.length < 60
  );
}

/**
 * Score a fields dict by how well the VALUES match what each LABEL suggests.
 * Higher score = labels and values are correctly paired.
 */
function scoreFields(fields: Record<string, string>): number {
  let score = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (matchesAny(k, EMAIL_LABELS) && isEmailLike(v)) score += 3;
    if (matchesAny(k, PHONE_LABELS) && isPhoneLike(v)) score += 3;
    if (matchesAny(k, NAME_LABELS) && isNameLike(v)) score += 2;
  }
  return score;
}

/**
 * Invert a fields dict (swap keys and values), skipping entries where the
 * value is empty.
 */
function invertFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v) out[v] = k;
  }
  return out;
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
    return tabResult;
  }

  // Format B: *Label* on one line, value on next line(s) — may have multi-line labels
  const asteriskAltResult = parseAsteriskAlternatingFormat(body);
  if (asteriskAltResult && Object.keys(asteriskAltResult.fields).length >= 2) {
    return asteriskAltResult;
  }

  // Format C: plain alternating label/value lines.
  // parseAlternatingFormat internally tries offset-0, offset-1, and inversion
  // and picks whichever is semantically best (see scoreFields).
  return parseAlternatingFormat(body);
}
