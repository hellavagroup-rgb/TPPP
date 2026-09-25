import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "./db";
import { confirmationBlocker, confirmationBlockerCopy } from "@shared/confirmationRecovery";
import { ACTIVE_ALLOCATION_STATUSES } from "@shared/clientWorkflow";
import {
  bookingSnapshots,
  clients,
  clientClinicianOptions,
  clinicians,
  tenants,
  timeSlots,
  users,
  type BookingSnapshot,
  type Client,
} from "@shared/schema";

export type BookingConfirmationSource =
  | "manual"
  | "option-selection"
  | "registration"
  | "stripe"
  | "reassignment";

export type BookingConfirmationResult = {
  client: Client;
  snapshot: BookingSnapshot;
  status: "Scheduled" | "BookingConfirmed";
  newlyConfirmed: boolean;
};

export function confirmationStatus(bookingConfirmedEmailEnabled: boolean): "Scheduled" | "BookingConfirmed" {
  return bookingConfirmedEmailEnabled ? "BookingConfirmed" : "Scheduled";
}

/**
 * The sole state transition for a completed booking.  The client lock makes
 * browser retries, webhook retries, and competing admin requests converge on
 * one committed result.  Snapshot, option resolution, client state, and slot
 * retirement intentionally share one transaction.
 */
export type BookingConfirmationInput = {
  clientId: string;
  tenantId: string;
  source: BookingConfirmationSource;
  idempotencyKey?: string;
  expectedStatus?: Client["status"];
  expectedPaymentLinkId?: string;
  expectedPaymentAttemptKey?: string;
};

