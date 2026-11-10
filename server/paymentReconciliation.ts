import Stripe from "stripe";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { bookingSnapshots, clients, formSubmissions, paymentCharges, type BookingSnapshot, type Client, type Tenant } from "@shared/schema";
import { canInspectRegistrationPayment } from "@shared/paymentReconciliationEligibility";
import { confirmBooking } from "./bookingConfirmation";
import { generateBookingConfirmedEmail, sendEmail } from "./email";
import { isCyaPsychologyTenant } from "@shared/practicePolicies";
import { latestReservation, reservationPaymentMatches } from "./reservationLifecycle";

async function reservationPaymentSafe(client: Client, executor: any = db) {
  if (!isCyaPsychologyTenant(client.tenantId)) return true;
  const hold = await latestReservation(client.id, executor);
  return !hold || (["active", "payment_check", "confirmed"].includes(hold.status) && reservationPaymentMatches(client, hold));
}

type State = "awaiting" | "open" | "paid_unrecorded" | "recorded" | "uncertain";
export type PaymentInspection = {
  state: State; detail: string; sessionId?: string; blocker?: string;
  confirmationEmail?: "accepted_by_provider" | "not_recorded" | "not_enabled";
};

// Do not use getStripeInstance here: that legacy helper prefers a global key
// over the tenant's key. Reconciliation must never search a different account.
function provider(tenant: Tenant) {
  if (!tenant.stripeSecretKey) throw new Error("Tenant Stripe key is not configured");
  return new Stripe(tenant.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" });
}

async function hasSubmittedRegistration(client: Client, tenantId: string, executor: any = db): Promise<boolean> {
  if (!client.registrationFormSubmissionId) return false;
  const [submission] = await executor.select({ id: formSubmissions.id }).from(formSubmissions).where(and(
    eq(formSubmissions.id, client.registrationFormSubmissionId),
    eq(formSubmissions.clientId, client.id),
    eq(formSubmissions.tenantId, tenantId),
    eq(formSubmissions.isDraft, false),
  )).limit(1);
  return !!submission;
}

async function inspect(tenant: Tenant, clientId: string, requestedSessionId?: string) {
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.tenantId, tenant.id))).limit(1);
  if (!client) return { state: "uncertain", detail: "Client not found in this practice." } as PaymentInspection;
  if (!await reservationPaymentSafe(client)) {
    return { state: "uncertain", detail: "The reservation's original payment needs staff review. No payment or booking was changed; do not request another payment." } as PaymentInspection;
  }
  if (!canInspectRegistrationPayment(client) || !client.agreedRatePence ||
      !client.stripePaymentLinkId || !client.registrationPaymentAttemptKey) {
    return { state: "uncertain", detail: "No current registration payment link, attempt or agreed rate is recorded." } as PaymentInspection;
  }
  // A legacy awaiting-confirmation status is only eligible for provider
  // inspection when its linked registration is an actual submitted response
  // owned by this tenant and client. This is a read-only gate before Stripe.
  if (client.status === "AwaitingConfirmation" && !await hasSubmittedRegistration(client, tenant.id)) {
    return { state: "uncertain", detail: "The linked registration is missing, unsubmitted or does not belong to this client and practice." } as PaymentInspection;
  }
  try {
    const stripe = provider(tenant);
    const link = await stripe.paymentLinks.retrieve(client.stripePaymentLinkId);
    if (link.metadata?.clientId !== client.id || link.metadata?.tenantId !== tenant.id ||
        link.metadata?.registrationAttemptKey !== client.registrationPaymentAttemptKey) {
      return { state: "uncertain", detail: "Stored Stripe link does not belong to this client's current payment attempt." } as PaymentInspection;
    }
    let open = false;
    let paid: { sessionId: string; intentId: string; customerId: string | null; methodId: string | null } | null = null;
    for await (const session of stripe.checkout.sessions.list({ payment_link: client.stripePaymentLinkId, limit: 100 })) {
      if (requestedSessionId && session.id !== requestedSessionId) continue;
      if (session.status === "open") open = true;
      if (session.payment_status !== "paid" || session.status !== "complete") continue;
      const paymentLinkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
      const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (session.metadata?.tenantId !== tenant.id || session.metadata?.clientId !== client.id ||
          session.metadata?.registrationAttemptKey !== client.registrationPaymentAttemptKey ||
          paymentLinkId !== client.stripePaymentLinkId || !intentId ||
          session.amount_total !== client.agreedRatePence || session.currency !== "gbp") {
        return { state: "uncertain", detail: "Completed checkout has mismatched ownership, attempt, currency or amount. Review in Stripe; no state was changed." } as PaymentInspection;
      }
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status !== "succeeded" || intent.amount_received !== client.agreedRatePence ||
          intent.currency !== "gbp" || intent.metadata?.clientId !== client.id ||
          intent.metadata?.tenantId !== tenant.id || intent.metadata?.registrationAttemptKey !== client.registrationPaymentAttemptKey) {
        return { state: "uncertain", detail: "Payment intent does not confirm this client's agreed payment. No state was changed." } as PaymentInspection;
      }
      if (paid && paid.intentId !== intentId) {
        return { state: "uncertain", detail: "More than one paid checkout exists. Review in Stripe before proceeding." } as PaymentInspection;
      }
      paid = {
        sessionId: session.id, intentId,
        customerId: typeof session.customer === "string" ? session.customer : session.customer?.id || null,
        methodId: typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id || null,
      };
    }
    if (!paid) {
      return { state: open ? "open" : "awaiting", detail: open
        ? "Checkout is open; wait for Stripe payment or review it before sending another request."
        : "Stripe has no completed payment on the current link. Check this practice's Stripe account for any payment made outside this link before taking another payment." } as PaymentInspection;
    }
    const snapshotPredicate = client.assignedSlotId
      ? and(
          eq(bookingSnapshots.clientId, client.id),
          eq(bookingSnapshots.tenantId, tenant.id),
          eq(bookingSnapshots.slotId, client.assignedSlotId),
        )
      : and(eq(bookingSnapshots.clientId, client.id), eq(bookingSnapshots.tenantId, tenant.id));
    const [snapshot] = await db.select({ id: bookingSnapshots.id }).from(bookingSnapshots)
      .where(snapshotPredicate).orderBy(desc(bookingSnapshots.confirmedAt), desc(bookingSnapshots.id)).limit(1);
    const [charge] = await db.select().from(paymentCharges)
      .where(and(eq(paymentCharges.stripePaymentIntentId, paid.intentId), eq(paymentCharges.tenantId, tenant.id))).limit(1);
    const recorded = client.paymentStatus === "active" && !!snapshot &&
      ["Scheduled", "BookingConfirmed"].includes(client.status) &&
      charge?.status === "succeeded" && charge.clientId === client.id &&
      charge.amountPence === client.agreedRatePence &&
      (!tenant.bookingConfirmedEmailEnabled || !!client.bookingConfirmationSentAt);
    return {
      state: recorded ? "recorded" : "paid_unrecorded",
      sessionId: paid.sessionId,
      detail: recorded ? "Stripe payment and booking are recorded. The external practice appointment still requires staff confirmation."
        : "Stripe confirms payment, but the app has not finished booking progression.",
      blocker: !snapshot && (!client.assignedSlotId || !client.assignedClinicianId)
        ? "The allocated slot or clinician is missing; staff must resolve this before booking can be confirmed." : undefined,
      confirmationEmail: tenant.bookingConfirmedEmailEnabled
        ? (client.bookingConfirmationSentAt ? "accepted_by_provider" : "not_recorded")
        : "not_enabled",
      paid, client, stripe,
    } as const;
  } catch (error) {
    console.error("Payment reconciliation: provider check failed");
    return { state: "uncertain", detail: "Stripe could not be checked. No payment or booking state was changed." } as const;
  }
}

