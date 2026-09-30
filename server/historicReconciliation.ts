import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { ACTIVE_ALLOCATION_STATUSES } from "@shared/clientWorkflow";
import { auditLogs, bookingSnapshots, clients, formSubmissions, paymentCharges, timeSlots } from "@shared/schema";
import { z } from "zod";

export const externalBookingReview = z.object({
  externalReference: z.string().trim().min(3).max(200),
  clinicianReference: z.string().trim().min(2).max(200),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const date = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, "Invalid date"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  familyMessageReview: z.string().trim().min(10).max(2000),
  diaryVerified: z.literal(true),
});

export function appointmentKey(value: z.infer<typeof externalBookingReview>): string {
  return [value.clinicianReference.trim().toLowerCase(), value.appointmentDate, value.startTime].join("|");
}

// This audit-only action does not change workflow status, payment, consent, allocation,
// snapshots or email timestamps. It is NOT the portal's confirmBooking transition.
export async function recordExternalBookingReview(
  tenantId: string, clientId: string, actorId: string, ipAddress: string | null,
  review: z.infer<typeof externalBookingReview>,
) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('historic-booking-review'))`);
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).for("update");
    if (!client || client.isArchived || client.completedAt) throw new Error("Client is not active in this practice");
    if (!["AwaitingConfirmation", "RegistrationPending"].includes(client.status)) throw new Error("Only unconfirmed clients can be marked as historically booked");
    const [snapshot] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots)
      .where(and(eq(bookingSnapshots.tenantId, tenantId), eq(bookingSnapshots.clientId, clientId))).limit(1);
    if (snapshot) throw new Error("This client already has a portal booking snapshot");
    if (client.assignedSlotId) {
      const [slot] = await tx.select().from(timeSlots).where(and(eq(timeSlots.id, client.assignedSlotId), eq(timeSlots.tenantId, tenantId))).limit(1);
      if (!slot || slot.clinicianId !== client.assignedClinicianId || !slot.isBooked || slot.retiredAt)
        throw new Error("The assigned appointment is invalid; repair its allocation before review");
      const [conflict] = await tx.select({ id: clients.id }).from(clients).where(and(
        eq(clients.tenantId, tenantId), eq(clients.assignedSlotId, slot.id), ne(clients.id, clientId),
        eq(clients.isArchived, false), inArray(clients.status, [...ACTIVE_ALLOCATION_STATUSES]),
      )).limit(1);
      const [confirmedConflict] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots).where(and(
        eq(bookingSnapshots.tenantId, tenantId), eq(bookingSnapshots.slotId, slot.id), ne(bookingSnapshots.clientId, clientId),
      )).limit(1);
      if (conflict || confirmedConflict) throw new Error("Another client claims this portal appointment slot");
    }
    const key = appointmentKey(review);
    const prior = await tx.select().from(auditLogs).where(and(
      eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_external_booking_reviewed"),
    ));
    for (const item of prior) {
      if (item.resourceId === clientId) {
        if (item.details?.appointmentKey === key && item.details?.externalReference === review.externalReference) return { alreadyReviewed: true };
        throw new Error("This client already has an external booking review; ask staff to resolve the discrepancy");
      }
      if (item.details?.appointmentKey === key || item.details?.externalReference === review.externalReference)
        throw new Error("This external appointment or reference is already recorded for another client");
    }
    await tx.insert(auditLogs).values({
      tenantId, userId: actorId, ipAddress, action: "activity_external_booking_reviewed",
      resourceType: "client", resourceId: clientId,
      details: {
        clientDisplayId: client.displayId, appointmentKey: key, externalReference: review.externalReference,
        clinicianReference: review.clinicianReference, appointmentDate: review.appointmentDate,
        startTime: review.startTime, familyMessageReview: review.familyMessageReview,
        diaryVerified: true, portalStatusAtReview: client.status,
        // No assertion about consent, Stripe payment, or email delivery.
      },
    });
    return { alreadyReviewed: false };
  });
}

export async function historicReconciliationInventory(tenantId: string) {
  const activeClients = await db.select().from(clients).where(and(eq(clients.tenantId, tenantId), eq(clients.isArchived, false)));
  const rows = activeClients.filter(c => ["AwaitingConfirmation", "RegistrationPending", "BookingConfirmed", "Scheduled"].includes(c.status) && !c.completedAt);
  const [slots, snapshots, submissions, charges, reviews, bookingEvents, selectionEvents] = await Promise.all([
    db.select().from(timeSlots).where(eq(timeSlots.tenantId, tenantId)),
    db.select().from(bookingSnapshots).where(eq(bookingSnapshots.tenantId, tenantId)),
    db.select({ id: formSubmissions.id, clientId: formSubmissions.clientId, isDraft: formSubmissions.isDraft,
      consent: formSubmissions.registrationConsentEvidence, termsAt: formSubmissions.registrationTermsAcceptedAt })
      .from(formSubmissions).where(eq(formSubmissions.tenantId, tenantId)),
    db.select({ clientId: paymentCharges.clientId, status: paymentCharges.status })
      .from(paymentCharges).where(eq(paymentCharges.tenantId, tenantId)),
    db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_external_booking_reviewed"))),
    db.select({ resourceId: auditLogs.resourceId }).from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_booking_confirmed"))),
    db.select({ resourceId: auditLogs.resourceId }).from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_appointment_option_selected"))),
  ]);
  return rows.map(client => {
    const slot = slots.find(s => s.id === client.assignedSlotId);
    const snapshot = snapshots.find(s => s.clientId === client.id);
    const registration = submissions.find(s => s.id === client.registrationFormSubmissionId && s.clientId === client.id && !s.isDraft);
    const conflictingClients = slot ? activeClients.filter(c => c.id !== client.id && c.assignedSlotId === slot.id && (ACTIVE_ALLOCATION_STATUSES as readonly string[]).includes(c.status)) : [];
    const conflictingSnapshots = slot ? snapshots.filter(s => s.clientId !== client.id && s.slotId === slot.id) : [];
    const review = reviews.find(r => r.resourceId === client.id);
    return {
      id: client.id, displayId: client.displayId, status: client.status,
      portalSnapshot: !!snapshot, portalConfirmedAt: snapshot?.confirmedAt ?? null,
      bookingEmailAcceptedAt: client.bookingConfirmationSentAt,
      portalBookingEvent: bookingEvents.some(e => e.resourceId === client.id),
      optionSelectionEvent: selectionEvents.some(e => e.resourceId === client.id),
      allocation: !client.assignedSlotId || !client.assignedClinicianId ? "missing"
        : !slot || slot.clinicianId !== client.assignedClinicianId || slot.retiredAt || !slot.isBooked ? "invalid"
        : conflictingClients.length || conflictingSnapshots.length ? "duplicate" : "reserved",
      slot: slot ? { type: slot.type, day: slot.day, date: slot.date, startTime: slot.startTime, endTime: slot.endTime } : null,
      intakeSubmitted: submissions.some(s => s.clientId === client.id && s.id !== client.registrationFormSubmissionId && !s.isDraft),
      registrationSubmitted: !!registration,
      consentEvidence: Array.isArray(registration?.consent) && registration.consent.length > 0 ? "recorded"
        : registration?.termsAt || client.termsAcceptedAt ? "legacy_terms_only" : "not_recorded",
      paymentType: client.paymentType, paymentStatus: client.paymentStatus,
      chargeStatuses: charges.filter(c => c.clientId === client.id).map(c => c.status),
      externalReview: review ? { reviewedAt: review.timestamp, externalReference: review.details?.externalReference,
        appointmentDate: review.details?.appointmentDate, startTime: review.details?.startTime,
        familyMessageReview: review.details?.familyMessageReview } : null,
    };
  });
}