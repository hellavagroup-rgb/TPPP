import Stripe from "stripe";
import { and, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import { bookingReservations, bookingSnapshots, clients, clinicians, clinicianInvitations, auditLogs, timeSlots, tenants, formSubmissions, paymentCharges, type Client, type Tenant, type BookingSnapshot, type BookingReservation } from "@shared/schema";
import { isCyaPsychologyTenant } from "@shared/practicePolicies";
import { decryptSecret } from "./encryption";
import { createPaymentLink, childNameFromClientNotes } from "./stripe";
import { reconcileRegistrationPayment } from "./paymentReconciliation";
import { confirmBooking } from "./bookingConfirmation";
import { isClientStatus } from "@shared/clientWorkflow";
import { sendEmail, generateBookingConfirmedEmail } from "./email";

let recoveryFollowUp: ((tenant: Tenant, details: { client: Client; snapshot: BookingSnapshot; intentId: string }) => Promise<void>) | undefined;
export function registerReservationRecoveryFollowUp(callback: NonNullable<typeof recoveryFollowUp>) { recoveryFollowUp = callback; }

async function finishRecoveredReservation(hold: BookingReservation, tenant: Tenant) {
  const [client] = await db.select().from(clients).where(eq(clients.id, hold.clientId));
  const [snapshot] = await db.select().from(bookingSnapshots).where(and(eq(bookingSnapshots.clientId, hold.clientId), eq(bookingSnapshots.tenantId, tenant.id)));
  if (!client || !snapshot) return;
  const [charge] = await db.select().from(paymentCharges).where(and(eq(paymentCharges.clientId, client.id), eq(paymentCharges.status, "succeeded"))).orderBy(desc(paymentCharges.chargedAt)).limit(1);
  if (tenant.bookingConfirmedEmailEnabled && !client.bookingConfirmationSentAt) {
    if (hold.endedAt && Date.now() - hold.endedAt.getTime() > 23 * 60 * 60 * 1000) {
      await db.update(bookingReservations).set({ reason: "Booking confirmed. Confirmation email needs staff review: its safe automatic retry window elapsed." }).where(eq(bookingReservations.id, hold.id));
      return;
    }
    const email = await generateBookingConfirmedEmail({
      clinicianName: snapshot.clinicianName, type: snapshot.slotType, date: snapshot.date,
      day: snapshot.day, startTime: snapshot.startTime, endTime: snapshot.endTime,
    }, tenant);
    const delivery = await sendEmail({ ...email, to: client.email,
      idempotencyKey: charge?.stripePaymentIntentId
        ? `stripe-booking-confirmation-${client.id}-${charge.stripePaymentIntentId}`
        : `registration-confirmation-${client.id}-${client.registrationPaymentAttemptKey}`,
    });
    if (!delivery.success) return; // Durable retry; never fabricate acceptance.
    await db.update(clients).set({ bookingConfirmationSentAt: new Date() }).where(eq(clients.id, client.id));
  }
  await recoveryFollowUp?.(tenant, { client, snapshot, intentId: charge?.stripePaymentIntentId || `registration-${client.registrationPaymentAttemptKey}` });
  await db.update(bookingReservations).set({ followUpPending: false }).where(eq(bookingReservations.id, hold.id));
}

export class ReservationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const liveReservationStatuses = ["active", "payment_check", "payment_review"] as const;

export async function latestReservation(clientId: string, executor: any = db): Promise<BookingReservation | undefined> {
  const [row] = await executor.select().from(bookingReservations).where(eq(bookingReservations.clientId, clientId))
    .orderBy(desc(bookingReservations.createdAt), desc(bookingReservations.id)).limit(1);
  return row;
}

/** Called within the owning client's transaction too, not just at HTTP entry. */
export async function assertReservationOpen(client: Pick<Client, "id" | "tenantId" | "assignedSlotId">, executor: any = db): Promise<BookingReservation | undefined> {
  if (!isCyaPsychologyTenant(client.tenantId)) return undefined;
  const hold = await latestReservation(client.id, executor);
  if (!hold) return undefined; // Legacy bookings never acquire retroactive deadlines.
  if (hold.status === "confirmed") return hold;
  if (hold.status !== "active" || hold.deadline.getTime() <= Date.now() || hold.slotId !== client.assignedSlotId) {
    throw new ReservationError(hold.status === "payment_check" || hold.status === "payment_review" ? 409 : 410,
      hold.status === "payment_check" || hold.status === "payment_review"
        ? "Payment check needed. Please contact the practice; do not make another payment."
        : "This reservation has expired or was cancelled. Please contact the practice for fresh appointment choices.");
  }
  return hold;
}

export async function reservationPaymentLock(tx: any, clientId: string, tenantId: string) {
  // Same lock as existing registration payment resource creation. Always before client lock.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${clientId}:payment-link-creation`}))`);
}

export async function guardReservationMutation(clientId: string, tenantId: string, executor: any = db) {
  if (!isCyaPsychologyTenant(tenantId)) return;
  const hold = await latestReservation(clientId, executor);
  if (hold && liveReservationStatuses.includes(hold.status as any)) {
    throw new ReservationError(409, "Use Cancel reservation and complete its payment check before changing this client's allocation or archiving it.");
  }
}

export async function reservationAudit(tx: any, tenantId: string, clientId: string, action: string, details: Record<string, unknown> = {}, userId?: string) {
  await tx.insert(auditLogs).values({
    tenantId, userId: userId || null, resourceType: "client", resourceId: clientId,
    action, details, ipAddress: null,
  });
}

/** Disable payment entry, close open checkouts, then prove nonpayment. Fail closed on ANY unknown. */
export async function stopReservationPayment(stripe: Stripe, client: Client, hold: BookingReservation): Promise<"unpaid" | "paid"> {
  if (client.paymentStatus === "active") return "paid";
  if (!client.registrationPaymentAttemptKey && !client.stripePaymentLinkId) return "unpaid";
  let linkId = client.stripePaymentLinkId;
  if (!linkId) throw new Error("Payment setup outcome needs reconciliation");
  const link = await stripe.paymentLinks.retrieve(linkId);
  if (link.metadata.tenantId !== hold.tenantId || link.metadata.clientId !== client.id ||
      link.metadata.registrationAttemptKey !== client.registrationPaymentAttemptKey) throw new Error("Payment ownership mismatch");
  await stripe.paymentLinks.update(linkId, { active: false });
  // Expiring an already-completed session may race with payment. Always re-read instead of assuming an error means unpaid.
  for await (const session of stripe.checkout.sessions.list({ payment_link: linkId, limit: 100 })) {
    if (session.status === "open") {
      try { await stripe.checkout.sessions.expire(session.id); }
      catch { /* re-read and inspect below */ }
    }
  }
  let paid = false;
  for await (const session of stripe.checkout.sessions.list({ payment_link: linkId, limit: 100 })) {
    if (session.metadata?.tenantId !== hold.tenantId || session.metadata?.clientId !== client.id ||
        session.metadata?.registrationAttemptKey !== client.registrationPaymentAttemptKey) throw new Error("Checkout ownership mismatch");
    if (session.status === "open") throw new Error("Checkout is still open");
    if (session.payment_status === "paid") { paid = true; continue; }
    const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (intentId) {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status === "succeeded") { paid = true; continue; }
      // Card methods only today. Never release processing, authorised or actionable intents.
      if (intent.status === "requires_payment_method") {
        const cancelled = await stripe.paymentIntents.cancel(intent.id);
        if (cancelled.status !== "canceled") throw new Error("Payment intent could not be closed");
      } else if (intent.status !== "canceled") {
        throw new Error("Payment is still processing or authorised");
      }
    }
    if (session.status === "complete") throw new Error("Completed checkout payment outcome is unknown");
  }
  return paid ? "paid" : "unpaid";
}

