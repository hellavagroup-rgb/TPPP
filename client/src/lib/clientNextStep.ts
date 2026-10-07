import { bookingCompletionBlockerCopy, type BookingCompletionBlockerCode } from "@shared/bookingCompletion";

export type ClientNextStepAction =
  | "offer_new_choices"
  | "review_allocation"
  | "check_payment"
  | "review_payment_record"
  | "recover_payment"
  | "retry_registration"
  | "record_writeupp"
  | "review_writeupp"
  | "complete"
  | "review_offer";

export interface ClientNextStepInput {
  status: string;
  registrationProgress?: string;
  paymentProgress?: string;
  confirmationBlocker?: string | null;
  externallyArranged?: boolean;
  hasSelectedAppointment?: boolean;
  offerState?: string | null;
  offerDeliveryRecorded?: boolean;
  offerEligibility?: {
    pendingCount: number;
    availableCount: number;
    unavailableCount: number;
  } | null;
  needsAdminCall?: boolean;
  writeuppAppointmentConfirmed?: boolean;
  writeuppDataTransferred?: boolean;
  writeuppChecklistEnabled?: boolean;
  completedBookingsEnabled?: boolean;
  registrationEnabled?: boolean;
  isAdmin?: boolean;
}

export type ClientNextStep = {
  kind: "action" | "waiting";
  title: string;
  detail: string;
  action?: ClientNextStepAction;
  actionLabel?: string;
};

export function bookingCompletionNextStep(
  step: ClientNextStep,
  blocker: BookingCompletionBlockerCode | null,
): ClientNextStep {
  if (!blocker || step.action !== "complete") return step;
  if (blocker === "payment_setup_unverified") {
    return {
      kind: "action",
      title: "Payment record needs staff review",
      detail: "Booking confirmed. Portal payment setup is not verified. Check the existing payment before finishing booking administration; do not request another payment.",
      action: "review_payment_record",
      actionLabel: "Review payment record",
    };
  }
  return { kind: "waiting", title: "Waiting for booking requirements", detail: bookingCompletionBlockerCopy[blocker] };
}

function action(title: string, detail: string, actionName: ClientNextStepAction): ClientNextStep {
  return { kind: "action", title, detail, action: actionName };
}

function waiting(title: string, detail: string): ClientNextStep {
  return { kind: "waiting", title, detail };
}

function offerChoices(input: ClientNextStepInput, detail: string): ClientNextStep {
  return input.isAdmin
    ? action("Offer new appointment choices", detail, "offer_new_choices")
    : action("Review appointment choices", detail, "review_offer");
}

function reviewRegistrationEvidence(): ClientNextStep {
  return waiting(
    "Review registration progress",
    "Registration delivery evidence is unavailable; do not assume an email was sent or a form was submitted.",
  );
}

function registrationNextStep(input: ClientNextStepInput): ClientNextStep {
  switch (input.registrationProgress) {
    case "allocation_incomplete":
      return action(
        "Review the allocation",
        "A clinician and appointment slot must both be recorded before registration can be delivered.",
        "review_allocation",
      );
    case "waiting_for_option":
      return action(
        "Review the appointment selection",
        "No selected appointment is recorded; verify the allocation before registration proceeds.",
        "review_allocation",
      );
    case "automatic_pending":
      return waiting(
        "Registration delivery is pending",
        "The system has not recorded a delivered registration email yet.",
      );
    case "sending":
      return waiting(
        "Registration delivery is in progress",
        "Wait for delivery to finish, then refresh the recorded registration progress.",
      );
    case "failed":
      return input.registrationEnabled === false
        ? waiting(
            "Registration delivery failed",
            "Registration is disabled for this practice; review the workflow before retrying delivery.",
          )
        : action(
            "Retry registration delivery",
            "The recorded registration email delivery failed.",
            "retry_registration",
          );
    case "sent":
      return waiting(
        "Waiting for registration",
        "The registration email is recorded as sent; wait for the client to submit the form.",
      );
    case "completed":
      return paymentNextStep(input);
    default:
      return reviewRegistrationEvidence();
  }
}

function paymentNextStep(input: ClientNextStepInput): ClientNextStep {
  switch (input.paymentProgress) {
    case "recovery_needed":
      return action(
        "Recover payment setup",
        "Registration is submitted and payment recovery is recorded as needed.",
        "recover_payment",
      );
    case "awaiting_client":
      return waiting(
        "Waiting for payment setup",
        "Registration is submitted; the client still needs to complete payment setup.",
      );
    case "automatic_pending":
      return waiting(
        "Payment verification is pending",
        "Registration is submitted; wait for the payment status to update before advancing.",
      );
    case "active":
    case "not_required":
      return action(
        "Review the booking allocation",
        input.paymentProgress === "active"
          ? "Registration is submitted and payment is recorded as active; review the allocation before booking progression."
          : "Registration is submitted and no payment setup is required; review the allocation before booking progression.",
        "review_allocation",
      );
    default:
      return action(
        "Check payment status",
        "Registration is submitted, but no verified payment state is available.",
        "check_payment",
      );
  }
}

