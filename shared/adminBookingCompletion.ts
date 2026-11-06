import { isCyaPsychologyTenant } from "./practicePolicies";

export type AdminCompletionRecord = {
  tenantId?: string | null;
  status: string;
  isArchived?: boolean;
  completedAt?: Date | string | null;
  managerConfirmedAt?: Date | string | null;
  writeuppAppointmentConfirmed?: boolean | null;
  writeuppDataTransferred?: boolean | null;
};

/** Administrative completion must never substitute for a newer portal booking check. */
export function isAdminCompletionRecord(client: AdminCompletionRecord, writeuppArranged: boolean) {
  return client.status === "Scheduled"
    || (client.status === "BookingConfirmed" && !!client.managerConfirmedAt)
    || (["AwaitingConfirmation", "RegistrationPending"].includes(client.status) && writeuppArranged);
}

export function adminCompletionBlocker(
  client: AdminCompletionRecord,
  options: { tenantId: string; enabled: boolean; writeuppArranged: boolean },
): string | null {
  if (!isCyaPsychologyTenant(options.tenantId) || client.tenantId !== options.tenantId || !options.enabled)
    return "Administrative completion is not enabled for this practice.";
  if (client.isArchived) return "Restore this client before completing booking administration.";
  if (!isAdminCompletionRecord(client, options.writeuppArranged))
    return "This client must use the normal portal booking completion checks.";
  if (!client.writeuppAppointmentConfirmed || !client.writeuppDataTransferred)
    return "Save both WriteUpp checklist items before completing booking administration.";
  return null;
}
