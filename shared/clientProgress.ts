export type RegistrationProgressState =
  | "not_sent"
  | "sending"
  | "sent"
  | "failed"
  | "completed";

export type PaymentProgressState =
  | "not_required"
  | "automatic_pending"
  | "recovery_needed"
  | "awaiting_client"
  | "active";

export interface ClientProgressRecord {
  status?: string | null;
  registrationEmailSentAt?: Date | string | null;
  registrationEmailSendingAt?: Date | string | null;
  registrationEmailFailedAt?: Date | string | null;
  registrationEmailFailureReason?: string | null;
  registrationFormSubmissionId?: string | null;
  termsAcceptedAt?: Date | string | null;
  registrationPaymentAttemptKey?: string | null;
  registrationPaymentFailedAt?: Date | string | null;
  registrationPaymentFailureReason?: string | null;
  stripeCheckoutUrl?: string | null;
  paymentStatus?: "none" | "setup_pending" | "active" | string | null;
  paymentType?: "self_pay" | "insurer" | string | null;
}

export interface PaymentProgressContext {
  paymentsEnabled: boolean;
}

export function registrationProgress(client: ClientProgressRecord): RegistrationProgressState {
  if (client.registrationFormSubmissionId) return "completed";
  if (client.registrationEmailSendingAt) return "sending";
  if (client.registrationEmailFailedAt) return "failed";
  if (client.registrationEmailSentAt) return "sent";
  return "not_sent";
}

export function paymentProgress(
  client: ClientProgressRecord,
  context: PaymentProgressContext,
): PaymentProgressState {
  if (client.paymentType === "insurer") return "not_required";
  if (client.paymentStatus === "active") return "active";
  if (!context.paymentsEnabled) return "not_required";
  if (client.paymentStatus === "setup_pending" && client.stripeCheckoutUrl) return "awaiting_client";
  if (
    client.status === "RegistrationPending"
    && client.paymentType === "self_pay"
    && client.registrationFormSubmissionId
    && client.registrationPaymentAttemptKey
    && client.registrationPaymentFailedAt
    && !client.stripeCheckoutUrl
  ) return "recovery_needed";
  if (
    client.status === "RegistrationPending"
    && client.paymentType === "self_pay"
    && client.registrationFormSubmissionId
  ) return "automatic_pending";
  return "not_required";
}
