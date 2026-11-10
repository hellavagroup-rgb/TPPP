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
  const [snapshot] = await db.select().from(bookingSnapshots).where(and(
    eq(bookingSnapshots.clientId, hold.clientId),
    eq(bookingSnapshots.tenantId, tenant.id),
    eq(bookingSnapshots.slotId, hold.slotId),
  )).orderBy(desc(bookingSnapshots.confirmedAt), desc(bookingSnapshots.id)).limit(1);
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
      locationType: snapshot.locationType,
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

/** Payment identity belongs to the hold, not the mutable client pointer. Missing
 * historical identity is uncertainty too: never adopt an arbitrary current link. */
export function reservationPaymentMatches(client: Client, hold: BookingReservation): boolean {
  if ((client.registrationPaymentAttemptKey || null) !== hold.paymentAttemptKey ||
      (client.stripePaymentLinkId || null) !== hold.paymentLinkId) return false;
  if (hold.paymentAttemptKey || hold.paymentLinkId) return true;
  // Null == null is not payment evidence after registration has progressed.
  // Only a pristine, not-yet-submitted hold has no payment journey to close.
  // Legacy/missing identities must never be reconstructed from current pointers.
  return client.status === "OptionSelected" &&
    !client.paymentType && client.paymentStatus === "none" &&
    !client.stripeCheckoutUrl && !client.registrationFormSubmissionId && !client.termsAcceptedAt;
}

/** Only called under the payment-creation lock and client lock, before/after
 * creating resources with the SAME provider idempotency key. Never replace. */
export async function bindReservationPayment(client: Client, attemptKey: string, linkId: string | null, tx: any) {
  if (!isCyaPsychologyTenant(client.tenantId)) return;
  const hold = await assertReservationOpen(client, tx);
  if (!hold) return;
  if (hold.status !== "active") throw new ReservationError(409, "This reservation is not open for payment setup.");
  if ((hold.paymentAttemptKey && hold.paymentAttemptKey !== attemptKey) ||
      (hold.paymentLinkId && hold.paymentLinkId !== linkId)) {
    throw new ReservationError(409, "Reservation payment changed. Staff must review the original payment; do not pay again.");
  }
  await tx.update(bookingReservations).set({ paymentAttemptKey: attemptKey, paymentLinkId: linkId })
    .where(and(eq(bookingReservations.id, hold.id), eq(bookingReservations.tenantId, client.tenantId!)));
}

export async function latestReservation(clientId: string, executor: any = db): Promise<BookingReservation | undefined> {
  const [row] = await executor.select().from(bookingReservations).where(eq(bookingReservations.clientId, clientId))
    .orderBy(desc(bookingReservations.createdAt), desc(bookingReservations.id)).limit(1);
  return row;
}

