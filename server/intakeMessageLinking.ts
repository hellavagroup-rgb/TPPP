export function findUniqueOrphanedIntakeMessageId(
  clientEmail: string | null | undefined,
  candidates: Array<{ id: string; email: string | null | undefined }>,
): string | null {
  const email = String(clientEmail || "").trim().toLowerCase();
  if (!email || email.endsWith("@noemail.placeholder")) return null;

  const matches = candidates.filter(
    (candidate) => String(candidate.email || "").trim().toLowerCase() === email,
  );
  return matches.length === 1 ? matches[0].id : null;
}