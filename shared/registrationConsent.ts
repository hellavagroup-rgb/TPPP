export type RegistrationConsentField = {
  id?: string;
  type?: string;
  label?: string;
  content?: string;
  isTermsAcceptance?: boolean;
  isConsentConfirmation?: boolean;
  isConsentDate?: boolean;
};

export type RegistrationConsentEvidence = {
  fieldId: string;
  statement: string;
  answer: unknown;
  acceptedAt: string;
};

export function activeRegistrationFields(fields: unknown): RegistrationConsentField[] {
  return Array.isArray(fields)
    ? (fields as RegistrationConsentField[]).filter(field => field.isConsentDate !== true)
    : [];
}

export function buildRegistrationConsentEvidence(
  fields: unknown,
  responses: unknown,
  acceptedAt: Date,
): RegistrationConsentEvidence[] {
  if (!Array.isArray(fields) || !responses || typeof responses !== "object" || Array.isArray(responses)) return [];
  const responseMap = responses as Record<string, unknown>;
  return (fields as RegistrationConsentField[])
    .filter(field => !!field.id && (field.isConsentConfirmation === true || field.isTermsAcceptance === true))
    .flatMap(field => {
      const answer = responseMap[field.id!];
      const accepted = answer === true
        || (typeof answer === "string" && /^(yes|i agree|accepted)$/i.test(answer.trim()))
        || (Array.isArray(answer) && answer.some(value =>
          typeof value === "string" && /^(yes|i agree|accepted)$/i.test(value.trim()),
        ));
      return accepted ? [{
        fieldId: field.id!,
        statement: field.label || field.content || "",
        answer,
        acceptedAt: acceptedAt.toISOString(),
      }] : [];
    });
}

export function findRegistrationConsent(
  fields: unknown,
  responses: unknown,
): { fieldId: string; accepted: boolean; evidenceContent: string } | null {
  if (!Array.isArray(fields) || !responses || typeof responses !== "object" || Array.isArray(responses)) {
    return null;
  }

  const typedFields = activeRegistrationFields(fields);
  const explicit = typedFields.filter(field => field.isTermsAcceptance === true);
  const legacy = typedFields.filter(field =>
    typeof field.label === "string"
    && /\bagree\b/i.test(field.label)
    && /terms?\s*(?:&|and)?\s*conditions?/i.test(field.label),
  );
  const candidates = explicit.length ? explicit : legacy;
  if (candidates.length !== 1 || !candidates[0].id) return null;

  const consentField = candidates[0];
  const fieldId = consentField.id!;
  const answer = (responses as Record<string, unknown>)[fieldId];
  const accepted = answer === true
    || (typeof answer === "string" && /^(yes|i agree|accepted)$/i.test(answer.trim()))
    || (Array.isArray(answer) && answer.some(value =>
      typeof value === "string" && /^(yes|i agree|accepted)$/i.test(value.trim()),
    ));
  const consentIndex = typedFields.indexOf(consentField);
  const termsText = typedFields
    .slice(0, consentIndex)
    .reverse()
    .find(field => field.type === "info" && typeof field.content === "string" && field.content.trim())
    ?.content?.trim();

  return {
    fieldId,
    accepted,
    evidenceContent: [termsText, consentField.label].filter(Boolean).join("\n\n"),
  };
}