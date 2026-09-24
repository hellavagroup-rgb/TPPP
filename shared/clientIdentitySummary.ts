/** Client identity is a summary line, not a change to the source enquiry or clinical state. */
export function getSummaryClientName(notes: string | null | undefined): string {
  return notes?.match(/^Client name:\s*(.+)$/m)?.[1]?.trim() ?? "";
}

export function correctSummaryClientName(notes: string, name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("Client name cannot be empty");
  const lines = notes.split("\n");
  const index = lines.findIndex(line => line.startsWith("Client name:"));
  if (index < 0) return [`Client name: ${trimmed}`, ...lines].filter(Boolean).join("\n");
  const previous = getSummaryClientName(notes);
  lines[index] = `Client name: ${trimmed}`;
  // Older child enquiries labelled the adult as the client. Keep their identity
  // explicitly as a contact when correcting the young person's displayed name.
  if (previous && previous !== trimmed && lines.some(line => line.startsWith("Child's name:"))
    && !lines.some(line => line.startsWith("Parent/guardian contact:"))) {
    lines.splice(index + 1, 0, `Parent/guardian contact: ${previous}`);
  }
  return lines.join("\n");
}

export function editClientStatusPatch(
  status: string,
  originalStatus: string,
  intakeClientSummaryEnabled: boolean,
): { status?: string } {
  return !intakeClientSummaryEnabled || status !== originalStatus ? { status } : {};
}