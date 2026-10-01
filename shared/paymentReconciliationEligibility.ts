export type RegistrationPaymentClient = {
  status: string;
  paymentType?: string | null;
  stripePaymentLinkId?: string | null;
  registrationPaymentAttemptKey?: string | null;
  registrationFormSubmissionId?: string | null;
};

// This only makes the Stripe inspection available; it is not payment evidence.
// Legacy awaiting-confirmation clients must have submitted registration as well
// as a current payment attempt. Never make arbitrary historic payments eligible.
export function canInspectRegistrationPayment(client: RegistrationPaymentClient): boolean {
  if (client.paymentType !== "self_pay" || !client.stripePaymentLinkId ||
      !client.registrationPaymentAttemptKey) return false;
  return ["RegistrationPending", "Scheduled", "BookingConfirmed"].includes(client.status) ||
    (client.status === "AwaitingConfirmation" && !!client.registrationFormSubmissionId);
}