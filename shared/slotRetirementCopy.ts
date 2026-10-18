import { FINALIZED_BOOKING_STATUSES } from "./clientWorkflow";

export const confirmedSlotRetirementCopy =
  "This slot is linked to a confirmed booking and is kept as booking history. If the clinician confirms this time is free again, use Add Availability to create a new slot at the same time. There is no need to reopen the client or mark therapy as completed.";

export function hasOnlyConfirmedSlotOwners(statuses: readonly string[]): boolean {
  return statuses.length > 0 && statuses.every(status =>
    FINALIZED_BOOKING_STATUSES.some(confirmed => confirmed === status));
}

export function slotRetirementConflictCopy(statuses: readonly string[]): string {
  return hasOnlyConfirmedSlotOwners(statuses)
    ? confirmedSlotRetirementCopy
    : "This slot cannot be retired while an active client workflow owns it. Reassign or complete that client first.";
}
