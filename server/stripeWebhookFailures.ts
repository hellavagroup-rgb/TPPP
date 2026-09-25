import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { clients, stripeWebhookFailures, type Tenant } from "@shared/schema";
import { db } from "./db";
import { buildFromAddress, sendEmail } from "./email";
import { storage } from "./storage";

type FailureReason = "stripe_unavailable" | "finalization_incomplete" | "processing_error";
const safeEventId = (id: unknown): id is string =>
  typeof id === "string" && /^evt_[a-zA-Z0-9]{1,100}$/.test(id);

// Only a signature-verified tenant can call these functions. Never persist provider
// errors, payloads, customer identifiers or unverified metadata as a reason.
export async function recordStripeWebhookFailure(
  tenantId: string | null, event: { id?: unknown; type?: unknown; data?: { object?: any } },
  reason: FailureReason,
) {
  if (!tenantId || !safeEventId(event.id)) return;
  const eventType = event.type === "checkout.session.completed" ? event.type
    : event.type === "payment_intent.succeeded" ? event.type
    : event.type === "payment_intent.payment_failed" ? event.type : "other";
  const possibleClientId = eventType === "checkout.session.completed" ? event.data?.object?.metadata?.clientId : null;
  const [ownedClient] = typeof possibleClientId === "string" && possibleClientId.length < 200
    ? await db.select({ id: clients.id, displayId: clients.displayId }).from(clients)
      .where(and(eq(clients.id, possibleClientId), eq(clients.tenantId, tenantId))).limit(1)
    : [];
  const [failure] = await db.insert(stripeWebhookFailures).values({
    tenantId, eventId: event.id, eventType, clientId: ownedClient?.id || null, reason,
  }).onConflictDoUpdate({
    target: [stripeWebhookFailures.tenantId, stripeWebhookFailures.eventId],
    set: {
      attempts: sql`case when ${stripeWebhookFailures.resolvedAt} is null then ${stripeWebhookFailures.attempts} + 1 else 1 end`,
      generation: sql`case when ${stripeWebhookFailures.resolvedAt} is null then ${stripeWebhookFailures.generation} else ${stripeWebhookFailures.generation} + 1 end`,
      firstFailedAt: sql`case when ${stripeWebhookFailures.resolvedAt} is null then ${stripeWebhookFailures.firstFailedAt} else now() end`,
      lastFailedAt: new Date(), reason,
      alertedAt: sql`case when ${stripeWebhookFailures.resolvedAt} is null then ${stripeWebhookFailures.alertedAt} else null end`,
      alertClaimedAt: sql`case when ${stripeWebhookFailures.resolvedAt} is null then ${stripeWebhookFailures.alertClaimedAt} else null end`,
      resolvedAt: null,
      // Keep the stored registration reference if a later retry has no metadata.
      clientId: sql`coalesce(${stripeWebhookFailures.clientId}, ${ownedClient?.id || null})`,
    },
  }).returning();
  if (!failure || failure.attempts < 3 || failure.alertedAt) return;

  // Atomic claim prevents competing deliveries from sending the same alert.
  // An abandoned claim can be reclaimed after five minutes; provider keys
  // deduplicate any send accepted just before a process crash.
  const claimedAt = new Date();
  const [claimed] = await db.update(stripeWebhookFailures).set({ alertClaimedAt: claimedAt })
    .where(and(eq(stripeWebhookFailures.id, failure.id), eq(stripeWebhookFailures.tenantId, tenantId),
      isNull(stripeWebhookFailures.alertedAt),
      or(isNull(stripeWebhookFailures.alertClaimedAt),
        lt(stripeWebhookFailures.alertClaimedAt, new Date(Date.now() - 5 * 60_000)))))
    .returning();
  if (!claimed) return;
  try {
    const tenant = await storage.getTenantById(tenantId);
    if (!tenant) throw new Error("Verified practice no longer exists");
    const admins = await storage.getAdminUsersByTenantId(tenantId);
    if (!admins.length) throw new Error("No administrator to notify");
    const display = ownedClient?.displayId || "unknown registration";
    const message = `Stripe has retried webhook event ${event.id} at least three times without successful processing.\n` +
      `Affected registration: ${display}.\n` +
      `Reason: ${reason.replaceAll("_", " ")}.\n` +
      `Open Client Allocation, find the registration by ID, and use Check Stripe payment followed by Reconcile verified payment if needed. ` +
      `Do not send another payment request until Stripe has been checked. In Stripe Dashboard, inspect this event and resend it after the underlying issue is fixed.\n` +
      `If the problem persists, ask support to investigate event ${event.id}.`;
    for (const admin of admins) {
      const result = await sendEmail({
        to: admin.email,
        from: buildFromAddress({ id: tenant.id, name: tenant.name, fromEmail: tenant.fromEmail, primaryColor: tenant.primaryColor }),
        subject: `Stripe webhook needs attention — ${tenant.name}`,
        text: message,
        html: `<p>${message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>")}</p>`,
        idempotencyKey: `stripe-webhook-alert-${tenantId}-${event.id}-${failure.generation}-${admin.id}`,
      });
      if (!result.success) throw new Error("Alert delivery was not accepted");
    }
    await db.update(stripeWebhookFailures).set({ alertedAt: new Date() })
      .where(and(eq(stripeWebhookFailures.id, claimed.id), eq(stripeWebhookFailures.tenantId, tenantId),
        eq(stripeWebhookFailures.alertClaimedAt, claimedAt)));
  } catch {
    // Do not convert an alert transport failure into a webhook failure.
    // Release the claim so another Stripe retry can attempt the notification.
    await db.update(stripeWebhookFailures).set({ alertClaimedAt: null })
      .where(and(eq(stripeWebhookFailures.id, claimed.id), eq(stripeWebhookFailures.tenantId, tenantId),
        eq(stripeWebhookFailures.alertClaimedAt, claimedAt)));
    console.error("Stripe webhook alert could not be delivered", { tenantId, eventId: event.id });
  }
}

export async function resolveStripeWebhookFailure(tenantId: string | null, eventId: unknown) {
  if (!tenantId || !safeEventId(eventId)) return;
  await db.update(stripeWebhookFailures).set({ resolvedAt: new Date() })
    .where(and(eq(stripeWebhookFailures.tenantId, tenantId), eq(stripeWebhookFailures.eventId, eventId),
      isNull(stripeWebhookFailures.resolvedAt)));
}

export async function listStripeWebhookFailures(tenantId: string) {
  return db.select({
    eventId: stripeWebhookFailures.eventId, eventType: stripeWebhookFailures.eventType,
    reason: stripeWebhookFailures.reason, attempts: stripeWebhookFailures.attempts,
    lastFailedAt: stripeWebhookFailures.lastFailedAt,
    clientId: clients.id, displayId: clients.displayId,
  }).from(stripeWebhookFailures)
    .leftJoin(clients, and(eq(clients.id, stripeWebhookFailures.clientId), eq(clients.tenantId, tenantId)))
    .where(and(eq(stripeWebhookFailures.tenantId, tenantId), isNull(stripeWebhookFailures.resolvedAt),
      gte(stripeWebhookFailures.attempts, 3)))
    .orderBy(sql`${stripeWebhookFailures.lastFailedAt} desc`).limit(50);
}