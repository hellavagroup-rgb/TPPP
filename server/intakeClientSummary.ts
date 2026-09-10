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
  const adultName = pickExact(
    input.fields,
    "Your name",
    "Parent name",
    "Guardian name",
    "Parent/guardian name",
    "Adult name",
    "Client name",
  ) || input.fallbackClientName;
  const childName = pickExact(
    input.fields,
    "Child's name",
    "Child name",
    "Name of child",
    "Young person's name",
    "Young person name",
    "Name of young person",
  );

  return [
    adultName ? `Client name: ${adultName}` : null,
    input.email ? `Email address: ${input.email}` : null,
    childName ? `Child's name: ${childName}` : null,
  ].filter((line): line is string => Boolean(line));
}