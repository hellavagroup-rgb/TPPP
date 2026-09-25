export type ConfirmationClient = {
  status: string;
  assignedClinicianId?: string | null;
  assignedSlotId?: string | null;
  registrationFormSubmissionId?: string | null;
  registrationPaymentAttemptKey?: string | null;
  paymentStatus?: string | null;
  paymentType?: string | null;
};

export type ConfirmationBlocker =
  | "already_confirmed" | "registration_pending" | "payment_pending"
  | "booking_progression" | "registration_payment" | "allocation_missing" | "allocation_invalid"
  | "payment_unverified" | "wrong_status" | null;

// This is guidance, not authorisation: the server checks live ownership and
// slot state under a lock before committing any confirmation.
export function confirmationBlocker(
  client: ConfirmationClient,
  options: { paymentsEnabled: boolean; registrationEnabled: boolean; allocationValid: boolean },
): ConfirmationBlocker {
  if (client.status === "BookingConfirmed" || client.status === "Scheduled") return "already_confirmed";
  if (client.status === "RegistrationPending") {
    if (!client.registrationFormSubmissionId) return "registration_pending";
    return options.paymentsEnabled && client.paymentType === "self_pay" ? "payment_pending" : "booking_progression";
  }
  if (client.status !== "AwaitingConfirmation") return "wrong_status";
  if (!client.assignedClinicianId || !client.assignedSlotId) return "allocation_missing";
  if (!options.allocationValid) return "allocation_invalid";
  if (client.registrationPaymentAttemptKey) return "registration_payment";
  if (options.paymentsEnabled && client.paymentType !== "insurer") return "payment_unverified";
  return null;
}

export const confirmationBlockerCopy: Record<Exclude<ConfirmationBlocker, null>, string> = {
  already_confirmed: "Already confirmed in the app. Check the external practice appointment separately.",
  registration_pending: "Awaiting the client's registration. Do not confirm before it is submitted.",
  payment_pending: "Registration submitted; payment is not yet recorded. Check Stripe payment and reconcile only a verified registration payment.",
  booking_progression: "Registration submitted, but the app has not finished booking progression. Check the allocation and registration record; do not confirm through the manual shortcut.",
  registration_payment: "This registration payment must be verified and reconciled through Stripe, not manually confirmed.",
  allocation_missing: "No clinician and slot are assigned. Choose an available slot in Edit Status; this does not confirm a booking or resend payment.",
  allocation_invalid: "The assigned clinician or slot is no longer valid. Repair the allocation in Edit Status before confirming.",
  payment_unverified: "Payment is not independently verified, or the payment type is missing. Review it in Stripe and set the correct payment type; do not confirm based on a saved-card badge or staff assertion.",
  wrong_status: "This client is not awaiting confirmation. Review their workflow status before confirming.",
};