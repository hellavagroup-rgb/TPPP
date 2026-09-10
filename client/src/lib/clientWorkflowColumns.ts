const MATCHED_ALLOCATION_STATUSES = new Set([
  "Assigned",
  "OptionsSent",
  "OptionSelected",
]);

const AWAITING_CONFIRMATION_STATUSES = new Set([
  "AwaitingConfirmation",
  "RegistrationPending",
  "BookingConfirmed",
]);

export function isMatchedAllocationStatus(status: string): boolean {
  return MATCHED_ALLOCATION_STATUSES.has(status);
}

export function isAwaitingConfirmationStatus(status: string): boolean {
  return AWAITING_CONFIRMATION_STATUSES.has(status);
}