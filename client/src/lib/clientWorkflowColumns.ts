import type { ClientStatus } from "@shared/clientWorkflow";
import type { RegistrationProgressState } from "@shared/clientProgress";

export const MATCHED_ALLOCATION_STATUSES = [
  "Assigned",
  "OptionsSent",
  "OptionSelected",
] as const satisfies readonly ClientStatus[];

export const AWAITING_CONFIRMATION_STATUSES = [
  "AwaitingConfirmation",
  "RegistrationPending",
  "BookingConfirmed",
] as const satisfies readonly ClientStatus[];

const MATCHED_ALLOCATION_STATUS_SET = new Set<string>(MATCHED_ALLOCATION_STATUSES);
const AWAITING_CONFIRMATION_STATUS_SET = new Set<string>(AWAITING_CONFIRMATION_STATUSES);

export function isMatchedAllocationStatus(status: string): boolean {
  return MATCHED_ALLOCATION_STATUS_SET.has(status);
}

export function isAwaitingConfirmationStatus(status: string): boolean {
  return AWAITING_CONFIRMATION_STATUS_SET.has(status);
}

export function registrationProgressCopy(
  state: RegistrationProgressState,
  failureReason?: string | null,
): [title: string, detail: string] {
  return {
    waiting_for_option: ["Waiting for option selection", "Client: select an appointment before registration is delivered."],
    allocation_incomplete: ["Allocation incomplete", "A clinician and appointment slot are both required before registration can be delivered."],
    automatic_pending: ["Automatic registration delivery pending", "System: registration will be delivered when the completed allocation is processed."],
    sending: ["Automatic registration delivery in progress", "System: delivery is in progress. Refresh shortly."],
    failed: ["Registration delivery failed", failureReason || "Staff: retry registration delivery."],
    sent: ["Registration sent", "Client: complete the registration form."],
    completed: ["Registration completed", "The submitted registration remains available below."],
  }[state] as [string, string];
}