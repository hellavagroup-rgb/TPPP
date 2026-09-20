export const ACTIVE_ALLOCATION_STATUSES = [
  "Assigned",
  "AwaitingConfirmation",
  "Scheduled",
  "OptionSelected",
  "RegistrationPending",
  "BookingConfirmed",
] as const;

export const ACTIVE_ALLOCATION_STATUS_SET = new Set<string>(ACTIVE_ALLOCATION_STATUSES);
export const FINALIZED_BOOKING_STATUS_SET = new Set<string>(["Scheduled", "BookingConfirmed"]);

export function hasActiveClientAllocation(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_ALLOCATION_STATUS_SET.has(status));
}

export function hasFinalizedBooking(status: string | null | undefined): boolean {
  return Boolean(status && FINALIZED_BOOKING_STATUS_SET.has(status));
}

export type SlotIntegrityAction = "none" | "book" | "open" | "conflict";

export function getSlotIntegrityAction(
  isBooked: boolean,
  activeOwnerCount: number,
  isRetired = false,
): SlotIntegrityAction {
  if (activeOwnerCount > 1) return "conflict";
  if (isRetired) return isBooked ? "open" : "none";
  if (activeOwnerCount === 1) return isBooked ? "none" : "book";
  return isBooked ? "open" : "none";
}

export function getOptionStatusForSlot(
  status: "pending" | "selected" | "declined" | "unavailable",
  slotIsSelectable: boolean,
): "pending" | "selected" | "declined" | "unavailable" {
  return status === "pending" && !slotIsSelectable ? "unavailable" : status;
}

export function shouldReleaseClientAllocation(
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined,
): boolean {
  return Boolean(
    oldStatus &&
    newStatus &&
    hasActiveClientAllocation(oldStatus) &&
    !hasActiveClientAllocation(newStatus),
  );
}