function optionsSentNextStep(input: ClientNextStepInput): ClientNextStep {
  const eligibility = input.offerEligibility;

  if (input.needsAdminCall) {
    return action(
      "Review the appointment offer",
      "A staff follow-up is flagged; no appointment selection is recorded here.",
      "review_offer",
    );
  }

  if (input.offerState === "closed" || input.offerState === "declined") {
    return offerChoices(
      input,
      input.offerState === "declined"
        ? "The client declined the offered choices; review the offer before sending current choices."
        : "The appointment offer is closed; send current choices if the client still needs an appointment.",
    );
  }

  if (eligibility && eligibility.unavailableCount > 0) {
    return offerChoices(
      input,
      `${eligibility.unavailableCount} offered appointment choice${eligibility.unavailableCount === 1 ? " is" : "s are"} unavailable; send current choices.`,
    );
  }

  if (input.offerState === "pending" && eligibility) {
    if (eligibility.pendingCount > 0 && eligibility.availableCount > 0) {
      if (input.offerDeliveryRecorded !== true) {
        return action(
          "Review offer delivery",
          "Accepted offer delivery is not recorded; verify delivery before waiting for the family to choose.",
          "review_offer",
        );
      }
      return waiting(
        "Waiting for the family to choose",
        "Pending appointment choices remain available; no selection is recorded yet.",
      );
    }
    return offerChoices(
      input,
      "No available pending appointment choice is recorded; send current choices.",
    );
  }

  return action(
    "Review offer delivery",
    "Offer delivery or current choice availability is not established; check the offer record before contacting the family.",
    "review_offer",
  );
}

/**
 * Gives staff a next step from recorded workflow evidence only. In particular,
 * this helper never treats notes, an unknown offer state, or missing progress
 * data as proof of selection, email delivery, or payment.
 */
export function getClientNextStep(input: ClientNextStepInput): ClientNextStep {
  if (input.externallyArranged === true) {
    return {
      kind: "action",
      title: "No further booking action",
      detail: "The appointment is arranged in WriteUpp. No further booking action is needed.",
    };
  }

  if (input.status === "BookingConfirmed") {
    const appointmentConfirmed = input.writeuppAppointmentConfirmed === true;
    const dataTransferred = input.writeuppDataTransferred === true;

    if (
      input.writeuppChecklistEnabled === true
      && (!appointmentConfirmed || !dataTransferred)
    ) {
      const missing = [
        !appointmentConfirmed ? "confirm the appointment" : null,
        !dataTransferred ? "transfer the client data" : null,
      ].filter((item): item is string => item !== null);
      return action(
        "Review WriteUpp",
        `Verify in WriteUpp and record both checklist items: ${missing.join(" and ")}.`,
        "review_writeupp",
      );
    }

    if (input.completedBookingsEnabled === true) {
      return action(
        "Complete the booking",
        input.writeuppChecklistEnabled === true
          ? "The WriteUpp appointment and data checklist items are both recorded."
          : "The completed-booking workflow is enabled for this practice.",
        "complete",
      );
    }

    return waiting(
      "Booking verified",
      input.writeuppChecklistEnabled === true
        ? "Both WriteUpp checklist items are recorded; completed bookings are not enabled for this practice."
        : "The booking is confirmed; completed bookings are not enabled for this practice.",
    );
  }

  if (input.status === "AwaitingConfirmation") {
    const detail = input.externallyArranged
      ? "Verify the externally arranged appointment in WriteUpp; retain the existing registration and payment evidence."
      : "Verify the appointment in WriteUpp; retain the existing registration and payment evidence.";
    return action("Verify appointment in WriteUpp", detail, "record_writeupp");
  }

  if (input.status === "OptionsSent") {
    return optionsSentNextStep(input);
  }

  if (input.status === "Assigned") {
    if (input.needsAdminCall) {
      return action(
        "Review the appointment offer",
        "A staff follow-up is flagged; no selected appointment is recorded.",
        "review_offer",
      );
    }
    if (input.hasSelectedAppointment === true) {
      return action(
        "Review the allocation",
        "A selected appointment is recorded, but the client status has not progressed to Option Selected.",
        "review_allocation",
      );
    }
    const detail = "No selected appointment is recorded; review the appointment choices.";
    return input.isAdmin
      ? action("Review appointment choices", detail, "offer_new_choices")
      : action("Review appointment choices", detail, "review_allocation");
  }

  if (input.status === "OptionSelected" || input.status === "RegistrationPending") {
    if (input.hasSelectedAppointment === false) {
      return action(
        "Review the allocation",
        "No selected appointment is recorded; verify the allocation before proceeding.",
        "review_allocation",
      );
    }
    return registrationNextStep(input);
  }

  if (input.status === "Scheduled") {
    return waiting(
      "Booking is scheduled",
      "Review the recorded booking and external practice appointment if either needs reconciliation.",
    );
  }

  return waiting(
    "Review client status",
    "There is no workflow-specific next step for the recorded status.",
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripOuterQuotes(value: string): string {
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [opening, closing] of quotePairs) {
    if (value.startsWith(opening) && value.endsWith(closing) && value.length >= 2) {
      return value.slice(opening.length, -closing.length).trim();
    }
  }
  return value;
}

function limitDescription(value: string, maxLength = 160): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, maxLength - 1).join("").trimEnd()}…`;
}

/** Builds a compact factual label without inventing a client or guardian identity. */
export function getCompactClientDescription(
  notes: string | null | undefined,
  clientName?: string | null,
): string | null {
  const normalizedNotes = notes == null
    ? ""
    : normalizeWhitespace(stripOuterQuotes(normalizeWhitespace(notes)));
  const normalizedName = clientName == null ? "" : normalizeWhitespace(clientName);

  if (!normalizedNotes) return normalizedName ? limitDescription(normalizedName) : null;
  const description = normalizedName
    ? `${normalizedName}: ${normalizedNotes}`
    : normalizedNotes;
  return limitDescription(description);
}