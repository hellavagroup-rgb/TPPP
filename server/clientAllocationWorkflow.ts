const ALLOCATED_CLIENT_STATUSES = new Set([
  "Assigned",
  "AwaitingConfirmation",
  "Scheduled",
  "OptionSelected",
  "RegistrationPending",
  "BookingConfirmed",
]);

export function shouldReleaseClientAllocation(
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined,
): boolean {
  return Boolean(
    oldStatus &&
    newStatus &&
    ALLOCATED_CLIENT_STATUSES.has(oldStatus) &&
    !ALLOCATED_CLIENT_STATUSES.has(newStatus),
  );
}