/** Called within the owning client's transaction too, not just at HTTP entry. */
export async function assertReservationOpen(client: Client, executor: any = db): Promise<BookingReservation | undefined> {
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
  if (!reservationPaymentMatches(client, hold)) {
    throw new ReservationError(409, "Reservation payment changed. Staff must review all earlier attempts; do not make another payment.");
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
  if (client.tenantId !== hold.tenantId || client.id !== hold.clientId) throw new Error("Reservation ownership mismatch");
  if (!reservationPaymentMatches(client, hold)) throw new Error("Reservation payment identity changed");
  if (client.paymentStatus === "active") return "paid";
  if (!hold.paymentAttemptKey && !hold.paymentLinkId) return "unpaid";
  const linkId = hold.paymentLinkId;
  if (!linkId) throw new Error("Payment setup outcome needs reconciliation");
  const link = await stripe.paymentLinks.retrieve(linkId);
  if (link.metadata.tenantId !== hold.tenantId || link.metadata.clientId !== client.id ||
      link.metadata.registrationAttemptKey !== hold.paymentAttemptKey) throw new Error("Payment ownership mismatch");
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
        session.metadata?.registrationAttemptKey !== hold.paymentAttemptKey) throw new Error("Checkout ownership mismatch");
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

type ReservationResolutionDecision = "release_unpaid" | "confirm_verified_payment";
type ReservationPaymentScan = {
  paid: Array<{ intentId: string; amountPence: number }>;
  blocked: string | null;
  inspectedLinks: Array<{ paymentLinkId: string; attemptKey: string }>;
  inspectedSessionIds: string[];
  inspectedPaymentIntentIds: string[];
};

function stripeForReservation(tenant: Tenant) {
  if (!tenant.stripeSecretKey) throw new Error("The practice's Stripe account is not configured.");
  return new Stripe(decryptSecret(tenant.stripeSecretKey), { apiVersion: "2026-05-27.dahlia" });
}

async function scanReservationPaymentAttempts(
  stripe: Stripe,
  tenant: Tenant,
  client: Client,
  hold: BookingReservation,
  additionalLinkIds: string[],
  executor: any,
): Promise<ReservationPaymentScan> {
  const ids = Array.from(new Set([hold.paymentLinkId, client.stripePaymentLinkId, ...additionalLinkIds].filter((id): id is string => !!id)));
  const knownAttempts = new Set([hold.paymentAttemptKey, client.registrationPaymentAttemptKey].filter((key): key is string => !!key));
  const inspectedSessionIds: string[] = [];
  const recordedCharges = await executor.select().from(paymentCharges).where(and(
    eq(paymentCharges.clientId, client.id), eq(paymentCharges.tenantId, tenant.id),
  ));
  const hasRecordedIntent = recordedCharges.some((charge: any) => !!charge.stripePaymentIntentId);
  if (!hold.paymentLinkId && additionalLinkIds.length === 0 && !hasRecordedIntent) {
    return { paid: [], blocked: "The reservation's original payment identity is incomplete. Add every related Payment Link ID found in this practice's Stripe account before resolving it.", inspectedLinks: [], inspectedSessionIds, inspectedPaymentIntentIds: [] };
  }
  if (ids.length === 0 && !hasRecordedIntent) {
    return { paid: [], blocked: "No verifiable payment attempt is recorded. The reservation remains held for review.", inspectedLinks: [], inspectedSessionIds, inspectedPaymentIntentIds: [] };
  }

  const paid = new Map<string, { intentId: string; amountPence: number }>();
  const inspectedLinks: Array<{ paymentLinkId: string; attemptKey: string }> = [];
  const seenAttempts = new Set<string>();
  const seenIntents = new Set<string>();
  const inspectIntent = async (intentId: string, expectedAttempt?: string, expectedAmount?: number) => {
    if (seenIntents.has(intentId)) return;
    seenIntents.add(intentId);
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.metadata?.tenantId !== tenant.id || intent.metadata?.clientId !== client.id ||
        !intent.metadata?.registrationAttemptKey ||
        (expectedAttempt && intent.metadata.registrationAttemptKey !== expectedAttempt)) {
      throw new Error("A payment intent has mismatched practice, client or attempt details.");
    }
    seenAttempts.add(intent.metadata.registrationAttemptKey);
    if (intent.status === "succeeded") {
      const amountPence = intent.amount_received ?? intent.amount;
      if (!client.agreedRatePence || amountPence !== client.agreedRatePence || intent.currency !== "gbp" ||
          (expectedAmount !== undefined && expectedAmount !== amountPence)) {
        throw new Error("A completed payment does not match the client's agreed amount and currency.");
      }
      const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
      if (!chargeId) throw new Error("The completed payment has no charge that can be checked for refunds or disputes.");
      const charge: any = await stripe.charges.retrieve(chargeId);
      const chargeIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (chargeIntentId !== intent.id || charge.paid !== true || charge.captured !== true ||
          charge.amount_captured !== client.agreedRatePence || charge.currency !== "gbp" ||
          charge.refunded === true || (charge.amount_refunded || 0) > 0 || charge.disputed === true) {
        throw new Error("The completed payment is refunded, disputed or otherwise not safe to confirm.");
      }
      paid.set(intent.id, { intentId: intent.id, amountPence });
      return;
    }
    if (intent.status === "requires_payment_method") {
      const cancelled = await stripe.paymentIntents.cancel(intent.id);
      if (cancelled.status !== "canceled") throw new Error("A payment attempt could not be safely closed.");
      const verified = await stripe.paymentIntents.retrieve(intent.id);
      if (verified.status !== "canceled") throw new Error("A payment attempt is still active.");
      return;
    }
    if (intent.status !== "canceled") throw new Error("A payment attempt is pending or has an uncertain outcome.");
  };

  for (const paymentLinkId of ids) {
    const link = await stripe.paymentLinks.retrieve(paymentLinkId);
    const attemptKey = link.metadata?.registrationAttemptKey;
    if (!attemptKey || link.metadata?.tenantId !== tenant.id || link.metadata?.clientId !== client.id) {
      throw new Error("A Payment Link does not belong to this client and practice.");
    }
    seenAttempts.add(attemptKey);
    inspectedLinks.push({ paymentLinkId, attemptKey });
    const deactivated = await stripe.paymentLinks.update(paymentLinkId, { active: false });
    if (deactivated.active !== false) throw new Error("A Payment Link could not be disabled.");

    const sessionsToExpire: string[] = [];
    for await (const session of stripe.checkout.sessions.list({ payment_link: paymentLinkId, limit: 100 })) {
      inspectedSessionIds.push(session.id);
      const sessionLinkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
      if (sessionLinkId !== paymentLinkId || session.metadata?.tenantId !== tenant.id ||
          session.metadata?.clientId !== client.id ||
          session.metadata?.registrationAttemptKey !== attemptKey) {
        throw new Error("A Checkout Session has mismatched practice, client, link or attempt details.");
      }
      if (session.status === "open") sessionsToExpire.push(session.id);
    }
    for (const sessionId of sessionsToExpire) {
      try { await stripe.checkout.sessions.expire(sessionId); }
      catch { /* A payment can complete while expiry races; the re-read below decides. */ }
    }

    for await (const session of stripe.checkout.sessions.list({ payment_link: paymentLinkId, limit: 100 })) {
      if (!inspectedSessionIds.includes(session.id)) inspectedSessionIds.push(session.id);
      const sessionLinkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
      if (sessionLinkId !== paymentLinkId || session.metadata?.tenantId !== tenant.id ||
          session.metadata?.clientId !== client.id ||
          session.metadata?.registrationAttemptKey !== attemptKey) {
        throw new Error("A Checkout Session has mismatched practice, client, link or attempt details.");
      }
      if (session.status === "open") throw new Error("A Checkout Session is still open.");
      const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (session.payment_status === "paid" && !intentId) throw new Error("A paid Checkout Session has no verifiable payment intent.");
      if (session.status === "complete" && (!client.agreedRatePence ||
          session.amount_total !== client.agreedRatePence || session.currency !== "gbp")) {
        throw new Error("A completed Checkout Session does not match the agreed amount and currency.");
      }
      if (intentId) await inspectIntent(intentId, attemptKey, session.amount_total ?? undefined);
      if (session.status === "complete" && !intentId) throw new Error("A completed Checkout Session has an uncertain payment outcome.");
    }
  }

  for (const attemptKey of Array.from(knownAttempts)) {
    if (!seenAttempts.has(attemptKey)) throw new Error("A recorded payment attempt has no matching, verifiable Payment Link or intent.");
  }

  for (const charge of recordedCharges) {
    if (charge.status === "succeeded" && !charge.stripePaymentIntentId)
      throw new Error("A successful payment record has no Stripe intent to verify.");
    if (charge.stripePaymentIntentId) await inspectIntent(charge.stripePaymentIntentId);
    if (charge.status === "pending") throw new Error("A payment is already recorded as pending.");
  }
  return {
    paid: Array.from(paid.values()), blocked: null, inspectedLinks, inspectedSessionIds,
    inspectedPaymentIntentIds: Array.from(seenIntents),
  };
}

