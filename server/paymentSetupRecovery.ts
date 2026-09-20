export type PaymentSetupFailureCode =
  | "client_rate_required"
  | "stripe_unavailable"
  | "provider_rejected"
  | "provider_transient"
  | "interrupted";

const RECOVERY_MESSAGES: Record<PaymentSetupFailureCode, string> = {
  client_rate_required: "Set a positive agreed session rate for this client, then retry automatic payment setup.",
  stripe_unavailable: "Configure this practice's Stripe secret and webhook signing keys in Payment settings, then retry.",
  provider_rejected: "Stripe rejected payment-link setup. Check the practice Stripe account, then retry.",
  provider_transient: "Stripe could not complete payment-link setup. Retry the existing automatic setup.",
  interrupted: "Automatic payment setup was interrupted before the link was saved. Retry the existing setup.",
};

export function paymentSetupFailureMessage(code: PaymentSetupFailureCode): string {
  return RECOVERY_MESSAGES[code];
}

export function classifyPaymentSetupProviderFailure(error: unknown): PaymentSetupFailureCode {
  const value = error as { type?: string; statusCode?: number; code?: string } | null;
  const status = value?.statusCode;
  if (
    value?.type === "StripeInvalidRequestError"
    || value?.type === "StripeAuthenticationError"
    || value?.type === "StripePermissionError"
    || (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429)
  ) {
    return "provider_rejected";
  }
  return "provider_transient";
}

export function paymentSetupRecoveryHref(
  code: PaymentSetupFailureCode | string | null | undefined,
  clientId: string,
): string {
  if (code === "stripe_unavailable") return "/settings?tab=payments";
  return `/clients?clientId=${encodeURIComponent(clientId)}`;
}