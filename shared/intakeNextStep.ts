export type IntakeNextStep = "email" | "phone" | null;

export function classifyIntakeNextStepAnswer(value: string | null | undefined): IntakeNextStep {
  const answer = String(value || "").trim();
  if (!answer) return null;
  if (/\bcall\b|phone/i.test(answer)) return "phone";
  if (/intake form|complete a full intake|send (?:me )?(?:an? )?intake/i.test(answer)) return "email";
  return null;
}