/** An explicit staff resolution for conflicting/missing immutable payment identities.
 * Provider checks run only with the owning practice's Stripe key. References on
 * the hold and client are deliberately never rewritten or discarded. */
export async function resolveReservationPaymentConflict(input: {
  reservationId: string;
  tenantId: string;
  userId: string;
  decision: ReservationResolutionDecision;
  additionalPaymentLinkIds: string[];
}) {
  if (!isCyaPsychologyTenant(input.tenantId)) throw new ReservationError(404, "Reservation not found");
  const outcome: {
    hold: BookingReservation;
    resolved: boolean;
    paymentIntentId?: string;
    tenant?: Tenant;
  } = await db.transaction(async tx => {
    const [observed] = await tx.select().from(bookingReservations).where(and(
      eq(bookingReservations.id, input.reservationId), eq(bookingReservations.tenantId, input.tenantId),
    ));
    if (!observed) throw new ReservationError(404, "Reservation not found");
    await reservationPaymentLock(tx, observed.clientId, input.tenantId);
    const [client] = await tx.select().from(clients).where(and(
      eq(clients.id, observed.clientId), eq(clients.tenantId, input.tenantId),
    )).for("update");
    const [hold] = await tx.select().from(bookingReservations).where(and(
      eq(bookingReservations.id, input.reservationId), eq(bookingReservations.tenantId, input.tenantId),
    )).for("update");
    if (!client || !hold || !["payment_check", "payment_review"].includes(hold.status)) {
      throw new ReservationError(409, "Only a reservation held for payment review can use this resolution.");
    }
    if (hold.latePaymentReviewRequired) {
      throw new ReservationError(409, "A late-payment alert is attached. Review it separately before resolving this reservation.");
    }
    if (client.assignedSlotId !== hold.slotId || client.assignedClinicianId !== hold.clinicianId) {
      throw new ReservationError(409, "The appointment allocation changed. Keep the reservation held and review it.");
    }
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, input.tenantId));
    if (!tenant) throw new ReservationError(404, "Practice not found");

    let scan: ReservationPaymentScan | null = null;
    let blocked: string | null = null;
    try {
      const stripe = stripeForReservation(tenant);
      scan = await scanReservationPaymentAttempts(stripe, tenant, client, hold, input.additionalPaymentLinkIds, tx);
      blocked = scan.blocked;
    } catch {
      blocked = "Stripe could not verify every payment attempt in this practice's account. The slot remains reserved; do not request another payment.";
    }
    const paymentStatus = scan?.paid.length === 1 ? "one_verified_payment" : scan?.paid.length ? "multiple_verified_payments" : "no_verified_payment";
    if (!blocked && input.decision === "release_unpaid" && scan!.paid.length) {
      blocked = "Stripe found a completed payment. The hold was not released; confirm the verified payment or review duplicate payments.";
    } else if (!blocked && input.decision === "confirm_verified_payment" && scan!.paid.length !== 1) {
      blocked = scan!.paid.length === 0
        ? "No completed payment was verified. The hold remains reserved."
        : "More than one completed payment was found. Keep the hold reserved and review the duplicate payments.";
    }
    if (client.paymentStatus === "active" && input.decision !== "confirm_verified_payment" && !blocked) {
      blocked = "The client already has an active payment record. Keep the reservation held for review.";
    }
    if (client.paymentStatus === "active" && input.decision === "confirm_verified_payment" &&
        scan?.paid.length !== 1 && !blocked) {
      blocked = "The active payment record could not be matched to exactly one verified attempt. Keep the reservation held for review.";
    }
    if (blocked) {
      const reason = blocked;
      const [updated] = await tx.update(bookingReservations).set({ status: "payment_review", reason, lastCheckedAt: new Date() })
        .where(eq(bookingReservations.id, hold.id)).returning();
      await reservationAudit(tx, input.tenantId, client.id, "activity_reservation_payment_conflict_resolution", {
        reservationId: hold.id, decision: input.decision, result: "blocked", paymentStatus,
        inspectedPaymentLinks: scan?.inspectedLinks || [],
        inspectedSessionIds: scan?.inspectedSessionIds || [],
        inspectedPaymentIntentIds: scan?.inspectedPaymentIntentIds || [],
        additionalPaymentLinkIds: input.additionalPaymentLinkIds,
      }, input.userId);
      return { hold: updated!, resolved: false };
    }

    if (input.decision === "confirm_verified_payment") {
      const paid = scan!.paid[0];
      const [tenantCharge] = await tx.select().from(paymentCharges).where(and(
        eq(paymentCharges.stripePaymentIntentId, paid.intentId), eq(paymentCharges.tenantId, input.tenantId),
      )).limit(1);
      if (tenantCharge && (tenantCharge.clientId !== client.id || tenantCharge.amountPence !== paid.amountPence ||
          tenantCharge.status !== "succeeded")) {
        throw new ReservationError(409, "This Stripe payment is already associated with a different record.");
      }
      if (!tenantCharge) {
        await tx.insert(paymentCharges).values({
          clientId: client.id, tenantId: input.tenantId, amountPence: paid.amountPence,
          stripePaymentIntentId: paid.intentId, status: "succeeded",
          notes: "Initial session payment verified during reservation conflict resolution",
        }).onConflictDoNothing();
        const [charge] = await tx.select().from(paymentCharges).where(eq(paymentCharges.stripePaymentIntentId, paid.intentId)).limit(1);
        if (!charge || charge.clientId !== client.id || charge.tenantId !== input.tenantId ||
            charge.amountPence !== paid.amountPence || charge.status !== "succeeded") {
          throw new ReservationError(409, "This Stripe payment is already associated with a different record.");
        }
      }
      await tx.update(clients).set({ paymentStatus: "active", updatedAt: new Date() })
        .where(and(eq(clients.id, client.id), eq(clients.tenantId, input.tenantId)));
      await tx.update(bookingReservations).set({
        status: "payment_review", reason: "Payment verified in this practice's Stripe account. Finishing booking confirmation.",
        lastCheckedAt: new Date(),
      }).where(eq(bookingReservations.id, hold.id));
      await reservationAudit(tx, input.tenantId, client.id, "activity_reservation_payment_conflict_resolution", {
        reservationId: hold.id, decision: input.decision, result: "payment_verified",
        paymentIntentId: paid.intentId, amountPence: paid.amountPence,
        inspectedPaymentLinks: scan!.inspectedLinks,
        inspectedSessionIds: scan!.inspectedSessionIds,
        inspectedPaymentIntentIds: scan!.inspectedPaymentIntentIds,
        additionalPaymentLinkIds: input.additionalPaymentLinkIds,
      }, input.userId);
      return { hold, resolved: true, paymentIntentId: paid.intentId, tenant };
    }

    const [slot] = await tx.select().from(timeSlots).where(and(
      eq(timeSlots.id, hold.slotId), eq(timeSlots.tenantId, input.tenantId),
    )).for("update");
    const otherOwners = await tx.select({ id: clients.id }).from(clients).where(and(
      eq(clients.tenantId, input.tenantId), eq(clients.assignedSlotId, hold.slotId),
      ne(clients.id, client.id),
      inArray(clients.status, ["Assigned", "AwaitingConfirmation", "OptionSelected", "RegistrationPending", "Scheduled", "BookingConfirmed"]),
    )).limit(1);
    if (!slot || slot.retiredAt || otherOwners.length) {
      const reason = "The payment attempts are unpaid, but appointment ownership needs staff review; the slot remains reserved.";
      const [updated] = await tx.update(bookingReservations).set({ status: "payment_review", reason, lastCheckedAt: new Date() })
        .where(eq(bookingReservations.id, hold.id)).returning();
      await reservationAudit(tx, input.tenantId, client.id, "activity_reservation_payment_conflict_resolution", {
        reservationId: hold.id, decision: input.decision, result: "blocked_appointment_ownership",
        inspectedPaymentLinks: scan!.inspectedLinks,
        inspectedSessionIds: scan!.inspectedSessionIds,
        inspectedPaymentIntentIds: scan!.inspectedPaymentIntentIds,
      }, input.userId);
      return { hold: updated!, resolved: false };
    }
    const endedAt = new Date();
    await tx.update(timeSlots).set({ isBooked: false }).where(and(eq(timeSlots.id, hold.slotId), isNull(timeSlots.retiredAt)));
    await tx.update(clinicians).set({ currentLoad: sql`greatest(0, ${clinicians.currentLoad} - 1)` }).where(eq(clinicians.id, hold.clinicianId));
    await tx.update(clients).set({
      status: isClientStatus(hold.previousStatus) ? hold.previousStatus : "Forms Completed",
      assignedSlotId: null, assignedClinicianId: null, assignedSlot: null, assignedLocationType: null,
      registrationTokenRevokedAt: endedAt, stripeCheckoutUrl: null, paymentStatus: "none", updatedAt: endedAt,
    }).where(and(eq(clients.id, client.id), eq(clients.tenantId, input.tenantId)));
    if (hold.invitationId) await tx.update(clinicianInvitations).set({ status: "closed" }).where(eq(clinicianInvitations.id, hold.invitationId));
    const [updated] = await tx.update(bookingReservations).set({
      status: "cancelled", endedAt, reason: "Released by an administrator after every identified payment attempt was verified unpaid.",
    }).where(eq(bookingReservations.id, hold.id)).returning();
    await reservationAudit(tx, input.tenantId, client.id, "activity_reservation_payment_conflict_resolution", {
      reservationId: hold.id, decision: input.decision, result: "released_unpaid",
      inspectedPaymentLinks: scan!.inspectedLinks,
      inspectedSessionIds: scan!.inspectedSessionIds,
      inspectedPaymentIntentIds: scan!.inspectedPaymentIntentIds,
      additionalPaymentLinkIds: input.additionalPaymentLinkIds,
      originalPaymentAttemptKey: hold.paymentAttemptKey, originalPaymentLinkId: hold.paymentLinkId,
    }, input.userId);
    return { hold: updated!, resolved: true };
  });
  if (outcome.paymentIntentId) {
    try {
      await confirmBooking({
        clientId: outcome.hold.clientId, tenantId: input.tenantId, source: "stripe",
        idempotencyKey: `reservation-conflict-confirmation-${outcome.hold.id}-${outcome.paymentIntentId}`,
        reservationPaymentResolution: { reservationId: outcome.hold.id, paymentIntentId: outcome.paymentIntentId },
      });
    } catch {
      return { ...outcome.hold, status: "payment_review" as const,
        reason: "Payment is verified and recorded. Booking confirmation needs staff review; do not request another payment." };
    }
    const confirmed = await latestReservation(outcome.hold.clientId);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId));
    if (confirmed && tenant) await finishRecoveredReservation(confirmed, tenant);
    return confirmed;
  }
  return outcome.hold;
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
    const [snapshot] = await tx.select({ id: bookingSnapshots.id }).from(bookingSnapshots).where(and(
      eq(bookingSnapshots.clientId, client.id),
      eq(bookingSnapshots.tenantId, tenantId),
      eq(bookingSnapshots.slotId, hold.slotId),
    )).limit(1);
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
      }).where(eq(bookingReservations.id, hold.id)).returning();
      return { hold: checked };
    };
    if (client.assignedSlotId !== hold.slotId || client.assignedClinicianId !== hold.clinicianId) {
      return check("Reservation ownership changed. Staff must review before releasing this slot.");
    }
    if (!reservationPaymentMatches(client, hold)) {
      return check("The reservation's original payment attempt cannot be matched. Staff must check all earlier payments; the slot remains reserved. Do not request another payment.");
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
          await tx.update(bookingReservations).set({ paymentLinkId: recovered.paymentLinkId }).where(eq(bookingReservations.id, hold.id));
          hold.paymentLinkId = recovered.paymentLinkId;
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
      assignedSlotId: null, assignedClinicianId: null, assignedSlot: null, assignedLocationType: null,
      registrationTokenRevokedAt: endedAt, stripeCheckoutUrl: null, paymentStatus: "none", updatedAt: endedAt,
      // Preserve all submitted forms, consent, attempt and financial history.
    }).where(eq(clients.id, client.id));
    if (hold.invitationId) await tx.update(clinicianInvitations).set({ status: "closed" }).where(eq(clinicianInvitations.id, hold.invitationId));
    const [finished] = await tx.update(bookingReservations).set({
      status: cancel ? "cancelled" : "expired", endedAt,
      reason: cancel ? "Cancelled by staff. Send fresh clinician choices or agree a new slot." : "Reservation expired. Send fresh clinician choices or agree a new slot.",
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
      inArray(bookingReservations.status, ["expired", "cancelled", ...liveReservationStatuses]),
    )).limit(1);
    if (!old) return false;
    if (liveReservationStatuses.includes(old.status as any)) {
      if (reservationPaymentMatches(client, old)) return false;
      if (old.status === "payment_review" && old.latePaymentReviewRequired) return true;
      await reservationAudit(tx, tenantId, clientId, "activity_reservation_payment_review", { reservationId: old.id, reviewRequired: true });
      await tx.update(bookingReservations).set({
        status: "payment_review", latePaymentReviewRequired: true,
        reason: "Payment reported on the reservation's earlier link. Review all attempts in this practice's Stripe account; the slot remains reserved.",
      }).where(eq(bookingReservations.id, old.id));
      return true;
    }
    // Keep the historical hold terminal (a new live hold may exist); expose a separate financial alert.
    await reservationAudit(tx, tenantId, clientId, "activity_reservation_late_payment", { reservationId: old.id, reviewRequired: true });
    await tx.update(bookingReservations).set({ latePaymentReviewRequired: true, reason: "Late payment reported on an expired reservation. Verify the payment in this practice's Stripe account; no booking was created from this event." })
      .where(eq(bookingReservations.id, old.id));
    return true;
  });
}
