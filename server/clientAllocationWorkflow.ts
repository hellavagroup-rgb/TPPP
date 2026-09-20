export {
  ACTIVE_ALLOCATION_STATUSES,
  hasActiveClientAllocation,
  hasFinalizedBooking,
} from "@shared/clientWorkflow";

import { hasActiveClientAllocation } from "@shared/clientWorkflow";

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