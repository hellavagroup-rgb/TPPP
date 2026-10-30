import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, bookingSnapshots, clientClinicianOptions, clients, clinicians, timeSlots } from "@shared/schema";
import { ACTIVE_ALLOCATION_STATUSES } from "@shared/clientWorkflow";
import { db } from "./db";
import { confirmedSlotRetirementCopy, hasOnlyConfirmedSlotOwners } from "@shared/slotRetirementCopy";

const RETIREMENT_REASON = "Occupied appointment arranged in WriteUpp";

export class WriteuppSlotRetirementError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}

/** Preview and commit use the same locked eligibility checks. Never confirm a booking here. */
export async function writeuppSlotRetirement(input: {
  tenantId: string; clinicianId: string; slotId: string;
  confirm?: boolean; expectedClientId?: string; actorId?: string; ipAddress?: string | null;
}) {
  return db.transaction(async tx => {
    const [clinician] = await tx.select({ id: clinicians.id }).from(clinicians).where(and(
      eq(clinicians.id, input.clinicianId), eq(clinicians.tenantId, input.tenantId),
    ));
    if (!clinician) throw new WriteuppSlotRetirementError("Slot not found in this practice.", 404);
    const [slot] = await tx.select().from(timeSlots).where(eq(timeSlots.id, input.slotId)).for("update");
    if (!slot || slot.clinicianId !== input.clinicianId || (slot.tenantId && slot.tenantId !== input.tenantId))
      throw new WriteuppSlotRetirementError("Slot not found in this practice.", 404);

    // Inspect every active reference, including inconsistent foreign references:
    // never retire a slot shared by multiple active workflows.
    const owners = await tx.select().from(clients).where(and(
      eq(clients.assignedSlotId, slot.id), inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
    )).for("update");
    const client = owners.length === 1 ? owners[0] : undefined;
    const confirmedBooking = hasOnlyConfirmedSlotOwners(owners.map(owner => owner.status))
      && owners.every(owner => owner.tenantId === input.tenantId && owner.assignedClinicianId === input.clinicianId);
    let reason = "An active reservation must be resolved before this slot can be retired.";
    if (confirmedBooking) reason = confirmedSlotRetirementCopy;
    let eligible = Boolean(client && client.tenantId === input.tenantId &&
      client.assignedClinicianId === input.clinicianId && !client.isArchived && !client.completedAt &&
      ["AwaitingConfirmation", "RegistrationPending"].includes(client.status));
    if (eligible && client) {
      const [arrangement] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
        eq(auditLogs.tenantId, input.tenantId), eq(auditLogs.resourceType, "client"),
        eq(auditLogs.resourceId, client.id), eq(auditLogs.action, "activity_writeupp_appointment_arranged"),
      )).limit(1);
      const [snapshot] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots)
        .where(and(eq(bookingSnapshots.clientId, client.id), eq(bookingSnapshots.slotId, slot.id))).limit(1);
      eligible = Boolean(arrangement && !snapshot);
      reason = snapshot ? "This slot has a portal booking and cannot be retired using the WriteUpp action."
        : "Record that the appointment is arranged in WriteUpp before retiring its occupied slot.";
    }
    if (!input.confirm) {
      return eligible && !slot.retiredAt && client
        ? { eligible: true, clientId: client.id, clientDisplayId: client.displayId }
        : {
          eligible: false,
          ...(confirmedBooking ? { confirmedBooking: true } : {}),
          reason: slot.retiredAt
            ? `This slot has already been retired.${confirmedBooking ? ` ${confirmedSlotRetirementCopy}` : ""}`
            : reason,
        };
    }
    if (!eligible || !client) throw new WriteuppSlotRetirementError(reason);
    if (!input.actorId || input.expectedClientId !== client.id)
      throw new WriteuppSlotRetirementError("The slot's client has changed. Refresh and review the slot again.");
    if (slot.retiredAt) {
      if (slot.retirementReason === RETIREMENT_REASON) return { retired: true, alreadyRetired: true };
      throw new WriteuppSlotRetirementError("This slot has already been retired.");
    }
    await tx.update(timeSlots).set({
      retiredAt: new Date(), retirementReason: RETIREMENT_REASON, isBooked: false,
    }).where(eq(timeSlots.id, slot.id));
    await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
      eq(clientClinicianOptions.slotId, slot.id), eq(clientClinicianOptions.tenantId, input.tenantId),
      eq(clientClinicianOptions.status, "pending"),
    ));
    await tx.insert(auditLogs).values({
      tenantId: input.tenantId, userId: input.actorId, ipAddress: input.ipAddress || null,
      action: "activity_writeupp_slot_retired", resourceType: "timeslot", resourceId: slot.id,
      details: { clientId: client.id, clientDisplayId: client.displayId, clinicianId: input.clinicianId,
        reason: RETIREMENT_REASON, appointmentLinksPreserved: true },
    });
    return { retired: true, alreadyRetired: false };
  });
}
