import { and, eq, sql } from "drizzle-orm";
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
  arrangedInWriteupp: z.boolean().default(false),
});

export function appointmentKey(value: z.infer<typeof externalBookingReview>): string {
  return [value.clinicianReference.trim().toLowerCase(), value.appointmentDate, value.startTime].join("|");
}

export const writeuppArrangementAssertion = z.object({
  arrangedInWriteupp: z.literal(true),
}).strict();

/** Staff's explicit acknowledgement, without inventing appointment or payment evidence. */
export async function acknowledgeWriteuppArrangement(
  tenantId: string, clientId: string, actorId: string, ipAddress: string | null,
) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('historic-booking-review'))`);
    const [client] = await tx.select().from(clients).where(and(
      eq(clients.id, clientId), eq(clients.tenantId, tenantId),
    )).for("update");
    if (!client || client.isArchived || client.completedAt) throw new Error("Client is not active in this practice");
    if (!["AwaitingConfirmation", "RegistrationPending"].includes(client.status))
      throw new Error("Only unconfirmed clients can be marked as arranged in WriteUpp");
    const [snapshot] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots).where(and(
      eq(bookingSnapshots.tenantId, tenantId), eq(bookingSnapshots.clientId, clientId),
    )).limit(1);
    if (snapshot) throw new Error("This client already has a portal booking snapshot");
    const arrangements = await tx.select().from(auditLogs).where(and(
      eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, clientId),
      eq(auditLogs.action, "activity_writeupp_appointment_arranged"),
    ));
    if (arrangements.some(item => item.resourceId === clientId)) return { arrangedInWriteupp: true, alreadyRecorded: true };
    await tx.insert(auditLogs).values({
      tenantId, userId: actorId, ipAddress, action: "activity_writeupp_appointment_arranged",
      resourceType: "client", resourceId: clientId,
      details: {
        clientDisplayId: client.displayId, staffAcknowledged: true, portalStatusAtReview: client.status,
      },
    });
    return { arrangedInWriteupp: true, alreadyRecorded: false };
  });
}

// These audit-only actions do not change workflow status, payment, consent, allocation,
// snapshots or email timestamps. They are NOT the portal's confirmBooking transition.
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
    const key = appointmentKey(review);
    const prior = await tx.select().from(auditLogs).where(and(
      eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_external_booking_reviewed"),
    ));
    for (const item of prior) {
      if (item.resourceId === clientId) {
        if (item.details?.appointmentKey === key && item.details?.externalReference === review.externalReference) {
          if (review.arrangedInWriteupp) {
            await recordWriteuppArrangement(tx, tenantId, clientId, actorId, ipAddress, client, key, review);
          }
          return { alreadyReviewed: true };
        }
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
    if (review.arrangedInWriteupp) {
      await recordWriteuppArrangement(tx, tenantId, clientId, actorId, ipAddress, client, key, review);
    }
    return { alreadyReviewed: false };
  });
}

async function recordWriteuppArrangement(
  tx: any, tenantId: string, clientId: string, actorId: string, ipAddress: string | null,
  client: any, key: string, review: z.infer<typeof externalBookingReview>,
) {
  const arrangements = await tx.select().from(auditLogs).where(and(
    eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_writeupp_appointment_arranged"),
  ));
  if (arrangements.some((item: any) => item.resourceId === clientId
    && item.details?.appointmentKey === key
    && item.details?.externalReference === review.externalReference)) return;
  await tx.insert(auditLogs).values({
    tenantId, userId: actorId, ipAddress, action: "activity_writeupp_appointment_arranged",
    resourceType: "client", resourceId: clientId,
    details: {
      clientDisplayId: client.displayId, appointmentKey: key, externalReference: review.externalReference,
      clinicianReference: review.clinicianReference, appointmentDate: review.appointmentDate,
      startTime: review.startTime, diaryVerified: true,
    },
  });
}

export async function historicReconciliationInventory(tenantId: string) {
  const activeClients = await db.select().from(clients).where(and(eq(clients.tenantId, tenantId), eq(clients.isArchived, false)));
  const rows = activeClients.filter(c => ["AwaitingConfirmation", "RegistrationPending", "BookingConfirmed", "Scheduled"].includes(c.status) && !c.completedAt);
  const [slots, snapshots, submissions, charges, reviews, arrangements, bookingEvents, selectionEvents] = await Promise.all([
    db.select().from(timeSlots).where(eq(timeSlots.tenantId, tenantId)),
    db.select().from(bookingSnapshots).where(eq(bookingSnapshots.tenantId, tenantId)),
    db.select({ id: formSubmissions.id, clientId: formSubmissions.clientId, isDraft: formSubmissions.isDraft,
      consent: formSubmissions.registrationConsentEvidence, termsAt: formSubmissions.registrationTermsAcceptedAt })
      .from(formSubmissions).where(eq(formSubmissions.tenantId, tenantId)),
    db.select({ clientId: paymentCharges.clientId, status: paymentCharges.status })
      .from(paymentCharges).where(eq(paymentCharges.tenantId, tenantId)),
    db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_external_booking_reviewed"))),
    db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "activity_writeupp_appointment_arranged"))),
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
      writeuppArranged: arrangements.some(e => e.resourceId === client.id),
      externalReview: review ? { reviewedAt: review.timestamp, externalReference: review.details?.externalReference,
        clinicianReference: review.details?.clinicianReference,
        appointmentDate: review.details?.appointmentDate, startTime: review.details?.startTime,
        familyMessageReview: review.details?.familyMessageReview } : null,
    };
  });
}