export async function confirmBookingInTransaction(tx: any, input: BookingConfirmationInput): Promise<BookingConfirmationResult> {
  const idempotencyKey = input.idempotencyKey || `booking-confirmation-${input.clientId}`;
  {
    const predicates = [
      eq(clients.id, input.clientId),
      eq(clients.tenantId, input.tenantId),
      ...(input.expectedStatus ? [eq(clients.status, input.expectedStatus)] : []),
      ...(input.expectedPaymentLinkId ? [eq(clients.stripePaymentLinkId, input.expectedPaymentLinkId)] : []),
      ...(input.expectedPaymentAttemptKey ? [eq(clients.registrationPaymentAttemptKey, input.expectedPaymentAttemptKey)] : []),
    ];
    const clientQuery = tx.select().from(clients).where(and(...predicates));
    // The production postgres builder supports FOR UPDATE. Lightweight HTTP
    // harnesses may provide a transaction query facade without row locking;
    // production never takes this branch.
    const [client] = await (typeof clientQuery.for === "function"
      ? clientQuery.for("update")
      : clientQuery);
    if (!client) throw new Error("Client not found");

    const [existingSnapshot] = await tx.select().from(bookingSnapshots)
      .where(eq(bookingSnapshots.clientId, client.id)).limit(1);
    if (existingSnapshot) {
      return {
        client,
        snapshot: existingSnapshot,
        status: client.status === "BookingConfirmed" ? "BookingConfirmed" : "Scheduled",
        newlyConfirmed: false,
      };
    }
    if (!client.assignedSlotId || !client.assignedClinicianId) {
      throw new Error("A clinician and appointment slot are required to confirm this booking");
    }

    const [tenant] = await tx.select({
      bookingConfirmedEmailEnabled: tenants.bookingConfirmedEmailEnabled,
      confirmationRecoveryEnabled: tenants.confirmationRecoveryEnabled,
      paymentsEnabled: tenants.paymentsEnabled,
      registrationFormEnabled: tenants.registrationFormEnabled,
    })
      .from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
    if (input.source === "manual" || input.source === "reassignment") {
      if (tenant?.confirmationRecoveryEnabled) {
        const blocker = confirmationBlocker(client, {
          paymentsEnabled: tenant.paymentsEnabled === true,
          registrationEnabled: tenant.registrationFormEnabled === true,
          allocationValid: !!client.assignedSlotId && !!client.assignedClinicianId,
        });
        if (blocker) throw new Error(confirmationBlockerCopy[blocker]);
      }
    }
    const status = confirmationStatus(tenant?.bookingConfirmedEmailEnabled === true);
    const [slot] = await tx.select().from(timeSlots).where(and(
      eq(timeSlots.id, client.assignedSlotId),
      eq(timeSlots.tenantId, input.tenantId),
    )).limit(1);
    if (!slot) throw new Error("The appointment slot could not be found");
    if (slot.clinicianId !== client.assignedClinicianId || slot.retiredAt ||
        (tenant?.confirmationRecoveryEnabled && (input.source === "manual" || input.source === "reassignment") && !slot.isBooked)) {
      throw new Error("The assigned slot is no longer reserved for this clinician");
    }
    if (tenant?.confirmationRecoveryEnabled && (input.source === "manual" || input.source === "reassignment")) {
      const [conflict] = await tx.select({ conflictingClientId: clients.id }).from(clients).where(and(
        eq(clients.tenantId, input.tenantId),
        eq(clients.assignedSlotId, slot.id),
        ne(clients.id, client.id),
        inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
      )).limit(1);
      if (conflict) throw new Error("Another active client is assigned to this appointment slot");
    }
    const [clinician] = await tx.select({
      id: clinicians.id,
      userId: clinicians.userId,
    }).from(clinicians).where(and(
      eq(clinicians.id, client.assignedClinicianId),
      eq(clinicians.tenantId, input.tenantId),
    )).limit(1);
    if (!clinician) throw new Error("The assigned clinician could not be found");
    const [user] = clinician.userId
      ? await tx.select({ name: users.name }).from(users)
        .where(eq(users.id, clinician.userId)).limit(1)
      : [];
    const confirmedAt = new Date();
    const [snapshot] = await tx.insert(bookingSnapshots).values({
      tenantId: input.tenantId,
      clientId: client.id,
      slotId: slot.id,
      clinicianId: clinician.id,
      clinicianName: user?.name || "Your Clinician",
      slotType: slot.type,
      date: slot.date,
      day: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime,
      locationType: slot.locationType,
      confirmedAt,
      idempotencyKey,
    }).returning();
    if (!snapshot) throw new Error("Booking snapshot could not be created");

    const retired = await tx.update(timeSlots).set({
      isBooked: false,
      retiredAt: confirmedAt,
      retirementReason: "Appointment confirmed",
    }).where(and(
      eq(timeSlots.id, slot.id),
      eq(timeSlots.tenantId, input.tenantId),
      isNull(timeSlots.retiredAt),
    )).returning({ id: timeSlots.id });
    if (retired.length !== 1) throw new Error("The appointment slot could not be retired");

    await tx.update(clientClinicianOptions).set({ status: "unavailable" }).where(and(
      eq(clientClinicianOptions.slotId, slot.id),
      eq(clientClinicianOptions.tenantId, input.tenantId),
      eq(clientClinicianOptions.status, "pending"),
    ));
    const [updated] = await tx.update(clients).set({
      status,
      assignedClinicianId: null,
      assignedSlotId: null,
      assignedSlot: null,
      confirmedAt,
      ...(input.source === "registration" || input.source === "stripe"
        ? { registrationTokenRevokedAt: confirmedAt }
        : {}),
      updatedAt: confirmedAt,
    }).where(and(eq(clients.id, client.id), eq(clients.tenantId, input.tenantId))).returning();
    if (!updated) throw new Error("Client confirmation update failed");
    return { client: updated, snapshot, status, newlyConfirmed: true };
  }
}

export async function confirmBooking(input: BookingConfirmationInput): Promise<BookingConfirmationResult> {
  return db.transaction((tx) => confirmBookingInTransaction(tx, input));
}