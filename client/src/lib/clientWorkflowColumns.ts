import type { ClientStatus } from "@shared/clientWorkflow";

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