export async function inspectRegistrationPayment(tenant: Tenant, clientId: string): Promise<PaymentInspection> {
  const result = await inspect(tenant, clientId);
  return { state: result.state, detail: result.detail, sessionId: result.sessionId, blocker: result.blocker, confirmationEmail: result.confirmationEmail };
}

export async function reconcileRegistrationPayment(
  tenant: Tenant,
  clientId: string,
  sessionId?: string,
  afterConfirmation?: (details: { client: Client; snapshot: BookingSnapshot; intentId: string }) => Promise<void>,
): Promise<PaymentInspection> {
  const checked = await inspect(tenant, clientId, sessionId);
  if (!["paid_unrecorded", "recorded"].includes(checked.state) || !("paid" in checked) || !checked.paid || !checked.client || !checked.stripe) {
    return { state: checked.state, detail: checked.detail, blocker: checked.blocker };
  }
  const { paid, client, stripe } = checked;
  const verifiedAmountPence = client.agreedRatePence;
  // Serialize competing staff requests and webhook deliveries per client. Recheck
  // current ownership/attempt while locked, before persisting provider evidence.
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenant.id}:${client.id}:reconcile-payment`}))`);
      const [current] = await tx.select().from(clients).where(and(eq(clients.id, client.id), eq(clients.tenantId, tenant.id))).for("update").limit(1);
      if (current && !await reservationPaymentSafe(current, tx)) throw new Error("Reservation payment changed; staff review required.");
      if (!current || !canInspectRegistrationPayment(current) ||
          current.stripePaymentLinkId !== client.stripePaymentLinkId ||
          current.registrationPaymentAttemptKey !== client.registrationPaymentAttemptKey ||
          current.agreedRatePence !== verifiedAmountPence ||
          ((client.status === "AwaitingConfirmation" || current.status === "AwaitingConfirmation") &&
            current.registrationFormSubmissionId !== client.registrationFormSubmissionId)) {
        throw new Error("The client's rate, payment attempt or workflow changed. Refresh and review.");
      }
      if (current.status === "AwaitingConfirmation" &&
          !await hasSubmittedRegistration(current, tenant.id, tx)) {
        throw new Error("The linked registration is missing, unsubmitted or does not belong to this client and practice.");
      }
      await tx.insert(paymentCharges).values({
        clientId: client.id, tenantId: tenant.id, amountPence: current.agreedRatePence!,
        stripePaymentIntentId: paid.intentId, status: "succeeded",
        notes: "Initial session payment verified with Stripe",
      }).onConflictDoNothing();
      const [charge] = await tx.select().from(paymentCharges).where(eq(paymentCharges.stripePaymentIntentId, paid.intentId)).limit(1);
      if (!charge || charge.clientId !== client.id || charge.tenantId !== tenant.id ||
          charge.amountPence !== current.agreedRatePence) {
        throw new Error("This Stripe payment is already associated with a different record.");
      }
      if (charge.status !== "succeeded") {
        await tx.update(paymentCharges).set({ status: "succeeded", failureReason: null })
          .where(and(eq(paymentCharges.id, charge.id), eq(paymentCharges.clientId, client.id),
            eq(paymentCharges.tenantId, tenant.id), eq(paymentCharges.stripePaymentIntentId, paid.intentId)));
      }
      await tx.update(clients).set({
        paymentStatus: "active", stripeCustomerId: paid.customerId || current.stripeCustomerId,
        stripePaymentMethodId: paid.methodId || current.stripePaymentMethodId, updatedAt: new Date(),
      }).where(and(eq(clients.id, client.id), eq(clients.tenantId, tenant.id),
        eq(clients.stripePaymentLinkId, client.stripePaymentLinkId!),
        eq(clients.registrationPaymentAttemptKey, client.registrationPaymentAttemptKey!)));
    });
    await stripe.paymentLinks.update(client.stripePaymentLinkId!, { active: false });
    if (paid.customerId) {
      try {
        await stripe.customers.update(paid.customerId, {
          metadata: { clientId: client.id, displayId: client.displayId },
        });
      } catch (error) {
        // Do not revoke a verified payment if optional customer enrichment fails.
        // Retrying reconciliation repeats this idempotent metadata update.
        console.error("Payment reconciliation: failed to tag Stripe customer", error);
      }
    }
    // Confirmation is itself transactional and idempotent; a missing slot leaves
    // payment evidence intact and an actionable blocker rather than inventing a booking.
    const confirmation = await confirmBooking({
      clientId: client.id, tenantId: tenant.id, source: "stripe",
      expectedPaymentLinkId: client.stripePaymentLinkId!,
      expectedPaymentAttemptKey: client.registrationPaymentAttemptKey!,
      idempotencyKey: `stripe-booking-confirmation-${client.id}-${paid.intentId}`,
    });
    if (confirmation.status === "BookingConfirmed" && tenant.bookingConfirmedEmailEnabled && !confirmation.client.bookingConfirmationSentAt) {
      const message = await generateBookingConfirmedEmail({
        clinicianName: confirmation.snapshot.clinicianName, type: confirmation.snapshot.slotType,
        day: confirmation.snapshot.day, date: confirmation.snapshot.date,
        startTime: confirmation.snapshot.startTime, endTime: confirmation.snapshot.endTime,
        locationType: confirmation.snapshot.locationType,
      }, { id: tenant.id, name: tenant.name, fromEmail: tenant.fromEmail, primaryColor: tenant.primaryColor });
      const sent = await sendEmail({
        ...message, to: client.email,
        idempotencyKey: `stripe-booking-confirmation-${client.id}-${paid.intentId}`,
      });
      if (!sent.success) throw new Error("Booking email was not accepted; retry reconciliation");
      await db.update(clients).set({ bookingConfirmationSentAt: new Date() })
        .where(and(eq(clients.id, client.id), eq(clients.tenantId, tenant.id)));
    }
    await afterConfirmation?.({ client, snapshot: confirmation.snapshot, intentId: paid.intentId });
    return {
      state: "recorded",
      detail: "Stripe payment and booking are recorded. Staff must still schedule the appointment in the external practice system.",
      confirmationEmail: tenant.bookingConfirmedEmailEnabled ? "accepted_by_provider" : "not_enabled",
    };
  } catch (error) {
    console.error("Payment reconciliation: finalization incomplete");
    return {
      state: "paid_unrecorded",
      detail: "Stripe confirms payment, but app finalization needs attention. Retry reconciliation; do not send another payment request.",
      blocker: error instanceof Error ? error.message : "Contact support to investigate this payment.",
      confirmationEmail: "not_recorded",
    };
  }
}