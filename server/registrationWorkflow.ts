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