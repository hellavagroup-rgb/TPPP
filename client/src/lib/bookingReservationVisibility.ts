import { isCyaPsychologyTenant } from "@shared/practicePolicies";

export function shouldShowBookingReservations(isAdmin: boolean, tenantId?: string | null): boolean {
  return isAdmin && isCyaPsychologyTenant(tenantId);
}
