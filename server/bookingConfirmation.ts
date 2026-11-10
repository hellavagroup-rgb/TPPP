import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { confirmationBlocker, confirmationBlockerCopy } from "@shared/confirmationRecovery";
import { ACTIVE_ALLOCATION_STATUSES } from "@shared/clientWorkflow";
import { isCyaPsychologyTenant } from "@shared/practicePolicies";
import { latestReservation, reservationPaymentMatches, ReservationError } from "./reservationLifecycle";
import {
  bookingSnapshots,
  auditLogs,
  clients,
  clientClinicianOptions,
  clinicians,
  tenants,
  timeSlots,
  users,
  bookingReservations,
  paymentCharges,
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

export class ExternalBookingReviewConflictError extends Error {
  constructor() {
    super("This client has a reviewed external appointment. Do not create a second portal booking.");
  }
}

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
  reservationPaymentResolution?: { reservationId: string; paymentIntentId: string };
};

export async function confirmBookingInTransaction(tx: any, input: BookingConfirmationInput): Promise<BookingConfirmationResult> {
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

    const idempotencyKey = input.idempotencyKey ||
      `booking-confirmation-${input.clientId}-${client.assignedSlotId || "no-slot"}`;
    // Removing the lifetime client uniqueness constraint must not silently
    // bypass a corrupt cross-practice history link that previously blocked it.
    const [foreignHistory] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots)
      .where(and(
        eq(bookingSnapshots.clientId, client.id),
        ne(bookingSnapshots.tenantId, input.tenantId),
      )).limit(1);
    if (foreignHistory) throw new Error("Booking history requires a practice ownership review");
    const [existingSnapshot] = await tx.select().from(bookingSnapshots)
      .where(and(
        eq(bookingSnapshots.clientId, client.id),
        eq(bookingSnapshots.tenantId, input.tenantId),
      )).orderBy(desc(bookingSnapshots.confirmedAt), desc(bookingSnapshots.id)).limit(1);
    if (existingSnapshot && (client.status === "Scheduled" || client.status === "BookingConfirmed")) {
      return {
        client,
        snapshot: existingSnapshot,
        status: client.status === "BookingConfirmed" ? "BookingConfirmed" : "Scheduled",
        newlyConfirmed: false,
      };
    }
    const externalReviews = await tx.select({ id: auditLogs.id, action: auditLogs.action })
      .from(auditLogs).where(and(
        eq(auditLogs.tenantId, input.tenantId),
        eq(auditLogs.resourceId, client.id),
        inArray(auditLogs.action, ["activity_external_booking_reviewed", "activity_writeupp_appointment_arranged"]),
      ));
    if (client.managerConfirmedAt || externalReviews.some((row: { action: string }) =>
      ["activity_external_booking_reviewed", "activity_writeupp_appointment_arranged"].includes(row.action))) {
      throw new ExternalBookingReviewConflictError();
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
    const guardedManual = (input.source === "manual" || input.source === "reassignment")
      && (tenant?.confirmationRecoveryEnabled || tenant?.registrationFormEnabled);
    if (input.source === "manual" || input.source === "reassignment") {
      if (guardedManual) {
        const blocker = confirmationBlocker(client, {
          paymentsEnabled: tenant.paymentsEnabled === true,
          registrationEnabled: tenant.registrationFormEnabled === true,
          allocationValid: !!client.assignedSlotId && !!client.assignedClinicianId,
        });
        if (blocker) throw new Error(confirmationBlockerCopy[blocker]);
      }
    }
    const status = confirmationStatus(tenant?.bookingConfirmedEmailEnabled === true);
    const reservation = isCyaPsychologyTenant(input.tenantId) ? await latestReservation(client.id, tx) : undefined;
    let reservationIdentityResolved = false;
    if (reservation) {
      const resolution = input.reservationPaymentResolution;
      if (resolution?.reservationId === reservation.id && input.source === "stripe" && client.paymentStatus === "active") {
        const [charge] = await tx.select().from(paymentCharges).where(and(
          eq(paymentCharges.stripePaymentIntentId, resolution.paymentIntentId),
          eq(paymentCharges.clientId, client.id), eq(paymentCharges.tenantId, input.tenantId),
          eq(paymentCharges.amountPence, client.agreedRatePence || 0), eq(paymentCharges.status, "succeeded"),
        )).limit(1);
        const resolutionAudits = await tx.select({ details: auditLogs.details }).from(auditLogs).where(and(
          eq(auditLogs.tenantId, input.tenantId), eq(auditLogs.resourceId, client.id),
          eq(auditLogs.action, "activity_reservation_payment_conflict_resolution"),
        ));
        reservationIdentityResolved = !!charge && resolutionAudits.some(({ details }: { details: Record<string, unknown> | null }) =>
          details?.reservationId === reservation.id && details?.decision === "confirm_verified_payment" &&
          details?.result === "payment_verified" && details?.paymentIntentId === resolution.paymentIntentId);
      }
      if (!reservationPaymentMatches(client, reservation) && !reservationIdentityResolved) {
        throw new ReservationError(409, "Review the reservation's original payment attempt before confirming this booking.");
      }
      const timelyDirectRegistration = input.source === "registration" && client.registrationFormSubmissionId &&
        client.termsAcceptedAt && client.termsAcceptedAt <= reservation.deadline &&
        (client.paymentType === "insurer" || !tenant?.paymentsEnabled);
      const verifiedPayment = input.source === "stripe" && client.paymentStatus === "active";
      if ((!["active", "payment_check"].includes(reservation.status) &&
          !(reservationIdentityResolved && reservation.status === "payment_review")) || reservation.slotId !== client.assignedSlotId ||
          (!verifiedPayment && !timelyDirectRegistration && (reservation.status !== "active" || reservation.deadline.getTime() <= Date.now()))) {
        throw new ReservationError(409, "This reservation is no longer available for confirmation. Staff must review the payment and appointment.");
      }
    }
    const [slot] = await tx.select().from(timeSlots).where(and(
      eq(timeSlots.id, client.assignedSlotId),
      eq(timeSlots.tenantId, input.tenantId),
    )).limit(1);
    if (!slot) throw new Error("The appointment slot could not be found");
    if (slot.clinicianId !== client.assignedClinicianId || slot.retiredAt ||
        (guardedManual && !slot.isBooked)) {
      throw new Error("The assigned slot is no longer reserved for this clinician");
    }
    // Different clients lock different rows; serialize by slot as well so two
    // simultaneous confirmation sources cannot claim the same appointment.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.tenantId}:${slot.id}:booking-confirmation`}))`);
    {
      const [conflict] = await tx.select({ conflictingClientId: clients.id }).from(clients).where(and(
        eq(clients.tenantId, input.tenantId),
        eq(clients.assignedSlotId, slot.id),
        ne(clients.id, client.id),
        inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
      )).limit(1);
      if (conflict) throw new Error("Another active client is assigned to this appointment slot");
      const [confirmedConflict] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots).where(and(
        eq(bookingSnapshots.tenantId, input.tenantId),
        eq(bookingSnapshots.slotId, slot.id),
      )).limit(1);
      if (confirmedConflict) throw new Error("This appointment slot already has a confirmed booking");
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
      locationType: client.assignedLocationType ?? slot.locationType,
      confirmedAt,
      idempotencyKey,
    }).returning();
    if (!snapshot) throw new Error("Booking snapshot could not be created");

    if (existingSnapshot) {
      // Preserve the previous appointment's operational evidence before the
      // client's current-booking markers are reset for this new appointment.
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        resourceType: "client",
        resourceId: client.id,
        action: "booking_milestones_preserved",
        details: {
          previousSnapshotId: existingSnapshot.id,
          replacementSnapshotId: snapshot.id,
          source: input.source,
          bookingConfirmationSentAt: client.bookingConfirmationSentAt,
          zoomLinkSentAt: client.zoomLinkSentAt,
          completedAt: client.completedAt,
          writeuppAppointmentConfirmed: client.writeuppAppointmentConfirmed,
          writeuppDataTransferred: client.writeuppDataTransferred,
        },
      });
    }

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
      assignedLocationType: null,
      assignedSlot: null,
      confirmedAt,
      // These markers describe the newly confirmed appointment, not an earlier
      // booking retained in history. Retries above must not clear them again.
      ...(existingSnapshot ? {
        bookingConfirmationSentAt: null,
        zoomLinkSentAt: null,
        completedAt: null,
        writeuppAppointmentConfirmed: false,
        writeuppDataTransferred: false,
      } : {}),
      ...(input.source === "registration" || input.source === "stripe"
        ? { registrationTokenRevokedAt: confirmedAt }
        : {}),
      updatedAt: confirmedAt,
    }).where(and(eq(clients.id, client.id), eq(clients.tenantId, input.tenantId))).returning();
    if (!updated) throw new Error("Client confirmation update failed");
    if (reservation) await tx.update(bookingReservations).set({
      status: "confirmed", endedAt: confirmedAt, reason: null, followUpPending: true,
      ...(!reservationIdentityResolved
        ? { paymentAttemptKey: client.registrationPaymentAttemptKey, paymentLinkId: client.stripePaymentLinkId }
        : {}),
    }).where(eq(bookingReservations.id, reservation.id));
    return { client: updated, snapshot, status, newlyConfirmed: true };
  }
}

export async function confirmBooking(input: BookingConfirmationInput): Promise<BookingConfirmationResult> {
  return db.transaction((tx) => confirmBookingInTransaction(tx, input));
}