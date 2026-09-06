export const REGISTRATION_SEND_STATUSES = ["Assigned", "AwaitingConfirmation", "OptionSelected"] as const;

/** Small pure decisions shared by routes and focused workflow-contract tests. */
export function isActiveRegistrationToken(token: {
  registrationToken: string | null;
  registrationTokenExpiresAt: Date | null;
  registrationTokenRevokedAt: Date | null;
}, supplied: string, now = new Date()): boolean {
  return token.registrationToken === supplied
    && !token.registrationTokenRevokedAt
    && (!token.registrationTokenExpiresAt || token.registrationTokenExpiresAt > now);
}

export function isCompletedRegistrationRetry(
  token: { registrationToken: string | null },
  supplied: string,
  status: string,
): boolean {
  return status === "BookingConfirmed"
    && !!token.registrationToken
    && token.registrationToken === supplied;
}

export function canSendRegistration(input: {
  featureEnabled: boolean;
  requestTenantId: string;
  clientTenantId: string | null;
  assignedClinicianId: string | null;
  assignedSlotId: string | null;
  status: string;
}): boolean {
  return input.featureEnabled
    && input.clientTenantId === input.requestTenantId
    && !!input.assignedClinicianId
    && !!input.assignedSlotId
    && REGISTRATION_SEND_STATUSES.includes(input.status as typeof REGISTRATION_SEND_STATUSES[number]);
}

export function optionSelectionProgression(registrationEnabled: boolean): {
  status: "OptionSelected" | "BookingConfirmed";
  requiresRegistration: boolean;
} {
  return registrationEnabled
    ? { status: "OptionSelected", requiresRegistration: true }
    : { status: "BookingConfirmed", requiresRegistration: false };
}

export function validateRegistrationConsent(termsAccepted: unknown, suppliedVersion: unknown, currentVersion: number): string | null {
  if (termsAccepted !== true) return "You must accept the Terms & Conditions to continue";
  if (!Number.isInteger(suppliedVersion) || suppliedVersion !== currentVersion) {
    return "The Terms & Conditions have changed. Please review and accept the current version.";
  }
  return null;
}

export type RegistrationPaymentPrerequisite =
  | "stripe_required"
  | "confirm_after_form"
  | "client_rate_required"
  | "stripe_unavailable";

/**
 * Payment is a prerequisite, not an optional best-effort side effect. In
 * particular, a self-paying client must never be confirmed merely because the
 * configured rate or Stripe connection is missing.
 */
export function registrationPaymentPrerequisite(input: {
  paymentType: "self_pay" | "insurer";
  paymentsEnabled: boolean;
  agreedRatePence: number | null;
  stripeAvailable: boolean;
}): RegistrationPaymentPrerequisite {
  if (input.paymentType === "insurer" || !input.paymentsEnabled) return "confirm_after_form";
  if (!input.agreedRatePence || input.agreedRatePence <= 0) return "client_rate_required";
  return input.stripeAvailable ? "stripe_required" : "stripe_unavailable";
}

export function registrationCompletionBranch(input: {
  paymentType: "self_pay" | "insurer";
  paymentsEnabled: boolean;
  agreedRatePence: number | null;
}): "stripe" | "confirm" {
  return input.paymentType === "self_pay" && input.paymentsEnabled && !!input.agreedRatePence && input.agreedRatePence > 0
    ? "stripe"
    : "confirm";
}

export function nextTermsVersion(contentChanged: boolean, currentVersion: number): number {
  return contentChanged ? currentVersion + 1 : currentVersion;
}

export function registrationRetryResponse(status: string, checkoutUrl: string | null): "completed" | "checkout" | "processing" | "invalid" {
  if (status === "BookingConfirmed") return "completed";
  if (status === "RegistrationPending") return checkoutUrl ? "checkout" : "processing";
  return "invalid";
}

/** Strict gate for registration-only Checkout webhooks. */
export function isCorrelatedRegistrationCheckout(input: {
  paymentStatus: string | null | undefined;
  metadataTenantId: string | null | undefined;
  metadataClientId: string | null | undefined;
  metadataAttemptKey: string | null | undefined;
  paymentLinkId: string | null | undefined;
  clientTenantId: string | null;
  clientId: string;
  currentAttemptKey: string | null;
  currentPaymentLinkId: string | null;
}): boolean {
  return input.paymentStatus === "paid"
    && input.metadataTenantId === input.clientTenantId
    && input.metadataClientId === input.clientId
    && !!input.metadataAttemptKey
    && input.metadataAttemptKey === input.currentAttemptKey
    && !!input.paymentLinkId
    && input.paymentLinkId === input.currentPaymentLinkId;
}