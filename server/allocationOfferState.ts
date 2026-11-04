import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { clientClinicianOptions, clinicianInvitations, timeSlots, clinicians, type Client } from "@shared/schema";
import { isCyaPsychologyTenant } from "@shared/practicePolicies";
import { practiceToday, slotUnavailableReason } from "@shared/slotEligibility";
import type { AllocationOfferEligibility } from "@shared/allocationOfferSummary";

export type AllocationOfferState = "pending" | "declined" | "closed";
export interface AllocationOfferSummary {
  state: AllocationOfferState;
  kind?: "clinician_invitation";
  eligibility: AllocationOfferEligibility | null;
  deliveryAcceptedAt: Date | null;
}

// Workflow actions need this summary even when appointment-detail visibility is off.
// Never include public selection tokens in the staff list.
export async function getAllocationOfferStates(clientList: Client[], tenantId: string) {
  const ownedIds = clientList
    .filter(client => client.tenantId === tenantId && client.status === "OptionsSent")
    .map(client => client.id);
  const result = new Map<string, AllocationOfferSummary>();
  if (!ownedIds.length) return result;
  const rows = await db.select({
    clientId: clientClinicianOptions.clientId,
    tenantId: clientClinicianOptions.tenantId,
    status: clientClinicianOptions.status,
    createdAt: clientClinicianOptions.createdAt,
    sentAt: clientClinicianOptions.sentAt,
    slotId: clientClinicianOptions.slotId,
    clinicianId: clientClinicianOptions.clinicianId,
  }).from(clientClinicianOptions).where(and(
    eq(clientClinicianOptions.tenantId, tenantId),
    inArray(clientClinicianOptions.clientId, ownedIds),
  )).orderBy(desc(clientClinicianOptions.createdAt));
  // CY&A's live-choice invitations are a separate offer mechanism. Only read
  // safe summary fields; never include the family's invitation token.
  const invitations = isCyaPsychologyTenant(tenantId) ? await db.select({
    clientId: clinicianInvitations.clientId,
    status: clinicianInvitations.status,
    createdAt: clinicianInvitations.createdAt,
    emailAttemptAcceptedAt: clinicianInvitations.emailAttemptAcceptedAt,
  }).from(clinicianInvitations).where(and(
    eq(clinicianInvitations.tenantId, tenantId),
    inArray(clinicianInvitations.clientId, ownedIds),
  )).orderBy(desc(clinicianInvitations.createdAt)) : [];
  const pending = rows.filter(row => row.tenantId === tenantId && row.status === "pending");
  const slotIds = Array.from(new Set(pending.flatMap(row => row.slotId ? [row.slotId] : [])));
  const clinicianIds = Array.from(new Set(pending.map(row => row.clinicianId)));
  const [slots, ownedClinicians] = await Promise.all([
    slotIds.length ? db.select().from(timeSlots).where(and(
      eq(timeSlots.tenantId, tenantId), inArray(timeSlots.id, slotIds),
    )) : [],
    clinicianIds.length ? db.select({ id: clinicians.id, tenantId: clinicians.tenantId }).from(clinicians).where(and(
      eq(clinicians.tenantId, tenantId), inArray(clinicians.id, clinicianIds),
    )) : [],
  ]);
  const slotsById = new Map(slots.filter(slot => slot.tenantId === tenantId).map(slot => [slot.id, slot]));
  const clinicianIdSet = new Set(ownedClinicians.filter(clinician => clinician.tenantId === tenantId).map(clinician => clinician.id));
  const today = practiceToday();
  for (const id of ownedIds) {
    const options = rows.filter(row => row.clientId === id && row.tenantId === tenantId);
    const newestTime = options[0]?.createdAt?.getTime();
    const invitation = invitations.find(row => row.clientId === id);
    if (invitation && (newestTime === undefined || invitation.createdAt.getTime() >= newestTime)) {
      result.set(id, {
        kind: "clinician_invitation",
        state: ["sent", "prepared", "uncertain"].includes(invitation.status) ? "pending"
          : invitation.status === "declined" ? "declined" : "closed",
        deliveryAcceptedAt: invitation.status === "sent" ? invitation.emailAttemptAcceptedAt : null,
        // These invite a clinician choice from live availability, not fixed
        // appointment options. Do not fabricate fixed-slot eligibility counts.
        eligibility: null,
      });
      continue;
    }
    const latest = options.filter(row => row.createdAt?.getTime() === newestTime);
    const pendingOptions = options.filter(row => row.status === "pending");
    const state = pendingOptions.length ? "pending"
      : latest.length && latest.every(row => row.status === "declined") ? "declined" : "closed";
    const availableCount = pendingOptions.filter(option => {
      const slot = option.slotId ? slotsById.get(option.slotId) : undefined;
      return slot && clinicianIdSet.has(option.clinicianId)
        && slot.clinicianId === option.clinicianId && !slotUnavailableReason(slot, today);
    }).length;
    result.set(id, {
      state,
      // Pending rows alone do not prove the family was emailed. Be conservative
      // if any current choice lacks its recorded provider-acceptance milestone.
      deliveryAcceptedAt: pendingOptions.length && pendingOptions.every(option => option.sentAt)
        ? pendingOptions[0].sentAt! : null,
      eligibility: state === "pending" ? {
        pendingCount: pendingOptions.length,
        availableCount,
        unavailableCount: pendingOptions.length - availableCount,
      } : null,
    });
  }
  return result;
}