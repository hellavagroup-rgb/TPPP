function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pickExact(fields: Record<string, string> | null, ...labels: string[]): string | undefined {
  if (!fields) return undefined;
  const wanted = new Set(labels.map(normaliseLabel));
  const found = Object.entries(fields).find(([label]) => wanted.has(normaliseLabel(label)));
  return found?.[1]?.trim() || undefined;
}

export function buildIntakeClientSummary(input: {
  fields: Record<string, string> | null;
  fallbackClientName?: string;
  email?: string;
}): string[] {
  const explicitlyNamedAdult = pickExact(
    input.fields,
    "Your name",
    "Parent name",
    "Guardian name",
    "Parent/guardian name",
    "Adult name",
    "Client name",
  );
  const childName = pickExact(
    input.fields,
    "Child's name",
    "Child name",
    "Name of child",
    "Young person's name",
    "Young person name",
    "Name of young person",
  );
  // The parser's generic extracted name can refer to the child, not the adult.
  const adultName = explicitlyNamedAdult || (childName ? undefined : input.fallbackClientName);

  return [
    childName ? `Client name: ${childName}` : adultName ? `Client name: ${adultName}` : null,
    childName && adultName ? `Parent/guardian contact: ${adultName}` : null,
    input.email ? `Email address: ${input.email}` : null,
    // Without an adult contact line, retain explicit child context for downstream
    // integrations; a generic "Client name" alone cannot establish their age.
    childName && !adultName ? `Child's name: ${childName}` : null,
  ].filter((line): line is string => Boolean(line));
}

export function buildConversionNameNotes(input: {
  fields: Record<string, string> | null;
  fallbackClientName?: string;
  email?: string;
  referrerEmail?: string;
  dateOfBirth?: string;
  intakeClientSummaryEnabled: boolean;
}): string[] {
  if (input.intakeClientSummaryEnabled) {
    return buildIntakeClientSummary(input);
  }
  return [
    input.referrerEmail ? `Referred by: ${input.referrerEmail}` : null,
    input.fallbackClientName ? `Client name: ${input.fallbackClientName}` : null,
    input.dateOfBirth ? `Date of birth: ${input.dateOfBirth}` : null,
  ].filter((line): line is string => Boolean(line));
}