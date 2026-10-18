import { isCyaPsychologyTenant } from "./practicePolicies";

export type WriteUppAdminEvidence = {
  tenantId?: string | null;
  status: string;
  isArchived?: boolean;
  completedAt?: Date | string | null;
  writeuppAppointmentConfirmed?: boolean | null;
  writeuppDataTransferred?: boolean | null;
};

/** An additional working-list entry, never a change to booking/calendar status. */
export function needsWriteUppAdminWork(client: WriteUppAdminEvidence, tenantId?: string | null): boolean {
  return isCyaPsychologyTenant(tenantId)
    && client.tenantId === tenantId
    && ["BookingConfirmed", "Scheduled"].includes(client.status)
    && !client.isArchived
    && !client.completedAt
    && (client.writeuppAppointmentConfirmed !== true || client.writeuppDataTransferred !== true);
}
