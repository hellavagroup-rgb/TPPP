export type PaymentInspectionResult = {
  state: string;
  detail: string;
  blocker?: string;
  confirmationEmail?: "accepted_by_provider" | "not_recorded" | "not_enabled";
  reconciled?: boolean;
};

export function paymentInspectionOutcome(
  result: PaymentInspectionResult,
  reconcile: boolean,
): PaymentInspectionResult {
  return reconcile ? { ...result, reconciled: result.state === "recorded" } : result;
}

export function mergePaymentInspection(
  current: Record<string, PaymentInspectionResult>,
  clientId: string,
  result: PaymentInspectionResult,
): Record<string, PaymentInspectionResult> {
  return { ...current, [clientId]: result };
}