export async function settleReservation(reservationId: string, tenantId: string, cancel = false, userId?: string) {
  if (!isCyaPsychologyTenant(tenantId)) throw new ReservationError(404, "Reservation not found");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new ReservationError(404, "Practice not found");
  let key: string | null = null;
  try { key = tenant.stripeSecretKey ? decryptSecret(tenant.stripeSecretKey) : null; } catch { /* fail closed if payment exists */ }
  const result: { hold?: BookingReservation; paidClientId?: string; directClientId?: string } = await db.transaction(async tx => {
    const [observed] = await tx.select().from(bookingReservations).where(and(eq(bookingReservations.id, reservationId), eq(bookingReservations.tenantId, tenantId)));
    if (!observed) throw new ReservationError(404, "Reservation not found");
    await reservationPaymentLock(tx, observed.clientId, tenantId);
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, observed.clientId), eq(clients.tenantId, tenantId))).for("update");
    const [hold] = await tx.select().from(bookingReservations).where(eq(bookingReservations.id, reservationId)).for("update");
    if (hold?.status === "confirmed" && hold.followUpPending) {
      await tx.update(bookingReservations).set({ lastCheckedAt: new Date() }).where(eq(bookingReservations.id, hold.id));
    }
    if (!client || !hold || !liveReservationStatuses.includes(hold.status as any)) return { hold };
    if (hold.status === "payment_review") return { hold };
    const [snapshot] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots).where(eq(bookingSnapshots.clientId, client.id)).limit(1);
    const external = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, client.id),
      inArray(auditLogs.action, ["activity_external_booking_reviewed", "activity_writeupp_appointment_arranged"]),
    )).limit(1);
    if (snapshot || client.managerConfirmedAt || external.length || ["Scheduled", "BookingConfirmed"].includes(client.status)) {
      const [finished] = await tx.update(bookingReservations).set({ status: "confirmed", endedAt: new Date() }).where(eq(bookingReservations.id, hold.id)).returning();
      return { hold: finished };
    }
    if (!cancel && hold.status === "active" && hold.deadline.getTime() > Date.now()) return { hold };
    await tx.update(bookingReservations).set({ lastCheckedAt: new Date() }).where(eq(bookingReservations.id, hold.id));
    const check = async (reason: string) => {
      const [checked] = await tx.update(bookingReservations).set({
        status: "payment_check", reason,
        paymentAttemptKey: client.registrationPaymentAttemptKey, paymentLinkId: client.stripePaymentLinkId,
      }).where(eq(bookingReservations.id, hold.id)).returning();
      return { hold: checked };
    };
    if (client.assignedSlotId !== hold.slotId || client.assignedClinicianId !== hold.clinicianId) {
      return check("Reservation ownership changed. Staff must review before releasing this slot.");
    }
    if (client.status === "RegistrationPending" && (client.paymentType === "insurer" || !tenant.paymentsEnabled) &&
        client.registrationFormSubmissionId && client.termsAcceptedAt && client.termsAcceptedAt <= hold.deadline) {
      const [submission] = await tx.select({ id: formSubmissions.id }).from(formSubmissions).where(and(
        eq(formSubmissions.id, client.registrationFormSubmissionId), eq(formSubmissions.clientId, client.id),
        eq(formSubmissions.tenantId, tenantId), eq(formSubmissions.isDraft, false),
      )).limit(1);
      if (!submission) return check("Submitted registration needs staff review.");
      const checked = await check("Registration completed. Finishing booking confirmation.");
      await tx.update(bookingReservations).set({ followUpPending: true }).where(eq(bookingReservations.id, hold.id));
      return { ...checked, directClientId: client.id };
    }
    let paid = client.paymentStatus === "active";
    try {
      if (client.registrationPaymentAttemptKey || client.stripePaymentLinkId) {
        if (!key) throw new Error("Practice payment service unavailable");
        // Recover resources created before a crash using the EXISTING stable provider keys.
        if (!client.stripePaymentLinkId && client.registrationPaymentAttemptKey) {
          if (!client.termsAcceptedAt || Date.now() - client.termsAcceptedAt.getTime() > 23 * 60 * 60 * 1000) {
            throw new Error("Provider idempotency recovery window elapsed");
          }
          const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
          if (!base || !client.agreedRatePence) throw new Error("Payment setup is incomplete");
          const recovered = await createPaymentLink({
            clientId: client.id, clientDisplayId: client.displayId, amountPence: client.agreedRatePence,
            successUrl: `${base}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            tenantId, tenantStripeKey: key, tenantOwnedOnly: true, practiceName: tenant.name,
            childName: tenant.intakeClientSummaryEnabled ? childNameFromClientNotes(client.notes) : undefined,
            idempotencyKey: `registration-payment-${client.id}-${client.registrationPaymentAttemptKey}`,
            registrationAttemptKey: client.registrationPaymentAttemptKey,
          });
          if (!recovered) throw new Error("Payment setup cannot be inspected");
          client.stripePaymentLinkId = recovered.paymentLinkId;
          await tx.update(clients).set({ stripePaymentLinkId: recovered.paymentLinkId }).where(eq(clients.id, client.id));
        }
        const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
        paid = await stopReservationPayment(stripe, client, hold) === "paid";
      }
    } catch {
      return check("Payment check needed. The slot remains reserved until this practice's payment outcome can be verified.");
    }
    if (paid) {
      const checked = await check("Payment received. Finishing booking confirmation; do not request another payment.");
      await tx.update(bookingReservations).set({ followUpPending: true }).where(eq(bookingReservations.id, hold.id));
      return { ...checked, paidClientId: client.id };
    }
    const [slot] = await tx.select().from(timeSlots).where(eq(timeSlots.id, hold.slotId)).for("update");
    const otherOwners = await tx.select({ id: clients.id }).from(clients).where(and(
      eq(clients.assignedSlotId, hold.slotId), ne(clients.id, client.id),
      inArray(clients.status, ["Assigned", "AwaitingConfirmation", "OptionSelected", "RegistrationPending", "Scheduled", "BookingConfirmed"]),
    )).limit(1);
    if (!slot || slot.retiredAt || otherOwners.length) return check("Appointment ownership needs staff review; no slot was released.");
    const endedAt = new Date();
    await tx.update(timeSlots).set({ isBooked: false }).where(and(eq(timeSlots.id, hold.slotId), isNull(timeSlots.retiredAt)));
    await tx.update(clinicians).set({ currentLoad: sql`greatest(0, ${clinicians.currentLoad} - 1)` }).where(eq(clinicians.id, hold.clinicianId));
    await tx.update(clients).set({
      status: isClientStatus(hold.previousStatus) ? hold.previousStatus : "Forms Completed",
      assignedSlotId: null, assignedClinicianId: null, assignedSlot: null,
      registrationTokenRevokedAt: endedAt, stripeCheckoutUrl: null, paymentStatus: "none", updatedAt: endedAt,
      // Preserve all submitted forms, consent, attempt and financial history.
    }).where(eq(clients.id, client.id));
    if (hold.invitationId) await tx.update(clinicianInvitations).set({ status: "closed" }).where(eq(clinicianInvitations.id, hold.invitationId));
    const [finished] = await tx.update(bookingReservations).set({
      status: cancel ? "cancelled" : "expired", endedAt,
      reason: cancel ? "Cancelled by staff. Send fresh clinician choices or agree a new slot." : "Reservation expired. Send fresh clinician choices or agree a new slot.",
      paymentAttemptKey: client.registrationPaymentAttemptKey, paymentLinkId: client.stripePaymentLinkId,
    }).where(eq(bookingReservations.id, hold.id)).returning();
    await reservationAudit(tx, tenantId, client.id, cancel ? "activity_reservation_cancelled" : "activity_reservation_expired", { reservationId: hold.id }, userId);
    return { hold: finished };
  });
  if (result.directClientId) {
    await confirmBooking({ clientId: result.directClientId, tenantId, source: "registration" });
    const finished = await latestReservation(result.directClientId);
    if (finished) await finishRecoveredReservation(finished, tenant);
    return finished;
  }
  if (result.paidClientId && key) {
    const outcome = await reconcileRegistrationPayment({ ...tenant, stripeSecretKey: key }, result.paidClientId);
    if (outcome.state !== "recorded") return { ...result.hold, reason: "Payment received; booking finalisation needs staff review. Do not request another payment." };
    const finished = await latestReservation(result.paidClientId);
    if (finished) await finishRecoveredReservation(finished, tenant);
    return finished;
  }
  if (result.hold?.status === "confirmed" && result.hold.followUpPending) await finishRecoveredReservation(result.hold, tenant);
  return result.hold;
}

let scanning = false;
export async function sweepReservations() {
  if (scanning) return;
  scanning = true;
  try {
    const due = await db.select({ id: bookingReservations.id, tenantId: bookingReservations.tenantId }).from(bookingReservations).where(or(
      and(inArray(bookingReservations.status, ["active", "payment_check"]), lte(bookingReservations.deadline, new Date())),
      and(eq(bookingReservations.status, "confirmed"), eq(bookingReservations.followUpPending, true)),
    )).orderBy(sql`coalesce(${bookingReservations.lastCheckedAt}, ${bookingReservations.createdAt})`, bookingReservations.deadline).limit(50);
    for (const hold of due) {
      try { await settleReservation(hold.id, hold.tenantId); }
      catch { console.error("Reservation reconciliation failed; ownership preserved", { reservationId: hold.id }); }
    }
  } finally { scanning = false; }
}

/** Await on availability reads/claims as well as background sweep (scale-to-zero safe). */
export async function reconcileDueReservations(tenantId: string) {
  if (!isCyaPsychologyTenant(tenantId)) return;
  const due = await db.select({ id: bookingReservations.id }).from(bookingReservations).where(and(
    eq(bookingReservations.tenantId, tenantId), eq(bookingReservations.status, "active"), lte(bookingReservations.deadline, new Date()),
  )).limit(50);
  for (const hold of due) await settleReservation(hold.id, tenantId);
}

export async function flagLateReservationPayment(tenantId: string, clientId: string, attemptKey: string | undefined, linkId: string | undefined): Promise<boolean> {
  if (!isCyaPsychologyTenant(tenantId) || !attemptKey || !linkId) return false;
  return db.transaction(async tx => {
    const [client] = await tx.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId))).for("update");
    if (!client) return false;
    const [old] = await tx.select().from(bookingReservations).where(and(
      eq(bookingReservations.clientId, clientId), eq(bookingReservations.tenantId, tenantId),
      eq(bookingReservations.paymentAttemptKey, attemptKey), eq(bookingReservations.paymentLinkId, linkId),
      inArray(bookingReservations.status, ["expired", "cancelled"]),
    )).limit(1);
    if (!old) return false;
    // Keep the historical hold terminal (a new live hold may exist); expose a separate financial alert.
    await reservationAudit(tx, tenantId, clientId, "activity_reservation_late_payment", { reservationId: old.id, reviewRequired: true });
    await tx.update(bookingReservations).set({ latePaymentReviewRequired: true, reason: "Late payment reported on an expired reservation. Verify the payment in this practice's Stripe account; no booking was created from this event." })
      .where(eq(bookingReservations.id, old.id));
    return true;
  });
}
